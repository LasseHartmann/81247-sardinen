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
  setManualTestLocation: (pt: LatLng) => void;
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

  // 50-Meter-Leash State
  const consecutiveViolationsRef = useRef(0);
  const violationStartedAtMsRef = useRef<number | null>(null);
  const [leashState, setLeashState] = useState<LeashMonitorState>({
    distanceFromAnchorMeters: null,
    consecutiveOutsideCount: 0,
    warningActive: false,
    countdownSecondsLeft: null,
    publicAlertTriggered: false,
  });

  const broadcasterRef = useRef(new SeekerBeaconBroadcaster());
  const hiderBroadcasterRef = useRef(new HiderPrivateBroadcaster());

  const canUseManualClicks = Boolean(
    adapter.mode === 'demo' || publicState?.allowTestClicks
  );

  // Wenn Manual-Testmodus vom Host deaktiviert wird, lösche lokale Testposition
  useEffect(() => {
    if (!canUseManualClicks && manualFix !== null) {
      setManualFix(null);
    }
  }, [canUseManualClicks, manualFix]);

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

  // Effektive Position bestimmen (Manueller Testklick > Hardware-GPS > gespeicherter Team-Standort im Demo-Modus)
  const currentFix: GeoFix | null =
    (canUseManualClicks && manualFix) ||
    hardwareFix ||
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
    (pt: LatLng) => {
      if (!canUseManualClicks) return;
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
    [adapter, canUseManualClicks]
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
      gameMode: publicState?.gameMode ?? 'CLASSIC',
      gameActive: isRoundRunningOrPaused,
      fix: currentFix,
    });
  }, [adapter, ownMember, ownTeam, publicState, currentFix]);

  // Lokale 50-Meter-Versteck-Leash (Klassisch) bzw. Aktive-Zonen-Überwachung mit 60s-Frist (Manhunt)
  useEffect(() => {
    const isManhunt = (publicState?.gameMode ?? 'CLASSIC') === 'MANHUNT';

    if (isManhunt) {
      const isActiveManhuntHider = Boolean(
        ownMember?.enabled &&
          ownMember.side === 'HIDER' &&
          publicState?.status === 'RUNNING' &&
          publicState.currentPhase !== 'LOBBY' &&
          currentFix
      );

      const zoneKey = publicState?.sessionId
        ? `sardinen_manhunt_zone_${publicState.sessionId}`
        : null;

      if (!isActiveManhuntHider || !publicState || !currentFix) {
        consecutiveViolationsRef.current = 0;
        violationStartedAtMsRef.current = null;
        setLeashState({
          distanceFromAnchorMeters: null,
          consecutiveOutsideCount: 0,
          warningActive: false,
          countdownSecondsLeft: null,
          publicAlertTriggered: Boolean(publicState?.leashAlertActive),
        });
        return;
      }

      if (
        zoneKey &&
        violationStartedAtMsRef.current === null &&
        typeof window !== 'undefined'
      ) {
        try {
          const raw = window.sessionStorage.getItem(zoneKey);
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

      const activeCircle = publicState.radarCircle;
      const outsideRadarMeters = activeCircle
        ? Math.max(
            0,
            distanceMeters(activeCircle.center, currentFix) -
              activeCircle.radiusMeters
          )
        : 0;
      const insidePlayPoly = isPointInPlayArea(
        currentFix,
        publicState.playArea.polygon
      );
      const outsidePolyMeters = insidePlayPoly
        ? 0
        : Math.max(
            1,
            distanceMeters(
              snapPointIntoPlayArea(currentFix, publicState.playArea.polygon),
              currentFix
            )
          );
      const outsideMeters = Math.max(outsideRadarMeters, outsidePolyMeters);
      const isOutsideActiveZone = outsideMeters > 0;
      const isAccurateFix =
        currentFix.accuracy <= LEASH_REQUIRED_ACCURACY_METERS;
      const isClearlyOutside = outsideMeters > currentFix.accuracy;

      if (isOutsideActiveZone && (isAccurateFix || isClearlyOutside)) {
        consecutiveViolationsRef.current += 1;
        if (
          (consecutiveViolationsRef.current >= LEASH_CONSECUTIVE_VIOLATIONS ||
            isClearlyOutside ||
            gpsStatus === 'MANUAL_TEST' ||
            Boolean(publicState.leashAlertActive)) &&
          violationStartedAtMsRef.current === null
        ) {
          violationStartedAtMsRef.current = publicState.leashAlertActive
            ? adapter.getServerNow() - LEASH_RETURN_COUNTDOWN_MS
            : adapter.getServerNow();
        }
        if (
          zoneKey &&
          violationStartedAtMsRef.current !== null &&
          typeof window !== 'undefined'
        ) {
          try {
            window.sessionStorage.setItem(
              zoneKey,
              JSON.stringify({
                startedAt: violationStartedAtMsRef.current,
                violations: consecutiveViolationsRef.current,
              })
            );
          } catch {
            // Ignoriere Speicherfehler
          }
        }
      } else if (!isOutsideActiveZone) {
        consecutiveViolationsRef.current = 0;
        violationStartedAtMsRef.current = null;
        if (zoneKey && typeof window !== 'undefined') {
          try {
            window.sessionStorage.removeItem(zoneKey);
          } catch {
            // Ignoriere Speicherfehler
          }
        }
        if (publicState.leashAlertActive) {
          void adapter.patchControllerPublicTransition({
            leashAlertActive: false,
          });
        }
      }

      const updateZoneCountdown = () => {
        const startedAt = violationStartedAtMsRef.current;
        if (startedAt === null) {
          setLeashState({
            distanceFromAnchorMeters:
              outsideMeters > 0 ? Math.round(outsideMeters) : 0,
            consecutiveOutsideCount: consecutiveViolationsRef.current,
            warningActive: false,
            countdownSecondsLeft: null,
            publicAlertTriggered: Boolean(publicState.leashAlertActive),
          });
          return;
        }

        const elapsedViolationMs = adapter.getServerNow() - startedAt;
        const remainingMs = Math.max(
          0,
          LEASH_RETURN_COUNTDOWN_MS - elapsedViolationMs
        );
        const secondsLeft = Math.ceil(remainingMs / 1000);

        if (remainingMs <= 0 && !publicState.leashAlertActive) {
          void adapter.patchControllerPublicTransition({
            leashAlertActive: true,
          });
        }

        setLeashState({
          distanceFromAnchorMeters: Math.max(1, Math.round(outsideMeters)),
          consecutiveOutsideCount: consecutiveViolationsRef.current,
          warningActive: true,
          countdownSecondsLeft: secondsLeft,
          publicAlertTriggered:
            remainingMs <= 0 || Boolean(publicState.leashAlertActive),
        });
      };

      updateZoneCountdown();
      const interval = setInterval(updateZoneCountdown, 1000);
      return () => clearInterval(interval);
    }

    const isActiveHiderAfterLock = Boolean(
      ownMember?.enabled &&
        ownMember.side === 'HIDER' &&
        publicState?.status === 'RUNNING' &&
        publicState.currentPhase !== 'LOBBY' &&
        publicState.currentPhase !== 'HIDING' &&
        anchorPoint
    );

    const leashStorageKey = anchorPoint
      ? `sardinen_leash_${anchorPoint.lockedAt}`
      : null;

    if (!isActiveHiderAfterLock || !anchorPoint || !currentFix) {
      consecutiveViolationsRef.current = 0;
      violationStartedAtMsRef.current = null;
      setLeashState({
        distanceFromAnchorMeters:
          anchorPoint && currentFix
            ? Math.round(distanceMeters(anchorPoint, currentFix))
            : null,
        consecutiveOutsideCount: 0,
        warningActive: false,
        countdownSecondsLeft: null,
        publicAlertTriggered: Boolean(publicState?.leashAlertActive),
      });
      return;
    }

    // Nach Page-Reload gespeicherten Leash-Verstoß wiederherstellen, falls noch aktiv
    if (
      leashStorageKey &&
      violationStartedAtMsRef.current === null &&
      typeof window !== 'undefined'
    ) {
      try {
        const raw = window.sessionStorage.getItem(leashStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as {
            startedAt?: number;
            violations?: number;
          };
          if (typeof parsed.startedAt === 'number' && Number.isFinite(parsed.startedAt)) {
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

    const dist = distanceMeters(anchorPoint, currentFix);
    const isAccurateFix = currentFix.accuracy <= LEASH_REQUIRED_ACCURACY_METERS;
    const isClearlyOutsideDespiteUncertainty =
      dist - currentFix.accuracy > LEASH_RADIUS_METERS;

    // Anti-Jitter-Filter: Messungen mit accuracy <= 25 m (oder eindeutig außerhalb) zählen als Verstoß
    if (
      dist > LEASH_RADIUS_METERS &&
      (isAccurateFix || isClearlyOutsideDespiteUncertainty)
    ) {
      consecutiveViolationsRef.current += 1;
      if (
        (consecutiveViolationsRef.current >= LEASH_CONSECUTIVE_VIOLATIONS ||
          isClearlyOutsideDespiteUncertainty ||
          gpsStatus === 'MANUAL_TEST' ||
          Boolean(publicState?.leashAlertActive)) &&
        violationStartedAtMsRef.current === null
      ) {
        violationStartedAtMsRef.current = publicState?.leashAlertActive
          ? adapter.getServerNow() - LEASH_RETURN_COUNTDOWN_MS
          : adapter.getServerNow();
      }
      if (leashStorageKey && violationStartedAtMsRef.current !== null && typeof window !== 'undefined') {
        try {
          window.sessionStorage.setItem(
            leashStorageKey,
            JSON.stringify({
              startedAt: violationStartedAtMsRef.current,
              violations: consecutiveViolationsRef.current,
            })
          );
        } catch {
          // Ignoriere Speicherfehler
        }
      }
    } else if (dist <= LEASH_RADIUS_METERS) {
      // Rückkehr innerhalb des 50m-Kreises beendet Countdown lautlos
      consecutiveViolationsRef.current = 0;
      violationStartedAtMsRef.current = null;
      if (leashStorageKey && typeof window !== 'undefined') {
        try {
          window.sessionStorage.removeItem(leashStorageKey);
        } catch {
          // Ignoriere Speicherfehler
        }
      }
      if (publicState?.leashAlertActive) {
        void adapter.patchControllerPublicTransition({
          leashAlertActive: false,
        });
      }
    }

    const updateCountdown = () => {
      const startedAt = violationStartedAtMsRef.current;
      if (startedAt === null) {
        setLeashState({
          distanceFromAnchorMeters: Math.round(dist),
          consecutiveOutsideCount: consecutiveViolationsRef.current,
          warningActive: false,
          countdownSecondsLeft: null,
          publicAlertTriggered: Boolean(publicState?.leashAlertActive),
        });
        return;
      }

      const elapsedViolationMs = adapter.getServerNow() - startedAt;
      const remainingMs = Math.max(
        0,
        LEASH_RETURN_COUNTDOWN_MS - elapsedViolationMs
      );
      const secondsLeft = Math.ceil(remainingMs / 1000);

      if (remainingMs <= 0 && !publicState?.leashAlertActive) {
        void adapter.patchControllerPublicTransition({
          leashAlertActive: true,
        });
      }

      setLeashState({
        distanceFromAnchorMeters: Math.round(dist),
        consecutiveOutsideCount: consecutiveViolationsRef.current,
        warningActive: true,
        countdownSecondsLeft: secondsLeft,
        publicAlertTriggered:
          remainingMs <= 0 || Boolean(publicState?.leashAlertActive),
      });
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [
    adapter,
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
