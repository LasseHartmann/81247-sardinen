import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_MANUAL_ADJUST_MAX_METERS,
  DEFAULT_PLAY_AREA_FEATURE,
  LEASH_RADIUS_METERS,
} from '../src/config/gameConfig';
import {
  FALLBACK_GREEN_POLYGONS_81247,
  FALLBACK_RECYCLING_STATIONS_81247,
  FALLBACK_TRANSIT_STOPS_81247,
  getFallbackRecyclingLatLngs81247,
  getFallbackTransitLatLngs81247,
} from '../src/config/fallbackOsm81247';
import {
  buildPolygonFromVertices,
  extractPolygonVertices,
  isPointInPlayArea,
  isValidPlayAreaPolygon,
  validateManualAnchorSelection,
} from '../src/geo/boundary';
import {
  buildQuestionPreviewGeoJson,
  evaluateCone45,
  evaluateDonutRing,
  evaluateOsmGreen,
  evaluateOsmRecycling,
  evaluateOsmTransit,
  evaluateRadiusRadar,
  evaluateSplitEastWest,
  evaluateSplitNorthSouth,
  evaluateThermometer,
} from '../src/geo/clueGeometry';
import {
  buildExcludedOrangeMask,
  computePossibleHidingArea,
} from '../src/geo/hidingArea';
import type { ClueRecord } from '../src/types/game';
import {
  bearingDegrees,
  destinationPoint,
  distanceMeters,
  smallestAngleDiffDeg,
} from '../src/geo/distance';

const PLAY_AREA_81247 = buildPolygonFromVertices([
  { lat: 48.1785, lng: 11.4455 },
  { lat: 48.1785, lng: 11.4885 },
  { lat: 48.1515, lng: 11.4885 },
  { lat: 48.1515, lng: 11.4455 },
]);

