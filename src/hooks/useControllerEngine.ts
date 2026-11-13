import { useEffect, useRef, useState } from 'react';
import {
  CONTROLLER_HEARTBEAT_INTERVAL_MS,
  CONTROLLER_LEASE_TTL_MS,
  MEDIA_REFUND_MS,
  MEDIA_RESPONSE_TIMEOUT_NET_MS,
} from '../config/gameConfig';
import { isPointInPlayArea, snapPointIntoPlayArea } from '../geo/boundary';
import {
  evaluateDeterministicQuestion,
  evaluateDonutRing,
  type OsmEnvironmentData,
} from '../geo/clueGeometry';
import {
  generateInsideOutRadarStages,
  getDueRadarCircle,
  getPhaseForElapsedMs,
} from '../geo/radar';
import type { DatabaseAdapter } from '../services/databaseAdapter';
import { fetchOsmEnvironment81247 } from '../services/overpassService';
import { generateRandomId, verifyCatchSubmission } from '../services/qrService';
import type {
  AnchorPoint,
  CatchRequest,
  ClueRecord,
  ClueRequest,
  ControllerLease,
  GeoFix,
  HiderPrivateState,
  LatLng,
  LeaderboardEntry,
  MemberRecord,
  PublicGameState,
  TeamLocation,
  TeamPublic,
} from '../types/game';
import {
  computeNetElapsedMs,
  computeOfficialTeamScore,
  getQuestionLabelDe,
} from '../utils/formatting';

export interface ControllerTickContext {
  adapter: DatabaseAdapter;
  controllerUid: string;
  serverNowMs: number;
  publicState: PublicGameState;
  hiderPrivate: HiderPrivateState;
  teamsPublic: Record<string, TeamPublic>;
  teamLocations: Record<string, TeamLocation | null>;
  requestsByTeam: Record<string, Record<string, ClueRequest>>;
  catchRequests: Record<string, CatchRequest>;
  fallbackHiderFix?: GeoFix | null;
  osmFetcher?: (
    playArea: PublicGameState['playArea']['polygon']
  ) => Promise<OsmEnvironmentData>;
}

/**
 * Fixiert den geheimen Anchor Point der Verstecker und berechnet einmalig
 * alle 5 Inside-Out-Radar-Stufen unter `/state/hiderPrivate`.
 */
export async function lockHiderAnchorAndGenerateRadar(params: {
  adapter: DatabaseAdapter;
  uid: string;
  targetLocation: LatLng;
  accuracy: number;
  serverNowMs: number;
  publicState: PublicGameState;
  currentHiderPrivate: HiderPrivateState;
  startSearchImmediately?: boolean;
  rng?: () => number;
}): Promise<HiderPrivateState> {
  const {
    adapter,
    uid,
    targetLocation,
    accuracy,
    serverNowMs,
    publicState,
    currentHiderPrivate,
    startSearchImmediately = false,
    rng,
  } = params;

  const poly = publicState.playArea.polygon;
  const safePt = isPointInPlayArea(targetLocation, poly)
    ? targetLocation
    : snapPointIntoPlayArea(targetLocation, poly);

  const anchorPoint: AnchorPoint = {
    lat: safePt.lat,
    lng: safePt.lng,
    accuracy: Math.max(1, Math.round(accuracy)),
    lockedAt: serverNowMs,
    lockedByUid: uid,
  };

  const radarStages = generateInsideOutRadarStages(
    anchorPoint,
    publicState.radarSchedule,
    rng
  );

  const updatedPrivate: HiderPrivateState = {
    ...currentHiderPrivate,
    anchorPoint,
    radarStages,
  };

  await adapter.saveHiderPrivate(updatedPrivate);

  if (startSearchImmediately && publicState.currentPhase === 'HIDING') {
    await adapter.patchControllerPublicTransition({
      anchorLocked: true,
      currentPhase: 'OPEN_SEARCH',
      searchStartTimestamp: serverNowMs,
      pausedBeforeSearchMs: publicState.totalPausedMs,
    });
  } else {
    await adapter.patchControllerPublicTransition({
      anchorLocked: true,
    });
  }

  return updatedPrivate;
}

