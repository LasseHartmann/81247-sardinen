import type { Feature, Polygon } from 'geojson';
import defaultPlayAreaJson from './playArea.geojson';
import type {
  PublicGameState,
  QuestionType,
  RadarSchedule,
  RadarStageId,
  SafetyPoint,
  TeamPublic,
} from '../types/game';

export const GAME_ID = '81247' as const;

export const MAP_DEFAULT_CENTER: [number, number] = [48.1682, 11.465];
export const MAP_DEFAULT_ZOOM = 14;

export const OFFICIAL_81247_AREA_NAME =
  '81247 M-Obermenzing (Offizielle PLZ-Grenze)';
export const LEGACY_PLACEHOLDER_AREA_NAME =
  '81247 München (Obermenzing / Blutenburg / Pipping)';

export const DEFAULT_PLAY_AREA_FEATURE =
  defaultPlayAreaJson as unknown as Feature<Polygon>;

export function isLegacyPlaceholderPlayArea(
  playArea: PublicGameState['playArea'] | null | undefined
): boolean {
  if (!playArea || !playArea.polygon) return true;
  if (playArea.name === LEGACY_PLACEHOLDER_AREA_NAME) return true;
  const ringLen = playArea.polygon.geometry?.coordinates?.[0]?.length ?? 0;
  // Altes Platzhalter-Polygon aus der Erstinitialisierung hatte nur 9 Eckpunkte (10 Ring-Koordinaten)
  if (
    ringLen <= 12 &&
    playArea.confirmedByUid !== 'osm_official_81247' &&
    playArea.name !== OFFICIAL_81247_AREA_NAME
  ) {
    return true;
  }
  return false;
}

export const DEFAULT_SAFETY_POINT: SafetyPoint = {
  name: 'Schloss Blutenburg — Vorplatz (Seldweg)',
  description:
    'Zentraler Sammelpunkt vor dem Haupttor von Schloss Blutenburg (gut erreichbar per Fußweg & Bus 143/160).',
  lat: 48.1632,
  lng: 11.4572,
};

export const DEFAULT_RADAR_SCHEDULE: RadarSchedule = {
  hidingDurationMs: 20 * 60_000, // 20:00 Standard-Versteckzeit
  stage1Ms: 35 * 60_000, // 35:00 -> 800m
  stage2Ms: 40 * 60_000, // 40:00 -> 400m
  stage3Ms: 45 * 60_000, // 45:00 -> 200m
  stage4Ms: 50 * 60_000, // 50:00 -> 100m
  stage5Ms: 55 * 60_000, // 55:00 -> 25m
};

export const DEFAULT_MANHUNT_HIDING_MINUTES = 5;
export const DEFAULT_MANHUNT_SHRINK_MINUTES = 40;

export const MANHUNT_PING_INTERVAL_INITIAL_MS = 10 * 60_000; // Erste 3/4 der Spielzeit: alle 10 Min.
export const MANHUNT_PING_INTERVAL_LAST_QUARTER_MS = 5 * 60_000; // Letztes Viertel der Spielzeit: alle 5 Min.

export const MANHUNT_RADAR_RADII: Record<RadarStageId, number> = {
  1: 1200,
  2: 800,
  3: 500,
  4: 300,
  5: 150,
};

export interface ManhuntPingStatus {
  /** Absolute Netto-Spielzeit (ab Rundenstart) des zuletzt fälligen Pings, oder null vor dem ersten Ping */
  duePingElapsedMs: number | null;
  /** 1-basierte Nummer des aktuell fälligen Pings (0 vor dem ersten Ping) */
  duePingNumber: number;
  /** Zugehörige Zonen-Stufe (1..5) des aktuell fälligen Pings, oder null vor dem ersten Ping */
  dueStageId: RadarStageId | null;
  /** Zugehöriger Zonen-Radius (1200..150 m) des aktuell fälligen Pings, oder null vor dem ersten Ping */
  dueRadiusMeters: number | null;
  /** Absolute Netto-Spielzeit (ab Rundenstart) des nächsten bevorstehenden Pings */
  nextPingElapsedMs: number;
  /** Aktuelles Ping-Intervall in Minuten (10 in den ersten 3/4, 5 im letzten Viertel) */
  currentIntervalMinutes: 10 | 5;
  /** Ob sich die Jagd aktuell im letzten Viertel (oder in der Verlängerung) der angegebenen Spielzeit befindet */
  isInLastQuarter: boolean;
  /** Geplante Ping-Zeitpunkte (Netto-Spielzeit ab Rundenstart) innerhalb der regulären Jagddauer */
  scheduledPingElapsedMs: number[];
}

