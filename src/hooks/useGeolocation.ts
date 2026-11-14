import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LEASH_CONSECUTIVE_VIOLATIONS,
  LEASH_RADIUS_METERS,
  LEASH_REQUIRED_ACCURACY_METERS,
  LEASH_RETURN_COUNTDOWN_MS,
  MAP_DEFAULT_CENTER,
} from '../config/gameConfig';
import { isPointInPlayArea, snapPointIntoPlayArea } from '../geo/boundary';
import { distanceMeters } from '../geo/distance';
import type { DatabaseAdapter } from '../services/databaseAdapter';
import {
  HiderPrivateBroadcaster,
  SeekerBeaconBroadcaster,
} from '../services/locationService';
import type {
  AnchorPoint,
  GeoFix,
  LatLng,
  MemberRecord,
  PublicGameState,
  TeamLocation,
  TeamPublic,
} from '../types/game';

export type GpsPermissionState = 'IDLE' | 'TRACKING' | 'DENIED' | 'UNSUPPORTED' | 'MANUAL_TEST';

export interface LeashMonitorState {
  distanceFromAnchorMeters: number | null;
  consecutiveOutsideCount: number;
  warningActive: boolean;
  countdownSecondsLeft: number | null;
  publicAlertTriggered: boolean;
  liveRevealSecondsLeft: number | null;
  liveLocationExposed: boolean;
  outsidePlayAreaSecondsLeft: number | null;
  violationReason:
    | 'OUTSIDE_81247'
    | 'OUTSIDE_MANHUNT_ZONE'
    | 'OUTSIDE_CLASSIC_LEASH'
    | null;
}

export interface UseGeolocationParams {
  adapter: DatabaseAdapter;
  ownMember: MemberRecord | null;
  ownTeam: TeamPublic | null;
  ownTeamStoredLocation: TeamLocation | null;
  publicState: PublicGameState | null;
  anchorPoint: AnchorPoint | null;
}

/**
 * Verwaltet Live-GPS (`watchPosition`), `visibilitychange`-Resilienz, manuelle Kartenklick-Testpositionen,
 * das gedrosselte Seeker-Beacon-Senden sowie die lokale 50-Meter-Versteck-Leash der Sardinen.
 */