/**
 * Führt einen deterministischen, idempotenten Controller-Zyklus aus:
 * 1. Phasenwechsel (inkl. Auto-Anchor bei 10:00 + pausedBeforeSearchMs) & Radar-Veröffentlichung
 * 2. PENDING Hinweis-Anfragen (Kategorie 1–3 sofort, Kategorie 4 -> AWAITING_HIDER_MEDIA)
 * 3. 120s-Netto-Spielzeit-Timeout für offene Medienanfragen (-5 Min. Erstattung + Gratis-Donut-Ring)
 * 4. Catch-Validierung (QR-Secret & 6-stelliger Ersatzcode, Ranglisten-Eintrag, Location-Cleanup)
 */
export async function executeControllerTick(
  ctx: ControllerTickContext
): Promise<void> {
  const {
    adapter,
    controllerUid,
    serverNowMs,
    publicState,
    teamsPublic,
    teamLocations,
    requestsByTeam,
    catchRequests,
    fallbackHiderFix,
    osmFetcher = fetchOsmEnvironment81247,
  } = ctx;

  let hiderPrivate = ctx.hiderPrivate;

  if (
    publicState.status === 'LOBBY' ||
    publicState.status === 'EMERGENCY_STOP'
  ) {
    return;
  }

  const isRunningUnpaused =
    publicState.status === 'RUNNING' && publicState.pausedAt === null;
  const netElapsedMs = computeNetElapsedMs(publicState, serverNowMs);

  // 1. Phasenwechsel & Radar-Stufen-Publikation (nur wenn aktiv und nicht pausiert)
  if (isRunningUnpaused) {
    const rawDuePhase = getPhaseForElapsedMs(
      netElapsedMs,
      publicState.radarSchedule
    );
    const duePhase =
      rawDuePhase === 'HIDING' &&
      publicState.searchStartTimestamp !== null &&
      publicState.currentPhase !== 'HIDING'
        ? publicState.currentPhase
        : rawDuePhase;

    // Automatische Fixierung des Anchor Points ab 10:00, falls noch nicht manuell fixiert
    if (duePhase !== 'HIDING' && !hiderPrivate.anchorPoint) {
      const candidate: LatLng = fallbackHiderFix
        ? { lat: fallbackHiderFix.lat, lng: fallbackHiderFix.lng }
        : snapPointIntoPlayArea(
            {
              lat: publicState.safetyPoint.lat,
              lng: publicState.safetyPoint.lng,
            },
            publicState.playArea.polygon
          );
      hiderPrivate = await lockHiderAnchorAndGenerateRadar({
        adapter,
        uid: controllerUid,
        targetLocation: candidate,
        accuracy: fallbackHiderFix?.accuracy ?? 15,
        serverNowMs,
        publicState,
        currentHiderPrivate: hiderPrivate,
        startSearchImmediately: false,
      });
    }

    const dueRadar = getDueRadarCircle(
      netElapsedMs,
      hiderPrivate.radarStages,
      serverNowMs
    );

    const needsSearchStartInit =
      duePhase !== 'HIDING' && publicState.searchStartTimestamp === null;
    const needsPhaseUpdate = duePhase !== publicState.currentPhase;
    const needsRadarUpdate =
      dueRadar !== null &&
      dueRadar.stage !== (publicState.radarCircle?.stage ?? null);

    if (needsSearchStartInit || needsPhaseUpdate || needsRadarUpdate) {
      await adapter.patchControllerPublicTransition({
        ...(needsPhaseUpdate ? { currentPhase: duePhase } : {}),
        ...(needsSearchStartInit
          ? {
              searchStartTimestamp: serverNowMs,
              pausedBeforeSearchMs: publicState.totalPausedMs,
              anchorLocked: true,
            }
          : {}),
        ...(needsRadarUpdate ? { radarCircle: dueRadar } : {}),
      });
    }
  }

  // 2. Hinweis-Anfragen verarbeiten (sofern Anchor Point vorhanden und nicht pausiert)
  if (isRunningUnpaused && hiderPrivate.anchorPoint) {
    const anchor = hiderPrivate.anchorPoint;

    for (const [teamId, teamReqs] of Object.entries(requestsByTeam)) {
      for (const req of Object.values(teamReqs)) {
        if (req.sessionId !== publicState.sessionId) continue;

        if (req.status === 'PENDING') {
          const claimed = await adapter.claimRequestForProcessing(
            teamId,
            req.id,
            publicState.sessionId,
            ['PENDING'],
            'PROCESSING'
          );
          if (!claimed) continue;

          if (claimed.category === 4) {
            // Manuelle Medienanfrage: Strafzeit einmalig buchen und 120s-Netto-Frist starten
            await adapter.adjustTeamPenaltyAndClueCountAtomically(
              teamId,
              claimed.penaltyMs,
              1
            );
            const awaitingReq: ClueRequest = {
              ...claimed,
              status: 'AWAITING_HIDER_MEDIA',
              penaltyApplied: true,
              netElapsedAtRequestMs: netElapsedMs,
              mediaDeadlineNetElapsedMs:
                netElapsedMs + MEDIA_RESPONSE_TIMEOUT_NET_MS,
              processedAt: serverNowMs,
            };
            await adapter.updateClueRequest(teamId, claimed.id, awaitingReq);
          } else {
            let osmData: OsmEnvironmentData | undefined;
            if (claimed.category === 2) {
              osmData = await osmFetcher(publicState.playArea.polygon);
            }

            const evaluated = evaluateDeterministicQuestion(
              claimed.questionType,
              claimed.params,
              claimed.requesterSnapshotLocation,
              anchor,
              publicState.playArea.polygon,
              osmData
            );

            await adapter.adjustTeamPenaltyAndClueCountAtomically(
              teamId,
              claimed.penaltyMs,
              1
            );

            const clue: ClueRecord = {
              id: `clue_${claimed.id}`,
              requestId: claimed.id,
              teamId,
              sessionId: claimed.sessionId,
              questionType: claimed.questionType,
              category: claimed.category,
              title: evaluated.title,
              answerText: evaluated.answerText,
              detailText: evaluated.detailText,
              isPositiveHit: evaluated.isPositiveHit,
              penaltyMs: claimed.penaltyMs,
              createdAt: serverNowMs,
              overlayGeoJson: evaluated.overlayGeoJson,
              overlayStyle: evaluated.overlayStyle,
              usedOfflineOsmFallback: osmData?.usedOfflineFallback,
            };

            await adapter.saveClue(teamId, clue);
            await adapter.updateClueRequest(teamId, claimed.id, {
              ...claimed,
              status: 'ANSWERED',
              penaltyApplied: true,
              processedAt: serverNowMs,
              usedOfflineOsmFallback: osmData?.usedOfflineFallback,
            });
          }
        } else if (req.status === 'AWAITING_HIDER_MEDIA') {
          const deadlineNetMs =
            req.mediaDeadlineNetElapsedMs ??
            (req.netElapsedAtRequestMs ?? 0) + MEDIA_RESPONSE_TIMEOUT_NET_MS;

          if (netElapsedMs >= deadlineNetMs) {
            await refundAndCompensateMediaRequest({
              adapter,
              req,
              reasonStatus: 'EXPIRED',
              anchorPoint: anchor,
              playArea: publicState.playArea.polygon,
              latestTeamLocation: teamLocations[teamId] ?? null,
              serverNowMs,
            });
          }
        }
      }
    }
  }

  // 3. Catch-Anfragen validieren
  for (const catchReq of Object.values(catchRequests)) {
    if (catchReq.status !== 'PENDING') continue;

    const claimedCatch = await adapter.claimCatchRequest(catchReq.id);
    if (!claimedCatch) continue;

    const check = verifyCatchSubmission(
      claimedCatch.codeOrSecret,
      claimedCatch.sessionId,
      publicState.sessionId,
      hiderPrivate.qrSecret,
      hiderPrivate.shortCode
    );

    if (!check.valid) {
      await adapter.finalizeCatchRequest(
        claimedCatch.id,
        'INVALID',
        serverNowMs,
        check.reason
      );
      continue;
    }

    const { transitioned, team } = await adapter.markTeamCaughtAtomically(
      claimedCatch.teamId,
      serverNowMs
    );

    if (!transitioned || !team) {
      await adapter.finalizeCatchRequest(
        claimedCatch.id,
        'ALREADY_CAUGHT',
        serverNowMs,
        'Team ist bereits bei den Sardinen.'
      );
      continue;
    }

    const searchStart =
      publicState.searchStartTimestamp ??
      publicState.gameStartTimestamp ??
      serverNowMs;

    const score = computeOfficialTeamScore({
      catchTimestampMs: serverNowMs,
      searchStartTimestamp: searchStart,
      totalPausedMsAtCatch: publicState.totalPausedMs,
      pausedBeforeSearchMs: publicState.pausedBeforeSearchMs,
      validPenaltyMsSum: team.penaltyMs,
      refundedPenaltyMsSum: 0,
    });

    const entry: LeaderboardEntry = {
      teamId: team.id,
      teamName: team.name,
      color: team.color,
      status: 'JOINED_SARDINES',
      searchTimeMs: score.searchTimeMs,
      penaltyMs: score.penaltyMs,
      totalTimeMs: score.totalTimeMs,
      clueCount: team.clueCount,
      caughtAt: serverNowMs,
    };

    await adapter.saveLeaderboardEntry(entry);
    await adapter.clearTeamLocation(team.id);
    await adapter.finalizeCatchRequest(claimedCatch.id, 'ACCEPTED', serverNowMs);

    // Prüfe, ob nun alle besetzten Sucher-Teams im Ziel sind
    const populatedTeams = Object.values(teamsPublic).filter(
      (t) => t.memberPlayerIds.length > 0
    );
    if (
      populatedTeams.length > 0 &&
      populatedTeams.every(
        (t) => t.id === team.id || t.status === 'JOINED_SARDINES'
      )
    ) {
      await adapter.patchControllerPublicTransition({
        status: 'FINISHED',
      });
    }
  }
}