/**
 * Berechnet alle Manhunt-Ping-Zeitpunkte (in ms Netto-Spielzeit ab Rundenstart):
 * - Während des Vorsprungs (`0 .. headStartMs`) wird noch nicht gepingt.
 * - In den ersten 3/4 der angegebenen Spielzeit (`huntDurationMs`) wird alle 10 Min. gepingt.
 * - Im letzten Viertel (`>= 0.75 * huntDurationMs`, sowie in einer evtl. Verlängerung) wird alle 5 Min. gepingt.
 */
export function getManhuntPingScheduleMs(
  headStartMs: number,
  huntDurationMs: number,
  upToNetElapsedMs?: number
): number[] {
  const safeHeadStartMs = Math.max(0, Math.round(headStartMs));
  const safeHuntDurationMs = Math.max(10 * 60_000, Math.round(huntDurationMs));
  const lastQuarterStartRelMs = Math.round(safeHuntDurationMs * 0.75);

  const schedule: number[] = [];
  let relMs = 0;

  while (
    relMs < safeHuntDurationMs ||
    (upToNetElapsedMs !== undefined && safeHeadStartMs + relMs <= upToNetElapsedMs)
  ) {
    const nextFiveRelMs = relMs + MANHUNT_PING_INTERVAL_LAST_QUARTER_MS;
    const stepMs =
      nextFiveRelMs >= lastQuarterStartRelMs
        ? MANHUNT_PING_INTERVAL_LAST_QUARTER_MS
        : MANHUNT_PING_INTERVAL_INITIAL_MS;
    relMs += stepMs;
    schedule.push(safeHeadStartMs + relMs);
  }

  return schedule;
}

/**
 * Liefert für einen beliebigen Netto-Spielzeitpunkt `netElapsedMs` den aktuellen Manhunt-Ping-Status
 * (fälliger Ping, Ping-Nummer, Zonen-Stufe/Radius, nächster Ping-Zeitpunkt und Intervall).
 */
export function getManhuntPingStatusAtElapsedMs(
  netElapsedMs: number,
  headStartMs: number,
  huntDurationMs: number
): ManhuntPingStatus {
  const safeHeadStartMs = Math.max(0, Math.round(headStartMs));
  const safeHuntDurationMs = Math.max(10 * 60_000, Math.round(huntDurationMs));
  const lastQuarterStartRelMs = Math.round(safeHuntDurationMs * 0.75);

  const scheduledPingElapsedMs = getManhuntPingScheduleMs(
    safeHeadStartMs,
    safeHuntDurationMs
  );
  const extendedSchedule = getManhuntPingScheduleMs(
    safeHeadStartMs,
    safeHuntDurationMs,
    Math.max(0, netElapsedMs)
  );

  let dueIndex = -1;
  if (netElapsedMs >= safeHeadStartMs) {
    for (let i = 0; i < extendedSchedule.length; i++) {
      if (extendedSchedule[i] <= netElapsedMs) {
        dueIndex = i;
      } else {
        break;
      }
    }
  }

  const huntElapsedMs = Math.max(0, netElapsedMs - safeHeadStartMs);
  const isInLastQuarter =
    netElapsedMs >= safeHeadStartMs && huntElapsedMs >= lastQuarterStartRelMs;

  if (dueIndex < 0) {
    const nextPingElapsedMs =
      extendedSchedule[0] ?? safeHeadStartMs + MANHUNT_PING_INTERVAL_INITIAL_MS;
    const currentIntervalMinutes: 10 | 5 =
      nextPingElapsedMs - safeHeadStartMs <= MANHUNT_PING_INTERVAL_LAST_QUARTER_MS
        ? 5
        : 10;
    return {
      duePingElapsedMs: null,
      duePingNumber: 0,
      dueStageId: null,
      dueRadiusMeters: null,
      nextPingElapsedMs,
      currentIntervalMinutes,
      isInLastQuarter,
      scheduledPingElapsedMs,
    };
  }

  const duePingElapsedMs = extendedSchedule[dueIndex];
  const duePingNumber = dueIndex + 1;
  const nextPingElapsedMs =
    extendedSchedule[dueIndex + 1] ??
    duePingElapsedMs + MANHUNT_PING_INTERVAL_LAST_QUARTER_MS;

  const totalBasePings = scheduledPingElapsedMs.length;
  let dueStageId: RadarStageId;
  if (
    totalBasePings <= 1 ||
    duePingNumber >= totalBasePings ||
    duePingElapsedMs >= safeHeadStartMs + safeHuntDurationMs
  ) {
    dueStageId = 5;
  } else if (duePingNumber === 1) {
    dueStageId = 1;
  } else {
    const mapped = Math.min(
      5,
      Math.max(1, Math.round(1 + ((duePingNumber - 1) / (totalBasePings - 1)) * 4))
    );
    dueStageId = mapped as RadarStageId;
  }

  const dueRadiusMeters = MANHUNT_RADAR_RADII[dueStageId];
  const currentIntervalMinutes: 10 | 5 =
    nextPingElapsedMs - duePingElapsedMs <= MANHUNT_PING_INTERVAL_LAST_QUARTER_MS
      ? 5
      : 10;

  return {
    duePingElapsedMs,
    duePingNumber,
    dueStageId,
    dueRadiusMeters,
    nextPingElapsedMs,
    currentIntervalMinutes,
    isInLastQuarter,
    scheduledPingElapsedMs,
  };
}

