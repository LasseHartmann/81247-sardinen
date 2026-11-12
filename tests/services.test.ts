import { describe, expect, it } from 'vitest';
import {
  EXPECTED_ADMIN_AUTH_HASH,
  PRESET_PLAYERS,
  resolveAllowedPlayerByNameInput,
  verifyAdminCode,
} from '../src/config/players';
import { destinationPoint } from '../src/geo/distance';
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
});
