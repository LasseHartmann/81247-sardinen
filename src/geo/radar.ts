import type {
  GamePhase,
  LatLng,
  PublishedRadarCircle,
  RadarSchedule,
  RadarStageId,
  RadarStageSecret,
} from '../types/game';
import { destinationPoint, distanceMeters } from './distance';

export const DEFAULT_RADAR_RADII: Record<RadarStageId, number> = {
  1: 800,
  2: 400,
  3: 200,
  4: 100,
  5: 25,
};

export const INNERMOST_SHIFT_FACTOR = 0.75;
export const NESTED_SAFETY_ALPHA = 0.85;

/**
 * Kryptographisch gestützter Zufallsgenerator in [0, 1) mit Fallback auf Math.random.
 */
export function defaultSecureRandom(): number {
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues) {
    const arr = new Uint32Array(1);
    globalThis.crypto.getRandomValues(arr);
    return arr[0] / 4294967296;
  }
  return Math.random();
}

/**
 * Inside-Out-Konstruktion aller 5 Schrumpf-Radar-Stufen (A -> C5 -> C4 -> C3 -> C2 -> C1).
 *
 * Mathematische Garantien:
 * 1. Innerste Stufe (R5 = 25 m): d5 = sqrt(u5) * (0.75 * R5), theta5 in [0, 360°).
 *    => dist(A, C5) <= 0.75 * R5 < R5.
 * 2. Aufsteigende Außenstufen k = 5, 4, 3, 2 (von C_k nach C_{k-1}):
 *    d_{k-1} = sqrt(u_{k-1}) * alpha * (R_{k-1} - R_k) mit alpha = 0.85.
 *    => dist(C_{k-1}, C_k) + R_k <= R_{k-1} und dist(A, C_k) <= R_k (Dreiecksungleichung).
 *    Keine fehlschlagenden Rejection-Loops und kein verräterisches Kleben am Außenrand.
 */
export function generateInsideOutRadarStages(
  anchorPoint: LatLng,
  schedule: RadarSchedule,
  rng: () => number = defaultSecureRandom
): RadarStageSecret[] {
  const r5 = DEFAULT_RADAR_RADII[5];
  const u5 = clampUnit(rng());
  const theta5Deg = clampUnit(rng()) * 360;
  const d5 = Math.sqrt(u5) * (INNERMOST_SHIFT_FACTOR * r5);
  const c5 = destinationPoint(anchorPoint, d5, theta5Deg);

  const centers: Record<RadarStageId, LatLng> = {
    5: c5,
    4: c5,
    3: c5,
    2: c5,
    1: c5,
  };

  const descendingStages: RadarStageId[] = [5, 4, 3, 2];
  for (const k of descendingStages) {
    const outerStage = (k - 1) as RadarStageId;
    const rInner = DEFAULT_RADAR_RADII[k];
    const rOuter = DEFAULT_RADAR_RADII[outerStage];
    const u = clampUnit(rng());
    const thetaDeg = clampUnit(rng()) * 360;
    const displacement =
      Math.sqrt(u) * NESTED_SAFETY_ALPHA * (rOuter - rInner);
    centers[outerStage] = destinationPoint(centers[k], displacement, thetaDeg);
  }

  const triggerMap: Record<RadarStageId, number> = {
    1: schedule.stage1Ms,
    2: schedule.stage2Ms,
    3: schedule.stage3Ms,
    4: schedule.stage4Ms,
    5: schedule.stage5Ms,
  };

  return ([1, 2, 3, 4, 5] as RadarStageId[]).map((stage) => ({
    stage,
    radiusMeters: DEFAULT_RADAR_RADII[stage],
    center: centers[stage],
    triggerElapsedMs: triggerMap[stage],
  }));
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value >= 1) return 0.999999999;
  return value;
}

/**
 * Prüft die beiden geometrischen Kern-Invarianten eines generierten Radar-Sets.
 */
export function verifyRadarStageInvariants(
  anchorPoint: LatLng,
  stages: RadarStageSecret[],
  epsilonMeters = 1e-3
): { valid: boolean; violations: string[] } {
  const violations: string[] = [];
  const sorted = [...stages].sort((a, b) => a.stage - b.stage);
  if (sorted.length !== 5) {
    violations.push(`Erwartet 5 Stufen, erhalten: ${sorted.length}`);
    return { valid: false, violations };
  }

  for (const s of sorted) {
    const distAnchor = distanceMeters(anchorPoint, s.center);
    if (distAnchor > s.radiusMeters + epsilonMeters) {
      violations.push(
        `Stufe ${s.stage}: dist(A, C_${s.stage}) = ${distAnchor.toFixed(3)} m > R_${s.stage} = ${s.radiusMeters} m`
      );
    }
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const outer = sorted[i];
    const inner = sorted[i + 1];
    const centerShift = distanceMeters(outer.center, inner.center);
    if (centerShift + inner.radiusMeters > outer.radiusMeters + epsilonMeters) {
      violations.push(
        `Verschachtelung Stufe ${outer.stage}->${inner.stage} verletzt: dist + R_inner = ${(
          centerShift + inner.radiusMeters
        ).toFixed(3)} m > R_outer = ${outer.radiusMeters} m`
      );
    }
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Bestimmt anhand der Netto-Spielzeit die aktuelle Spielphase.
 */
export function getPhaseForElapsedMs(
  elapsedNetMs: number,
  schedule: RadarSchedule
): GamePhase {
  if (elapsedNetMs < schedule.hidingDurationMs) return 'HIDING';
  if (elapsedNetMs < schedule.stage1Ms) return 'OPEN_SEARCH';
  if (elapsedNetMs < schedule.stage2Ms) return 'RADAR_1';
  if (elapsedNetMs < schedule.stage3Ms) return 'RADAR_2';
  if (elapsedNetMs < schedule.stage4Ms) return 'RADAR_3';
  if (elapsedNetMs < schedule.stage5Ms) return 'RADAR_4';
  return 'ENDGAME';
}

/**
 * Liefert ausschließlich die zum aktuellen Netto-Zeitpunkt bereits fällige Radar-Stufe
 * (ohne zukünftige Stufen zu exponieren).
 */
export function getDueRadarCircle(
  elapsedNetMs: number,
  stages: RadarStageSecret[],
  publishedAt?: number
): PublishedRadarCircle | null {
  if (!stages || stages.length === 0) return null;
  const dueStages = stages
    .filter((s) => elapsedNetMs >= s.triggerElapsedMs)
    .sort((a, b) => b.stage - a.stage);

  if (dueStages.length === 0) return null;
  const current = dueStages[0];
  return {
    stage: current.stage,
    radiusMeters: current.radiusMeters,
    center: { lat: current.center.lat, lng: current.center.lng },
    publishedAt,
  };
}
