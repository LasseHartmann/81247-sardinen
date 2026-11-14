import { describe, expect, it } from 'vitest';
import {
  buildManhuntRadarSchedule,
  DEFAULT_PLAY_AREA_FEATURE,
  getManhuntPingScheduleMs,
  getManhuntPingStatusAtElapsedMs,
  MANHUNT_RADAR_RADII,
} from '../src/config/gameConfig';
import { destinationPoint, distanceMeters } from '../src/geo/distance';
import {
  computeNextManhuntZoneCircle,
  DEFAULT_RADAR_RADII,
  generateInsideOutRadarStages,
  getDueRadarCircle,
  getDueRadarStageId,
  getPhaseForElapsedMs,
  verifyRadarStageInvariants,
} from '../src/geo/radar';
import type { RadarSchedule, RadarStageId } from '../src/types/game';

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

  it('berechnet den Manhunt-Ping- & Schrumpfplan (alle 10 Min. in den ersten 3/4, alle 5 Min. im letzten Viertel)', () => {
    // 5 Min. Vorsprung + 40 Min. Spielzeit -> Letztes Viertel startet nach 30 Min. Jagd (Netto 35:00)
    // Pings bei Netto 15:00 (+10m), 25:00 (+20m), 35:00 (+30m), 40:00 (+35m), 45:00 (+40m)
    const pings40 = getManhuntPingScheduleMs(5 * 60_000, 40 * 60_000);
    expect(pings40).toEqual([
      15 * 60_000,
      25 * 60_000,
      35 * 60_000,
      40 * 60_000,
      45 * 60_000,
    ]);

    const sched40 = buildManhuntRadarSchedule(5, 40);
    expect(sched40.hidingDurationMs).toBe(5 * 60_000);
    expect(sched40.stage1Ms).toBe(15 * 60_000);
    expect(sched40.stage2Ms).toBe(25 * 60_000);
    expect(sched40.stage3Ms).toBe(35 * 60_000);
    expect(sched40.stage4Ms).toBe(40 * 60_000);
    expect(sched40.stage5Ms).toBe(45 * 60_000);

    expect(getDueRadarStageId(14 * 60_000 + 59_999, sched40)).toBeNull();
    expect(getDueRadarStageId(15 * 60_000, sched40)).toBe(1);
    expect(getDueRadarStageId(35 * 60_000, sched40)).toBe(3);
    expect(getDueRadarStageId(45 * 60_000, sched40)).toBe(5);

    const statusBeforeFirstPing = getManhuntPingStatusAtElapsedMs(
      12 * 60_000,
      5 * 60_000,
      40 * 60_000
    );
    expect(statusBeforeFirstPing.duePingElapsedMs).toBeNull();
    expect(statusBeforeFirstPing.nextPingElapsedMs).toBe(15 * 60_000);
    expect(statusBeforeFirstPing.currentIntervalMinutes).toBe(10);
    expect(statusBeforeFirstPing.isInLastQuarter).toBe(false);

    const statusInLastQuarter = getManhuntPingStatusAtElapsedMs(
      36 * 60_000,
      5 * 60_000,
      40 * 60_000
    );
    expect(statusInLastQuarter.duePingElapsedMs).toBe(35 * 60_000);
    expect(statusInLastQuarter.duePingNumber).toBe(3);
    expect(statusInLastQuarter.nextPingElapsedMs).toBe(40 * 60_000);
    expect(statusInLastQuarter.currentIntervalMinutes).toBe(5);
    expect(statusInLastQuarter.isInLastQuarter).toBe(true);

    const schedFast = buildManhuntRadarSchedule(0, 20);
    expect(schedFast.hidingDurationMs).toBe(0);
    expect(schedFast.stage1Ms).toBe(10 * 60_000);
    expect(schedFast.stage5Ms).toBe(20 * 60_000);

    const schedMax = buildManhuntRadarSchedule(30, 80);
    expect(schedMax.hidingDurationMs).toBe(30 * 60_000);
    expect(schedMax.stage1Ms).toBe(40 * 60_000);
    expect(schedMax.stage5Ms).toBe(110 * 60_000);
  });

  it('hält bewegliche Manhunt-Verstecker in 500 Läufen (inkl. Rand-Grenzfall) ausnahmslos im geschachtelten Folge-Kreis', () => {
    const rng = createSeededRng(2026_1114);
    const stageIds: RadarStageId[] = [1, 2, 3, 4, 5];
    let nonZeroOffsetStages = 0;

    for (let trial = 0; trial < 500; trial++) {
      let hiderPos = {
        lat: 48.155 + rng() * 0.025,
        lng: 11.45 + rng() * 0.035,
      };
      let prevCircle = null;

      for (const stage of stageIds) {
        const nextRadius = MANHUNT_RADAR_RADII[stage];

        // Bei vorherigem Kreis bewegen sich die Verstecker innerhalb der aktuellen Zone weiter;
        // in jedem 5. Lauf testen wir explizit Verstecker direkt am äußersten Rand (R_prev - 0.05 m)!
        if (prevCircle) {
          const walkRatio = trial % 5 === 0 ? 0.9999 : rng() * 0.95;
          const walkDist = Math.max(0, prevCircle.radiusMeters * walkRatio - 0.05);
          const walkBearing = rng() * 360;
          hiderPos = destinationPoint(prevCircle.center, walkDist, walkBearing);
          expect(distanceMeters(hiderPos, prevCircle.center)).toBeLessThanOrEqual(
            prevCircle.radiusMeters + 0.05
          );
        }

        const nextCircle = computeNextManhuntZoneCircle({
          stage,
          nextRadiusMeters: nextRadius,
          hiderPosition: hiderPos,
          previousCircle: prevCircle,
          playArea: DEFAULT_PLAY_AREA_FEATURE,
          publishedAt: stage * 60_000,
          rng,
        });

        // 1. Verstecker werden NIEMALS aus ihrer aktuellen Position gedrängt
        const distHiderToNext = distanceMeters(hiderPos, nextCircle.center);
        expect(distHiderToNext).toBeLessThanOrEqual(nextRadius + 0.08);
        if (distHiderToNext > 1) nonZeroOffsetStages++;

        // 2. Neuer Kreis liegt monoton geschachtelt im vorherigen Kreis
        if (prevCircle) {
          const centerShift = distanceMeters(nextCircle.center, prevCircle.center);
          expect(centerShift + nextCircle.radiusMeters).toBeLessThanOrEqual(
            prevCircle.radiusMeters + 0.08
          );
        }

        prevCircle = nextCircle;
      }
    }

    expect(nonZeroOffsetStages).toBeGreaterThan(2000);
  });
});
