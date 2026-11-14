import { describe, expect, it } from 'vitest';
import {
  buildManhuntRadarScheduleForHidingMs,
  buildRadarScheduleForHidingMinutes,
  buildRadarScheduleForHidingMs,
  CLASSIC_SEARCH_DURATION_STEPS_MINUTES,
  DEFAULT_CLASSIC_HIDING_MINUTES,
  DEFAULT_CLASSIC_SEARCH_MINUTES,
  DEFAULT_PLAY_AREA_FEATURE,
  DEFAULT_RADAR_SCHEDULE,
  getMediaRefundMs,
  getQuestionPenaltyMs,
  isLegacyPlaceholderPlayArea,
  LEGACY_PLACEHOLDER_AREA_NAME,
  TEAM_PALETTE,
} from '../src/config/gameConfig';
import {
  computeHiderPasswordHash,
  EXPECTED_ADMIN_AUTH_HASH,
  getPlayerGreeting,
  isOverviewMember,
  PRESET_PLAYERS,
  REGULAR_PLAYER_COUNT,
  resolveAllowedPlayerByNameInput,
  verifyAdminCode,
  verifyHiderPasswordHash,
} from '../src/config/players';
import { createDemoStore } from '../src/demo/demoStore';
import { destinationPoint } from '../src/geo/distance';
import {
  buildReadyToken,
  computeAveragedTeamLocationFromMemberFixes,
  deduplicateEnabledMembers,
  extractActiveHiderLock,
  extractActiveLeashViolation,
  extractEmergencyMessages,
  extractReadyPlayerIds,
  filterOnlineEnabledMembers,
  getRequiredReadyHiderMembers,
} from '../src/services/databaseAdapter';
import { evaluateLocationThrottle } from '../src/services/locationService';
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

  it('erlaubt beim Login exakt die 14 Spielernamen sowie den Overview-Account (nur mit Admin-Code) und schaltet Admin-Rechte für Lasse, Linus, Test 1 & Overview frei', () => {
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
      'Theo',
      'Test 1',
      'Test 2',
      'Overview',
    ];
    expect(PRESET_PLAYERS.map((p) => p.name)).toEqual(expectedNames);
    expect(PRESET_PLAYERS).toHaveLength(15);
    expect(REGULAR_PLAYER_COUNT).toBe(14);

    // Nur Lasse, Linus, Test 1 & Overview können Admin-Rechte freischalten (Test 2 nicht)
    expect(
      PRESET_PLAYERS.filter((p) => p.canUnlockAdmin).map((p) => p.name)
    ).toEqual(['Lasse', 'Linus', 'Test 1', 'Overview']);

    // Alle 14 Namen loggen sich direkt per Vorname ein, Overview (bzw. Übersicht) ist als Overview-Account markiert
    expect(resolveAllowedPlayerByNameInput('  lasse ')?.name).toBe('Lasse');
    expect(resolveAllowedPlayerByNameInput('LINUS')?.name).toBe('Linus');
    expect(resolveAllowedPlayerByNameInput('  roman  ')?.name).toBe('Roman');
    expect(resolveAllowedPlayerByNameInput('  theo  ')?.name).toBe('Theo');
    expect(resolveAllowedPlayerByNameInput('  test 1 ')?.canUnlockAdmin).toBe(true);
    expect(resolveAllowedPlayerByNameInput('TEST 2')?.canUnlockAdmin).toBe(false);
    expect(resolveAllowedPlayerByNameInput('Overview')?.isOverviewOnly).toBe(true);
    expect(resolveAllowedPlayerByNameInput('übersicht')?.id).toBe('overview');
    expect(isOverviewMember({ playerId: 'overview', name: 'Overview' })).toBe(true);
    expect(isOverviewMember({ playerId: 'test-1', name: 'Overview' })).toBe(true);
    expect(isOverviewMember({ playerId: 'lasse', name: 'Lasse' })).toBe(false);

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

  it('setzt das Verstecker-Passwort als QR-/Fang-Code + Account-Schutz, startet bei Alle-Bereit automatisch nur mit belegten Teams und erlaubt Notfallnachrichten-Löschung nur dem Absender', async () => {
    const t0 = 1_700_050_000_000;
    const store = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });

    const snap0 = store.getSnapshot();
    const sessionId = snap0.state.public.sessionId;

    // 1. Verstecker (Lasse) legt Passwort fest -> wird QR-Geheimnis, Fang-Code & gehashter Login-Schutz
    const chosenPw = 'BlutenburgFuchs';
    const pwHash = computeHiderPasswordHash(chosenPw);
    expect(verifyHiderPasswordHash(chosenPw, pwHash)).toBe(true);
    expect(verifyHiderPasswordHash('Falsch123', pwHash)).toBe(false);

    const lock = await store.adapter.setHiderPasswordAndTriggerLogout({
      uid: 'demo_uid_lasse',
      sessionId,
      cleanPassword: chosenPw,
      passwordHash: pwHash,
      hiderPlayerIds: ['lasse'],
      nowMs: t0 + 1_000,
    });

    const snapAfterPw = store.getSnapshot();
    expect(snapAfterPw.state.hiderPrivate.qrSecret).toBe(chosenPw);
    expect(snapAfterPw.state.hiderPrivate.shortCode).toBe(chosenPw);

    const extractedLock = extractActiveHiderLock(
      snapAfterPw.state.public,
      snapAfterPw.presence,
      snapAfterPw.members
    );
    expect(extractedLock?.logoutGen).toBe(lock.logoutGen);
    expect(extractedLock?.hiderPlayerIds).toContain('lasse');

    // Sowohl QR-Scan als auch manuelle Passwort-Eingabe verifizieren das Verstecker-Passwort
    const qrJson = serializeQrPayload(sessionId, chosenPw, chosenPw);
    expect(
      verifyCatchSubmission(qrJson, sessionId, sessionId, chosenPw, chosenPw).valid
    ).toBe(true);
    expect(
      verifyCatchSubmission(chosenPw, sessionId, sessionId, chosenPw, chosenPw).valid
    ).toBe(true);
    expect(
      verifyCatchSubmission(
        chosenPw.toLowerCase(),
        sessionId,
        sessionId,
        chosenPw,
        chosenPw
      ).valid
    ).toBe(true);
    expect(
      verifyCatchSubmission('FalscherCode', sessionId, sessionId, chosenPw, chosenPw)
        .valid
    ).toBe(false);

    // 2. Alle Spieler drücken „Bereit" -> Runde startet automatisch und führt nur belegte Teams
    const enabledMembers = deduplicateEnabledMembers(
      snapAfterPw.members,
      snapAfterPw.presence
    );
    const readyToken = buildReadyToken(sessionId, lock.logoutGen);

    for (const m of enabledMembers) {
      await store.adapter.setPlayerReadyState(
        m.uid,
        m.playerId,
        readyToken,
        t0 + 2_000
      );
    }

    const snapReady = store.getSnapshot();
    const readyIds = extractReadyPlayerIds(
      snapReady.state.public,
      extractedLock,
      snapReady.presence
    );
    expect(readyIds.sort()).toEqual(enabledMembers.map((m) => m.playerId).sort());

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
    // Verstecker-Passwort bleibt nach Rundenstart unverändert erhalten!
    expect(snapStarted.state.hiderPrivate.shortCode).toBe(chosenPw);
    expect(snapStarted.state.hiderPrivate.qrSecret).toBe(chosenPw);

    // 2b. Ändert ein Verstecker den Verstecker-Code mitten in der Runde, bleiben AnchorPoint & RadarStages vollständig erhalten!
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
    const midRoundPw = 'NeuerSardinenCode';
    const midRoundLock = await store.adapter.setHiderPasswordAndTriggerLogout({
      uid: 'demo_uid_lasse',
      sessionId,
      cleanPassword: midRoundPw,
      passwordHash: computeHiderPasswordHash(midRoundPw),
      hiderPlayerIds: ['lasse'],
      nowMs: t0 + 3_800,
    });
    const snapMidRound = store.getSnapshot();
    expect(snapMidRound.state.hiderPrivate.shortCode).toBe(midRoundPw);
    expect(snapMidRound.state.hiderPrivate.qrSecret).toBe(midRoundPw);
    expect(snapMidRound.state.hiderPrivate.anchorPoint?.lat).toBeCloseTo(
      48.1632,
      4
    );
    expect(midRoundLock.hiderPlayerIds).toEqual(['lasse']);

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
});
