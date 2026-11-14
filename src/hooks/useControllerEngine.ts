import { useEffect, useRef, useState } from 'react';
import {
  CONTROLLER_HEARTBEAT_INTERVAL_MS,
  CONTROLLER_LEASE_TTL_MS,
  getManhuntPingStatusAtElapsedMs,
  MANHUNT_RADAR_RADII,
  MEDIA_AUTO_EXPIRE_MS,
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
  computeNextManhuntZoneCircle,
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
  GamePhase,
  GeoFix,
  HiderPrivateState,
  LatLng,
  LeaderboardEntry,
  ManhuntPingInfo,
  ManhuntPingSource,
  MemberRecord,
  PublicGameState,
  PublishedRadarCircle,
  RadarStageId,
  RadarStageSecret,
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
  rng?: () => number;
  osmFetcher?: (
    playArea: PublicGameState['playArea']['polygon']
  ) => Promise<OsmEnvironmentData>;
}

export const MANHUNT_LIVE_FIX_MAX_AGE_MS = 2 * 60_000; // <= 2 Min. gilt als frischer Live-GPS-Fix

export interface ResolvedManhuntPingLocation {
  lat: number;
  lng: number;
  accuracy: number;
  source: ManhuntPingSource;
  lastFixAgeMs?: number;
}

/**
 * Mehrstufige Positionsauflösung für Manhunt-Pings mit GPS-Ausfallschutz:
 * 1. LIVE_GPS: Frische GPS-Fixes (<= 2 Min. alt) aus `hiderPrivate.hiderLocations` (inkl. Sardinen-Rudel) oder `fallbackHiderFix`.
 * 2. LAST_KNOWN_GPS: Letzter bekannter historischer Standort der Verstecker (aus `hiderLocations`, `fallbackHiderFix` oder vorherigem Ping).
 * 3. ZONE_FALLBACK: Aktueller Zonenmittelpunkt bzw. Sammelpunkt im Spielgebiet, falls noch nie ein GPS-Signal vorlag.
 */