/**
 * Atomare Rückerstattung (-5 Min.) + Gratis-Donut-Ring bei Timeout (120s Netto) oder Hider-Ablehnung.
 */
export async function refundAndCompensateMediaRequest(params: {
  adapter: DatabaseAdapter;
  req: ClueRequest;
  reasonStatus: 'EXPIRED' | 'REJECTED';
  rejectionReason?: string;
  anchorPoint: LatLng;
  playArea: PublicGameState['playArea']['polygon'];
  latestTeamLocation: TeamLocation | null;
  serverNowMs: number;
}): Promise<boolean> {
  const {
    adapter,
    req,
    reasonStatus,
    rejectionReason,
    anchorPoint,
    playArea,
    latestTeamLocation,
    serverNowMs,
  } = params;

  const claimed = await adapter.claimRequestForProcessing(
    req.teamId,
    req.id,
    req.sessionId,
    ['AWAITING_HIDER_MEDIA'],
    'EXPIRED_PROCESSING'
  );
  if (!claimed) {
    return false;
  }

  // Exakt einmal -5 Min. (300.000 ms) zurückerstatten
  await adapter.adjustTeamPenaltyAndClueCountAtomically(
    claimed.teamId,
    -MEDIA_REFUND_MS,
    0
  );

  // Aktuellste bekannte Team-Position nutzen, falls neuer als Anfragezeitpunkt
  const origin: LatLng =
    latestTeamLocation && latestTeamLocation.timestamp >= claimed.createdAt
      ? { lat: latestTeamLocation.lat, lng: latestTeamLocation.lng }
      : {
          lat: claimed.requesterSnapshotLocation.lat,
          lng: claimed.requesterSnapshotLocation.lng,
        };

  const freeDonut = evaluateDonutRing(origin, anchorPoint, playArea, true);

  const compensationClue: ClueRecord = {
    id: generateRandomId(`clue_comp_${claimed.id}`),
    requestId: claimed.id,
    teamId: claimed.teamId,
    sessionId: claimed.sessionId,
    questionType: 'DONUT_RING',
    category: 3,
    title: freeDonut.title,
    answerText: freeDonut.answerText,
    detailText:
      reasonStatus === 'EXPIRED'
        ? `120s-Antwortfrist abgelaufen (-5 Min. erstattet). ${freeDonut.detailText}`
        : `Medienanfrage abgelehnt (-5 Min. erstattet). ${freeDonut.detailText}`,
    isPositiveHit: true,
    penaltyMs: 0,
    refundedMs: MEDIA_REFUND_MS,
    createdAt: serverNowMs,
    overlayGeoJson: freeDonut.overlayGeoJson,
    overlayStyle: 'RING_BAND',
    isFallbackCompensation: true,
  };

  await adapter.saveClue(claimed.teamId, compensationClue);
  await adapter.updateClueRequest(claimed.teamId, claimed.id, {
    ...claimed,
    status: reasonStatus,
    refundedMs: MEDIA_REFUND_MS,
    processedAt: serverNowMs,
    rejectionReason,
  });

  return true;
}

