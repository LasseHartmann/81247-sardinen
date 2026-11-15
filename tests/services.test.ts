import { describe, expect, it } from 'vitest';
import {
  ALL_MUNICH_POSTAL_CODES,
  buildFullMunichPlayAreaState,
  buildManhuntRadarScheduleForHidingMs,
  buildRadarScheduleForHidingMinutes,
  buildRadarScheduleForHidingMs,
  CLASSIC_SEARCH_DURATION_STEPS_MINUTES,
  DEFAULT_CLASSIC_HIDING_MINUTES,
  DEFAULT_CLASSIC_SEARCH_MINUTES,
  DEFAULT_PLAY_AREA_FEATURE,
  DEFAULT_RADAR_SCHEDULE,
  formatPostalCodesLabel,
  getMediaRefundMs,
  getQuestionPenaltyMs,
  isAllMunichPostalCodes,
  isLegacyPlaceholderPlayArea,
  LEGACY_PLACEHOLDER_AREA_NAME,
  parseAndValidateMunichPostalCodes,
  TEAM_PALETTE,
} from '../src/config/gameConfig';
import {
  ADMIN_ACCOUNT_ID,
  computeAccountPasswordHash,
  getPlayerGreeting,
  isAdminAccountId,
  isOverviewMember,
  validateAccountPassword,
  validateAndNormalizeAccountName,
  verifyAccountPasswordHash,
} from '../src/config/players';
import { createDemoStore } from '../src/demo/demoStore';
import { destinationPoint } from '../src/geo/distance';
import {
  buildReadyToken,
  computeAveragedTeamLocationFromMemberFixes,
  deduplicateEnabledMembers,
  extractActiveLeashViolation,
  extractEmergencyMessages,
  extractReadyPlayerIds,
  filterOnlineEnabledMembers,
  getRequiredReadyHiderMembers,
} from '../src/services/databaseAdapter';
import { evaluateLocationThrottle } from '../src/services/locationService';
import {
  generateRoomCode,
  generateSessionSecrets,
  isValidRoomCode,
  normalizeRoomCode,
  serializeQrPayload,
  UNAMBIGUOUS_ALPHABET,
  verifyCatchSubmission,
} from '../src/services/qrService';
import {
  AVATAR_LOGO_ID,
  mergePlayerStats,
} from '../src/services/playerPreferencesService';

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

    const moved30m = destinationPoint(
      { lat: first.roundedLat, lng: first.roundedLng },
      30,
      90
    );

    // Nach nur 4 Sekunden (< 6s) blockieren, selbst bei 30m Bewegung
    const blockedByTime = evaluateLocationThrottle({
      nextFix: { ...moved30m, accuracy: 8, timestamp: 5000 },
      lastSentPoint: { lat: first.roundedLat, lng: first.roundedLng },
      lastSentAtMs: 1000,
      nowMs: 5000,
    });
    expect(blockedByTime.shouldSend).toBe(false);

    // Nach 7 Sekunden, aber nur 20m Bewegung (<= 25m) blockieren
    const moved20m = destinationPoint(
      { lat: first.roundedLat, lng: first.roundedLng },
      20,
      90
    );
    const blockedByDist = evaluateLocationThrottle({
      nextFix: { ...moved20m, accuracy: 8, timestamp: 8000 },
      lastSentPoint: { lat: first.roundedLat, lng: first.roundedLng },
      lastSentAtMs: 1000,
      nowMs: 8000,
    });
    expect(blockedByDist.shouldSend).toBe(false);

    // Nach 7 Sekunden UND 30m Bewegung (> 25m) senden!
    const allowed = evaluateLocationThrottle({
      nextFix: { ...moved30m, accuracy: 8, timestamp: 8000 },
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

  it('berechnet die neuen Hinweis-Preise (Himmelsrichtung 15m, Thermometer 10m, Radar 15m, Foto 5m) und skaliert Radar-Stufen sowie Preise über die 5 Spielzeit-Stufen (30/45/60/75/90 Min.)', async () => {
    expect(CLASSIC_SEARCH_DURATION_STEPS_MINUTES).toEqual([30, 45, 60, 75, 90]);
    expect(DEFAULT_CLASSIC_SEARCH_MINUTES).toBe(45);

    expect(getQuestionPenaltyMs('SPLIT_NS')).toBe(15 * 60_000);
    expect(getQuestionPenaltyMs('SPLIT_EW')).toBe(15 * 60_000);
    expect(getQuestionPenaltyMs('THERMOMETER')).toBe(10 * 60_000);
    expect(getQuestionPenaltyMs('RADIUS_RADAR')).toBe(15 * 60_000);
    expect(getQuestionPenaltyMs('CONE_45')).toBe(15 * 60_000);
    expect(getQuestionPenaltyMs('MEDIA_SKY')).toBe(5 * 60_000);
    expect(getQuestionPenaltyMs('MEDIA_GROUND')).toBe(5 * 60_000);
    expect(getMediaRefundMs()).toBe(10 * 60_000);

    // Prüfe Preis-Skalierung für alle 5 Stufen (30, 45, 60, 75, 90 Min.)
    const stepsMs = CLASSIC_SEARCH_DURATION_STEPS_MINUTES.map((m) => m * 60_000);
    expect(
      stepsMs.map((ms) => Math.round(getQuestionPenaltyMs('SPLIT_NS', ms) / 60_000))
    ).toEqual([10, 15, 20, 25, 30]);
    expect(
      stepsMs.map((ms) => Math.round(getQuestionPenaltyMs('THERMOMETER', ms) / 60_000))
    ).toEqual([7, 10, 13, 17, 20]);
    expect(
      stepsMs.map((ms) => Math.round(getQuestionPenaltyMs('MEDIA_SKY', ms) / 60_000))
    ).toEqual([3, 5, 7, 8, 10]);
    expect(
      stepsMs.map((ms) => Math.round(getQuestionPenaltyMs('DONUT_RING', ms) / 60_000))
    ).toEqual([3, 4, 5, 7, 8]);
    expect(
      stepsMs.map((ms) => Math.round(getQuestionPenaltyMs('OSM_TRANSIT', ms) / 60_000))
    ).toEqual([2, 3, 4, 5, 6]);
    expect(
      stepsMs.map((ms) => Math.round(getMediaRefundMs(ms) / 60_000))
    ).toEqual([6, 10, 14, 16, 20]);

    // Prüfe Radar-Schrumpfstufen (800m -> 400m -> 200m -> 100m -> 25m) für 30, 60 und 90 Min. Suchdauer
    const sched30 = buildRadarScheduleForHidingMinutes(20, 30);
    expect(sched30).toEqual({
      hidingDurationMs: 20 * 60_000,
      stage1Ms: 30 * 60_000, // +10 Min.
      stage2Ms: 35 * 60_000, // +15 Min.
      stage3Ms: 40 * 60_000, // +20 Min.
      stage4Ms: 45 * 60_000, // +25 Min.
      stage5Ms: 50 * 60_000, // +30 Min.
    });

    const sched60 = buildRadarScheduleForHidingMinutes(20, 60);
    expect(sched60).toEqual({
      hidingDurationMs: 20 * 60_000,
      stage1Ms: 40 * 60_000, // +20 Min.
      stage2Ms: 50 * 60_000, // +30 Min.
      stage3Ms: 60 * 60_000, // +40 Min.
      stage4Ms: 70 * 60_000, // +50 Min.
      stage5Ms: 80 * 60_000, // +60 Min.
    });

    const sched90 = buildRadarScheduleForHidingMinutes(20, 90);
    expect(sched90).toEqual({
      hidingDurationMs: 20 * 60_000,
      stage1Ms: 50 * 60_000, // +30 Min.
      stage2Ms: 65 * 60_000, // +45 Min.
      stage3Ms: 80 * 60_000, // +60 Min.
      stage4Ms: 95 * 60_000, // +75 Min.
      stage5Ms: 110 * 60_000, // +90 Min.
    });
  });

  it('ermöglicht freie Konto-Erstellung (Name + Passwort) und vergibt Admin-Rechte ausschließlich an das Konto „admin“', async () => {
    expect(ADMIN_ACCOUNT_ID).toBe('admin');
    expect(isAdminAccountId('admin')).toBe(true);
    expect(isAdminAccountId('ADMIN')).toBe(true);
    expect(isAdminAccountId('lasse')).toBe(false);
    expect(isAdminAccountId('linus')).toBe(false);

    expect(isOverviewMember({ playerId: 'admin', name: 'admin' })).toBe(true);
    expect(isOverviewMember({ playerId: 'lasse', name: 'Lasse' })).toBe(false);

    // Namens- & Passwort-Validierung
    expect(validateAndNormalizeAccountName('  Sophie  ')).toEqual({
      valid: true,
      playerId: 'sophie',
      displayName: 'Sophie',
      isAdmin: false,
    });
    expect(validateAndNormalizeAccountName('  ADMIN  ')).toEqual({
      valid: true,
      playerId: 'admin',
      displayName: 'Admin',
      isAdmin: true,
    });
    expect(validateAndNormalizeAccountName('A').valid).toBe(false);
    expect(validateAccountPassword('123').valid).toBe(false);
    expect(validateAccountPassword('geheim123').valid).toBe(true);

    // Gesalzener SHA-256 Passwort-Hash ist pro playerId gebunden
    const sophieHash = computeAccountPasswordHash('sophie', 'Sardine2026!');
    expect(verifyAccountPasswordHash('sophie', 'Sardine2026!', sophieHash)).toBe(
      true
    );
    expect(verifyAccountPasswordHash('sophie', 'Falsch!', sophieHash)).toBe(
      false
    );
    expect(verifyAccountPasswordHash('alex', 'Sardine2026!', sophieHash)).toBe(
      false
    );

    // Selbstregistrierung & Login über Adapter
    const store = createDemoStore({
      inMemoryOnly: true,
      initialNowMs: 1_700_010_000_000,
    });

    const { member: createdSophie } = await store.adapter.registerAccount({
      name: 'Sophie',
      password: 'Sardine2026!',
    });
    expect(createdSophie.playerId).toBe('sophie');
    expect(createdSophie.name).toBe('Sophie');
    expect(createdSophie.isHost).toBe(false);
    expect(createdSophie.enabled).toBe(true);

    // Doppelter Benutzername wird abgelehnt
    await expect(
      store.adapter.registerAccount({
        name: 'sophie',
        password: 'AnderesPasswort',
      })
    ).rejects.toThrow(/bereits vergeben/i);

    // Falsches Passwort und unbekanntes Konto werden abgelehnt
    await expect(
      store.adapter.loginWithAccount({
        name: 'Sophie',
        password: 'FalschesPasswort',
      })
    ).rejects.toThrow(/Falsches Passwort/i);
    await expect(
      store.adapter.loginWithAccount({
        name: 'Unbekannt',
        password: 'irgendwas',
      })
    ).rejects.toThrow(/existiert noch nicht/i);

    // Korrekter Login als Sophie -> kein Admin
    const { member: loggedInSophie } = await store.adapter.loginWithAccount({
      name: 'Sophie',
      password: 'Sardine2026!',
    });
    expect(loggedInSophie.playerId).toBe('sophie');
    expect(loggedInSophie.isHost).toBe(false);

    // Passwort ändern im Profil: falsches altes Passwort oder zu kurzes neues Passwort wird abgelehnt
    await expect(
      store.adapter.changeAccountPassword({
        playerId: 'sophie',
        currentPassword: 'FalschesAltesPasswort',
        newPassword: 'NeuesPasswort2026!',
      })
    ).rejects.toThrow(/aktuelle Passwort ist nicht korrekt/i);

    await expect(
      store.adapter.changeAccountPassword({
        playerId: 'sophie',
        currentPassword: 'Sardine2026!',
        newPassword: '123',
      })
    ).rejects.toThrow(/mindestens 4 Zeichen/i);

    // Korrektes Ändern des Passworts
    await store.adapter.changeAccountPassword({
      playerId: 'sophie',
      currentPassword: 'Sardine2026!',
      newPassword: 'NeuesPasswort2026!',
    });

    // Altes Passwort funktioniert nicht mehr, neues Passwort funktioniert
    await expect(
      store.adapter.loginWithAccount({
        name: 'Sophie',
        password: 'Sardine2026!',
      })
    ).rejects.toThrow(/Falsches Passwort/i);

    const { member: reloggedSophie } = await store.adapter.loginWithAccount({
      name: 'Sophie',
      password: 'NeuesPasswort2026!',
    });
    expect(reloggedSophie.playerId).toBe('sophie');

    // Wechsel in ein Team UND zurück zu „Kein Team“ (UNASSIGNED) bleibt stabil (auch bei Mehrfach-Sitzungen & Re-Login)
    await store.adapter.savePlayerAssignment('sophie', 'SEEKER', 'team-2');
    await store.adapter.updateMember(reloggedSophie.uid, {
      ...reloggedSophie,
      side: 'SEEKER',
      teamId: 'team-2',
      updatedAt: 1000,
    });
    expect((await store.adapter.fetchPlayerAssignment('sophie'))?.side).toBe(
      'SEEKER'
    );

    // Jetzt zurück zu „Kein Team“ (UNASSIGNED)
    await store.adapter.savePlayerAssignment('sophie', 'UNASSIGNED', null);
    await store.adapter.updateMember(reloggedSophie.uid, {
      ...reloggedSophie,
      side: 'UNASSIGNED',
      teamId: null,
      updatedAt: 2000,
    });
    expect(await store.adapter.fetchPlayerAssignment('sophie')).toEqual({
      side: 'UNASSIGNED',
      teamId: null,
    });

    // Selbst wenn eine ältere Offline-UID noch auf SEEKER stand, gewinnt die neuere/online UNASSIGNED-Sitzung!
    const dedupedAfterLeave = deduplicateEnabledMembers(
      {
        old_uid: {
          uid: 'old_uid',
          playerId: 'sophie',
          name: 'Sophie',
          isHost: false,
          enabled: true,
          side: 'SEEKER',
          teamId: 'team-2',
          updatedAt: 1000,
        },
        [reloggedSophie.uid]: {
          uid: reloggedSophie.uid,
          playerId: 'sophie',
          name: 'Sophie',
          isHost: false,
          enabled: true,
          side: 'UNASSIGNED',
          teamId: null,
          updatedAt: 2000,
        },
      },
      {
        [reloggedSophie.uid]: {
          tab_active: { online: true, lastSeen: 2000 },
        },
      }
    );
    expect(dedupedAfterLeave).toHaveLength(1);
    expect(dedupedAfterLeave[0].side).toBe('UNASSIGNED');
    expect(dedupedAfterLeave[0].teamId).toBeNull();

    // Avatar & All-Time Stats im Profil speichern und beim Login übernehmen
    const mergedStats = mergePlayerStats(
      {
        roundsPlayed: 2,
        catchesAsSeeker: 1,
        bestSearchTimeMs: 22 * 60_000,
        totalDistanceMeters: 1850,
        participatedSessionIds: ['s1', 's2'],
      },
      {
        roundsPlayed: 1,
        catchesAsSeeker: 2,
        bestSearchTimeMs: 18 * 60_000,
        totalDistanceMeters: 3400,
        participatedSessionIds: ['s2', 's3'],
      }
    );
    expect(mergedStats.roundsPlayed).toBe(3);
    expect(mergedStats.catchesAsSeeker).toBe(2);
    expect(mergedStats.bestSearchTimeMs).toBe(18 * 60_000);
    expect(mergedStats.totalDistanceMeters).toBe(3400);

    await store.adapter.updateAccountProfile('sophie', {
      avatar: AVATAR_LOGO_ID,
      stats: mergedStats,
    });
    const fetchedAcct = await store.adapter.fetchAccountProfile('sophie');
    expect(fetchedAcct?.avatar).toBe(AVATAR_LOGO_ID);
    expect(fetchedAcct?.stats?.roundsPlayed).toBe(3);

    const { member: sophieAfterLeaveAndAvatar } =
      await store.adapter.loginWithAccount({
        name: 'Sophie',
        password: 'NeuesPasswort2026!',
      });
    expect(sophieAfterLeaveAndAvatar.side).toBe('UNASSIGNED');
    expect(sophieAfterLeaveAndAvatar.teamId).toBeNull();
    expect(sophieAfterLeaveAndAvatar.avatar).toBe(AVATAR_LOGO_ID);

    // Login als „admin“ -> erhält exklusiv isHost: true
    const { member: loggedInAdmin } = await store.adapter.loginWithAccount({
      name: 'Admin',
      password: 'admin123',
    });
    expect(loggedInAdmin.playerId).toBe('admin');
    expect(loggedInAdmin.isHost).toBe(true);
    expect(isOverviewMember(loggedInAdmin)).toBe(true);

    // Auch Lasse & Linus erhalten ohne das „admin“-Konto niemals isHost: true
    const { member: loggedInLasse } = await store.adapter.loginWithAccount({
      name: 'Lasse',
      password: 'demo1234',
    });
    expect(loggedInLasse.isHost).toBe(false);

    // Standard-Versteckzeit beträgt 15 Minuten und Radius-Radar kostet 15 Minuten
    expect(DEFAULT_CLASSIC_HIDING_MINUTES).toBe(15);
    expect(DEFAULT_RADAR_SCHEDULE.hidingDurationMs).toBe(15 * 60_000);
    expect(DEFAULT_RADAR_SCHEDULE.stage1Ms).toBe(30 * 60_000);
    expect(buildRadarScheduleForHidingMinutes(25).hidingDurationMs).toBe(
      25 * 60_000
    );
    const skippedSched = buildRadarScheduleForHidingMs(95_000, 45 * 60_000);
    expect(skippedSched.hidingDurationMs).toBe(95_000);
    expect(skippedSched.stage1Ms).toBe(95_000 + 15 * 60_000);
    const skippedManhunt = buildManhuntRadarScheduleForHidingMs(
      95_000,
      40 * 60_000
    );
    expect(skippedManhunt.hidingDurationMs).toBe(95_000);
    expect(skippedManhunt.stage5Ms).toBe(95_000 + 40 * 60_000);
    expect(getQuestionPenaltyMs('RADIUS_RADAR')).toBe(15 * 60_000);
    expect(getQuestionPenaltyMs('DONUT_RING')).toBe(4 * 60_000);

    // Ganz München als Versteck-Zone (alle 75 Münchner PLZ)
    expect(ALL_MUNICH_POSTAL_CODES).toHaveLength(75);
    expect(isAllMunichPostalCodes(ALL_MUNICH_POSTAL_CODES)).toBe(true);
    expect(isAllMunichPostalCodes(['81247'])).toBe(false);
    expect(formatPostalCodesLabel(ALL_MUNICH_POSTAL_CODES)).toBe('Ganz München');
    expect(formatPostalCodesLabel(['81247', '81245'])).toBe('81247, 81245');
    expect(
      parseAndValidateMunichPostalCodes('Ganz München')
    ).toMatchObject({
      validCodes: ALL_MUNICH_POSTAL_CODES,
      notFoundCodes: [],
    });
    const fullMunichArea = buildFullMunichPlayAreaState('admin-uid', 123456);
    expect(fullMunichArea.postalCodes).toHaveLength(75);
    expect(isAllMunichPostalCodes(fullMunichArea.postalCodes)).toBe(true);
    expect(fullMunichArea.polygon.properties?.postalCode).toBe('Ganz München');
    expect(fullMunichArea.polygon.geometry.type).toBe('Polygon');
    expect(fullMunichArea.polygon.geometry.coordinates).toHaveLength(1);
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

    // Mehrere Tabs UND mehrere Geräte (verschiedene UIDs) desselben Spielers sind erlaubt!
    const store = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });
    const firstTab = await store.adapter.tryAcquireOrRenewPlayerSeat(
      'thomas',
      'uid_1',
      'tab_a',
      t0
    );
    expect(firstTab.acquired).toBe(true);

    // Zweiter Tab derselben UID ist erlaubt
    const secondTabSameUser = await store.adapter.tryAcquireOrRenewPlayerSeat(
      'thomas',
      'uid_1',
      'tab_b',
      t0 + 5_000
    );
    expect(secondTabSameUser.acquired).toBe(true);

    // Zweites Gerät (andere UID) darf sich ebenfalls gleichzeitig mit demselben Namen einloggen
    const secondDevice = await store.adapter.tryAcquireOrRenewPlayerSeat(
      'thomas',
      'uid_2',
      'tab_x',
      t0 + 5_000
    );
    expect(secondDevice.acquired).toBe(true);

    // Rollenzuweisung wird bei Multi-Device-Login sauber für neue Geräte vorgehalten
    await store.adapter.savePlayerAssignment('thomas', 'SEEKER', 'team-2');
    expect(await store.adapter.fetchPlayerAssignment('thomas')).toEqual({
      side: 'SEEKER',
      teamId: 'team-2',
    });

    await store.adapter.releasePlayerSeat('thomas', 'uid_2', 'tab_x');

    // Kicken eines Spielers durch den Spielleiter entfernt Member-Eintrag, Sitz-Claim und Team-Zugehörigkeit
    await store.adapter.kickPlayerByHost('thomas', ['demo_uid_thomas', 'uid_2']);
    const snapAfterKick = store.getSnapshot();
    expect(snapAfterKick.members['demo_uid_thomas']).toBeUndefined();
    expect(snapAfterKick.playerClaims['thomas']).toBeUndefined();
    expect(snapAfterKick.teams['team-1'].public.memberPlayerIds).not.toContain(
      'thomas'
    );

    // Offizielle 81247-PLZ-Grenze aus export.geojson (146 Eckpunkte = 147 Ring-Koordinaten)
    expect(DEFAULT_PLAY_AREA_FEATURE.geometry.coordinates[0].length).toBe(147);
    expect(
      isLegacyPlaceholderPlayArea({
        polygon: DEFAULT_PLAY_AREA_FEATURE,
        confirmed: true,
        confirmedAt: t0,
        confirmedByUid: 'osm_official_81247',
        name: '81247 M-Obermenzing (Offizielle PLZ-Grenze)',
      })
    ).toBe(false);
    expect(
      isLegacyPlaceholderPlayArea({
        polygon: DEFAULT_PLAY_AREA_FEATURE,
        confirmed: true,
        confirmedAt: t0,
        confirmedByUid: 'old_uid',
        name: LEGACY_PLACEHOLDER_AREA_NAME,
      })
    ).toBe(true);
  });

  it('nutzt zufällige Hider-QR-Codes & 6-stellige Fang-Codes mit Reroll-Funktion (ohne Verstecker-Passwort), startet bei Alle-Bereit automatisch und schützt Notfallnachrichten', async () => {
    const t0 = 1_700_050_000_000;
    const store = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });

    const snap0 = store.getSnapshot();
    const sessionId = snap0.state.public.sessionId;

    // 1. Initialer QR-Code & Fang-Code sind zufällig generiert (32 Hex + 6 Zeichen ohne 0/O/1/I)
    const initialQrSecret = snap0.state.hiderPrivate.qrSecret;
    const initialShortCode = snap0.state.hiderPrivate.shortCode;
    expect(initialQrSecret).toMatch(/^[0-9a-f]{32}$/i);
    expect(initialShortCode).toHaveLength(6);
    expect(initialShortCode).not.toMatch(/[0O1I]/);

    // Sowohl QR-Scan als auch manuelle 6-Zeichen-Code-Eingabe verifizieren den Fang
    const qrJson = serializeQrPayload(
      sessionId,
      initialQrSecret,
      initialShortCode
    );
    expect(
      verifyCatchSubmission(
        qrJson,
        sessionId,
        sessionId,
        initialQrSecret,
        initialShortCode
      ).valid
    ).toBe(true);
    expect(
      verifyCatchSubmission(
        initialShortCode.toLowerCase(),
        sessionId,
        sessionId,
        initialQrSecret,
        initialShortCode
      ).valid
    ).toBe(true);

    // 2. Alle Verstecker drücken direkt ohne Verstecker-Passwort „Bereit" -> Runde startet automatisch
    const enabledMembers = deduplicateEnabledMembers(
      snap0.members,
      snap0.presence
    );
    const readyToken = buildReadyToken(sessionId);

    for (const m of enabledMembers) {
      if (m.side === 'HIDER') {
        await store.adapter.setPlayerReadyState(
          m.uid,
          m.playerId,
          readyToken,
          t0 + 2_000
        );
      }
    }

    const snapReady = store.getSnapshot();
    const readyIds = extractReadyPlayerIds(
      snapReady.state.public,
      snapReady.presence
    );
    expect(readyIds.sort()).toEqual(['lasse', 'linus']);

    await store.adapter.startRoundWhenAllReady({
      starterUid: 'demo_uid_lasse',
      publicState: snapReady.state.public,
      enabledMembers,
      currentHiderPrivate: snapReady.state.hiderPrivate,
      nowMs: t0 + 3_000,
    });

    const snapStarted = store.getSnapshot();
    expect(snapStarted.state.public.status).toBe('RUNNING');
    expect(snapStarted.state.public.currentPhase).toBe('HIDING');
    // Im Demo-Default sind nur Team 1 bis Team 4 belegt (Team 5 & Team 6 leer -> nicht in activeTeamIds!)
    expect(snapStarted.state.public.activeTeamIds).toEqual([
      'team-1',
      'team-2',
      'team-3',
      'team-4',
    ]);
    expect(snapStarted.state.hiderPrivate.shortCode).toBe(initialShortCode);
    expect(snapStarted.state.hiderPrivate.qrSecret).toBe(initialQrSecret);

    // 2b. Reroll-Button würfelt während der Runde einen neuen zufälligen QR-Code & Fang-Code,
    // macht den alten Code ungültig und erhält AnchorPoint, RadarStages & HiderLocations!
    await store.adapter.saveHiderPrivate({
      ...snapStarted.state.hiderPrivate,
      anchorPoint: {
        lat: 48.1632,
        lng: 11.4572,
        accuracy: 7,
        lockedAt: t0 + 3_500,
        lockedByUid: 'demo_uid_lasse',
      },
    });
    const rerolled = await store.adapter.rerollHiderSecrets();
    expect(rerolled.qrSecret).toMatch(/^[0-9a-f]{32}$/i);
    expect(rerolled.shortCode).toHaveLength(6);
    expect(rerolled.shortCode).not.toMatch(/[0O1I]/);
    expect(rerolled.shortCode).not.toBe(initialShortCode);
    expect(rerolled.qrSecret).not.toBe(initialQrSecret);

    const snapAfterReroll = store.getSnapshot();
    expect(snapAfterReroll.state.hiderPrivate.shortCode).toBe(
      rerolled.shortCode
    );
    expect(snapAfterReroll.state.hiderPrivate.qrSecret).toBe(rerolled.qrSecret);
    expect(snapAfterReroll.state.hiderPrivate.anchorPoint?.lat).toBeCloseTo(
      48.1632,
      4
    );

    // Alter Code wird nach Reroll abgelehnt, neuer Code wird akzeptiert
    expect(
      verifyCatchSubmission(
        initialShortCode,
        sessionId,
        sessionId,
        rerolled.qrSecret,
        rerolled.shortCode
      ).valid
    ).toBe(false);
    expect(
      verifyCatchSubmission(
        rerolled.shortCode,
        sessionId,
        sessionId,
        rerolled.qrSecret,
        rerolled.shortCode
      ).valid
    ).toBe(true);

    // 3. Notfallnachricht inkl. GPS-Standort senden, für alle sichtbar extrahieren & Löschschutz bei Orphan-Cleanup prüfen
    await store.adapter.sendEmergencyMessage({
      uid: 'demo_uid_thomas',
      playerId: 'thomas',
      senderName: 'Thomas',
      text: 'Umgeknickt an der Würmbrücke, bitte kurz warten!',
      createdAt: t0 + 4_000,
      lat: 48.16542,
      lng: 11.46821,
      accuracy: 7,
    });

    const msgs1 = extractEmergencyMessages(store.getSnapshot().presence);
    expect(msgs1).toHaveLength(1);
    expect(msgs1[0].senderName).toBe('Thomas');
    expect(msgs1[0].text).toContain('Würmbrücke');
    expect(msgs1[0].lat).toBeCloseTo(48.16542, 5);
    expect(msgs1[0].lng).toBeCloseTo(11.46821, 5);
    expect(msgs1[0].accuracy).toBe(7);

    // 4. Vor dem Rundenstart zählen für Gruppen & Bereit-Check nur Spieler, die aktuell online sind
    const unsubLasse = store.adapter.registerTabPresence(
      'demo_uid_lasse',
      'tab_lasse',
      'TestUA'
    );
    const unsubThomas = store.adapter.registerTabPresence(
      'demo_uid_thomas',
      'tab_thomas',
      'TestUA'
    );
    const snapOnline = store.getSnapshot();
    const onlineOnly = filterOnlineEnabledMembers(
      snapOnline.members,
      snapOnline.presence
    );
    expect(onlineOnly.map((m) => m.playerId).sort()).toEqual([
      'lasse',
      'thomas',
    ]);
    // Für den Bereit-Check müssen ALLE Mitglieder des Verstecker-Teams bereit sein (auch Linus, der aktuell offline ist), und NIEMAND sonst!
    const requiredHiders = getRequiredReadyHiderMembers(
      snapOnline.members,
      snapOnline.presence
    );
    expect(requiredHiders.map((m) => m.playerId).sort()).toEqual([
      'lasse',
      'linus',
    ]);
    unsubLasse();
    unsubThomas();

    // Weder Orphan-Cleanup noch ein fremder Löschversuch löschen Thomas' Notfallnachricht
    await store.adapter.cleanupOrphanedPresence('demo_uid_thomas');
    await store.adapter.clearOwnEmergencyMessage('demo_uid_robert');
    expect(extractEmergencyMessages(store.getSnapshot().presence)).toHaveLength(1);

    // Erst wenn der Absender selbst (demo_uid_thomas) löscht, verschwindet die Nachricht
    await store.adapter.clearOwnEmergencyMessage('demo_uid_thomas');
    expect(extractEmergencyMessages(store.getSnapshot().presence)).toHaveLength(0);

    // 5. Leash-/Zonenverstoß veröffentlicht nach 60s den 2.-Minuten-Countdown und nach einer weiteren Minute den Live-Verstecker-Standort
    await store.adapter.patchControllerPublicTransition({
      leashAlertActive: true,
    });
    await store.adapter.setLeashViolationAlert({
      uid: 'demo_uid_lasse',
      sessionId,
      alertStartedAt: t0 + 60_000,
      exposeAt: t0 + 120_000,
      violationReason: 'OUTSIDE_MANHUNT_ZONE',
      exposedLat: 48.1642,
      exposedLng: 11.4621,
      exposedAccuracy: 9,
      nowMs: t0 + 121_000,
    });
    const snapLeash = store.getSnapshot();
    const activeViolation = extractActiveLeashViolation(
      snapLeash.state.public,
      snapLeash.presence
    );
    expect(activeViolation?.violationReason).toBe('OUTSIDE_MANHUNT_ZONE');
    expect(activeViolation?.exposeAt).toBe(t0 + 120_000);
    expect(activeViolation?.exposedLat).toBeCloseTo(48.1642, 4);
    expect(activeViolation?.exposedLng).toBeCloseTo(11.4621, 4);
  });

  it('returns custom greetings for specific players and falls back for others', () => {
    expect(getPlayerGreeting({ playerId: 'linus', name: 'Linus' })).toBe(
      'GOLD! GOLD! GOLD!'
    );
    expect(getPlayerGreeting({ playerId: 'lasse', name: 'Lasse' })).toBe(
      'Welcome back, sir.'
    );
    expect(getPlayerGreeting({ playerId: 'thomas', name: 'Thomas' })).toBe(
      'Papaya Rules sind heute aktiv!'
    );
    expect(getPlayerGreeting({ playerId: 'nick', name: 'Nick' })).toBe(
      'Hast du das POTENZIAL zu gewinnen?'
    );
    expect(getPlayerGreeting({ playerId: 'robert', name: 'Robert' })).toBe(
      'Hast du deinen Atlas dabei? Wenn ja: Warum?'
    );
    expect(getPlayerGreeting({ playerId: 'jonah', name: 'Jonah' })).toBe(
      'Hast du dein Handtuch dabei?'
    );
    expect(getPlayerGreeting({ playerId: 'lorenzo', name: 'Lorenzo' })).toBe(
      'Ciao, boss mafiosi.'
    );
    expect(getPlayerGreeting({ playerId: 'max', name: 'Max' })).toBe(
      'ATTACK THE D POINT!'
    );
    expect(getPlayerGreeting({ playerId: 'theo', name: 'Theo' })).toBe(
      'YO PHONE LINGING!'
    );
    expect(getPlayerGreeting({ playerId: 'eric', name: 'Eric' })).toBe(
      'Hallo Eric!'
    );
  });

  it('unterstützt eigenes Spiel-Hosting per 6-Zeichen-Code, isolierte Raum-Einstellungen (Zeiten/Grenzen) & Late-Join-Teamwahl', async () => {
    // 1. Raum-Code-Generierung & Link-/Code-Normalisierung
    for (let i = 0; i < 50; i++) {
      const code = generateRoomCode(6);
      expect(code).toHaveLength(6);
      expect(code).not.toMatch(/[0O1I]/);
      expect(isValidRoomCode(code)).toBe(true);
    }
    expect(normalizeRoomCode('  k7m-4p2 ')).toBe('K7M4P2');
    expect(
      normalizeRoomCode('https://81247-sardinen.web.app/?room=k7m4p2&foo=1')
    ).toBe('K7M4P2');
    expect(isValidRoomCode('AB')).toBe(false);
    expect(isValidRoomCode('81247')).toBe(true);

    const t0 = 1_700_100_000_000;
    const store = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });

    // Registriere zwei normale Spieler (Anna = Host, Ben = Mitspieler / Spät-Beitretender)
    const { member: annaAcct } = await store.adapter.registerAccount({
      name: 'Anna',
      password: 'Password123',
    });
    const { member: benAcct } = await store.adapter.registerAccount({
      name: 'Ben',
      password: 'Password123',
    });
    expect(annaAcct.isHost).toBe(false);
    expect(benAcct.isHost).toBe(false);

    // 2. Anna hostet ein eigenes Spiel -> erhält 6-stelligen Raum-Code & isHost: true in ihrem Raum
    await store.adapter.loginWithAccount({
      name: 'Anna',
      password: 'Password123',
    });
    const hosted = await store.adapter.createHostedRoom({
      hostPlayerId: 'anna',
      hostName: 'Anna',
      avatar: '🦊',
    });

    expect(hosted.roomCode).toHaveLength(6);
    expect(hosted.roomCode).not.toBe('81247');
    expect(store.adapter.getRoomCode()).toBe(hosted.roomCode);
    expect(hosted.member.playerId).toBe('anna');
    expect(hosted.member.isHost).toBe(true);
    expect(hosted.member.side).toBe('UNASSIGNED');
    expect(hosted.publicState.roomCode).toBe(hosted.roomCode);
    expect(hosted.publicState.hostPlayerId).toBe('anna');
    expect(hosted.publicState.hostName).toBe('Anna');
    expect(hosted.publicState.status).toBe('LOBBY');

    // Host passt Grenzen (Ganz München) & Zeiten (25 Min Verstecken, 60 Min Suche) an und startet das Spiel
    const customSchedule = buildRadarScheduleForHidingMinutes(25, 60);
    const customArea = buildFullMunichPlayAreaState(hosted.member.uid, t0 + 1_000);
    const runningHostedState = {
      ...hosted.publicState,
      status: 'RUNNING' as const,
      currentPhase: 'OPEN_SEARCH' as const,
      gameStartTimestamp: t0 + 2_000,
      radarSchedule: customSchedule,
      playArea: customArea,
      activeTeamIds: ['team-1'],
    };
    await store.adapter.savePublicStateByHost(runningHostedState);

    // Prüfe Isolation: Raum 81247 ist weiterhin unverändert in LOBBY!
    expect(store.getSnapshot().state.public.status).toBe('LOBBY');
    expect(
      store.getSnapshot().rooms?.[hosted.roomCode]?.state.public.status
    ).toBe('RUNNING');
    expect(
      store.getSnapshot().rooms?.[hosted.roomCode]?.state.public.playArea
        ?.postalCodes
    ).toHaveLength(75);

    // 3. Unbekannter Spiel-Code wird sauber abgelehnt
    await store.adapter.loginWithAccount({
      name: 'Ben',
      password: 'Password123',
    });
    await expect(
      store.adapter.joinRoomByCode({
        roomCode: 'ZZZZZZ',
        playerId: 'ben',
        playerName: 'Ben',
      })
    ).rejects.toThrow(/Kein Spiel mit dem Code/i);

    // 4. Ben tritt Annas bereits laufendem Spiel per Code verspätet bei -> startet als UNASSIGNED (muss erst Team wählen!) und ohne Host-Rechte
    const benJoined = await store.adapter.joinRoomByCode({
      roomCode: hosted.roomCode.toLowerCase(),
      playerId: 'ben',
      playerName: 'Ben',
      avatar: '🐻',
    });
    expect(benJoined.roomCode).toBe(hosted.roomCode);
    expect(benJoined.member.playerId).toBe('ben');
    expect(benJoined.member.isHost).toBe(false);
    expect(benJoined.member.side).toBe('UNASSIGNED');
    expect(benJoined.member.teamId).toBeNull();
    expect(benJoined.publicState.status).toBe('RUNNING');

    // Ben sieht im Raum alle Mitglieder und entscheidet sich beim Late-Join für Team 5 -> addActiveTeamIdIfRunning ergänzt team-5 ohne Duplikate
    await store.adapter.savePlayerAssignment('ben', 'SEEKER', 'team-5');
    await store.adapter.updateMember(benJoined.member.uid, {
      ...benJoined.member,
      side: 'SEEKER',
      teamId: 'team-5',
      updatedAt: t0 + 5_000,
    });
    await store.adapter.addActiveTeamIdIfRunning('team-5');
    await store.adapter.addActiveTeamIdIfRunning('team-1'); // bereits enthalten -> kein Duplikat

    const hostedSliceAfterLateJoin =
      store.getSnapshot().rooms?.[hosted.roomCode];
    expect(hostedSliceAfterLateJoin?.state.public.activeTeamIds).toEqual([
      'team-1',
      'team-5',
    ]);

    // 5. Wenn Anna erneut beitritt, behält sie ihre Host-Rechte, und ein Runden-Reset bewahrt roomCode & hostPlayerId
    await store.adapter.loginWithAccount({
      name: 'Anna',
      password: 'Password123',
    });
    const annaRejoined = await store.adapter.joinRoomByCode({
      roomCode: hosted.roomCode,
      playerId: 'anna',
      playerName: 'Anna',
    });
    expect(annaRejoined.member.isHost).toBe(true);

    const currentTeams = hostedSliceAfterLateJoin!.teams;
    const resetTeams = Object.fromEntries(
      Object.entries(currentTeams).map(([id, bundle]) => [id, bundle.public])
    );
    await store.adapter.resetRoundByHost(
      {
        ...hosted.publicState,
        sessionId: 'sess_next',
        status: 'LOBBY',
        currentPhase: 'LOBBY',
      },
      resetTeams,
      hostedSliceAfterLateJoin!.state.hiderPrivate
    );

    const afterResetPublic =
      store.getSnapshot().rooms?.[hosted.roomCode]?.state.public;
    expect(afterResetPublic?.status).toBe('LOBBY');
    expect(afterResetPublic?.roomCode).toBe(hosted.roomCode);
    expect(afterResetPublic?.hostPlayerId).toBe('anna');
    expect(afterResetPublic?.hostName).toBe('Anna');

    // 6. Host benennt ein Team um („Team Papaya“) -> bleibt auch nach automatischem Rundenstart (startRoundWhenAllReady) erhalten
    const team5Before =
      store.getSnapshot().rooms?.[hosted.roomCode]?.teams['team-5']?.public;
    expect(team5Before).toBeDefined();
    await store.adapter.saveTeamPublic('team-5', {
      ...team5Before!,
      name: 'Team Papaya',
    });
    expect(
      store.getSnapshot().rooms?.[hosted.roomCode]?.teams['team-5']?.public.name
    ).toBe('Team Papaya');

    const roomAfterRename = store.getSnapshot().rooms?.[hosted.roomCode]!;
    await store.adapter.startRoundWhenAllReady({
      starterUid: annaRejoined.member.uid,
      publicState: roomAfterRename.state.public,
      enabledMembers: Object.values(roomAfterRename.members),
      currentHiderPrivate: roomAfterRename.state.hiderPrivate,
      nowMs: t0 + 10_000,
    });
    expect(
      store.getSnapshot().rooms?.[hosted.roomCode]?.teams['team-5']?.public.name
    ).toBe('Team Papaya');
  });
});
