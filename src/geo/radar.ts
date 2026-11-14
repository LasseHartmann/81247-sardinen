import type { Feature, Polygon } from 'geojson';
import type {
  GamePhase,
  LatLng,
  PublishedRadarCircle,
  RadarSchedule,
  RadarStageId,
  RadarStageSecret,
} from '../types/game';
import { isPointInPlayArea } from './boundary';
import { bearingDegrees, destinationPoint, distanceMeters } from './distance';

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

/**
 * Bestimmt die aktuell fällige Radar-/Zonen-Stufe (1..5) allein anhand des Zeitplans.
 */
export function getDueRadarStageId(
  elapsedNetMs: number,
  schedule: RadarSchedule
): RadarStageId | null {
  if (elapsedNetMs >= schedule.stage5Ms) return 5;
  if (elapsedNetMs >= schedule.stage4Ms) return 4;
  if (elapsedNetMs >= schedule.stage3Ms) return 3;
  if (elapsedNetMs >= schedule.stage2Ms) return 2;
  if (elapsedNetMs >= schedule.stage1Ms) return 1;
  return null;
}

export const MANHUNT_COMFORT_SHIFT_FACTOR = 0.7;

export interface ComputeNextManhuntZoneParams {
  hiderPosition: LatLng;
  stage: RadarStageId;
  nextRadiusMeters: number;
  previousCircle: { center: LatLng; radiusMeters: number } | null;
  playArea?: Feature<Polygon> | null;
  publishedAt?: number;
  rng?: () => number;
}

/**
 * Berechnet dynamisch die nächste Manhunt-Schrumpfzone um die aktuelle Live-Position `H(t)` der Verstecker:
 *
 * Mathematische Garantien:
 * 1. Verstecker werden NIEMALS aus ihrem Bereich gedrängt: `dist(H(t), C_next) < R_next`
 *    (bevorzugt `<= 0.70 * R_next`, sodass mind. 30 % Puffer in alle Richtungen bleiben).
 * 2. Zufälliger Off-Center-Versatz: `C_next` liegt zufällig versetzt um `H(t)`, sodass Sucher
 *    nicht einfach ins Zentrum des neuen Kreises laufen können.
 * 3. Monotone Verschachtelung: Liegt `H(t)` im vorherigen Kreis `(C_prev, R_prev)`, gilt strikt
 *    `dist(C_next, C_prev) + R_next <= R_prev`, sodass die orange Ausschlusszone niemals zurückspringt.
 */
