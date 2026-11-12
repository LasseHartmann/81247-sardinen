import { useEffect, useState } from 'react';
import { getPhaseForElapsedMs } from '../geo/radar';
import type { DatabaseAdapter } from '../services/databaseAdapter';
import type { GamePhase, PublicGameState } from '../types/game';
import { computeNetElapsedMs } from '../utils/formatting';

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
    const updateNow = () => setServerNowMs(adapter.getServerNow());
    updateNow();

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
      hidingRemainingMs: publicState?.radarSchedule.hidingDurationMs ?? 600_000,
      nextStageRemainingMs: null,
      nextStageLabel: 'Wartet auf Rundenstart',
    };
  }

  const netElapsedMs = computeNetElapsedMs(publicState, serverNowMs);
  const sched = publicState.radarSchedule;
  const computedPhase = getPhaseForElapsedMs(netElapsedMs, sched);
  const hidingRemainingMs = Math.max(0, sched.hidingDurationMs - netElapsedMs);

  let nextStageRemainingMs: number | null = null;
  let nextStageLabel = 'Finales 25m-Radar aktiv';

  if (netElapsedMs < sched.hidingDurationMs) {
    nextStageRemainingMs = sched.hidingDurationMs - netElapsedMs;
    nextStageLabel = 'Suchstart bei 10:00';
  } else if (netElapsedMs < sched.stage1Ms) {
    nextStageRemainingMs = sched.stage1Ms - netElapsedMs;
    nextStageLabel = 'Erster Radar-Kreis (800 m) bei 25:00';
  } else if (netElapsedMs < sched.stage2Ms) {
    nextStageRemainingMs = sched.stage2Ms - netElapsedMs;
    nextStageLabel = 'Radar 400 m bei 30:00';
  } else if (netElapsedMs < sched.stage3Ms) {
    nextStageRemainingMs = sched.stage3Ms - netElapsedMs;
    nextStageLabel = 'Radar 200 m bei 35:00';
  } else if (netElapsedMs < sched.stage4Ms) {
    nextStageRemainingMs = sched.stage4Ms - netElapsedMs;
    nextStageLabel = 'Radar 100 m bei 40:00';
  } else if (netElapsedMs < sched.stage5Ms) {
    nextStageRemainingMs = sched.stage5Ms - netElapsedMs;
    nextStageLabel = 'Endspiel-Radar 25 m bei 45:00';
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
