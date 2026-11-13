import type { Feature, Polygon } from 'geojson';
import defaultPlayAreaJson from './playArea.geojson';
import type {
  PublicGameState,
  QuestionType,
  RadarSchedule,
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

export const QUESTION_CATEGORY_MAP: Record<QuestionType, 1 | 2 | 3 | 4> = {
  SPLIT_NS: 1,
  SPLIT_EW: 1,
  THERMOMETER: 1,
  CONE_45: 1,
  OSM_TRANSIT: 2,
  OSM_GREEN: 2,
  RADIUS_RADAR: 3,
  DONUT_RING: 3,
  MEDIA_SKY: 4,
  MEDIA_GROUND: 4,
  MEDIA_SELFIE: 4,
};

export const QUESTION_PENALTY_MS: Record<1 | 2 | 3 | 4, number> = {
  1: 2 * 60_000,
  2: 3 * 60_000,
  3: 4 * 60_000,
  4: 5 * 60_000,
};

export function getQuestionPenaltyMs(questionType: QuestionType): number {
  if (questionType === 'RADIUS_RADAR') {
    return 3 * 60_000; // +3 Min. Strafzeit für Radius-Radar
  }
  return QUESTION_PENALTY_MS[QUESTION_CATEGORY_MAP[questionType]];
}

export const MEDIA_RESPONSE_TIMEOUT_NET_MS = 5 * 60_000; // 5 Min. (300s) Netto-Spielzeit zum Senden eines Fotos
export const MEDIA_REFUND_MS = 10 * 60_000; // -10 Min. Zeitabzug bei Nicht-Senden innerhalb von 5 Min. (oder Ablehnung)
export const MEDIA_AUTO_EXPIRE_MS = 10 * 60_000; // Empfangene Fotos verschwinden automatisch nach 10 Min.
export const MEDIA_POST_DOWNLOAD_EXPIRE_MS = 60_000; // Nach Klick auf Download verkürzt sich die Restzeit auf max. 1 Min.

export const LEASH_RADIUS_METERS = 20;
export const LEASH_REQUIRED_ACCURACY_METERS = 25;
export const LEASH_CONSECUTIVE_VIOLATIONS = 3;
export const LEASH_RETURN_COUNTDOWN_MS = 60_000;

export const ANCHOR_ACCURACY_WARNING_METERS = 35;
export const ANCHOR_MANUAL_ADJUST_MAX_METERS = 50;

export const LOCATION_THROTTLE_INTERVAL_MS = 6_000;
export const LOCATION_MIN_DISTANCE_METERS = 5;

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
