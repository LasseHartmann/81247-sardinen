import { useEffect, useState } from 'react';
import {
  DEFAULT_RADAR_SCHEDULE,
  MANHUNT_RADAR_RADII,
} from '../config/gameConfig';
import { getPhaseForElapsedMs } from '../geo/radar';
import type { DatabaseAdapter } from '../services/databaseAdapter';
import type { GamePhase, PublicGameState } from '../types/game';
import { computeNetElapsedMs, formatDurationClock } from '../utils/formatting';

export interface GameTimerSnapshot {
  serverNowMs: number;
  netElapsedMs: number;
  computedPhase: GamePhase;
  hidingRemainingMs: number;
  nextStageRemainingMs: number | null;
  nextStageLabel: string;
}

/**
 * Synchronisiert die Netto-Spielzeit anhand des Server-Zeitoffsets (`serverNow`),
 * niemals über unkorrigierte lokale Zähler, und aktualisiert sofort bei `visibilitychange`.
 */
export function useGameTimer(
  adapter: DatabaseAdapter,
  publicState: PublicGameState | null
): GameTimerSnapshot {
  const [serverNowMs, setServerNowMs] = useState(() => adapter.getServerNow());

  useEffect(() => {
    const updateNow = () => {
      const next = adapter.getServerNow();
      setServerNowMs((prev) =>
        Math.floor(prev / 1000) === Math.floor(next / 1000) ? prev : next
      );
    };
    setServerNowMs(adapter.getServerNow());

    const interval = setInterval(updateNow, 500);
    const unsubOffset = adapter.subscribeServerTimeOffset(() => {
      updateNow();
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        updateNow();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      unsubOffset();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [adapter]);

  if (!publicState || publicState.status === 'LOBBY') {
    return {
      serverNowMs,
      netElapsedMs: 0,
      computedPhase: 'LOBBY',
      hidingRemainingMs:
        publicState?.radarSchedule.hidingDurationMs ??
        DEFAULT_RADAR_SCHEDULE.hidingDurationMs,
      nextStageRemainingMs: null,
      nextStageLabel: 'Wartet auf Rundenstart',
    };
  }

  const netElapsedMs = computeNetElapsedMs(publicState, serverNowMs);
  const sched = publicState.radarSchedule;
  const rawPhase = getPhaseForElapsedMs(netElapsedMs, sched);
  const computedPhase =
    rawPhase === 'HIDING' &&
    publicState.searchStartTimestamp !== null &&
    publicState.currentPhase !== 'HIDING'
      ? publicState.currentPhase
      : rawPhase;
  const hidingRemainingMs =
    computedPhase === 'HIDING'
      ? Math.max(0, sched.hidingDurationMs - netElapsedMs)
      : 0;

  const isManhunt = (publicState.gameMode ?? 'CLASSIC') === 'MANHUNT';
  let nextStageRemainingMs: number | null = null;
  let nextStageLabel = isManhunt
    ? `Kleinste Zone (${MANHUNT_RADAR_RADII[5]} m) aktiv`
    : 'Finales 25m-Radar aktiv';

  if (computedPhase === 'HIDING' && netElapsedMs < sched.hidingDurationMs) {
    nextStageRemainingMs = sched.hidingDurationMs - netElapsedMs;
    nextStageLabel = isManhunt
      ? `Jagdstart bei ${formatDurationClock(sched.hidingDurationMs)}`
      : `Suchstart bei ${formatDurationClock(sched.hidingDurationMs)}`;
  } else if (netElapsedMs < sched.stage1Ms) {
    nextStageRemainingMs = sched.stage1Ms - netElapsedMs;
    nextStageLabel = isManhunt
      ? `Zone ${MANHUNT_RADAR_RADII[1]} m bei ${formatDurationClock(sched.stage1Ms)}`
      : `Erster Radar-Kreis (800 m) bei ${formatDurationClock(sched.stage1Ms)}`;
  } else if (netElapsedMs < sched.stage2Ms) {
    nextStageRemainingMs = sched.stage2Ms - netElapsedMs;
    nextStageLabel = isManhunt
      ? `Zone ${MANHUNT_RADAR_RADII[2]} m bei ${formatDurationClock(sched.stage2Ms)}`
      : `Radar 400 m bei ${formatDurationClock(sched.stage2Ms)}`;
  } else if (netElapsedMs < sched.stage3Ms) {
    nextStageRemainingMs = sched.stage3Ms - netElapsedMs;
    nextStageLabel = isManhunt
      ? `Zone ${MANHUNT_RADAR_RADII[3]} m bei ${formatDurationClock(sched.stage3Ms)}`
      : `Radar 200 m bei ${formatDurationClock(sched.stage3Ms)}`;
  } else if (netElapsedMs < sched.stage4Ms) {
    nextStageRemainingMs = sched.stage4Ms - netElapsedMs;
    nextStageLabel = isManhunt
      ? `Zone ${MANHUNT_RADAR_RADII[4]} m bei ${formatDurationClock(sched.stage4Ms)}`
      : `Radar 100 m bei ${formatDurationClock(sched.stage4Ms)}`;
  } else if (netElapsedMs < sched.stage5Ms) {
    nextStageRemainingMs = sched.stage5Ms - netElapsedMs;
    nextStageLabel = isManhunt
      ? `Finale Zone ${MANHUNT_RADAR_RADII[5]} m bei ${formatDurationClock(sched.stage5Ms)}`
      : `Endspiel-Radar 25 m bei ${formatDurationClock(sched.stage5Ms)}`;
  }

  return {
    serverNowMs,
    netElapsedMs,
    computedPhase,
    hidingRemainingMs,
    nextStageRemainingMs,
    nextStageLabel,
  };
}