function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function isInsideFeatureCollectionPolygons(
  lat: number,
  lng: number,
  fc: GeoJSON.FeatureCollection | GeoJSON.Feature | null
): boolean {
  if (!fc) return false;
  const pt = turf.point([lng, lat]);
  const features = fc.type === 'FeatureCollection' ? fc.features : [fc];
  return features.some(
    (f) =>
      (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') &&
      turf.booleanPointInPolygon(pt, f as Feature<Polygon>)
  );
}

describe('Geometrie-Kern (Haversine, 45°-Kegel-Wrap, Mittelsenkrechte, Donut-Ringe & OSM)', () => {
  it('berechnet Haversine-Distanzen und Zielpunkte konsistent über Zufallsvektoren', () => {
    const rng = createRng(101);
    const origin = { lat: 48.1662, lng: 11.4673 };
    for (let i = 0; i < 100; i++) {
      const dist = 5 + rng() * 2500;
      const angle = rng() * 360;
      const target = destinationPoint(origin, dist, angle);
      expect(distanceMeters(origin, target)).toBeCloseTo(dist, 2);
      expect(smallestAngleDiffDeg(bearingDegrees(origin, target), angle)).toBeLessThan(0.05);
    }
  });

  it('behandelt den 360°/0°-Nulldurchgang beim 45°-Radarkegel fehlerfrei', () => {
    const seeker = { lat: 48.162, lng: 11.465 };
    const targetAt5Deg = destinationPoint(seeker, 600, 5);
    const targetAt350Deg = destinationPoint(seeker, 600, 350);
    const targetAt35Deg = destinationPoint(seeker, 600, 35);

    expect(smallestAngleDiffDeg(355, 5)).toBeCloseTo(10, 5);
    expect(smallestAngleDiffDeg(5, 355)).toBeCloseTo(10, 5);
    expect(smallestAngleDiffDeg(0, 360)).toBeCloseTo(0, 5);

    // Kegel auf 355° gerichtet deckt [332.5°, 17.5°] ab -> 5° ist TREFFER, 35° ist FEHLVERSUCH
    const hitWrapRight = evaluateCone45(seeker, 355, targetAt5Deg, PLAY_AREA_81247);
    expect(hitWrapRight.answerText).toBe('TREFFER (Im Kegel)');
    expect(
      isInsideFeatureCollectionPolygons(
        targetAt5Deg.lat,
        targetAt5Deg.lng,
        hitWrapRight.overlayGeoJson
      )
    ).toBe(true);

    // Kegel auf 8° gerichtet deckt [345.5°, 30.5°] ab -> 350° ist TREFFER
    const hitWrapLeft = evaluateCone45(seeker, 8, targetAt350Deg, PLAY_AREA_81247);
    expect(hitWrapLeft.answerText).toBe('TREFFER (Im Kegel)');
    expect(
      isInsideFeatureCollectionPolygons(
        targetAt350Deg.lat,
        targetAt350Deg.lng,
        hitWrapLeft.overlayGeoJson
      )
    ).toBe(true);

    const miss = evaluateCone45(seeker, 355, targetAt35Deg, PLAY_AREA_81247);
    expect(miss.answerText).toBe('FEHLVERSUCH (Außerhalb)');
    expect(
      isInsideFeatureCollectionPolygons(
        targetAt35Deg.lat,
        targetAt35Deg.lng,
        miss.overlayGeoJson
      )
    ).toBe(false);
  });

  it('schließt bei Nord/Süd- und Ost/West-Teilungen niemals den wahren Anchor Point aus', () => {
    const rng = createRng(202);
    for (let i = 0; i < 80; i++) {
      const split = {
        lat: 48.155 + rng() * 0.02,
        lng: 11.45 + rng() * 0.03,
      };
      const anchor = {
        lat: 48.153 + rng() * 0.024,
        lng: 11.448 + rng() * 0.035,
      };
      if (Math.abs(anchor.lat - split.lat) < 0.0002 || Math.abs(anchor.lng - split.lng) < 0.0002) {
        continue;
      }

      const ns = evaluateSplitNorthSouth(split, anchor, PLAY_AREA_81247);
      expect(ns.answerText).toBe(anchor.lat >= split.lat ? 'NORDEN' : 'SÜDEN');
      expect(
        isInsideFeatureCollectionPolygons(anchor.lat, anchor.lng, ns.overlayGeoJson)
      ).toBe(false);

      const ew = evaluateSplitEastWest(split, anchor, PLAY_AREA_81247);
      expect(ew.answerText).toBe(anchor.lng >= split.lng ? 'OSTEN' : 'WESTEN');
      expect(
        isInsideFeatureCollectionPolygons(anchor.lat, anchor.lng, ew.overlayGeoJson)
      ).toBe(false);
    }
  });

  it('berechnet die Thermometer-Mittelsenkrechte bei 48.166°N verzerrungsfrei (kein Anchor in ausgeschlossener Halbebene über 150 Zufallstests)', () => {
    const rng = createRng(303);
    for (let i = 0; i < 150; i++) {
      const pointA = {
        lat: 48.158 + rng() * 0.015,
        lng: 11.455 + rng() * 0.025,
      };
      const walkBearing = rng() * 360;
      const walkDist = 100 + rng() * 250;
      const pointB = destinationPoint(pointA, walkDist, walkBearing);
      const anchor = {
        lat: 48.153 + rng() * 0.023,
        lng: 11.448 + rng() * 0.036,
      };

      const dA = distanceMeters(pointA, anchor);
      const dB = distanceMeters(pointB, anchor);
      // Überspringe Punkte unmittelbar auf der Mittelsenkrechten (< 2 m Differenz)
      if (Math.abs(dA - dB) < 2) continue;

      const res = evaluateThermometer(pointA, pointB, anchor, PLAY_AREA_81247);
      expect(res.answerText).toBe(
        dB < dA ? 'WÄRMER (Näher dran)' : 'KÄLTER (Weiter weg)'
      );
      expect(
        isInsideFeatureCollectionPolygons(anchor.lat, anchor.lng, res.overlayGeoJson)
      ).toBe(false);
    }
  });

  it('stanzt beim Donut-Ring-Scanner echte Innenlöcher aus und ordnet alle 6 Distanzbänder korrekt zu', () => {
    const seeker = { lat: 48.1662, lng: 11.4673 };
    const testDistances: Array<[number, string, boolean]> = [
      [80, 'Distanzband: 0–200 m', true],
      [310, 'Distanzband: 200–400 m', false],
      [510, 'Distanzband: 400–600 m', false],
      [710, 'Distanzband: 600–800 m', false],
      [910, 'Distanzband: 800–1000 m', false],
      [1250, 'Distanzband: 1000 m+', false],
    ];

    for (const [dist, expectedAnswer, originShouldBeInside] of testDistances) {
      const anchor = destinationPoint(seeker, dist, 90);
      expect(isPointInPlayArea(anchor, PLAY_AREA_81247)).toBe(true);
      const donut = evaluateDonutRing(seeker, anchor, PLAY_AREA_81247);
      expect(donut.answerText).toBe(expectedAnswer);
      // Der Ankerpunkt selbst liegt garantiert im gezeichneten Ringband:
      expect(
        isInsideFeatureCollectionPolygons(anchor.lat, anchor.lng, donut.overlayGeoJson)
      ).toBe(true);
      // Bei Ringen >= 200 m muss das Innenloch ausgestanzt sein (Seeker-Ursprung nicht im Ring!):
      expect(
        isInsideFeatureCollectionPolygons(seeker.lat, seeker.lng, donut.overlayGeoJson)
      ).toBe(originShouldBeInside);
    }
  });

  it('wertet ÖPNV-150m und Grünflächen-20m-Randtoleranz präzise aus', () => {
    const stop = { lat: 48.166, lng: 11.467 };
    const nearAnchor = destinationPoint(stop, 142, 45);
    const farAnchor = destinationPoint(stop, 165, 45);

    expect(
      evaluateOsmTransit(nearAnchor, [stop], PLAY_AREA_81247).answerText
    ).toBe('JA (Innerhalb 150 m)');
    expect(
      evaluateOsmTransit(farAnchor, [stop], PLAY_AREA_81247).answerText
    ).toBe('NEIN (Weiter als 150 m)');

    const parkPoly = buildPolygonFromVertices([
      { lat: 48.165, lng: 11.46 },
      { lat: 48.165, lng: 11.463 },
      { lat: 48.163, lng: 11.463 },
      { lat: 48.163, lng: 11.46 },
    ]);
    // 14 m nördlich des Nordrands -> zählt wegen <= 20 m Randtoleranz als JA
    const edgeAnchor = destinationPoint({ lat: 48.165, lng: 11.4615 }, 14, 0);
    // 35 m nördlich des Nordrands -> NEIN
    const outsideAnchor = destinationPoint({ lat: 48.165, lng: 11.4615 }, 35, 0);

    expect(
      evaluateOsmGreen(edgeAnchor, [parkPoly], PLAY_AREA_81247).answerText
    ).toBe('JA (In Grünfläche)');
    expect(
      evaluateOsmGreen(outsideAnchor, [parkPoly], PLAY_AREA_81247).answerText
    ).toBe('NEIN (Außerhalb)');

    expect(isValidPlayAreaPolygon(PLAY_AREA_81247).valid).toBe(true);

    // Prüfe auch das offizielle Overpass-81247-PLZ-Polygon (relation/1102638)
    expect(isValidPlayAreaPolygon(DEFAULT_PLAY_AREA_FEATURE).valid).toBe(true);
    expect(extractPolygonVertices(DEFAULT_PLAY_AREA_FEATURE).length).toBe(146);
    // Schloss Blutenburg liegt im offiziellen 81247-Gebiet
    expect(
      isPointInPlayArea({ lat: 48.1632, lng: 11.4572 }, DEFAULT_PLAY_AREA_FEATURE)
    ).toBe(true);

    // Prüfe den vollständigen 81247-ÖPNV-Haltestellen-Datensatz (45 Overpass-Haltepunkte)
    expect(FALLBACK_TRANSIT_STOPS_81247).toHaveLength(45);
    expect(getFallbackTransitLatLngs81247()).toHaveLength(45);
    expect(
      FALLBACK_TRANSIT_STOPS_81247.some(
        (s) => s.name === 'Obermenzing' && s.kind === 'S-Bahn'
      )
    ).toBe(true);
    expect(
      FALLBACK_TRANSIT_STOPS_81247.some((s) => s.name === 'Goteboldstraße')
    ).toBe(true);

    // Prüfe den 81247-Wertstoffinseln-Datensatz (14 Standorte) & 150m-Auswertung
    expect(FALLBACK_RECYCLING_STATIONS_81247).toHaveLength(14);
    expect(getFallbackRecyclingLatLngs81247()).toHaveLength(14);
    expect(
      evaluateOsmRecycling(nearAnchor, [stop], PLAY_AREA_81247).answerText
    ).toBe('JA (Innerhalb 150 m)');
    expect(
      evaluateOsmRecycling(farAnchor, [stop], PLAY_AREA_81247).answerText
    ).toBe('NEIN (Weiter als 150 m)');

    // Prüfe den 81247-Grünflächen-Datensatz
    expect(FALLBACK_GREEN_POLYGONS_81247.length).toBeGreaterThanOrEqual(1);

    // Prüfe Kartenvorschau (buildQuestionPreviewGeoJson) für alle räumlichen Fragen
    const origin = { lat: 48.165, lng: 11.466 };
    for (const qType of [
      'SPLIT_NS',
      'SPLIT_EW',
      'THERMOMETER',
      'CONE_45',
      'OSM_TRANSIT',
      'OSM_RECYCLING',
      'OSM_GREEN',
      'RADIUS_RADAR',
      'DONUT_RING',
    ] as const) {
      const preview = buildQuestionPreviewGeoJson(
        qType,
        {
          bearingDeg: 90,
          radiusMeters: 250,
          pointA: origin,
          pointB: destinationPoint(origin, 250, 45),
        },
        origin,
        PLAY_AREA_81247
      );
      expect(preview).not.toBeNull();
    }

    // Bei Fotos ist keine Kartenvorschau möglich -> gibt null zurück
    expect(
      buildQuestionPreviewGeoJson('MEDIA_SKY', {}, origin, PLAY_AREA_81247)
    ).toBeNull();
    expect(
      buildQuestionPreviewGeoJson('MEDIA_GROUND', {}, origin, PLAY_AREA_81247)
    ).toBeNull();
  });

  it('kombiniert Spielgebiet, Schrumpf-Radar und mehrere Hinweise zu einem sauberen Versteckbereich ohne Linien-Artefakte und färbt den Rest als einheitliche Außenmaske', () => {
    const anchor = { lat: 48.1632, lng: 11.4572 }; // Schloss Blutenburg (in 81247)
    const splitPt = { lat: 48.16, lng: 11.462 }; // südlich & östlich von Blutenburg
    const farSeeker = { lat: 48.168, lng: 11.47 }; // > 250 m entfernt

    const nsEval = evaluateSplitNorthSouth(splitPt, anchor, DEFAULT_PLAY_AREA_FEATURE);
    const ewEval = evaluateSplitEastWest(splitPt, anchor, DEFAULT_PLAY_AREA_FEATURE);
    const missRadarEval = evaluateRadiusRadar(
      farSeeker,
      250,
      anchor,
      DEFAULT_PLAY_AREA_FEATURE
    );

    // Sicherstellen, dass keine Trennlinien (LineString) mehr in den Hinweis-Overlays liegen
    for (const ev of [nsEval, ewEval, missRadarEval]) {
      const feats =
        ev.overlayGeoJson?.type === 'FeatureCollection'
          ? ev.overlayGeoJson.features
          : ev.overlayGeoJson
            ? [ev.overlayGeoJson]
            : [];
      for (const f of feats) {
        expect(f.geometry.type).not.toBe('LineString');
      }
    }

    const toClue = (
      id: string,
      questionType: ClueRecord['questionType'],
      ev: ReturnType<typeof evaluateSplitNorthSouth>
    ): ClueRecord => ({
      id,
      requestId: `req-${id}`,
      sessionId: 's1',
      teamId: 'team-1',
      questionType,
      category: 1,
      createdAt: 1000,
      penaltyMs: 360000,
      title: ev.title,
      answerText: ev.answerText,
      detailText: ev.detailText,
      isPositiveHit: ev.isPositiveHit,
      overlayGeoJson: ev.overlayGeoJson,
      overlayStyle: ev.overlayStyle,
    });

    const clues: ClueRecord[] = [
      toClue('c1', 'SPLIT_NS', nsEval),
      toClue('c2', 'SPLIT_EW', ewEval),
      toClue('c3', 'RADIUS_RADAR', missRadarEval),
    ];

    const possibleArea = computePossibleHidingArea({
      playArea: DEFAULT_PLAY_AREA_FEATURE,
      clues,
      hiddenClueIds: new Set(),
      publishedRadar: {
        stage: 2,
        center: { lat: 48.1638, lng: 11.458 },
        radiusMeters: 900,
        publishedAt: 1000,
      },
    });

    expect(possibleArea).not.toBeNull();
    // Wahrer Versteckpunkt liegt im verbleibenden möglichen Versteckbereich:
    expect(
      isInsideFeatureCollectionPolygons(anchor.lat, anchor.lng, possibleArea)
    ).toBe(true);

    // Südlich von splitPt (ausgeschlossen durch SPLIT_NS) und im verfehlten 250m-Kreis (farSeeker) ausgeschlossen:
    const excludedSouthPt = { lat: 48.157, lng: 11.4572 };
    expect(
      isInsideFeatureCollectionPolygons(
        excludedSouthPt.lat,
        excludedSouthPt.lng,
        possibleArea
      )
    ).toBe(false);
    expect(
      isInsideFeatureCollectionPolygons(farSeeker.lat, farSeeker.lng, possibleArea)
    ).toBe(false);

    // Orangefarbene Außenmaske enthält alles außerhalb von possibleArea, aber nicht den wahren Ankerpunkt:
    const orangeMask = buildExcludedOrangeMask(possibleArea);
    expect(
      isInsideFeatureCollectionPolygons(anchor.lat, anchor.lng, orangeMask)
    ).toBe(false);
    expect(
      isInsideFeatureCollectionPolygons(
        excludedSouthPt.lat,
        excludedSouthPt.lng,
        orangeMask
      )
    ).toBe(true);
    expect(
      isInsideFeatureCollectionPolygons(farSeeker.lat, farSeeker.lng, orangeMask)
    ).toBe(true);
  });

  it('erlaubt manuelle Versteck-Korrekturen der Verstecker ausschließlich innerhalb von 50 m um deren GPS-Position und setzt das Leash-Limit auf 50 m', () => {
    expect(ANCHOR_MANUAL_ADJUST_MAX_METERS).toBe(50);
    expect(LEASH_RADIUS_METERS).toBe(50);

    const gpsPos = { lat: 48.1632, lng: 11.4572 };
    const within45m = destinationPoint(gpsPos, 45, 70);
    const farOutside75m = destinationPoint(gpsPos, 75, 70);

    const ok = validateManualAnchorSelection({
      candidate: within45m,
      gpsPosition: gpsPos,
      playArea: PLAY_AREA_81247,
      maxDistanceMeters: ANCHOR_MANUAL_ADJUST_MAX_METERS,
    });
    expect(ok.valid).toBe(true);

    const tooFar = validateManualAnchorSelection({
      candidate: farOutside75m,
      gpsPosition: gpsPos,
      playArea: PLAY_AREA_81247,
      maxDistanceMeters: ANCHOR_MANUAL_ADJUST_MAX_METERS,
    });
    expect(tooFar.valid).toBe(false);

    const noGps = validateManualAnchorSelection({
      candidate: within45m,
      gpsPosition: null,
      playArea: PLAY_AREA_81247,
      maxDistanceMeters: ANCHOR_MANUAL_ADJUST_MAX_METERS,
    });
    expect(noGps.valid).toBe(false);

    const outsideZone = validateManualAnchorSelection({
      candidate: { lat: 48.1, lng: 11.4 },
      gpsPosition: gpsPos,
      playArea: PLAY_AREA_81247,
      maxDistanceMeters: ANCHOR_MANUAL_ADJUST_MAX_METERS,
    });
    expect(outsideZone.valid).toBe(false);
  });
});