export function buildRadarScheduleForHidingMinutes(
  hidingMinutes: number
): RadarSchedule {
  const clampedMin = Math.max(1, Math.round(hidingMinutes));
  const hidingDurationMs = clampedMin * 60_000;
  return {
    hidingDurationMs,
    stage1Ms: hidingDurationMs + 15 * 60_000,
    stage2Ms: hidingDurationMs + 20 * 60_000,
    stage3Ms: hidingDurationMs + 25 * 60_000,
    stage4Ms: hidingDurationMs + 30 * 60_000,
    stage5Ms: hidingDurationMs + 35 * 60_000,
  };
}

/**
 * Erzeugt den Manhunt-Schrumpf- & Ping-Plan:
 * Nach `headStartMinutes` (0..30 Min.) startet die Jagd auf dem vollen 81247-Gebiet.
 * In den ersten 3/4 von `totalShrinkMinutes` (10..80 Min.) werden die Verstecker alle 10 Min. gepingt,
 * im letzten Viertel alle 5 Min., wobei die Zone um die Verstecker bis auf 150 m schrumpft.
 */
export function buildManhuntRadarSchedule(
  headStartMinutes: number,
  totalShrinkMinutes = DEFAULT_MANHUNT_SHRINK_MINUTES
): RadarSchedule {
  const clampedHeadStart = Math.min(30, Math.max(0, Math.round(headStartMinutes)));
  const clampedShrinkMin = Math.min(80, Math.max(10, Math.round(totalShrinkMinutes)));
  const hidingDurationMs = clampedHeadStart * 60_000;
  const shrinkDurationMs = clampedShrinkMin * 60_000;
  const pings = getManhuntPingScheduleMs(hidingDurationMs, shrinkDurationMs);

  const pickStageMs = (stageIdxZeroBased: number): number => {
    if (pings.length === 0) {
      return hidingDurationMs + Math.round(((stageIdxZeroBased + 1) * shrinkDurationMs) / 5);
    }
    if (stageIdxZeroBased === 0) return pings[0];
    if (stageIdxZeroBased === 4) return pings[pings.length - 1];
    const mappedIdx = Math.min(
      pings.length - 1,
      Math.max(0, Math.round((stageIdxZeroBased / 4) * (pings.length - 1)))
    );
    return pings[mappedIdx];
  };

  return {
    hidingDurationMs,
    stage1Ms: pickStageMs(0),
    stage2Ms: pickStageMs(1),
    stage3Ms: pickStageMs(2),
    stage4Ms: pickStageMs(3),
    stage5Ms: pickStageMs(4),
  };
}

export const QUESTION_CATEGORY_MAP: Record<QuestionType, 1 | 2 | 3 | 4> = {
  SPLIT_NS: 1,
  SPLIT_EW: 1,
  THERMOMETER: 1,
  CONE_45: 1,
  OSM_TRANSIT: 2,
  OSM_RECYCLING: 2,
  OSM_GREEN: 2,
  RADIUS_RADAR: 3,
  DONUT_RING: 3,
  MEDIA_SKY: 4,
  MEDIA_GROUND: 4,
  MEDIA_SELFIE: 4,
};

export const QUESTION_PENALTY_MS: Record<1 | 2 | 3 | 4, number> = {
  1: 15 * 60_000,
  2: 3 * 60_000,
  3: 4 * 60_000,
  4: 5 * 60_000,
};

export const THERMOMETER_MIN_DISTANCE_METERS = 250;