export function resolveManhuntHiderPingLocation(params: {
  hiderPrivate: HiderPrivateState;
  fallbackHiderFix?: GeoFix | null;
  publicState: PublicGameState;
  serverNowMs: number;
}): ResolvedManhuntPingLocation {
  const { hiderPrivate, fallbackHiderFix, publicState, serverNowMs } = params;
  const allFixes = Object.values(hiderPrivate.hiderLocations ?? {}).filter(
    (f): f is GeoFix =>
      Boolean(
        f &&
          typeof f.lat === 'number' &&
          Number.isFinite(f.lat) &&
          typeof f.lng === 'number' &&
          Number.isFinite(f.lng)
      )
  );

  const freshFixes = allFixes.filter(
    (f) =>
      typeof f.timestamp !== 'number' ||
      !Number.isFinite(f.timestamp) ||
      serverNowMs - f.timestamp <= MANHUNT_LIVE_FIX_MAX_AGE_MS
  );

  // 1. LIVE_GPS aus aktiven Hider/Sardinen-Fixes
  if (freshFixes.length > 0) {
    const sumLat = freshFixes.reduce((acc, f) => acc + f.lat, 0);
    const sumLng = freshFixes.reduce((acc, f) => acc + f.lng, 0);
    const avgAcc =
      freshFixes.reduce(
        (acc, f) => acc + (Number.isFinite(f.accuracy) ? f.accuracy : 15),
        0
      ) / freshFixes.length;
    const newestTs = Math.max(
      ...freshFixes.map((f) =>
        typeof f.timestamp === 'number' && Number.isFinite(f.timestamp)
          ? f.timestamp
          : serverNowMs
      )
    );
    return {
      lat: sumLat / freshFixes.length,
      lng: sumLng / freshFixes.length,
      accuracy: Math.max(5, Math.round(avgAcc)),
      source: 'LIVE_GPS',
      lastFixAgeMs: Math.max(0, serverNowMs - newestTs),
    };
  }

  // 1b. LIVE_GPS aus lokalem Controller-Fallback-Fix (falls frisch)
  if (
    fallbackHiderFix &&
    (typeof fallbackHiderFix.timestamp !== 'number' ||
      serverNowMs - fallbackHiderFix.timestamp <= MANHUNT_LIVE_FIX_MAX_AGE_MS)
  ) {
    return {
      lat: fallbackHiderFix.lat,
      lng: fallbackHiderFix.lng,
      accuracy: Math.max(5, Math.round(fallbackHiderFix.accuracy || 15)),
      source: 'LIVE_GPS',
      lastFixAgeMs:
        typeof fallbackHiderFix.timestamp === 'number'
          ? Math.max(0, serverNowMs - fallbackHiderFix.timestamp)
          : 0,
    };
  }

  // 2. LAST_KNOWN_GPS aus älteren gespeicherten Hider-Fixes (neuestes Zeitfenster)
  if (allFixes.length > 0) {
    const newestTs = Math.max(
      ...allFixes.map((f) =>
        typeof f.timestamp === 'number' && Number.isFinite(f.timestamp)
          ? f.timestamp
          : 0
      )
    );
    const recentHistorical = allFixes.filter(
      (f) => (f.timestamp ?? 0) >= newestTs - 60_000
    );
    const chosen = recentHistorical.length > 0 ? recentHistorical : allFixes;
    const sumLat = chosen.reduce((acc, f) => acc + f.lat, 0);
    const sumLng = chosen.reduce((acc, f) => acc + f.lng, 0);
    const avgAcc =
      chosen.reduce(
        (acc, f) => acc + (Number.isFinite(f.accuracy) ? f.accuracy : 25),
        0
      ) / chosen.length;
    return {
      lat: sumLat / chosen.length,
      lng: sumLng / chosen.length,
      accuracy: Math.max(10, Math.round(avgAcc)),
      source: 'LAST_KNOWN_GPS',
      lastFixAgeMs: newestTs > 0 ? Math.max(0, serverNowMs - newestTs) : undefined,
    };
  }

  // 2b. LAST_KNOWN_GPS aus älterem lokalen Controller-Fix
  if (fallbackHiderFix) {
    return {
      lat: fallbackHiderFix.lat,
      lng: fallbackHiderFix.lng,
      accuracy: Math.max(10, Math.round(fallbackHiderFix.accuracy || 25)),
      source: 'LAST_KNOWN_GPS',
      lastFixAgeMs:
        typeof fallbackHiderFix.timestamp === 'number'
          ? Math.max(0, serverNowMs - fallbackHiderFix.timestamp)
          : undefined,
    };
  }

  // 2c. LAST_KNOWN_GPS aus vorherigem Ping
  if (publicState.radarCircle?.lastPing) {
    const prevPing = publicState.radarCircle.lastPing;
    return {
      lat: prevPing.lat,
      lng: prevPing.lng,
      accuracy: Math.max(15, Math.round(prevPing.accuracy || 30)),
      source: 'LAST_KNOWN_GPS',
      lastFixAgeMs: Math.max(0, serverNowMs - prevPing.pingedAt),
    };
  }

  // 3. ZONE_FALLBACK: Noch nie ein GPS-Signal empfangen -> nutze aktuellen Zonenmittelpunkt bzw. SafetyPoint
  if (publicState.radarCircle) {
    return {
      lat: publicState.radarCircle.center.lat,
      lng: publicState.radarCircle.center.lng,
      accuracy: Math.min(
        250,
        Math.max(40, Math.round(publicState.radarCircle.radiusMeters * 0.25))
      ),
      source: 'ZONE_FALLBACK',
    };
  }

  const snappedSafety = snapPointIntoPlayArea(
    {
      lat: publicState.safetyPoint.lat,
      lng: publicState.safetyPoint.lng,
    },
    publicState.playArea.polygon
  );
  return {
    lat: snappedSafety.lat,
    lng: snappedSafety.lng,
    accuracy: 100,
    source: 'ZONE_FALLBACK',
  };
}

/**
 * Ermittelt im Manhunt-Modus den aktuellen Live-Schwerpunkt aller Verstecker aus `hiderPrivate.hiderLocations`.
 */
export function resolveLiveManhuntHiderCentroid(params: {
  hiderPrivate: HiderPrivateState;
  fallbackHiderFix?: GeoFix | null;
  publicState: PublicGameState;
  serverNowMs?: number;
}): LatLng {
  const resolved = resolveManhuntHiderPingLocation({
    ...params,
    serverNowMs: params.serverNowMs ?? Date.now(),
  });
  return { lat: resolved.lat, lng: resolved.lng };
}

