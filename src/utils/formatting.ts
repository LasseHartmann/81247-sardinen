import type {
  GamePhase,
  LeaderboardEntry,
  PublicGameState,
  QuestionType,
} from '../types/game';

/**
 * Berechnet die gesamte verstrichene Netto-Spielzeit in Millisekunden (Sektion 6).
 */
export function computeNetElapsedMs(
  state: Pick<
    PublicGameState,
    'status' | 'gameStartTimestamp' | 'pausedAt' | 'totalPausedMs'
  >,
  serverNowMs: number
): number {
  if (state.status === 'LOBBY' || state.gameStartTimestamp === null) {
    return 0;
  }
  if (state.pausedAt !== null || state.status === 'PAUSED') {
    const refTime = state.pausedAt ?? serverNowMs;
    return Math.max(0, refTime - state.gameStartTimestamp - state.totalPausedMs);
  }
  return Math.max(
    0,
    serverNowMs - state.gameStartTimestamp - state.totalPausedMs
  );
}

export interface ScoreCalculationInput {
  catchTimestampMs: number;
  searchStartTimestamp: number;
  totalPausedMsAtCatch: number;
  pausedBeforeSearchMs: number;
  validPenaltyMsSum: number;
  refundedPenaltyMsSum?: number;
}

export interface ScoreCalculationResult {
  pausedDuringSearchMs: number;
  searchTimeMs: number;
  penaltyMs: number;
  totalTimeMs: number;
}

/**
 * Offizielle Wertungsformel mit phasenreiner Pausenberechnung (Sektion 1):
 * Pausen während HIDING (00:00–10:00) sind in `pausedBeforeSearchMs` eingefroren
 * und verfälschen niemals die spätere Suchzeit eines Teams!
 */
export function computeOfficialTeamScore(
  input: ScoreCalculationInput
): ScoreCalculationResult {
  const pausedDuringSearchMs = Math.max(
    0,
    input.totalPausedMsAtCatch - input.pausedBeforeSearchMs
  );
  const searchTimeMs = Math.max(
    0,
    input.catchTimestampMs - input.searchStartTimestamp - pausedDuringSearchMs
  );
  const refunded = input.refundedPenaltyMsSum ?? 0;
  const penaltyMs = input.validPenaltyMsSum - refunded;
  const totalTimeMs = Math.max(0, searchTimeMs + penaltyMs);

  return {
    pausedDuringSearchMs,
    searchTimeMs,
    penaltyMs,
    totalTimeMs,
  };
}

/**
 * Sortiert Ranglisten-Einträge aufsteigend nach `totalTimeMs` (niedrigste Gesamtzeit = Rang 1).
 */
export function sortLeaderboardEntries(
  entries: LeaderboardEntry[]
): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (a.totalTimeMs !== b.totalTimeMs) {
      return a.totalTimeMs - b.totalTimeMs;
    }
    if (a.searchTimeMs !== b.searchTimeMs) {
      return a.searchTimeMs - b.searchTimeMs;
    }
    if (a.caughtAt !== b.caughtAt) {
      return a.caughtAt - b.caughtAt;
    }
    return a.teamName.localeCompare(b.teamName, 'de');
  });
}

/**
 * Formatiert Millisekunden als MM:SS (oder HH:MM:SS ab 60 Minuten).
 */
export function formatDurationClock(ms: number): string {
  const safeSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

/**
 * Formatiert Strafzeit bzw. Zeitgutschrift kompakt in Minuten (z. B. "+4 Min.", "-5 Min." oder "0 Min.").
 */
export function formatPenaltyMinutes(penaltyMs: number): string {
  const mins = Math.round(penaltyMs / 60_000);
  if (mins === 0) return '0 Min.';
  if (mins < 0) return `${mins} Min.`;
  return `+${mins} Min.`;
}

export function getPhaseLabelDe(phase: GamePhase): string {
  switch (phase) {
    case 'LOBBY':
      return 'Lobby';
    case 'HIDING':
      return 'Versteckphase';
    case 'OPEN_SEARCH':
      return 'Offene Suche';
    case 'RADAR_1':
      return 'Radar Stufe 1 (800 m)';
    case 'RADAR_2':
      return 'Radar Stufe 2 (400 m)';
    case 'RADAR_3':
      return 'Radar Stufe 3 (200 m)';
    case 'RADAR_4':
      return 'Radar Stufe 4 (100 m)';
    case 'ENDGAME':
      return 'Endspiel (25 m)';
  }
}

export function getQuestionLabelDe(type: QuestionType): string {
  switch (type) {
    case 'SPLIT_NS':
      return 'Nord/Süd-Teilung';
    case 'SPLIT_EW':
      return 'Ost/West-Teilung';
    case 'THERMOMETER':
      return 'Thermometer (250 m)';
    case 'CONE_45':
      return '45°-Radarkegel';
    case 'OSM_TRANSIT':
      return 'ÖPNV im Umkreis (150 m)';
    case 'OSM_GREEN':
      return 'Grünflächen-Check';
    case 'RADIUS_RADAR':
      return 'Radius-Radar';
    case 'DONUT_RING':
      return 'Donut-Ring-Scanner';
    case 'MEDIA_SKY':
      return 'Foto: Himmel / Blätterdach';
    case 'MEDIA_GROUND':
      return 'Foto: Bodenstruktur';
    case 'MEDIA_SELFIE':
      return 'Foto: Gruppen-Selfie (alle Köpfe)';
  }
}