export function computeNextManhuntZoneCircle(
  params: ComputeNextManhuntZoneParams
): PublishedRadarCircle {
  const {
    hiderPosition,
    stage,
    nextRadiusMeters,
    previousCircle,
    playArea = null,
    publishedAt,
    rng = defaultSecureRandom,
  } = params;

  const comfortMaxDist = MANHUNT_COMFORT_SHIFT_FACTOR * nextRadiusMeters;

  // Fall 1: Erste Schrumpfstufe (kein vorheriger Kreis aktiv)
  if (!previousCircle || previousCircle.radiusMeters <= nextRadiusMeters) {
    let fallbackCandidate: LatLng | null = null;
    for (let i = 0; i < 40; i++) {
      const u = clampUnit(rng());
      const theta = clampUnit(rng()) * 360;
      const d = Math.sqrt(u) * comfortMaxDist;
      const candidate = destinationPoint(hiderPosition, d, theta);
      if (!fallbackCandidate) fallbackCandidate = candidate;
      if (!playArea || isPointInPlayArea(candidate, playArea)) {
        return {
          stage,
          radiusMeters: nextRadiusMeters,
          center: candidate,
          publishedAt,
        };
      }
    }
    return {
      stage,
      radiusMeters: nextRadiusMeters,
      center: fallbackCandidate ?? {
        lat: hiderPosition.lat,
        lng: hiderPosition.lng,
      },
      publishedAt,
    };
  }

  // Fall 2: Folge-Schrumpfstufe mit vorherigem Kreis (C_prev, R_prev)
  const prevCenter = previousCircle.center;
  const maxShiftFromPrev = Math.max(
    0,
    previousCircle.radiusMeters - nextRadiusMeters
  );
  const distHiderToPrev = distanceMeters(hiderPosition, prevCenter);

  // 2a. Falls Hider kurzzeitig außerhalb des alten Kreises waren:
  // Halte Hider garantiert im neuen Kreis (<= 0.70 * R_next) und ziehe Richtung C_prev.
  if (distHiderToPrev > previousCircle.radiusMeters) {
    const bearingToPrev = bearingDegrees(hiderPosition, prevCenter);
    const pullDist = Math.min(comfortMaxDist, distHiderToPrev);
    const jitterDeg = (clampUnit(rng()) - 0.5) * 24;
    const pulled = destinationPoint(
      hiderPosition,
      pullDist * (0.85 + 0.15 * clampUnit(rng())),
      (bearingToPrev + jitterDeg + 360) % 360
    );
    return {
      stage,
      radiusMeters: nextRadiusMeters,
      center: pulled,
      publishedAt,
    };
  }

  // 2b. Normalfall: Hider sind innerhalb von C_prev (distHiderToPrev <= R_prev).
  // Schnittlinse Disk(H, 0.70 * R_next) ∩ Disk(C_prev, R_prev - R_next) per Rejection-Sampling prüfen.
  const nestedMarginMeters = Math.max(0, maxShiftFromPrev - 0.25);
  let validOutsidePlayArea: LatLng | null = null;

  for (let i = 0; i < 64; i++) {
    const u = clampUnit(rng());
    const theta = clampUnit(rng()) * 360;
    const d = Math.sqrt(u) * comfortMaxDist;
    const candidate = destinationPoint(hiderPosition, d, theta);
    if (distanceMeters(candidate, prevCenter) <= nestedMarginMeters) {
      if (!playArea || isPointInPlayArea(candidate, playArea)) {
        return {
          stage,
          radiusMeters: nextRadiusMeters,
          center: candidate,
          publishedAt,
        };
      }
      if (!validOutsidePlayArea) {
        validOutsidePlayArea = candidate;
      }
    }
  }

  if (validOutsidePlayArea) {
    return {
      stage,
      radiusMeters: nextRadiusMeters,
      center: validOutsidePlayArea,
      publishedAt,
    };
  }

  // 2c. Analytischer Linsen-Fallback (wenn Hider nah am Außenrand von C_prev stehen,
  // sodass dist(H, C_prev) - maxShiftFromPrev > 0.70 * R_next, aber <= R_next gilt):
  // Entlang der Verbindungslinie H -> C_prev existiert wegen dist(H, C_prev) <= R_prev
  // IMMER ein gültiges Intervall [dMin, dMax] mit dMin <= dMax < R_next!
  if (distHiderToPrev < 0.01) {
    return {
      stage,
      radiusMeters: nextRadiusMeters,
      center: { lat: prevCenter.lat, lng: prevCenter.lng },
      publishedAt,
    };
  }

  const bearingToPrev = bearingDegrees(hiderPosition, prevCenter);
  const safeHiderLimit = Math.max(
    0.5,
    Math.min(nextRadiusMeters - 0.5, distHiderToPrev - maxShiftFromPrev + 25)
  );
  const dMin = Math.max(0, distHiderToPrev - nestedMarginMeters);
  const dMax = Math.min(
    Math.max(dMin, safeHiderLimit),
    distHiderToPrev + nestedMarginMeters,
    nextRadiusMeters - 0.25
  );

  // Wähle zufälligen Punkt im zulässigen Segment + leichten seitlichen Winkel-Jitter, sofern er in der Linse bleibt
  const baseDist =
    dMax > dMin ? dMin + clampUnit(rng()) * (dMax - dMin) : dMin;

  for (let attempt = 0; attempt < 16; attempt++) {
    const maxAngleJitter = attempt < 12 ? 18 * (1 - attempt / 12) : 0;
    const jitter = (clampUnit(rng()) - 0.5) * 2 * maxAngleJitter;
    const cand = destinationPoint(
      hiderPosition,
      baseDist,
      (bearingToPrev + jitter + 360) % 360
    );
    if (
      distanceMeters(hiderPosition, cand) <= nextRadiusMeters - 0.1 &&
      distanceMeters(cand, prevCenter) <= maxShiftFromPrev - 0.05
    ) {
      return {
        stage,
        radiusMeters: nextRadiusMeters,
        center: cand,
        publishedAt,
      };
    }
  }

  // Exakter Punkt auf der Verbindungsstrecke H -> C_prev (garantiert beide Ungleichungen per Dreiecksungleichung)
  const fallbackMaxFromPrev =
    distHiderToPrev > previousCircle.radiusMeters - 0.5
      ? maxShiftFromPrev
      : nestedMarginMeters;
  const exactDistFromPrev = Math.min(distHiderToPrev, fallbackMaxFromPrev);
  const bearingFromPrevToHider = bearingDegrees(prevCenter, hiderPosition);
  const exactCenter = destinationPoint(
    prevCenter,
    exactDistFromPrev,
    bearingFromPrevToHider
  );
  return {
    stage,
    radiusMeters: nextRadiusMeters,
    center: exactCenter,
    publishedAt,
  };
}