/**
 * Ermittelt für den klassischen Sardinen-Modus die beste echte Verstecker-GPS-Position
 * (aus `hiderPrivate.hiderLocations` bzw. lokalem Hider-Fix), OHNE jemals blind auf den
 * Safety-Point (Schloss Blutenburg) zurückzuspringen!
 */
export function resolveClassicHiderCandidateLocation(params: {
  hiderPrivate: HiderPrivateState | null;
  fallbackHiderFix?: GeoFix | null;
  serverNowMs?: number;
}): { lat: number; lng: number; accuracy: number } | null {
  const { hiderPrivate, fallbackHiderFix, serverNowMs = Date.now() } = params;
  const rawLocs = hiderPrivate?.hiderLocations ?? {};
  const allFixes = Object.values(rawLocs).filter(
    (f): f is GeoFix =>
      Boolean(f) &&
      typeof f.lat === 'number' &&
      Number.isFinite(f.lat) &&
      typeof f.lng === 'number' &&
      Number.isFinite(f.lng)
  );

  // 1. Frische gespeicherte Hider-Fixes (<= 2 Min.) mitteln
  const freshFixes = allFixes.filter(
    (f) =>
      typeof f.timestamp === 'number' &&
      Number.isFinite(f.timestamp) &&
      serverNowMs - f.timestamp <= MANHUNT_LIVE_FIX_MAX_AGE_MS
  );
  if (freshFixes.length > 0) {
    const sumLat = freshFixes.reduce((acc, f) => acc + f.lat, 0);
    const sumLng = freshFixes.reduce((acc, f) => acc + f.lng, 0);
    const avgAcc =
      freshFixes.reduce(
        (acc, f) => acc + (Number.isFinite(f.accuracy) ? f.accuracy : 15),
        0
      ) / freshFixes.length;
    return {
      lat: sumLat / freshFixes.length,
      lng: sumLng / freshFixes.length,
      accuracy: Math.max(5, Math.round(avgAcc)),
    };
  }

  // 2. Lokaler GPS-Fix eines Hiders (sofern dieser Tab selbst ein Hider ist)
  if (
    fallbackHiderFix &&
    typeof fallbackHiderFix.lat === 'number' &&
    Number.isFinite(fallbackHiderFix.lat) &&
    typeof fallbackHiderFix.lng === 'number' &&
    Number.isFinite(fallbackHiderFix.lng)
  ) {
    return {
      lat: fallbackHiderFix.lat,
      lng: fallbackHiderFix.lng,
      accuracy: Math.max(5, Math.round(fallbackHiderFix.accuracy || 15)),
    };
  }

  // 3. Letzte bekannte Hider-Position aus `hiderPrivate.hiderLocations`
  if (allFixes.length > 0) {
    const newestTs = Math.max(
      ...allFixes.map((f) =>
        typeof f.timestamp === 'number' && Number.isFinite(f.timestamp)
          ? f.timestamp
          : 0
      )
    );
    const recent = allFixes.filter((f) => (f.timestamp ?? 0) >= newestTs - 60_000);
    const chosen = recent.length > 0 ? recent : allFixes;
    const sumLat = chosen.reduce((acc, f) => acc + f.lat, 0);
    const sumLng = chosen.reduce((acc, f) => acc + f.lng, 0);
    const avgAcc =
      chosen.reduce(
        (acc, f) => acc + (Number.isFinite(f.accuracy) ? f.accuracy : 20),
        0
      ) / chosen.length;
    return {
      lat: sumLat / chosen.length,
      lng: sumLng / chosen.length,
      accuracy: Math.max(8, Math.round(avgAcc)),
    };
  }

  return null;
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
    rng,
    osmFetcher = fetchOsmEnvironment81247,
  } = ctx;

  let hiderPrivate = ctx.hiderPrivate;
  const isManhunt = (publicState.gameMode ?? 'CLASSIC') === 'MANHUNT';

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

    if (isManhunt) {
      // Im Manhunt-Modus bewegen sich die Verstecker dauerhaft (kein statisches Versteck / kein Anchor-Lock).
      // Pings erfolgen alle 10 Min. in den ersten 3/4 der angegebenen Spielzeit und alle 5 Min. im letzten Viertel.
      const headStartMs = publicState.radarSchedule.hidingDurationMs;
      const huntDurationMs =
        publicState.manhuntShrinkDurationMs ??
        Math.max(10 * 60_000, publicState.radarSchedule.stage5Ms - headStartMs);

      const pingStatus = getManhuntPingStatusAtElapsedMs(
        netElapsedMs,
        headStartMs,
        huntDurationMs
      );

      const manhuntRawPhase: GamePhase =
        netElapsedMs < headStartMs
          ? 'HIDING'
          : pingStatus.dueStageId === null
            ? 'OPEN_SEARCH'
            : pingStatus.dueStageId === 5
              ? 'ENDGAME'
              : (`RADAR_${pingStatus.dueStageId}` as GamePhase);

      const manhuntDuePhase: GamePhase =
        manhuntRawPhase === 'HIDING' &&
        publicState.searchStartTimestamp !== null &&
        publicState.currentPhase !== 'HIDING'
          ? publicState.currentPhase
          : manhuntRawPhase;

      const lastPublishedPingElapsedMs =
        publicState.radarCircle?.lastPing?.triggerElapsedMs ?? null;
      const isNewPingDue =
        pingStatus.duePingElapsedMs !== null &&
        pingStatus.dueStageId !== null &&
        (lastPublishedPingElapsedMs === null ||
          lastPublishedPingElapsedMs < pingStatus.duePingElapsedMs);

      let nextRadarToPublish: PublishedRadarCircle | null = null;

      if (
        pingStatus.dueStageId !== null &&
        pingStatus.duePingElapsedMs !== null
      ) {
        const dueStageId = pingStatus.dueStageId;
        const stageMap = new Map<RadarStageId, RadarStageSecret>();
        for (const s of hiderPrivate.radarStages ?? []) {
          stageMap.set(s.stage, s);
        }

        const triggerMap: Record<RadarStageId, number> = {
          1: publicState.radarSchedule.stage1Ms,
          2: publicState.radarSchedule.stage2Ms,
          3: publicState.radarSchedule.stage3Ms,
          4: publicState.radarSchedule.stage4Ms,
          5: publicState.radarSchedule.stage5Ms,
        };

        const resolvedPingLoc = resolveManhuntHiderPingLocation({
          hiderPrivate,
          fallbackHiderFix,
          publicState,
          serverNowMs,
        });
        const liveHiderPos: LatLng = {
          lat: resolvedPingLoc.lat,
          lng: resolvedPingLoc.lng,
        };

        let mutatedStages = false;
        for (let st = 1; st <= dueStageId; st++) {
          const stageId = st as RadarStageId;
          const isCurrentDueStage = stageId === dueStageId;
          const existingSecret = stageMap.get(stageId);
          const needsStageRecompute =
            !existingSecret ||
            (isCurrentDueStage &&
              isNewPingDue &&
              existingSecret.triggerElapsedMs < pingStatus.duePingElapsedMs);

          if (needsStageRecompute) {
            const prevSecret =
              stageId > 1
                ? (stageMap.get((stageId - 1) as RadarStageId) ?? null)
                : null;
            const candidatePrevCircle =
              publicState.radarCircle &&
              publicState.radarCircle.radiusMeters >
                MANHUNT_RADAR_RADII[stageId]
                ? {
                    center: publicState.radarCircle.center,
                    radiusMeters: publicState.radarCircle.radiusMeters,
                  }
                : prevSecret &&
                    prevSecret.radiusMeters > MANHUNT_RADAR_RADII[stageId]
                  ? {
                      center: prevSecret.center,
                      radiusMeters: prevSecret.radiusMeters,
                    }
                  : null;

            const computed = computeNextManhuntZoneCircle({
              hiderPosition: liveHiderPos,
              stage: stageId,
              nextRadiusMeters: MANHUNT_RADAR_RADII[stageId],
              previousCircle: candidatePrevCircle,
              playArea: publicState.playArea.polygon,
              publishedAt: serverNowMs,
              rng,
            });

            stageMap.set(stageId, {
              stage: stageId,
              radiusMeters: computed.radiusMeters,
              center: computed.center,
              triggerElapsedMs: isCurrentDueStage
                ? pingStatus.duePingElapsedMs
                : triggerMap[stageId],
            });
            mutatedStages = true;
          }
        }

        if (mutatedStages) {
          const orderedStages = Array.from(stageMap.values()).sort(
            (a, b) => a.stage - b.stage
          );
          hiderPrivate = {
            ...hiderPrivate,
            radarStages: orderedStages,
          };
          await adapter.saveHiderPrivate(hiderPrivate);
        }

        const activeSecret = stageMap.get(dueStageId);
        if (
          activeSecret &&
          (isNewPingDue ||
            publicState.radarCircle?.stage !== dueStageId ||
            !publicState.radarCircle?.lastPing)
        ) {
          const lastPing: ManhuntPingInfo = {
            lat: resolvedPingLoc.lat,
            lng: resolvedPingLoc.lng,
            accuracy: resolvedPingLoc.accuracy,
            pingNumber: pingStatus.duePingNumber,
            pingedAt: serverNowMs,
            triggerElapsedMs: pingStatus.duePingElapsedMs,
            source: resolvedPingLoc.source,
            ...(resolvedPingLoc.lastFixAgeMs !== undefined
              ? { lastFixAgeMs: resolvedPingLoc.lastFixAgeMs }
              : {}),
          };

          nextRadarToPublish = {
            stage: activeSecret.stage,
            radiusMeters: activeSecret.radiusMeters,
            center: activeSecret.center,
            publishedAt: serverNowMs,
            lastPing,
          };
        }
      }

      const shouldClearManhuntRadar =
        pingStatus.dueStageId === null && publicState.radarCircle !== null;
      const needsSearchStartInit =
        manhuntDuePhase !== 'HIDING' && publicState.searchStartTimestamp === null;
      const needsPhaseUpdate = manhuntDuePhase !== publicState.currentPhase;
      const needsRadarUpdate =
        nextRadarToPublish !== null || shouldClearManhuntRadar;

      if (needsSearchStartInit || needsPhaseUpdate || needsRadarUpdate) {
        await adapter.patchControllerPublicTransition({
          ...(needsPhaseUpdate ? { currentPhase: manhuntDuePhase } : {}),
          ...(needsSearchStartInit
            ? {
                searchStartTimestamp: serverNowMs,
                pausedBeforeSearchMs: publicState.totalPausedMs,
                anchorLocked: false,
              }
            : {}),
          ...(needsRadarUpdate
            ? { radarCircle: shouldClearManhuntRadar ? null : nextRadarToPublish }
            : {}),
        });
      }
    } else {
      // Automatische Fixierung des Anchor Points ab Ende der Versteckzeit anhand echter Verstecker-GPS-Daten
      // (NIEMALS blind auf Schloss Blutenburg springen, falls gerade noch kein Hider-Fix vorliegt!)
      if (duePhase !== 'HIDING' && !hiderPrivate.anchorPoint) {
        const candidateFix = resolveClassicHiderCandidateLocation({
          hiderPrivate,
          fallbackHiderFix,
          serverNowMs,
        });
        if (candidateFix) {
          hiderPrivate = await lockHiderAnchorAndGenerateRadar({
            adapter,
            uid: controllerUid,
            targetLocation: { lat: candidateFix.lat, lng: candidateFix.lng },
            accuracy: candidateFix.accuracy,
            serverNowMs,
            publicState,
            currentHiderPrivate: hiderPrivate,
            startSearchImmediately: false,
            rng,
          });
        }
      } else if (
        hiderPrivate.anchorPoint &&
        hiderPrivate.radarStages.length === 5
      ) {
        const schedMap: Record<RadarStageId, number> = {
          1: publicState.radarSchedule.stage1Ms,
          2: publicState.radarSchedule.stage2Ms,
          3: publicState.radarSchedule.stage3Ms,
          4: publicState.radarSchedule.stage4Ms,
          5: publicState.radarSchedule.stage5Ms,
        };
        const scheduleShifted = hiderPrivate.radarStages.some(
          (s) => s.triggerElapsedMs !== schedMap[s.stage]
        );
        if (scheduleShifted) {
          const syncedStages = hiderPrivate.radarStages.map((s) => ({
            ...s,
            triggerElapsedMs: schedMap[s.stage],
          }));
          hiderPrivate = {
            ...hiderPrivate,
            radarStages: syncedStages,
          };
          await adapter.saveHiderPrivate(hiderPrivate);
        }
      }

      const dueRadar = getDueRadarCircle(
        netElapsedMs,
        hiderPrivate.radarStages,
        serverNowMs
      );

      const hasAnchorLocked = Boolean(hiderPrivate.anchorPoint);
      const needsSearchStartInit =
        duePhase !== 'HIDING' && publicState.searchStartTimestamp === null;
      const needsPhaseUpdate = duePhase !== publicState.currentPhase;
      const needsAnchorFlagSync =
        duePhase !== 'HIDING' && publicState.anchorLocked !== hasAnchorLocked;
      const needsRadarUpdate =
        (dueRadar?.stage ?? null) !== (publicState.radarCircle?.stage ?? null);

      if (
        needsSearchStartInit ||
        needsPhaseUpdate ||
        needsAnchorFlagSync ||
        needsRadarUpdate
      ) {
        await adapter.patchControllerPublicTransition({
          ...(needsPhaseUpdate ? { currentPhase: duePhase } : {}),
          ...(needsSearchStartInit
            ? {
                searchStartTimestamp: serverNowMs,
                pausedBeforeSearchMs: publicState.totalPausedMs,
                anchorLocked: hasAnchorLocked,
              }
            : needsAnchorFlagSync
              ? { anchorLocked: hasAnchorLocked }
              : {}),
          ...(needsRadarUpdate ? { radarCircle: dueRadar } : {}),
        });
      }
    }
  }

  // 2. Hinweis-Anfragen verarbeiten (nur im klassischen Modus, sofern Anchor Point vorhanden und nicht pausiert)
  if (!isManhunt && isRunningUnpaused && hiderPrivate.anchorPoint) {
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
            // Manuelle Foto-Anfrage: +5 Min. Strafzeit einmalig buchen und 5-Min.-Netto-Frist starten
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

  // 2b. Abgelaufene Foto-Hinweise automatisch löschen (10 Min. ab Empfang bzw. 1 Min. nach Download)
  for (const [teamId, teamReqs] of Object.entries(requestsByTeam)) {
    for (const req of Object.values(teamReqs)) {
      if (req.sessionId !== publicState.sessionId) continue;
      if (req.status === 'ANSWERED' && req.mediaBase64) {
        const expAt =
          req.mediaExpiresAt ??
          (req.processedAt ?? req.createdAt) + MEDIA_AUTO_EXPIRE_MS;
        if (serverNowMs >= expAt) {
          await adapter.acknowledgeAndStripMedia(teamId, req.id, serverNowMs);
        }
      }
    }
  }

  // 3. Catch-Anfragen validieren
  const caughtTeamIdsInThisTick = new Set<string>();
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

    caughtTeamIdsInThisTick.add(team.id);

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
        (t) =>
          caughtTeamIdsInThisTick.has(t.id) || t.status === 'JOINED_SARDINES'
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

  const refundMs =
    claimed.penaltyMs > 0 ? claimed.penaltyMs * 2 : MEDIA_REFUND_MS;
  const refundMin = Math.round(refundMs / 60_000);

  // Exakt einmal das Doppelte des Foto-Preises (Standard -10 Min.) von der Zeit des anfragenden Sucher-Teams abziehen
  await adapter.adjustTeamPenaltyAndClueCountAtomically(
    claimed.teamId,
    -refundMs,
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
        ? `5-Min.-Antwortfrist abgelaufen (-${refundMin} Min. Zeitabzug). ${freeDonut.detailText}`
        : `Foto-Anfrage abgelehnt (-${refundMin} Min. Zeitabzug). ${freeDonut.detailText}`,
    isPositiveHit: true,
    penaltyMs: 0,
    refundedMs: refundMs,
    createdAt: serverNowMs,
    overlayGeoJson: freeDonut.overlayGeoJson,
    overlayStyle: 'RING_BAND',
    isFallbackCompensation: true,
  };

  await adapter.saveClue(claimed.teamId, compensationClue);
  await adapter.updateClueRequest(claimed.teamId, claimed.id, {
    ...claimed,
    status: reasonStatus,
    refundedMs: refundMs,
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
    mediaExpiresAt: serverNowMs + MEDIA_AUTO_EXPIRE_MS,
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
      fallbackHiderFix:
        cur.ownMember.side === 'HIDER' ? cur.ownGeoFix : null,
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