export function getQuestionPenaltyMs(questionType: QuestionType): number {
  switch (questionType) {
    case 'SPLIT_NS':
    case 'SPLIT_EW':
      return 15 * 60_000; // Himmelsrichtung: +15 Min.
    case 'THERMOMETER':
      return 10 * 60_000; // Thermometer (250 m): +10 Min.
    case 'RADIUS_RADAR':
    case 'CONE_45':
      return 15 * 60_000; // Radar: +15 Min.
    case 'MEDIA_SKY':
    case 'MEDIA_GROUND':
    case 'MEDIA_SELFIE':
      return 5 * 60_000; // Foto: +5 Min.
    default:
      return QUESTION_PENALTY_MS[QUESTION_CATEGORY_MAP[questionType]];
  }
}

export const MEDIA_RESPONSE_TIMEOUT_NET_MS = 5 * 60_000; // 5 Min. (300s) Netto-Spielzeit zum Senden eines Fotos
export const MEDIA_REFUND_MS = 10 * 60_000; // -10 Min. Zeitabzug bei Nicht-Senden innerhalb von 5 Min. (oder Ablehnung)
export const MEDIA_AUTO_EXPIRE_MS = 10 * 60_000; // Empfangene Fotos verschwinden automatisch nach 10 Min.
export const MEDIA_POST_DOWNLOAD_EXPIRE_MS = 60_000; // Nach Klick auf Download verkürzt sich die Restzeit auf max. 1 Min.

export const LEASH_RADIUS_METERS = 50;
export const LEASH_REQUIRED_ACCURACY_METERS = 25;
export const LEASH_CONSECUTIVE_VIOLATIONS = 3;
export const LEASH_RETURN_COUNTDOWN_MS = 60_000;

export const ANCHOR_ACCURACY_WARNING_METERS = 35;
export const ANCHOR_MANUAL_ADJUST_MAX_METERS = 50;

export const LOCATION_THROTTLE_INTERVAL_MS = 6_000;
export const LOCATION_MIN_DISTANCE_METERS = 25;

export const CONTROLLER_HEARTBEAT_INTERVAL_MS = 5_000;
export const CONTROLLER_LEASE_TTL_MS = 15_000;

export const TEAM_PALETTE = [
  { id: 'team-1', name: 'Team 1 (Bernstein)', color: '#f59e0b' },
  { id: 'team-2', name: 'Team 2 (Violett)', color: '#a855f7' },
  { id: 'team-3', name: 'Team 3 (Kobalt)', color: '#3b82f6' },
  { id: 'team-4', name: 'Team 4 (Magenta)', color: '#ec4899' },
  { id: 'team-5', name: 'Team 5 (Smaragd)', color: '#10b981' },
  { id: 'team-6', name: 'Team 6 (Koralle)', color: '#f97316' },
] as const;

export const PLAYER_SEAT_HEARTBEAT_MS = 10_000;
export const PLAYER_SEAT_TTL_MS = 28_000;
export const TEAM_MEMBER_FIX_MAX_AGE_MS = 5 * 60_000;

export function createDefaultTeams(): Record<string, TeamPublic> {
  const result: Record<string, TeamPublic> = {};
  for (const t of TEAM_PALETTE) {
    result[t.id] = {
      id: t.id,
      name: t.name,
      color: t.color,
      memberPlayerIds: [],
      beaconPlayerId: null,
      status: 'ACTIVE',
      penaltyMs: 0,
      catchTimestampMs: null,
      clueCount: 0,
    };
  }
  return result;
}

export function createDefaultPublicState(
  sessionId: string,
  existingConfirmedPlayArea?: PublicGameState['playArea']
): PublicGameState {
  return {
    status: 'LOBBY',
    currentPhase: 'LOBBY',
    gameMode: 'CLASSIC',
    manhuntShrinkDurationMs: DEFAULT_MANHUNT_SHRINK_MINUTES * 60_000,
    gameStartTimestamp: null,
    searchStartTimestamp: null,
    pausedAt: null,
    totalPausedMs: 0,
    pausedBeforeSearchMs: 0,
    sessionId,
    anchorLocked: false,
    radarCircle: null,
    radarSchedule: { ...DEFAULT_RADAR_SCHEDULE },
    playArea:
      existingConfirmedPlayArea && !isLegacyPlaceholderPlayArea(existingConfirmedPlayArea)
        ? existingConfirmedPlayArea
        : {
            polygon: structuredClone(DEFAULT_PLAY_AREA_FEATURE),
            confirmed: true,
            confirmedAt: Date.now(),
            confirmedByUid: 'osm_official_81247',
            name: OFFICIAL_81247_AREA_NAME,
          },
    safetyPoint: { ...DEFAULT_SAFETY_POINT },
    emergencyStopReason: null,
    allowTestClicks: false,
    leashAlertActive: false,
    activeTeamIds: TEAM_PALETTE.map((t) => t.id),
  };
}
