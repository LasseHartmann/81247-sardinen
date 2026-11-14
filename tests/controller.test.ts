import { describe, expect, it } from 'vitest';
import { buildManhuntRadarSchedule, MANHUNT_RADAR_RADII } from '../src/config/gameConfig';
import { createDemoStore } from '../src/demo/demoStore';
import { distanceMeters } from '../src/geo/distance';
import {
  executeControllerTick,
  lockHiderAnchorAndGenerateRadar,
  refundAndCompensateMediaRequest,
  submitHiderMediaResponse,
} from '../src/hooks/useControllerEngine';
import type { CatchRequest, ClueRequest } from '../src/types/game';

describe('Controller-Engine: Idempotenz, 120s-Netto-Timeout, Rückerstattung & Catch-Übergang', () => {
  it('verarbeitet deterministische Hinweis-Anfragen exakt einmal (idempotent auch bei parallelen Ticks)', async () => {
    const t0 = 1_700_000_000_000;
    const demo = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });
    const { adapter } = demo;

    const snap0 = demo.getSnapshot();
    const runningState = {
      ...snap0.state.public,
      status: 'RUNNING' as const,
      currentPhase: 'OPEN_SEARCH' as const,
      gameStartTimestamp: t0,
      searchStartTimestamp: t0 + 10 * 60_000,
      pausedBeforeSearchMs: 0,
    };
    await adapter.savePublicStateByHost(runningState);

    const anchor = { lat: 48.1632, lng: 11.4572 }; // Schloss Blutenburg
    const hiderPriv = await lockHiderAnchorAndGenerateRadar({
      adapter,
      uid: 'demo_uid_lasse',
      targetLocation: anchor,
      accuracy: 8,
      serverNowMs: t0 + 10 * 60_000,
      publicState: runningState,
      currentHiderPrivate: snap0.state.hiderPrivate,
    });

    const req: ClueRequest = {
      id: 'req_ns_1',
      teamId: 'team-1',
      requestedByUid: 'demo_uid_thomas',
      sessionId: runningState.sessionId,
      questionType: 'SPLIT_NS',
      category: 1,
      params: { splitPoint: { lat: 48.16, lng: 11.46 } },
      status: 'PENDING',
      penaltyMs: 2 * 60_000,
      penaltyApplied: false,
      refundedMs: 0,
      createdAt: t0 + 11 * 60_000,
      requesterSnapshotLocation: { lat: 48.16, lng: 11.46, accuracy: 10 },
    };
    await adapter.createClueRequest(req);

    const buildCtx = () => {
      const s = demo.getSnapshot();
      return {
        adapter,
        controllerUid: 'demo_uid_lasse',
        serverNowMs: t0 + 11 * 60_000 + 500,
        publicState: s.state.public,
        hiderPrivate: hiderPriv,
        teamsPublic: Object.fromEntries(
          Object.entries(s.teams).map(([k, v]) => [k, v.public])
        ),
        teamLocations: Object.fromEntries(
          Object.entries(s.teams).map(([k, v]) => [k, v.location])
        ),
        requestsByTeam: s.requests,
        catchRequests: s.catchRequests,
      };
    };

    // Zwei überlappende Controller-Läufe dürfen die Strafzeit (+2 Min.) nur exakt EINMAL buchen!
    await Promise.all([
      executeControllerTick(buildCtx()),
      executeControllerTick(buildCtx()),
    ]);

    const after = demo.getSnapshot();
    expect(after.teams['team-1'].public.penaltyMs).toBe(2 * 60_000);
    expect(after.teams['team-1'].public.clueCount).toBe(1);
    expect(after.requests['team-1']['req_ns_1'].status).toBe('ANSWERED');
    expect(after.clues['team-1']['clue_req_ns_1'].answerText).toBe('NORDEN');

    // Admin kann einen gekauften Tipp rückgängig machen (löscht Tipp + Request und zieht Strafzeit ab)
    await adapter.undoClueByHost('team-1', after.clues['team-1']['clue_req_ns_1']);
    const afterUndo = demo.getSnapshot();
    expect(afterUndo.teams['team-1'].public.penaltyMs).toBe(0);
    expect(afterUndo.teams['team-1'].public.clueCount).toBe(0);
    expect(afterUndo.clues['team-1']['clue_req_ns_1']).toBeUndefined();
    expect(afterUndo.requests['team-1']['req_ns_1']).toBeUndefined();
  });

  it('friert das 5-Min.-Foto-Timeout während einer Spielpause exakt ein und zieht nach 5 Min. Netto -10 Min. ab (+ Gratis-Donut-Ring)', async () => {
    const t0 = 1_700_000_000_000;
    const demo = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });
    const { adapter } = demo;

    const snap0 = demo.getSnapshot();
    const pubRunning = {
      ...snap0.state.public,
      status: 'RUNNING' as const,
      currentPhase: 'OPEN_SEARCH' as const,
      gameStartTimestamp: t0,
      searchStartTimestamp: t0 + 10 * 60_000,
      totalPausedMs: 0,
      pausedBeforeSearchMs: 0,
    };
    await adapter.savePublicStateByHost(pubRunning);

    const hiderPriv = await lockHiderAnchorAndGenerateRadar({
      adapter,
      uid: 'demo_uid_lasse',
      targetLocation: { lat: 48.1632, lng: 11.4572 },
      accuracy: 9,
      serverNowMs: t0 + 10 * 60_000,
      publicState: pubRunning,
      currentHiderPrivate: snap0.state.hiderPrivate,
    });

    // Fotoanfrage bei Netto 12:00 (+5 Min. Strafzeit = 300.000 ms)
    const reqTime = t0 + 12 * 60_000;
    const mediaReq: ClueRequest = {
      id: 'req_media_sky',
      teamId: 'team-1',
      requestedByUid: 'demo_uid_thomas',
      sessionId: pubRunning.sessionId,
      questionType: 'MEDIA_SKY',
      category: 4,
      params: {},
      status: 'PENDING',
      penaltyMs: 5 * 60_000,
      penaltyApplied: false,
      refundedMs: 0,
      createdAt: reqTime,
      requesterSnapshotLocation: { lat: 48.1656, lng: 11.4675, accuracy: 8 },
    };
    await adapter.createClueRequest(mediaReq);

    const runAt = async (nowMs: number) => {
      const s = demo.getSnapshot();
      await executeControllerTick({
        adapter,
        controllerUid: 'demo_uid_lasse',
        serverNowMs: nowMs,
        publicState: s.state.public,
        hiderPrivate: hiderPriv,
        teamsPublic: Object.fromEntries(
          Object.entries(s.teams).map(([k, v]) => [k, v.public])
        ),
        teamLocations: Object.fromEntries(
          Object.entries(s.teams).map(([k, v]) => [k, v.location])
        ),
        requestsByTeam: s.requests,
        catchRequests: s.catchRequests,
      });
    };

    // Schritt 1: Controller nimmt Fotoanfrage an -> AWAITING_HIDER_MEDIA, +5 Min. gebucht
    await runAt(reqTime);
    let stateSnap = demo.getSnapshot();
    expect(stateSnap.requests['team-1']['req_media_sky'].status).toBe(
      'AWAITING_HIDER_MEDIA'
    );
    expect(stateSnap.teams['team-1'].public.penaltyMs).toBe(5 * 60_000);

    // Schritt 2: Nach 2 Min. Netto pausiert der Host für 6 volle Minuten!
    const pauseStart = reqTime + 2 * 60_000;
    await adapter.savePublicStateByHost({
      ...stateSnap.state.public,
      status: 'PAUSED',
      pausedAt: pauseStart,
    });

    // Während der 6-minütigen Pause (Wanduhr +8 Min. > 5 Min.!) darf die Anfrage NICHT ablaufen!
    await runAt(pauseStart + 6 * 60_000);
    expect(
      demo.getSnapshot().requests['team-1']['req_media_sky'].status
    ).toBe('AWAITING_HIDER_MEDIA');

    // Schritt 3: Fortsetzen nach 6 Min. Pause (Netto-Verstrichen seit Anfrage immer noch erst 2 Min.!)
    const resumeAt = pauseStart + 6 * 60_000;
    await adapter.savePublicStateByHost({
      ...stateSnap.state.public,
      status: 'RUNNING',
      pausedAt: null,
      totalPausedMs: 6 * 60_000,
    });

    // 2 Min. 50s nach Fortsetzen (= 4 Min. 50s Netto seit Anfrage < 5 Min.) -> immer noch offen!
    await runAt(resumeAt + 170_000);
    expect(
      demo.getSnapshot().requests['team-1']['req_media_sky'].status
    ).toBe('AWAITING_HIDER_MEDIA');

    // 3 Min. 01s nach Fortsetzen (= 5 Min. 01s Netto >= 5 Min.!) -> EXPIRED, -10 Min. Abzug (effektiv -5 Min. Bonus) + Gratis-Donut-Ring!
    await runAt(resumeAt + 181_000);
    stateSnap = demo.getSnapshot();
    expect(stateSnap.requests['team-1']['req_media_sky'].status).toBe('EXPIRED');
    expect(stateSnap.teams['team-1'].public.penaltyMs).toBe(-5 * 60_000);

    const teamClues = Object.values(stateSnap.clues['team-1'] ?? {});
    expect(teamClues.length).toBe(1);
    expect(teamClues[0].isFallbackCompensation).toBe(true);
    expect(teamClues[0].penaltyMs).toBe(0);
    expect(teamClues[0].refundedMs).toBe(10 * 60_000);
    expect(teamClues[0].answerText).toContain('Distanzband:');
  });

  it('unterstützt Gruppen-Selfie-Beantwortung + Base64-Bereinigung sowie Hider-Ablehnung ohne Doppel-Erstattung', async () => {
    const t0 = 1_700_000_000_000;
    const demo = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });
    const { adapter } = demo;
    const s0 = demo.getSnapshot();

    await adapter.adjustTeamPenaltyAndClueCountAtomically('team-2', 5 * 60_000, 1);
    const awaitingReq: ClueRequest = {
      id: 'req_selfie_2',
      teamId: 'team-2',
      requestedByUid: 'demo_uid_nick',
      sessionId: s0.state.public.sessionId,
      questionType: 'MEDIA_SELFIE',
      category: 4,
      params: {},
      status: 'AWAITING_HIDER_MEDIA',
      penaltyMs: 5 * 60_000,
      penaltyApplied: true,
      refundedMs: 0,
      createdAt: t0,
      requesterSnapshotLocation: { lat: 48.165, lng: 11.466, accuracy: 10 },
    };
    await adapter.createClueRequest(awaitingReq);

    const ok = await submitHiderMediaResponse({
      adapter,
      req: awaitingReq,
      mediaBase64: 'data:image/jpeg;base64,AAAA',
      mediaMimeType: 'image/jpeg',
      serverNowMs: t0 + 15_000,
    });
    expect(ok).toBe(true);
    expect(demo.getSnapshot().clues['team-2']['clue_req_selfie_2'].answerText).toContain(
      'Gruppen-Selfie'
    );
    // Standard-Ablaufzeit für empfangene Fotos beträgt exakt 10 Minuten ab Antwort
    const answeredAt = t0 + 15_000;
    expect(
      demo.getSnapshot().requests['team-2']['req_selfie_2'].mediaExpiresAt
    ).toBe(answeredAt + 10 * 60_000);

    // Nach Klick auf Download verkürzt sich die Restlebensdauer auf 1 Minute!
    const downloadAt = answeredAt + 2 * 60_000;
    await adapter.markMediaDownloadedAndShortenExpiry(
      'team-2',
      'req_selfie_2',
      downloadAt
    );
    expect(
      demo.getSnapshot().requests['team-2']['req_selfie_2'].mediaExpiresAt
    ).toBe(downloadAt + 60_000);

    // Team 1 hat diesen Hinweis NICHT (strikt gruppen-individuell!)
    expect(demo.getSnapshot().clues['team-1']?.['clue_req_selfie_2']).toBeUndefined();

    // Nachfolgender verspäteter Timeout-/Ablehnungsversuch auf bereits beantworteter Anfrage schlägt sauber fehl
    const lateRefund = await refundAndCompensateMediaRequest({
      adapter,
      req: awaitingReq,
      reasonStatus: 'REJECTED',
      anchorPoint: { lat: 48.1632, lng: 11.4572 },
      playArea: s0.state.public.playArea.polygon,
      latestTeamLocation: null,
      serverNowMs: t0 + 20_000,
    });
    expect(lateRefund).toBe(false);
    expect(demo.getSnapshot().teams['team-2'].public.penaltyMs).toBe(5 * 60_000);

    // Nach Ablauf der 1-Minuten-Frist bereinigt der Controller-Tick das Foto automatisch aus der Datenbank
    await adapter.savePublicStateByHost({
      ...s0.state.public,
      status: 'RUNNING',
      currentPhase: 'OPEN_SEARCH',
      gameStartTimestamp: t0,
      searchStartTimestamp: t0,
    });
    const snapBeforeAutoStrip = demo.getSnapshot();
    await executeControllerTick({
      adapter,
      controllerUid: 'demo_uid_lasse',
      serverNowMs: downloadAt + 61_000,
      publicState: snapBeforeAutoStrip.state.public,
      hiderPrivate: snapBeforeAutoStrip.state.hiderPrivate,
      teamsPublic: Object.fromEntries(
        Object.entries(snapBeforeAutoStrip.teams).map(([k, v]) => [k, v.public])
      ),
      teamLocations: Object.fromEntries(
        Object.entries(snapBeforeAutoStrip.teams).map(([k, v]) => [k, v.location])
      ),
      requestsByTeam: snapBeforeAutoStrip.requests,
      catchRequests: snapBeforeAutoStrip.catchRequests,
    });

    const stripped = demo.getSnapshot().requests['team-2']['req_selfie_2'];
    expect(stripped.mediaBase64).toBeUndefined();
    expect(stripped.mediaAcknowledgedAt).toBe(downloadAt + 61_000);
  });

  it('validiert Catch-Codes (ShortCode & QR-Payload), setzt Team auf JOINED_SARDINES, löscht Team-Location und berechnet Rangliste phasenrein', async () => {
    const t0 = 1_700_000_000_000;
    const demo = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });
    const { adapter } = demo;
    const s0 = demo.getSnapshot();

    // 2 Min. Pause in HIDING + 3 Min. Pause in OPEN_SEARCH
    const searchStart = t0 + 12 * 60_000;
    const pubRunning = {
      ...s0.state.public,
      status: 'RUNNING' as const,
      currentPhase: 'RADAR_1' as const,
      gameStartTimestamp: t0,
      searchStartTimestamp: searchStart,
      totalPausedMs: 5 * 60_000,
      pausedBeforeSearchMs: 2 * 60_000,
    };
    await adapter.savePublicStateByHost(pubRunning);
    await adapter.adjustTeamPenaltyAndClueCountAtomically('team-1', 4 * 60_000, 1);

    expect(demo.getSnapshot().teams['team-1'].location).not.toBeNull();

    // Ungültiger Code wird sauber abgelehnt
    const wrongCatch: CatchRequest = {
      id: 'catch_wrong',
      teamId: 'team-1',
      submittedByUid: 'demo_uid_thomas',
      sessionId: pubRunning.sessionId,
      codeOrSecret: 'WRONG9',
      status: 'PENDING',
      createdAt: searchStart + 18 * 60_000,
    };
    await adapter.submitCatchRequest(wrongCatch);

    // Gültiger 6-stelliger Ersatzcode (kleingeschrieben mit Leerzeichen -> case-insensitive getrimmt)
    const catchTime = searchStart + 20 * 60_000; // 20m Wanduhr - 3m Suchpause = 17m Suchzeit + 4m Strafe = 21m
    const validCatch: CatchRequest = {
      id: 'catch_ok',
      teamId: 'team-1',
      submittedByUid: 'demo_uid_thomas',
      sessionId: pubRunning.sessionId,
      codeOrSecret: `  ${s0.state.hiderPrivate.shortCode.toLowerCase()}  `,
      status: 'PENDING',
      createdAt: catchTime,
    };
    const duplicateCatch: CatchRequest = {
      id: 'catch_dup',
      teamId: 'team-1',
      submittedByUid: 'demo_uid_robert',
      sessionId: pubRunning.sessionId,
      codeOrSecret: s0.state.hiderPrivate.qrSecret,
      status: 'PENDING',
      createdAt: catchTime + 1000,
    };
    await adapter.submitCatchRequest(validCatch);
    await adapter.submitCatchRequest(duplicateCatch);

    const sBefore = demo.getSnapshot();
    await executeControllerTick({
      adapter,
      controllerUid: 'demo_uid_lasse',
      serverNowMs: catchTime,
      publicState: sBefore.state.public,
      hiderPrivate: sBefore.state.hiderPrivate,
      teamsPublic: Object.fromEntries(
        Object.entries(sBefore.teams).map(([k, v]) => [k, v.public])
      ),
      teamLocations: Object.fromEntries(
        Object.entries(sBefore.teams).map(([k, v]) => [k, v.location])
      ),
      requestsByTeam: sBefore.requests,
      catchRequests: sBefore.catchRequests,
    });

    const after = demo.getSnapshot();
    expect(after.catchRequests['catch_wrong'].status).toBe('INVALID');
    expect(after.catchRequests['catch_ok'].status).toBe('ACCEPTED');
    expect(after.catchRequests['catch_dup'].status).toBe('ALREADY_CAUGHT');

    expect(after.teams['team-1'].public.status).toBe('JOINED_SARDINES');
    expect(after.teams['team-1'].location).toBeNull(); // Standort gelöscht!

    const lb = after.leaderboard['team-1'];
    expect(lb).toBeDefined();
    expect(lb.searchTimeMs).toBe(17 * 60_000);
    expect(lb.penaltyMs).toBe(4 * 60_000);
    expect(lb.totalTimeMs).toBe(21 * 60_000);

    // Andere Teams suchen weiter (Spiel noch RUNNING)
    expect(after.state.public.status).toBe('RUNNING');
  });

  it('steuert den Manhunt-Lebenszyklus ohne Anker-Lock mit 10-Min./5-Min.-Pings und dynamischen Zonen-Schrumpfstufen (1200..150 m) bis zum Sardinen-Catch aller Teams', async () => {
    const t0 = 1_700_500_000_000;
    const demo = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });
    const { adapter } = demo;
    const s0 = demo.getSnapshot();

    // Manhunt: 5 Min. Vorsprung, 40 Min. Jagddauer:
    // Erste 3/4 (30 Min.): Pings alle 10 Min. -> Netto 15, 25, 35 Min.
    // Letztes Viertel (ab 30 Min. Jagd): Pings alle 5 Min. -> Netto 40, 45 Min.
    const manhuntSchedule = buildManhuntRadarSchedule(5, 40);
    await adapter.savePublicStateByHost({
      ...s0.state.public,
      gameMode: 'MANHUNT',
      manhuntShrinkDurationMs: 40 * 60_000,
      radarSchedule: manhuntSchedule,
      status: 'RUNNING',
      currentPhase: 'HIDING',
      gameStartTimestamp: t0,
      searchStartTimestamp: null,
      anchorLocked: false,
      radarCircle: null,
    });

    const runTickAt = async (nowMs: number) => {
      const snap = demo.getSnapshot();
      await executeControllerTick({
        adapter,
        controllerUid: 'demo_uid_lasse',
        serverNowMs: nowMs,
        publicState: snap.state.public,
        hiderPrivate: snap.state.hiderPrivate,
        teamsPublic: Object.fromEntries(
          Object.entries(snap.teams).map(([k, v]) => [k, v.public])
        ),
        teamLocations: Object.fromEntries(
          Object.entries(snap.teams).map(([k, v]) => [k, v.location])
        ),
        requestsByTeam: snap.requests,
        catchRequests: snap.catchRequests,
      });
    };

    // 1. Verstecker bewegen sich während des Vorsprungs frei
    await adapter.writeHiderLocationPrivate('demo_uid_lasse', {
      lat: 48.1645,
      lng: 11.459,
      accuracy: 7,
      timestamp: t0 + 4 * 60_000,
    });

    // 2. Bei Netto 05:00 startet die Jagd OHNE statischen Anker-Lock und OHNE sofortigen Ping!
    await runTickAt(t0 + 5 * 60_000);
    let snap = demo.getSnapshot();
    expect(snap.state.public.currentPhase).toBe('OPEN_SEARCH');
    expect(snap.state.public.searchStartTimestamp).toBe(t0 + 5 * 60_000);
    expect(snap.state.public.anchorLocked).toBe(false);
    expect(snap.state.hiderPrivate.anchorPoint).toBeNull();
    expect(snap.state.public.radarCircle).toBeNull();

    // Auch nach 9 Minuten Jagd (Netto 14:00) ist noch kein Ping veröffentlicht (erst nach 10 Min.!)
    await runTickAt(t0 + 14 * 60_000);
    expect(demo.getSnapshot().state.public.radarCircle).toBeNull();

    // 3. Verstecker laufen weiter durch Obermenzing; Pings bei Netto 15, 25, 35 (alle 10m) und 40, 45 (letztes Viertel alle 5m)
    const roamPath = [
      { stage: 1 as const, pingNumber: 1, min: 15, lat: 48.1662, lng: 11.4624 },
      { stage: 2 as const, pingNumber: 2, min: 25, lat: 48.1675, lng: 11.4642 },
      { stage: 3 as const, pingNumber: 3, min: 35, lat: 48.1681, lng: 11.4651 },
      { stage: 4 as const, pingNumber: 4, min: 40, lat: 48.1684, lng: 11.4655 },
      { stage: 5 as const, pingNumber: 5, min: 45, lat: 48.1685, lng: 11.4657 },
    ];

    let prevPublished = null;
    for (const step of roamPath) {
      const nowMs = t0 + step.min * 60_000;
      await adapter.writeHiderLocationPrivate('demo_uid_lasse', {
        lat: step.lat,
        lng: step.lng,
        accuracy: 6,
        timestamp: nowMs - 2000,
      });

      // Falls Verstecker knapp außerhalb des bisherigen Kreises gewählt wären, ziehe Testpunkt in Kreis:
      if (
        prevPublished &&
        distanceMeters({ lat: step.lat, lng: step.lng }, prevPublished.center) >
          prevPublished.radiusMeters - 20
      ) {
        await adapter.writeHiderLocationPrivate('demo_uid_lasse', {
          lat: prevPublished.center.lat,
          lng: prevPublished.center.lng,
          accuracy: 6,
          timestamp: nowMs - 1000,
        });
      }

      const hiderLive =
        demo.getSnapshot().state.hiderPrivate.hiderLocations?.['demo_uid_lasse']!;

      // Doppelter Tick prüft Idempotenz (kein Neu-Auswürfeln desselben Pings!)
      await runTickAt(nowMs);
      const firstCircle = demo.getSnapshot().state.public.radarCircle;
      await runTickAt(nowMs + 1500);
      const secondCircle = demo.getSnapshot().state.public.radarCircle;

      expect(firstCircle).not.toBeNull();
      expect(secondCircle).toEqual(firstCircle);
      expect(firstCircle!.stage).toBe(step.stage);
      expect(firstCircle!.radiusMeters).toBe(MANHUNT_RADAR_RADII[step.stage]);
      expect(firstCircle!.lastPing).toBeDefined();
      expect(firstCircle!.lastPing!.pingNumber).toBe(step.pingNumber);
      expect(firstCircle!.lastPing!.source).toBe('LIVE_GPS');
      expect(distanceMeters(hiderLive, firstCircle!.center)).toBeLessThanOrEqual(
        firstCircle!.radiusMeters + 0.1
      );

      if (prevPublished) {
        expect(
          distanceMeters(firstCircle!.center, prevPublished.center) +
            firstCircle!.radiusMeters
        ).toBeLessThanOrEqual(prevPublished.radiusMeters + 0.1);
      }
      prevPublished = firstCircle;
    }

    // 4. Sardinen-Mechanik: Alle aktiven Sucher-Teams scannen nacheinander den QR-Code -> FINISHED
    snap = demo.getSnapshot();
    const activeTeamIds = Object.values(snap.teams)
      .filter(
        (t) =>
          t.public.memberPlayerIds.length > 0 && t.public.status === 'ACTIVE'
      )
      .map((t) => t.public.id);
    expect(activeTeamIds.length).toBeGreaterThanOrEqual(2);

    // Erstes Team findet das Rudel bei Minute 46 -> JOINED_SARDINES, Spiel läuft weiter
    await adapter.submitCatchRequest({
      id: 'mh_catch_1',
      teamId: activeTeamIds[0],
      submittedByUid: 'demo_uid_thomas',
      sessionId: snap.state.public.sessionId,
      codeOrSecret: snap.state.hiderPrivate.qrSecret,
      status: 'PENDING',
      createdAt: t0 + 46 * 60_000,
    });
    await runTickAt(t0 + 46 * 60_000);
    expect(demo.getSnapshot().teams[activeTeamIds[0]].public.status).toBe(
      'JOINED_SARDINES'
    );
    expect(demo.getSnapshot().state.public.status).toBe('RUNNING');
    expect(demo.getSnapshot().leaderboard[activeTeamIds[0]].penaltyMs).toBe(0);
    expect(demo.getSnapshot().leaderboard[activeTeamIds[0]].searchTimeMs).toBe(
      41 * 60_000
    );

    // Restliche Teams schließen sich dem Sardinen-Rudel an -> Spiel endet automatisch auf FINISHED
    for (let i = 1; i < activeTeamIds.length; i++) {
      await adapter.submitCatchRequest({
        id: `mh_catch_${i + 1}`,
        teamId: activeTeamIds[i],
        submittedByUid: `demo_uid_team_${i + 1}`,
        sessionId: snap.state.public.sessionId,
        codeOrSecret: snap.state.hiderPrivate.shortCode,
        status: 'PENDING',
        createdAt: t0 + (47 + i) * 60_000,
      });
    }
    await runTickAt(t0 + 50 * 60_000);
    expect(demo.getSnapshot().state.public.status).toBe('FINISHED');
  });

  it('greift bei fehlendem Live-GPS der Verstecker im Manhunt-Modus zuverlässig auf LAST_KNOWN_GPS bzw. ZONE_FALLBACK zurück', async () => {
    const t0 = 1_700_800_000_000;
    const demo = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });
    const { adapter } = demo;
    const s0 = demo.getSnapshot();

    const manhuntSchedule = buildManhuntRadarSchedule(0, 20);
    await adapter.savePublicStateByHost({
      ...s0.state.public,
      gameMode: 'MANHUNT',
      manhuntShrinkDurationMs: 20 * 60_000,
      radarSchedule: manhuntSchedule,
      status: 'RUNNING',
      currentPhase: 'OPEN_SEARCH',
      gameStartTimestamp: t0,
      searchStartTimestamp: t0,
      anchorLocked: false,
      radarCircle: null,
    });

    // Fall A: Gar kein GPS-Fix der Verstecker vorhanden -> Ping #1 bei 10 Min. nutzt ZONE_FALLBACK ohne Absturz
    const snapA = demo.getSnapshot();
    await executeControllerTick({
      adapter,
      controllerUid: 'demo_uid_lasse',
      serverNowMs: t0 + 10 * 60_000,
      publicState: snapA.state.public,
      hiderPrivate: {
        ...snapA.state.hiderPrivate,
        hiderLocations: {},
      },
      teamsPublic: {},
      teamLocations: {},
      requestsByTeam: {},
      catchRequests: {},
      fallbackHiderFix: null,
    });

    const afterZoneFallback = demo.getSnapshot().state.public.radarCircle;
    expect(afterZoneFallback).not.toBeNull();
    expect(afterZoneFallback!.lastPing?.pingNumber).toBe(1);
    expect(afterZoneFallback!.lastPing?.source).toBe('ZONE_FALLBACK');

    // Fall B: Historischer GPS-Fix (vor 8 Minuten, also > 2 Min. alt) vorhanden -> Ping #2 bei 15 Min. nutzt LAST_KNOWN_GPS
    await adapter.writeHiderLocationPrivate('demo_uid_lasse', {
      lat: afterZoneFallback!.center.lat,
      lng: afterZoneFallback!.center.lng,
      accuracy: 14,
      timestamp: t0 + 7 * 60_000,
    });

    const snapB = demo.getSnapshot();
    await executeControllerTick({
      adapter,
      controllerUid: 'demo_uid_lasse',
      serverNowMs: t0 + 15 * 60_000,
      publicState: snapB.state.public,
      hiderPrivate: snapB.state.hiderPrivate,
      teamsPublic: {},
      teamLocations: {},
      requestsByTeam: {},
      catchRequests: {},
      fallbackHiderFix: null,
    });

    const afterLastKnown = demo.getSnapshot().state.public.radarCircle;
    expect(afterLastKnown).not.toBeNull();
    expect(afterLastKnown!.lastPing?.pingNumber).toBe(2);
    expect(afterLastKnown!.lastPing?.source).toBe('LAST_KNOWN_GPS');
    expect(afterLastKnown!.lastPing?.lastFixAgeMs).toBe(8 * 60_000);
  });

  it('springt im klassischen Modus niemals auf Schloss Blutenburg zurück, bewahrt den Anchor bei Reload und unterstützt das Vor-/Zurückspulen der Spielzeit', async () => {
    const t0 = 1_701_000_000_000;
    const demo = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });
    const { adapter } = demo;
    const s0 = demo.getSnapshot();

    await adapter.savePublicStateByHost({
      ...s0.state.public,
      gameMode: 'CLASSIC',
      status: 'RUNNING',
      currentPhase: 'OPEN_SEARCH',
      gameStartTimestamp: t0,
      searchStartTimestamp: t0 + 15 * 60_000,
      anchorLocked: false,
      radarCircle: null,
    });

    // 1. Wenn weder Hider-Locations noch ein lokaler Hider-Fix vorliegen (z.B. Sucher-Host hält Lease kurz nach Reload),
    // darf der Anchor NIEMALS auf den Safety-Point (Schloss Blutenburg: 48.1632, 11.4572) springen!
    await executeControllerTick({
      adapter,
      controllerUid: 'demo_uid_lasse',
      serverNowMs: t0 + 16 * 60_000,
      publicState: demo.getSnapshot().state.public,
      hiderPrivate: demo.getSnapshot().state.hiderPrivate,
      teamsPublic: {},
      teamLocations: {},
      requestsByTeam: {},
      catchRequests: {},
      fallbackHiderFix: null,
    });
    expect(demo.getSnapshot().state.hiderPrivate.anchorPoint).toBeNull();

    // 2. Sobald eine echte Hider-Position in hiderPrivate.hiderLocations vorliegt, fixiert der Controller exakt dort!
    const realHidingSpot = { lat: 48.1695, lng: 11.4712 };
    await adapter.writeHiderLocationPrivate('demo_uid_linus', {
      lat: realHidingSpot.lat,
      lng: realHidingSpot.lng,
      accuracy: 7,
      timestamp: t0 + 16 * 60_000,
    });

    await executeControllerTick({
      adapter,
      controllerUid: 'demo_uid_lasse',
      serverNowMs: t0 + 16 * 60_000 + 1000,
      publicState: demo.getSnapshot().state.public,
      hiderPrivate: demo.getSnapshot().state.hiderPrivate,
      teamsPublic: {},
      teamLocations: {},
      requestsByTeam: {},
      catchRequests: {},
      fallbackHiderFix: null,
    });

    const lockedAnchor = demo.getSnapshot().state.hiderPrivate.anchorPoint;
    expect(lockedAnchor).not.toBeNull();
    expect(lockedAnchor!.lat).toBeCloseTo(realHidingSpot.lat, 4);
    expect(lockedAnchor!.lng).toBeCloseTo(realHidingSpot.lng, 4);

    // 3. initializeDefaultLobbyIfNeeded darf einen bestehenden Anchor bei Reload niemals überschreiben
    await adapter.initializeDefaultLobbyIfNeeded(
      s0.state.public,
      {},
      { qrSecret: 'new_secret', shortCode: 'NEWCOD' }
    );
    expect(demo.getSnapshot().state.hiderPrivate.anchorPoint).toEqual(
      lockedAnchor
    );

    // 4. Vorspulen auf Minute 31 veröffentlicht Radar-Stufe 1 (800m); Zurückspulen auf Minute 20 blendet den Kreis wieder aus!
    await executeControllerTick({
      adapter,
      controllerUid: 'demo_uid_lasse',
      serverNowMs: t0 + 31 * 60_000,
      publicState: demo.getSnapshot().state.public,
      hiderPrivate: demo.getSnapshot().state.hiderPrivate,
      teamsPublic: {},
      teamLocations: {},
      requestsByTeam: {},
      catchRequests: {},
      fallbackHiderFix: null,
    });
    expect(demo.getSnapshot().state.public.currentPhase).toBe('RADAR_1');
    expect(demo.getSnapshot().state.public.radarCircle?.stage).toBe(1);

    await executeControllerTick({
      adapter,
      controllerUid: 'demo_uid_lasse',
      serverNowMs: t0 + 20 * 60_000,
      publicState: demo.getSnapshot().state.public,
      hiderPrivate: demo.getSnapshot().state.hiderPrivate,
      teamsPublic: {},
      teamLocations: {},
      requestsByTeam: {},
      catchRequests: {},
      fallbackHiderFix: null,
    });
    expect(demo.getSnapshot().state.public.currentPhase).toBe('OPEN_SEARCH');
    expect(demo.getSnapshot().state.public.radarCircle).toBeNull();
  });
});
