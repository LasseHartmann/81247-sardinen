import { describe, expect, it } from 'vitest';
import { destinationPoint, distanceMeters } from '../src/geo/distance';
import {
  DEFAULT_RADAR_RADII,
  generateInsideOutRadarStages,
  getDueRadarCircle,
  getPhaseForElapsedMs,
  verifyRadarStageInvariants,
} from '../src/geo/radar';
import type { RadarSchedule } from '../src/types/game';

const STANDARD_SCHEDULE: RadarSchedule = {
  hidingDurationMs: 10 * 60_000,
  stage1Ms: 25 * 60_000,
  stage2Ms: 30 * 60_000,
  stage3Ms: 35 * 60_000,
  stage4Ms: 40 * 60_000,
  stage5Ms: 45 * 60_000,
};

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('Inside-Out Schrumpf-Radar (500-Trial Monte-Carlo & Phasenlogik)', () => {
  it('erfüllt in 500 Zufallsläufen im Gebiet 81247 München ausnahmslos alle Verschachtelungs- und Anker-Invarianten', () => {
    const rng = createSeededRng(81247_2026);
    let nonZeroShiftCount = 0;

    for (let trial = 0; trial < 500; trial++) {
      // Zufälliger Ankerpunkt im Raum Obermenzing / Blutenburg / Pipping
      const anchor = {
        lat: 48.152 + rng() * 0.03,
        lng: 11.445 + rng() * 0.045,
      };

      const stages = generateInsideOutRadarStages(anchor, STANDARD_SCHEDULE, rng);
      const check = verifyRadarStageInvariants(anchor, stages, 1e-4);
      expect(check.valid, check.violations.join('; ')).toBe(true);

      // Prüfe zusätzlich explizit alle Radien und Anti-Tangenten-Abstand
      expect(stages.map((s) => s.radiusMeters)).toEqual([800, 400, 200, 100, 25]);

      const c5 = stages[4];
      const distAtoC5 = distanceMeters(anchor, c5.center);
      expect(distAtoC5).toBeLessThanOrEqual(0.75 * DEFAULT_RADAR_RADII[5] + 0.02);
      if (distAtoC5 > 0.5) nonZeroShiftCount++;

      // Prüfe für jedes Paar (k-1, k) auch echte Randpunkte des inneren Kreises auf der Kugel
      for (let idx = 0; idx < stages.length - 1; idx++) {
        const outer = stages[idx];
        const inner = stages[idx + 1];
        const centerDist = distanceMeters(outer.center, inner.center);

        // Wegen alpha = 0.85 klebt der innere Kreis niemals an der Außenkante:
        const minSafetyMargin = 0.14 * (outer.radiusMeters - inner.radiusMeters);
        expect(centerDist + inner.radiusMeters).toBeLessThanOrEqual(
          outer.radiusMeters - minSafetyMargin
        );

        // Stichprobe von 12 Randpunkten des inneren Kreises liegt strikt im äußeren Kreis
        for (let b = 0; b < 360; b += 30) {
          const boundaryPt = destinationPoint(inner.center, inner.radiusMeters, b);
          expect(distanceMeters(outer.center, boundaryPt)).toBeLessThan(
            outer.radiusMeters
          );
        }
      }
    }

    expect(nonZeroShiftCount).toBeGreaterThan(450);
  });

  it('veröffentlicht zu jedem Netto-Zeitpunkt exakt nur die bereits fällige Radar-Stufe ohne Leak zukünftiger Mittelpunkte', () => {
    const rng = createSeededRng(42);
    const anchor = { lat: 48.1632, lng: 11.4569 }; // Schloss Blutenburg
    const stages = generateInsideOutRadarStages(anchor, STANDARD_SCHEDULE, rng);

    expect(getPhaseForElapsedMs(0, STANDARD_SCHEDULE)).toBe('HIDING');
    expect(getPhaseForElapsedMs(9 * 60_000 + 59_999, STANDARD_SCHEDULE)).toBe('HIDING');
    expect(getDueRadarCircle(24 * 60_000 + 59_999, stages)).toBeNull();

    expect(getPhaseForElapsedMs(10 * 60_000, STANDARD_SCHEDULE)).toBe('OPEN_SEARCH');
    expect(getPhaseForElapsedMs(25 * 60_000, STANDARD_SCHEDULE)).toBe('RADAR_1');
    expect(getDueRadarCircle(25 * 60_000, stages)?.radiusMeters).toBe(800);
    expect(getDueRadarCircle(25 * 60_000, stages)?.stage).toBe(1);

    expect(getPhaseForElapsedMs(30 * 60_000, STANDARD_SCHEDULE)).toBe('RADAR_2');
    expect(getDueRadarCircle(30 * 60_000, stages)?.radiusMeters).toBe(400);

    expect(getPhaseForElapsedMs(35 * 60_000, STANDARD_SCHEDULE)).toBe('RADAR_3');
    expect(getDueRadarCircle(35 * 60_000, stages)?.radiusMeters).toBe(200);

    expect(getPhaseForElapsedMs(40 * 60_000, STANDARD_SCHEDULE)).toBe('RADAR_4');
    expect(getDueRadarCircle(40 * 60_000, stages)?.radiusMeters).toBe(100);

    expect(getPhaseForElapsedMs(45 * 60_000, STANDARD_SCHEDULE)).toBe('ENDGAME');
    const endgameCircle = getDueRadarCircle(52 * 60_000, stages);
    expect(endgameCircle?.stage).toBe(5);
    expect(endgameCircle?.radiusMeters).toBe(25);
  });
});
