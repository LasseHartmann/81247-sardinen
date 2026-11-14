import { useEffect, useState } from 'react';
import {
  DEFAULT_RADAR_SCHEDULE,
  getManhuntPingStatusAtElapsedMs,
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
  manhuntPingIntervalMinutes?: 10 | 5;
  manhuntIsInLastQuarter?: boolean;
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
  const isManhunt = (publicState.gameMode ?? 'CLASSIC') === 'MANHUNT';

  if (isManhunt) {
    const headStartMs = sched.hidingDurationMs;
    const huntDurationMs =
      publicState.manhuntShrinkDurationMs ??
      Math.max(10 * 60_000, sched.stage5Ms - headStartMs);
    const pingStatus = getManhuntPingStatusAtElapsedMs(
      netElapsedMs,
      headStartMs,
      huntDurationMs
    );

    const rawManhuntPhase: GamePhase =
      netElapsedMs < headStartMs
        ? 'HIDING'
        : pingStatus.dueStageId === null
          ? 'OPEN_SEARCH'
          : pingStatus.dueStageId === 5
            ? 'ENDGAME'
            : (`RADAR_${pingStatus.dueStageId}` as GamePhase);

    const computedPhase =
      rawManhuntPhase === 'HIDING' &&
      publicState.searchStartTimestamp !== null &&
      publicState.currentPhase !== 'HIDING'
        ? publicState.currentPhase
        : rawManhuntPhase;

    const hidingRemainingMs =
      computedPhase === 'HIDING'
        ? Math.max(0, headStartMs - netElapsedMs)
        : 0;

    if (computedPhase === 'HIDING' && netElapsedMs < headStartMs) {
      return {
        serverNowMs,
        netElapsedMs,
        computedPhase,
        hidingRemainingMs,
        nextStageRemainingMs: headStartMs - netElapsedMs,
        nextStageLabel: `Jagdstart bei ${formatDurationClock(headStartMs)}`,
        manhuntPingIntervalMinutes: pingStatus.currentIntervalMinutes,
        manhuntIsInLastQuarter: false,
      };
    }

    const nextStageRemainingMs = Math.max(
      0,
      pingStatus.nextPingElapsedMs - netElapsedMs
    );
    const nextPingNumber = pingStatus.duePingNumber + 1;
    const nextStageLabel = pingStatus.isInLastQuarter
      ? `Nächster 5-Min.-Ping (#${nextPingNumber}) bei ${formatDurationClock(pingStatus.nextPingElapsedMs)}`
      : `Nächster 10-Min.-Ping (#${nextPingNumber}) bei ${formatDurationClock(pingStatus.nextPingElapsedMs)}`;

    return {
      serverNowMs,
      netElapsedMs,
      computedPhase,
      hidingRemainingMs: 0,
      nextStageRemainingMs,
      nextStageLabel,
      manhuntPingIntervalMinutes: pingStatus.currentIntervalMinutes,
      manhuntIsInLastQuarter: pingStatus.isInLastQuarter,
    };
  }

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

  let nextStageRemainingMs: number | null = null;
  let nextStageLabel = 'Finales 25m-Radar aktiv';

  if (computedPhase === 'HIDING' && netElapsedMs < sched.hidingDurationMs) {
    nextStageRemainingMs = sched.hidingDurationMs - netElapsedMs;
    nextStageLabel = `Suchstart bei ${formatDurationClock(sched.hidingDurationMs)}`;
  } else if (netElapsedMs < sched.stage1Ms) {
    nextStageRemainingMs = sched.stage1Ms - netElapsedMs;
    nextStageLabel = `Erster Radar-Kreis (800 m) bei ${formatDurationClock(sched.stage1Ms)}`;
  } else if (netElapsedMs < sched.stage2Ms) {
    nextStageRemainingMs = sched.stage2Ms - netElapsedMs;
    nextStageLabel = `Radar 400 m bei ${formatDurationClock(sched.stage2Ms)}`;
  } else if (netElapsedMs < sched.stage3Ms) {
    nextStageRemainingMs = sched.stage3Ms - netElapsedMs;
    nextStageLabel = `Radar 200 m bei ${formatDurationClock(sched.stage3Ms)}`;
  } else if (netElapsedMs < sched.stage4Ms) {
    nextStageRemainingMs = sched.stage4Ms - netElapsedMs;
    nextStageLabel = `Radar 100 m bei ${formatDurationClock(sched.stage4Ms)}`;
  } else if (netElapsedMs < sched.stage5Ms) {
    nextStageRemainingMs = sched.stage5Ms - netElapsedMs;
    nextStageLabel = `Endspiel-Radar 25 m bei ${formatDurationClock(sched.stage5Ms)}`;
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