export function useGeolocation(params: UseGeolocationParams): {
  currentFix: GeoFix | null;
  gpsStatus: GpsPermissionState;
  gpsError: string | null;
  leashState: LeashMonitorState;
  setManualTestLocation: (pt: LatLng, forceAllow?: boolean) => void;
  retryGpsPermission: () => Promise<GeoFix | null>;
} {
  const {
    adapter,
    ownMember,
    ownTeam,
    ownTeamStoredLocation,
    publicState,
    anchorPoint,
  } = params;

  const [hardwareFix, setHardwareFix] = useState<GeoFix | null>(null);
  const [manualFix, setManualFix] = useState<GeoFix | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsPermissionState>('IDLE');
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [watcherGeneration, setWatcherGeneration] = useState(0);

  // 50-Meter-Leash / Zonen- & 81247-Grenzüberwachung
  const consecutiveViolationsRef = useRef(0);
  const violationStartedAtMsRef = useRef<number | null>(null);
  const outsidePlayAreaStartedAtMsRef = useRef<number | null>(null);
  const lastAlertSyncKeyRef = useRef<string>('');
  const hadPublishedLeashAlertRef = useRef<boolean>(false);
  const [leashState, setLeashState] = useState<LeashMonitorState>({
    distanceFromAnchorMeters: null,
    consecutiveOutsideCount: 0,
    warningActive: false,
    countdownSecondsLeft: null,
    publicAlertTriggered: false,
    liveRevealSecondsLeft: null,
    liveLocationExposed: false,
    outsidePlayAreaSecondsLeft: null,
    violationReason: null,
  });

  const broadcasterRef = useRef(new SeekerBeaconBroadcaster());
  const hiderBroadcasterRef = useRef(new HiderPrivateBroadcaster());

  const canUseManualClicks = Boolean(
    adapter.mode === 'demo' || publicState?.allowTestClicks
  );

  const isManhuntSardineFallbackAllowed = Boolean(
    publicState?.gameMode === 'MANHUNT' &&
      (ownMember?.side === 'HIDER' || ownTeam?.status === 'JOINED_SARDINES')
  );

  // Wenn Manual-Testmodus vom Host deaktiviert wird (und kein Manhunt-GPS-Fallback nötig ist), lösche lokale Testposition
  useEffect(() => {
    if (
      !canUseManualClicks &&
      (!isManhuntSardineFallbackAllowed || hardwareFix !== null) &&
      manualFix !== null
    ) {
      setManualFix(null);
    }
  }, [canUseManualClicks, isManhuntSardineFallbackAllowed, hardwareFix, manualFix]);

  // Hardware-Geolocation-Watcher inkl. Re-Sync bei visibilitychange
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('UNSUPPORTED');
      setGpsError('GPS wird von diesem Browser nicht unterstützt.');
      return;
    }

    setGpsError(null);
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setHardwareFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp || Date.now(),
        });
        setGpsStatus('TRACKING');
        setGpsError(null);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsStatus('DENIED');
          setGpsError(
            'Standortfreigabe verweigert. Bitte erlaube GPS im Browser oder nutze im Testmodus den Kartenklick.'
          );
        } else {
          setGpsError('GPS-Signal wird gesucht (im Freien bessere Genauigkeit) ...');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 12000,
      }
    );

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setWatcherGeneration((g) => g + 1);
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      navigator.geolocation.clearWatch(watchId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [watcherGeneration]);

  // Effektive Position bestimmen (Manueller Testklick > Hardware-GPS > Manhunt-GPS-Fallback > Demo-Default)
  const currentFix: GeoFix | null =
    (canUseManualClicks && manualFix) ||
    hardwareFix ||
    (isManhuntSardineFallbackAllowed && manualFix) ||
    (adapter.mode === 'demo'
      ? ownTeamStoredLocation
        ? {
            lat: ownTeamStoredLocation.lat,
            lng: ownTeamStoredLocation.lng,
            accuracy: ownTeamStoredLocation.accuracy,
            timestamp: ownTeamStoredLocation.timestamp,
          }
        : {
            lat: MAP_DEFAULT_CENTER[0],
            lng: MAP_DEFAULT_CENTER[1],
            accuracy: 10,
            timestamp: Date.now(),
          }
      : null);

  const setManualTestLocation = useCallback(
    (pt: LatLng, forceAllow?: boolean) => {
      if (!canUseManualClicks && !isManhuntSardineFallbackAllowed && !forceAllow) {
        return;
      }
      const now = adapter.getServerNow();
      setManualFix({
        lat: pt.lat,
        lng: pt.lng,
        accuracy: 6,
        timestamp: now,
      });
      setGpsStatus('MANUAL_TEST');
      setGpsError(null);
    },
    [adapter, canUseManualClicks, isManhuntSardineFallbackAllowed]
  );

  const retryGpsPermission = useCallback((): Promise<GeoFix | null> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('UNSUPPORTED');
      setGpsError('GPS wird von diesem Browser nicht unterstützt.');
      return Promise.resolve(null);
    }

    setGpsError(null);
    setWatcherGeneration((g) => g + 1);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const fix: GeoFix = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp || Date.now(),
          };
          setHardwareFix(fix);
          setGpsStatus('TRACKING');
          setGpsError(null);
          resolve(fix);
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) {
            setGpsStatus('DENIED');
            setGpsError(
              'Standortfreigabe verweigert. Bitte erlaube GPS im Browser oder nutze im Testmodus den Kartenklick.'
            );
          } else {
            setGpsError('GPS-Signal wird gesucht (im Freien bessere Genauigkeit) ...');
          }
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 12000,
        }
      );
    });
  }, []);

  // Gedrosseltes Senden für Sucher-Beacon (6s / 25m) sowie privater Verstecker-Sync im Manhunt-Modus
  useEffect(() => {
    const isRoundRunningOrPaused = Boolean(
      publicState &&
        (publicState.status === 'RUNNING' || publicState.status === 'PAUSED')
    );
    const seekerGameActive = Boolean(
      isRoundRunningOrPaused && publicState?.currentPhase !== 'HIDING'
    );
    void broadcasterRef.current.maybePublishFix({
      adapter,
      member: ownMember,
      team: ownTeam,
      gameActive: seekerGameActive,
      fix: currentFix,
    });

    void hiderBroadcasterRef.current.maybePublishFix({
      adapter,
      member: ownMember,
      team: ownTeam,
      gameMode: publicState?.gameMode ?? 'CLASSIC',
      gameActive: isRoundRunningOrPaused,
      fix: currentFix,
    });
  }, [adapter, ownMember, ownTeam, publicState, currentFix]);

  // Lokale 50-Meter-Versteck-Leash (Klassisch), Aktive-Zonen-Überwachung (Manhunt) & 81247-Grenz-Countdown (60s + 60s bis Live-Standort-Freigabe)
  useEffect(() => {
    const isManhunt = (publicState?.gameMode ?? 'CLASSIC') === 'MANHUNT';
    const isRoundActive = Boolean(
      publicState &&
        (publicState.status === 'RUNNING' || publicState.status === 'PAUSED')
    );

    const insidePlayPoly =
      publicState && currentFix
        ? isPointInPlayArea(currentFix, publicState.playArea.polygon)
        : true;
    const outsidePolyMeters =
      !insidePlayPoly && publicState && currentFix
        ? Math.max(
            1,
            distanceMeters(
              snapPointIntoPlayArea(currentFix, publicState.playArea.polygon),
              currentFix
            )
          )
        : 0;

    // 60s-Countdown für JEDEN Spieler beim Verlassen von 81247 während einer laufenden/pausierten Runde
    const outside81247Key = publicState?.sessionId
      ? `sardinen_outside_81247_${publicState.sessionId}`
      : null;

    if (isRoundActive && currentFix && !insidePlayPoly) {
      if (
        outsidePlayAreaStartedAtMsRef.current === null &&
        outside81247Key &&
        typeof window !== 'undefined'
      ) {
        try {
          const savedRaw = window.sessionStorage.getItem(outside81247Key);
          if (savedRaw) {
            const parsed = Number(savedRaw);
            if (Number.isFinite(parsed) && parsed > 0) {
              outsidePlayAreaStartedAtMsRef.current = parsed;
            }
          }
        } catch {
          // Ignorieren
        }
      }
      if (outsidePlayAreaStartedAtMsRef.current === null) {
        outsidePlayAreaStartedAtMsRef.current = adapter.getServerNow();
        if (outside81247Key && typeof window !== 'undefined') {
          try {
            window.sessionStorage.setItem(
              outside81247Key,
              String(outsidePlayAreaStartedAtMsRef.current)
            );
          } catch {
            // Ignorieren
          }
        }
      }
    } else {
      outsidePlayAreaStartedAtMsRef.current = null;
      if (outside81247Key && typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem(outside81247Key);
        } catch {
          // Ignorieren
        }
      }
    }

    const computeOutside81247SecondsLeft = (nowMs: number): number | null => {
      const start = outsidePlayAreaStartedAtMsRef.current;
      if (start === null) return null;
      const rem = Math.max(0, LEASH_RETURN_COUNTDOWN_MS - (nowMs - start));
      return Math.ceil(rem / 1000);
    };

    const isActiveHider = Boolean(
      ownMember?.enabled &&
        ownMember.side === 'HIDER' &&
        publicState?.status === 'RUNNING' &&
        publicState.currentPhase !== 'LOBBY' &&
        currentFix
    );

    if (!isActiveHider || !publicState || !currentFix) {
      consecutiveViolationsRef.current = 0;
      violationStartedAtMsRef.current = null;
      const updateNonHiderCountdown = () => {
        const nowMs = adapter.getServerNow();
        setLeashState({
          distanceFromAnchorMeters:
            !isManhunt && anchorPoint && currentFix
              ? Math.round(distanceMeters(anchorPoint, currentFix))
              : null,
          consecutiveOutsideCount: 0,
          warningActive: false,
          countdownSecondsLeft: null,
          publicAlertTriggered: Boolean(publicState?.leashAlertActive),
          liveRevealSecondsLeft: null,
          liveLocationExposed: false,
          outsidePlayAreaSecondsLeft: computeOutside81247SecondsLeft(nowMs),
          violationReason: null,
        });
      };
      updateNonHiderCountdown();
      if (outsidePlayAreaStartedAtMsRef.current !== null) {
        const timer = setInterval(updateNonHiderCountdown, 1000);
        return () => clearInterval(timer);
      }
      return;
    }

    const storageKey = isManhunt
      ? `sardinen_manhunt_zone_${publicState.sessionId}`
      : `sardinen_leash_${anchorPoint?.lockedAt ?? publicState.sessionId}`;

    if (
      storageKey &&
      violationStartedAtMsRef.current === null &&
      typeof window !== 'undefined'
    ) {
      try {
        const raw = window.sessionStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            startedAt?: number;
            violations?: number;
          };
          if (
            typeof parsed.startedAt === 'number' &&
            Number.isFinite(parsed.startedAt)
          ) {
            violationStartedAtMsRef.current = parsed.startedAt;
            consecutiveViolationsRef.current = Math.max(
              LEASH_CONSECUTIVE_VIOLATIONS,
              parsed.violations ?? LEASH_CONSECUTIVE_VIOLATIONS
            );
          }
        }
      } catch {
        // Ignoriere Speicherfehler
      }
    }

    let isOutsideAllowedArea = false;
    let deviationMeters = 0;
    let isClearlyOutside = false;
    let violationReason: LeashMonitorState['violationReason'] = null;

    if (isManhunt) {
      const activeCircle = publicState.radarCircle;
      const outsideRadarMeters = activeCircle
        ? Math.max(
            0,
            distanceMeters(activeCircle.center, currentFix) -
              activeCircle.radiusMeters
          )
        : 0;
      const outsideMeters = Math.max(outsideRadarMeters, outsidePolyMeters);
      isOutsideAllowedArea = outsideMeters > 0;
      deviationMeters = outsideMeters > 0 ? Math.max(1, Math.round(outsideMeters)) : 0;
      isClearlyOutside = outsideMeters > currentFix.accuracy;
      if (isOutsideAllowedArea) {
        violationReason =
          outsidePolyMeters > 0 ? 'OUTSIDE_81247' : 'OUTSIDE_MANHUNT_ZONE';
      }
    } else {
      const canEnforceClassicAnchorLeash = Boolean(
        publicState.currentPhase !== 'HIDING' && anchorPoint
      );
      const distFromAnchor =
        canEnforceClassicAnchorLeash && anchorPoint
          ? distanceMeters(anchorPoint, currentFix)
          : 0;
      const outsideLeashMeters =
        canEnforceClassicAnchorLeash && distFromAnchor > LEASH_RADIUS_METERS
          ? distFromAnchor - LEASH_RADIUS_METERS
          : 0;

      if (outsidePolyMeters > 0) {
        isOutsideAllowedArea = true;
        deviationMeters = Math.max(
          Math.round(outsidePolyMeters),
          anchorPoint ? Math.round(distFromAnchor) : 1
        );
        isClearlyOutside = outsidePolyMeters > currentFix.accuracy;
        violationReason = 'OUTSIDE_81247';
      } else if (outsideLeashMeters > 0) {
        isOutsideAllowedArea = true;
        deviationMeters = Math.round(distFromAnchor);
        isClearlyOutside =
          distFromAnchor - currentFix.accuracy > LEASH_RADIUS_METERS;
        violationReason = 'OUTSIDE_CLASSIC_LEASH';
      } else {
        isOutsideAllowedArea = false;
        deviationMeters = anchorPoint ? Math.round(distFromAnchor) : 0;
      }
    }

    const isAccurateFix = currentFix.accuracy <= LEASH_REQUIRED_ACCURACY_METERS;

    if (isOutsideAllowedArea && (isAccurateFix || isClearlyOutside)) {
      consecutiveViolationsRef.current += 1;
      if (
        (consecutiveViolationsRef.current >= LEASH_CONSECUTIVE_VIOLATIONS ||
          isClearlyOutside ||
          gpsStatus === 'MANUAL_TEST' ||
          !insidePlayPoly ||
          Boolean(publicState.leashAlertActive)) &&
        violationStartedAtMsRef.current === null
      ) {
        violationStartedAtMsRef.current = publicState.leashAlertActive
          ? adapter.getServerNow() - LEASH_RETURN_COUNTDOWN_MS
          : adapter.getServerNow();
      }
      if (
        storageKey &&
        violationStartedAtMsRef.current !== null &&
        typeof window !== 'undefined'
      ) {
        try {
          window.sessionStorage.setItem(
            storageKey,
            JSON.stringify({
              startedAt: violationStartedAtMsRef.current,
              violations: consecutiveViolationsRef.current,
            })
          );
        } catch {
          // Ignoriere Speicherfehler
        }
      }
    } else if (!isOutsideAllowedArea) {
      consecutiveViolationsRef.current = 0;
      violationStartedAtMsRef.current = null;
      lastAlertSyncKeyRef.current = '';
      if (storageKey && typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem(storageKey);
        } catch {
          // Ignoriere Speicherfehler
        }
      }
      if (publicState.leashAlertActive) {
        void adapter.patchControllerPublicTransition({
          leashAlertActive: false,
        });
      }
      if (hadPublishedLeashAlertRef.current && ownMember?.uid) {
        hadPublishedLeashAlertRef.current = false;
        void adapter.clearLeashViolationAlert(ownMember.uid);
      }
    }

    const updateHiderViolationCountdown = () => {
      const nowMs = adapter.getServerNow();
      const outside81247Sec = computeOutside81247SecondsLeft(nowMs);
      const startedAt = violationStartedAtMsRef.current;

      if (startedAt === null) {
        setLeashState({
          distanceFromAnchorMeters: deviationMeters,
          consecutiveOutsideCount: consecutiveViolationsRef.current,
          warningActive: false,
          countdownSecondsLeft: null,
          publicAlertTriggered: Boolean(publicState.leashAlertActive),
          liveRevealSecondsLeft: null,
          liveLocationExposed: false,
          outsidePlayAreaSecondsLeft: outside81247Sec,
          violationReason: null,
        });
        return;
      }

      const elapsedViolationMs = nowMs - startedAt;
      const remainingMs = Math.max(
        0,
        LEASH_RETURN_COUNTDOWN_MS - elapsedViolationMs
      );
      const secondsLeft = Math.ceil(remainingMs / 1000);

      const alertStartedAt = startedAt + LEASH_RETURN_COUNTDOWN_MS;
      const exposeAt = alertStartedAt + LEASH_RETURN_COUNTDOWN_MS;
      const isPublicAlertPhase =
        remainingMs <= 0 || Boolean(publicState.leashAlertActive);
      const remainingUntilExposeMs = Math.max(0, exposeAt - nowMs);
      const liveRevealSecondsLeft = isPublicAlertPhase
        ? Math.ceil(remainingUntilExposeMs / 1000)
        : null;
      const liveLocationExposed =
        isPublicAlertPhase && remainingUntilExposeMs <= 0;

      if (remainingMs <= 0 && !publicState.leashAlertActive) {
        void adapter.patchControllerPublicTransition({
          leashAlertActive: true,
        });
      }

      if (isPublicAlertPhase && ownMember?.uid) {
        const roundedLat = Math.round(currentFix.lat * 100000) / 100000;
        const roundedLng = Math.round(currentFix.lng * 100000) / 100000;
        const syncKey = liveLocationExposed
          ? `EXPOSED:${alertStartedAt}:${roundedLat}:${roundedLng}`
          : `COUNTDOWN:${alertStartedAt}:${violationReason ?? ''}`;
        if (lastAlertSyncKeyRef.current !== syncKey) {
          lastAlertSyncKeyRef.current = syncKey;
          hadPublishedLeashAlertRef.current = true;
          void adapter.setLeashViolationAlert({
            uid: ownMember.uid,
            sessionId: publicState.sessionId,
            alertStartedAt,
            exposeAt,
            violationReason: violationReason ?? undefined,
            exposedLat: liveLocationExposed ? currentFix.lat : undefined,
            exposedLng: liveLocationExposed ? currentFix.lng : undefined,
            exposedAccuracy: liveLocationExposed
              ? currentFix.accuracy
              : undefined,
            nowMs,
          });
        }
      }

      setLeashState({
        distanceFromAnchorMeters: Math.max(1, deviationMeters),
        consecutiveOutsideCount: consecutiveViolationsRef.current,
        warningActive: true,
        countdownSecondsLeft: secondsLeft,
        publicAlertTriggered: isPublicAlertPhase,
        liveRevealSecondsLeft,
        liveLocationExposed,
        outsidePlayAreaSecondsLeft: outside81247Sec,
        violationReason,
      });
    };

    updateHiderViolationCountdown();
    const interval = setInterval(updateHiderViolationCountdown, 1000);
    return () => clearInterval(interval);
  }, [
    adapter,
    ownMember?.uid,
    ownMember?.enabled,
    ownMember?.side,
    publicState,
    gpsStatus,
    anchorPoint,
    currentFix,
  ]);

  return {
    currentFix,
    gpsStatus,
    gpsError,
    leashState,
    setManualTestLocation,
    retryGpsPermission,
  };
}
