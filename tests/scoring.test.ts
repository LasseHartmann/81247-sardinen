import { describe, expect, it } from 'vitest';
import {
  computeNetElapsedMs,
  computeOfficialTeamScore,
  sortLeaderboardEntries,
} from '../src/utils/formatting';
import type { LeaderboardEntry } from '../src/types/game';

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Offizielle Wertungsformel & Phasenreine Pausenberechnung', () => {
  it('ignoriert Pausen während HIDING (00:00–10:00) vollständig bei der Berechnung der Suchzeit', () => {
    const t0 = 1_700_000_000_000;
    const pauseDuringHidingMs = 3 * 60_000; // 3 Min. Pause in der Versteckphase
    // OPEN_SEARCH beginnt nach 10 Min. Netto + 3 Min. Pause = t0 + 13 Min.
    const searchStartTimestamp = t0 + 13 * 60_000;
    const pausedBeforeSearchMs = pauseDuringHidingMs;

    // Keine weitere Pause während OPEN_SEARCH; Team findet Verstecker 12 Min. nach Suchbeginn
    const catchTimestampMs = searchStartTimestamp + 12 * 60_000;
    const score = computeOfficialTeamScore({
      catchTimestampMs,
      searchStartTimestamp,
      totalPausedMsAtCatch: pauseDuringHidingMs,
      pausedBeforeSearchMs,
      validPenaltyMsSum: 2 * 60_000,
      refundedPenaltyMsSum: 0,
    });

    expect(score.pausedDuringSearchMs).toBe(0);
    expect(score.searchTimeMs).toBe(12 * 60_000);
    expect(score.penaltyMs).toBe(2 * 60_000);
    expect(score.totalTimeMs).toBe(14 * 60_000);
  });

  it('zieht Pausen während OPEN_SEARCH exakt ab und verrechnet Hinweis-Rückerstattungen ohne Unterlauf', () => {
    const t0 = 1_700_000_000_000;
    const pausedInHiding = 2 * 60_000;
    const pausedInSearch = 4 * 60_000;
    const searchStartTimestamp = t0 + 12 * 60_000;
    // Wanduhrzeit seit Suchstart: 20 Min., davon 4 Min. pausiert -> 16 Min. Netto-Suchzeit
    const catchTimestampMs = searchStartTimestamp + 20 * 60_000;

    const score = computeOfficialTeamScore({
      catchTimestampMs,
      searchStartTimestamp,
      totalPausedMsAtCatch: pausedInHiding + pausedInSearch,
      pausedBeforeSearchMs: pausedInHiding,
      validPenaltyMsSum: (5 + 3) * 60_000, // Kat 4 (+5m) + Kat 2 (+3m)
      refundedPenaltyMsSum: 5 * 60_000, // -5m Erstattung wegen Timeout
    });

    expect(score.pausedDuringSearchMs).toBe(4 * 60_000);
    expect(score.searchTimeMs).toBe(16 * 60_000);
    expect(score.penaltyMs).toBe(3 * 60_000);
    expect(score.totalTimeMs).toBe(19 * 60_000);

    // Unterlauf-Schutz: Strafzeit fällt niemals unter 0 ms
    const clamped = computeOfficialTeamScore({
      catchTimestampMs,
      searchStartTimestamp,
      totalPausedMsAtCatch: pausedInHiding,
      pausedBeforeSearchMs: pausedInHiding,
      validPenaltyMsSum: 2 * 60_000,
      refundedPenaltyMsSum: 5 * 60_000,
    });
    expect(clamped.penaltyMs).toBe(0);
  });

  it('Property-Test (200 Zufallsverläufe): Suchzeit ist invariant gegenüber beliebigen HIDING-Pausen', () => {
    const rng = createRng(999);
    for (let i = 0; i < 200; i++) {
      const gameStart = 1_700_000_000_000 + Math.floor(rng() * 1_000_000);
      const hidingPauseA = Math.floor(rng() * 15 * 60_000);
      const hidingPauseB = Math.floor(rng() * 45 * 60_000);
      const activeSearchDuration = Math.floor(rng() * 50 * 60_000);
      const searchPause = Math.floor(rng() * 10 * 60_000);
      const penalties = Math.floor(rng() * 20 * 60_000);

      const searchStartA = gameStart + 10 * 60_000 + hidingPauseA;
      const catchA = searchStartA + activeSearchDuration + searchPause;
      const resA = computeOfficialTeamScore({
        catchTimestampMs: catchA,
        searchStartTimestamp: searchStartA,
        totalPausedMsAtCatch: hidingPauseA + searchPause,
        pausedBeforeSearchMs: hidingPauseA,
        validPenaltyMsSum: penalties,
      });

      const searchStartB = gameStart + 10 * 60_000 + hidingPauseB;
      const catchB = searchStartB + activeSearchDuration + searchPause;
      const resB = computeOfficialTeamScore({
        catchTimestampMs: catchB,
        searchStartTimestamp: searchStartB,
        totalPausedMsAtCatch: hidingPauseB + searchPause,
        pausedBeforeSearchMs: hidingPauseB,
        validPenaltyMsSum: penalties,
      });

      expect(resA.searchTimeMs).toBe(activeSearchDuration);
      expect(resB.searchTimeMs).toBe(activeSearchDuration);
      expect(resA.totalTimeMs).toBe(resB.totalTimeMs);
    }
  });

  it('friert computeNetElapsedMs im PAUSED-Status exakt ein und sortiert die Rangliste aufsteigend', () => {
    const start = 1_000_000;
    const pausedState = {
      status: 'PAUSED' as const,
      gameStartTimestamp: start,
      pausedAt: start + 15 * 60_000,
      totalPausedMs: 2 * 60_000,
    };
    // Egal wie weit serverNow fortschreitet, die Netto-Zeit bleibt bei 13:00 eingefroren
    expect(computeNetElapsedMs(pausedState, start + 20 * 60_000)).toBe(13 * 60_000);
    expect(computeNetElapsedMs(pausedState, start + 99 * 60_000)).toBe(13 * 60_000);

    const entries: LeaderboardEntry[] = [
      {
        teamId: 'team-2',
        teamName: 'Team 2',
        color: '#a855f7',
        status: 'JOINED_SARDINES',
        searchTimeMs: 22 * 60_000,
        penaltyMs: 4 * 60_000,
        totalTimeMs: 26 * 60_000,
        clueCount: 1,
        caughtAt: 2000,
      },
      {
        teamId: 'team-1',
        teamName: 'Team 1',
        color: '#f59e0b',
        status: 'JOINED_SARDINES',
        searchTimeMs: 15 * 60_000,
        penaltyMs: 6 * 60_000,
        totalTimeMs: 21 * 60_000,
        clueCount: 2,
        caughtAt: 1500,
      },
    ];

    const sorted = sortLeaderboardEntries(entries);
    expect(sorted[0].teamId).toBe('team-1');
    expect(sorted[1].teamId).toBe('team-2');
  });
});
