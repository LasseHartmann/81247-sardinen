import { describe, expect, it } from 'vitest';
import { TEAM_PALETTE } from '../src/config/gameConfig';
import {
  EXPECTED_ADMIN_AUTH_HASH,
  PRESET_PLAYERS,
  resolveAllowedPlayerByNameInput,
  verifyAdminCode,
} from '../src/config/players';
import { createDemoStore } from '../src/demo/demoStore';
import { destinationPoint } from '../src/geo/distance';
import { computeAveragedTeamLocationFromMemberFixes } from '../src/services/databaseAdapter';
import { evaluateLocationThrottle } from '../src/services/locationService';
import { createSyntheticDemoAudio } from '../src/services/mediaService';
import {
  generateSessionSecrets,
  serializeQrPayload,
  UNAMBIGUOUS_ALPHABET,
  verifyCatchSubmission,
} from '../src/services/qrService';

describe('Services: Location-Throttling (6s / 5m), QR-Alphabet & Synthetik-Audio', () => {
  it('erzwingt das 6s-Intervall, >5m-Mindestdistanz und 5-Nachkommastellen-Rundung beim GPS-Beacon', () => {
    const startPt = { lat: 48.16623456, lng: 11.46738912 };
    const first = evaluateLocationThrottle({
      nextFix: { ...startPt, accuracy: 8, timestamp: 1000 },
      lastSentPoint: null,
      lastSentAtMs: 0,
      nowMs: 1000,
    });
    expect(first.shouldSend).toBe(true);
    expect(first.roundedLat).toBe(48.16623);
    expect(first.roundedLng).toBe(11.46739);

    const moved20m = destinationPoint(
      { lat: first.roundedLat, lng: first.roundedLng },
      20,
      90
    );

    // Nach nur 4 Sekunden (< 6s) blockieren, selbst bei 20m Bewegung
    const blockedByTime = evaluateLocationThrottle({
      nextFix: { ...moved20m, accuracy: 8, timestamp: 5000 },
      lastSentPoint: { lat: first.roundedLat, lng: first.roundedLng },
      lastSentAtMs: 1000,
      nowMs: 5000,
    });
    expect(blockedByTime.shouldSend).toBe(false);

    // Nach 7 Sekunden, aber nur 3m Bewegung (<= 5m) blockieren
    const moved3m = destinationPoint(
      { lat: first.roundedLat, lng: first.roundedLng },
      3,
      90
    );
    const blockedByDist = evaluateLocationThrottle({
      nextFix: { ...moved3m, accuracy: 8, timestamp: 8000 },
      lastSentPoint: { lat: first.roundedLat, lng: first.roundedLng },
      lastSentAtMs: 1000,
      nowMs: 8000,
    });
    expect(blockedByDist.shouldSend).toBe(false);

    // Nach 7 Sekunden UND 20m Bewegung (> 5m) senden!
    const allowed = evaluateLocationThrottle({
      nextFix: { ...moved20m, accuracy: 8, timestamp: 8000 },
      lastSentPoint: { lat: first.roundedLat, lng: first.roundedLng },
      lastSentAtMs: 1000,
      nowMs: 8000,
    });
    expect(allowed.shouldSend).toBe(true);
  });

  it('generiert 100 Session-Codes ohne verwechslungsanfällige Zeichen (0, O, 1, I) und prüft QR-JSON-Payloads', () => {
    expect(UNAMBIGUOUS_ALPHABET).not.toMatch(/[0O1I]/);
    for (let i = 0; i < 100; i++) {
      const { qrSecret, shortCode } = generateSessionSecrets();
      expect(qrSecret.length).toBe(32); // 128 Bit Hex
      expect(shortCode.length).toBe(6);
      expect(shortCode).not.toMatch(/[0O1I]/);

      const json = serializeQrPayload('sess_1', qrSecret, shortCode);
      expect(
        verifyCatchSubmission(json, 'sess_1', 'sess_1', qrSecret, shortCode).valid
      ).toBe(true);
      expect(
        verifyCatchSubmission(json, 'sess_old', 'sess_1', qrSecret, shortCode).valid
      ).toBe(false);
    }
  });

  it('erzeugt ein abspielbares Demo-Audio strikt unterhalb des 25-KB-Limits', () => {
    const audio = createSyntheticDemoAudio();
    expect(audio.mimeType).toBe('audio/wav');
    expect(audio.dataUrl.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(audio.approxBytes).toBeLessThanOrEqual(25_000);
  });

  it('erlaubt beim Login exakt die 11 Namen und schaltet Admin-Rechte für Lasse & Linus über den Admin-Code frei', () => {
    const expectedNames = [
      'Lasse',
      'Linus',
      'Thomas',
      'Robert',
      'Nick',
      'Eric',
      'Jonah',
      'Lorenzo',
      'Louis',
      'Max',
      'Roman',
    ];
    expect(PRESET_PLAYERS.map((p) => p.name)).toEqual(expectedNames);
    expect(PRESET_PLAYERS).toHaveLength(11);

    // Nur Lasse & Linus können Admin-Rechte freischalten
    expect(
      PRESET_PLAYERS.filter((p) => p.canUnlockAdmin).map((p) => p.name)
    ).toEqual(['Lasse', 'Linus']);

    // Alle 11 Namen (auch Lasse & Linus) loggen sich direkt per Vorname ein
    expect(resolveAllowedPlayerByNameInput('  lasse ')?.name).toBe('Lasse');
    expect(resolveAllowedPlayerByNameInput('LINUS')?.name).toBe('Linus');
    expect(resolveAllowedPlayerByNameInput('  roman  ')?.name).toBe('Roman');

    // Admin-Code-Verifikation (2342 gültig, alles andere abgelehnt)
    const valid = verifyAdminCode('2342');
    expect(valid.valid).toBe(true);
    expect(valid.adminAuthHash).toBe(EXPECTED_ADMIN_AUTH_HASH);
    expect(verifyAdminCode('0000').valid).toBe(false);
    expect(verifyAdminCode('9999').valid).toBe(false);
    expect(verifyAdminCode('').valid).toBe(false);

    // Fremde Namen oder Zusätze werden beim Login strikt abgelehnt
    for (const invalid of [
      '',
      '   ',
      'Lasse#2342',
      'Thomas#2342',
      'Alex',
      'Sophie',
      'Felix',
      'Admin',
      'Lasse(Admin)',
      'Gast',
    ]) {
      expect(resolveAllowedPlayerByNameInput(invalid)).toBeUndefined();
    }
  });

  it('unterstützt 6 Teams, berechnet die Durchschnittsposition aller aktiven Teammitglieder und sperrt doppelte Spieler-Sitzungen', async () => {
    expect(TEAM_PALETTE.map((t) => t.id)).toEqual([
      'team-1',
      'team-2',
      'team-3',
      'team-4',
      'team-5',
      'team-6',
    ]);

    // Durchschnitt aus Thomas (48.1600, 11.4600) und Robert (48.1700, 11.4800) -> (48.1650, 11.4700)
    const t0 = 1_700_000_000_000;
    const loc1 = computeAveragedTeamLocationFromMemberFixes(
      null,
      'thomas',
      'uid_thomas',
      { lat: 48.16, lng: 11.46, accuracy: 8, timestamp: t0 },
      t0
    );
    expect(loc1.activeContributorCount).toBe(1);
    expect(loc1.lat).toBe(48.16);
    expect(loc1.lng).toBe(11.46);

    const loc2 = computeAveragedTeamLocationFromMemberFixes(
      loc1,
      'robert',
      'uid_robert',
      { lat: 48.17, lng: 11.48, accuracy: 12, timestamp: t0 + 2_000 },
      t0 + 2_000
    );
    expect(loc2.activeContributorCount).toBe(2);
    expect(loc2.lat).toBe(48.165);
    expect(loc2.lng).toBe(11.47);
    expect(loc2.accuracy).toBe(10);

    // Ein veralteter Standort (> 5 Minuten alt) fällt automatisch aus dem Durchschnitt heraus
    const loc3 = computeAveragedTeamLocationFromMemberFixes(
      loc2,
      'robert',
      'uid_robert',
      { lat: 48.172, lng: 11.482, accuracy: 6, timestamp: t0 + 6 * 60_000 },
      t0 + 6 * 60_000
    );
    expect(loc3.activeContributorCount).toBe(1);
    expect(loc3.lat).toBe(48.172);
    expect(loc3.lng).toBe(11.482);

    // 1-Person- & 1-Tab-pro-Spieler-Sperre
    const store = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });
    const firstTab = await store.adapter.tryAcquireOrRenewPlayerSeat(
      'thomas',
      'uid_1',
      'tab_a',
      t0
    );
    expect(firstTab.acquired).toBe(true);

    // Zweiter Tab derselben UID oder zweites Gerät mit anderer UID wird blockiert!
    const secondTabSameUser = await store.adapter.tryAcquireOrRenewPlayerSeat(
      'thomas',
      'uid_1',
      'tab_b',
      t0 + 5_000
    );
    expect(secondTabSameUser.acquired).toBe(false);

    const secondPerson = await store.adapter.tryAcquireOrRenewPlayerSeat(
      'thomas',
      'uid_2',
      'tab_x',
      t0 + 5_000
    );
    expect(secondPerson.acquired).toBe(false);

    // Nach Abmelden / Schließen des Tabs ist der Name sofort wieder frei
    await store.adapter.releasePlayerSeat('thomas', 'uid_1', 'tab_a');
    const afterRelease = await store.adapter.tryAcquireOrRenewPlayerSeat(
      'thomas',
      'uid_2',
      'tab_x',
      t0 + 6_000
    );
    expect(afterRelease.acquired).toBe(true);
  });
});