/**
 * Übermittelt ein aufgenommenes (oder synthetisches Demo-)Foto bzw. 10s-Audio der Verstecker.
 */
export async function submitHiderMediaResponse(params: {
  adapter: DatabaseAdapter;
  req: ClueRequest;
  mediaBase64: string;
  mediaMimeType: string;
  mediaSynthetic?: boolean;
  serverNowMs: number;
}): Promise<boolean> {
  const {
    adapter,
    req,
    mediaBase64,
    mediaMimeType,
    mediaSynthetic,
    serverNowMs,
  } = params;

  if (mediaBase64.length > 95_000) {
    throw new Error('Mediendatei überschreitet das Sicherheitslimit von 95 KB.');
  }

  const claimed = await adapter.claimRequestForProcessing(
    req.teamId,
    req.id,
    req.sessionId,
    ['AWAITING_HIDER_MEDIA'],
    'PROCESSING'
  );
  if (!claimed) {
    return false;
  }

  const isSelfie = claimed.questionType === 'MEDIA_SELFIE';
  const clue: ClueRecord = {
    id: `clue_${claimed.id}`,
    requestId: claimed.id,
    teamId: claimed.teamId,
    sessionId: claimed.sessionId,
    questionType: claimed.questionType,
    category: 4,
    title: getQuestionLabelDe(claimed.questionType),
    answerText: isSelfie
      ? 'Gruppen-Selfie empfangen (alle Köpfe im Bild)'
      : 'Foto-Hinweis empfangen',
    detailText: mediaSynthetic
      ? 'Synthetisches Demo-Foto von den Versteckern übermittelt.'
      : isSelfie
        ? 'Gruppen-Selfie der aktuellen Verstecker-Gruppe bereit zur Ansicht.'
        : 'Live-Aufnahme der Verstecker bereit zur Ansicht.',
    isPositiveHit: true,
    penaltyMs: claimed.penaltyMs,
    createdAt: serverNowMs,
    overlayGeoJson: null,
    hasMedia: true,
    mediaKind: 'IMAGE',
  };

  await adapter.saveClue(claimed.teamId, clue);
  await adapter.updateClueRequest(claimed.teamId, claimed.id, {
    ...claimed,
    status: 'ANSWERED',
    mediaBase64,
    mediaMimeType,
    mediaSynthetic,
    processedAt: serverNowMs,
  });

  return true;
}

export interface UseControllerEngineParams {
  adapter: DatabaseAdapter;
  ownMember: MemberRecord | null;
  publicState: PublicGameState | null;
  controllerLease: ControllerLease | null;
  hiderPrivate: HiderPrivateState | null;
  teamsPublic: Record<string, TeamPublic>;
  teamLocations: Record<string, TeamLocation | null>;
  requestsByTeam: Record<string, Record<string, ClueRequest>>;
  catchRequests: Record<string, CatchRequest>;
  ownGeoFix: GeoFix | null;
}

export function useControllerEngine(params: UseControllerEngineParams): {
  isLeaseHolder: boolean;
  isControllerDisconnected: boolean;
} {
  const {
    adapter,
    ownMember,
    publicState,
    controllerLease,
    hiderPrivate,
    requestsByTeam,
    catchRequests,
  } = params;

  const [nowTick, setNowTick] = useState(() => adapter.getServerNow());
  const isBusyRef = useRef(false);
  const latestRef = useRef(params);
  latestRef.current = params;

  const eligibleToControl = Boolean(
    ownMember?.enabled && (ownMember.isHost || ownMember.side === 'HIDER')
  );

  // Regelmäßiger 1s-Takt für Lease-Prüfung, Phasenwechsel und 120s-Medien-Timeout
  useEffect(() => {
    const id = setInterval(() => {
      setNowTick(adapter.getServerNow());
    }, 1000);
    return () => clearInterval(id);
  }, [adapter]);

  // Lease-Erwerb & 5s-Heartbeat für berechtigte Host-/Hider-Geräte
  useEffect(() => {
    if (!eligibleToControl || !ownMember || !publicState) return;
    if (publicState.status === 'LOBBY') return;

    let cancelled = false;
    const attemptLease = async () => {
      if (cancelled) return;
      const now = adapter.getServerNow();
      try {
        await adapter.tryAcquireOrRenewLease(
          ownMember.uid,
          publicState.sessionId,
          now,
          CONTROLLER_LEASE_TTL_MS
        );
      } catch {
        // Bei kurzzeitigem Netzverlust beim nächsten Heartbeat erneut versuchen
      }
    };

    void attemptLease();
    const hb = setInterval(() => {
      void attemptLease();
    }, CONTROLLER_HEARTBEAT_INTERVAL_MS);

    const onVisChange = () => {
      if (document.visibilityState === 'visible') {
        setNowTick(adapter.getServerNow());
        void attemptLease();
      }
    };
    document.addEventListener('visibilitychange', onVisChange);

    return () => {
      cancelled = true;
      clearInterval(hb);
      document.removeEventListener('visibilitychange', onVisChange);
    };
  }, [adapter, eligibleToControl, ownMember?.uid, publicState?.sessionId, publicState?.status]);

  const serverNow = adapter.getServerNow();
  const leaseValid = Boolean(
    controllerLease &&
      controllerLease.sessionId === publicState?.sessionId &&
      controllerLease.leaseExpiresAt >= serverNow
  );
  const isLeaseHolder = Boolean(
    eligibleToControl &&
      ownMember &&
      leaseValid &&
      controllerLease?.controllerUid === ownMember.uid
  );

  const isControllerDisconnected = Boolean(
    publicState &&
      (publicState.status === 'RUNNING' || publicState.status === 'PAUSED') &&
      !leaseValid
  );

  // Führe Controller-Tick aus, sobald wir Lease-Halter sind und Daten oder Uhrzeit sich ändern
  useEffect(() => {
    if (!isLeaseHolder) return;
    const cur = latestRef.current;
    if (!cur.ownMember || !cur.publicState || !cur.hiderPrivate) return;
    if (isBusyRef.current) return;

    isBusyRef.current = true;
    void executeControllerTick({
      adapter: cur.adapter,
      controllerUid: cur.ownMember.uid,
      serverNowMs: cur.adapter.getServerNow(),
      publicState: cur.publicState,
      hiderPrivate: cur.hiderPrivate,
      teamsPublic: cur.teamsPublic,
      teamLocations: cur.teamLocations,
      requestsByTeam: cur.requestsByTeam,
      catchRequests: cur.catchRequests,
      fallbackHiderFix: cur.ownGeoFix,
    }).finally(() => {
      isBusyRef.current = false;
    });
  }, [
    isLeaseHolder,
    nowTick,
    publicState,
    hiderPrivate,
    requestsByTeam,
    catchRequests,
  ]);

  return {
    isLeaseHolder,
    isControllerDisconnected,
  };
}
