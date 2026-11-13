import * as turf from '@turf/turf';
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from 'geojson';
import { FALLBACK_TRANSIT_STOPS_81247 } from '../config/fallbackOsm81247';
import type {
  ClueOverlayStyle,
  DonutBandLabel,
  LatLng,
  QuestionParams,
  QuestionType,
  RadiusOptionMeters,
} from '../types/game';
import {
  bearingDegrees,
  destinationPoint,
  distanceMeters,
  smallestAngleDiffDeg,
} from './distance';

export interface EvaluatedClueResult {
  title: string;
  answerText: string;
  detailText: string;
  isPositiveHit: boolean;
  overlayGeoJson: FeatureCollection | Feature | null;
  overlayStyle: ClueOverlayStyle;
}

export interface OsmEnvironmentData {
  transitStops: LatLng[];
  greenPolygons: Feature<Polygon | MultiPolygon>[];
  usedOfflineFallback: boolean;
}

const METERS_PER_DEG_LAT = 111132;

function metersPerDegLngAt(latDeg: number): number {
  return 111320 * Math.cos((latDeg * Math.PI) / 180);
}

function safeClipWithPlayArea(
  candidate: Feature<Polygon | MultiPolygon>,
  playArea: Feature<Polygon>
): Feature<Polygon | MultiPolygon> | null {
  try {
    const clipped = turf.intersect(
      turf.featureCollection([playArea, candidate])
    );
    return clipped ?? null;
  } catch {
    return candidate;
  }
}

/**
 * 1A: Nord/Süd-Teilung (+2 Min.)
 */
export function evaluateSplitNorthSouth(
  splitPoint: LatLng,
  anchorPoint: LatLng,
  playArea: Feature<Polygon>
): EvaluatedClueResult {
  const isNorth = anchorPoint.lat >= splitPoint.lat;
  const answerText = isNorth ? 'NORDEN' : 'SÜDEN';
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(playArea);
  const pad = 0.08;

  // Ausgeschlossene Hälfte schattieren
  const excludedPoly = isNorth
    ? turf.bboxPolygon([minLng - pad, minLat - pad, maxLng + pad, splitPoint.lat])
    : turf.bboxPolygon([minLng - pad, splitPoint.lat, maxLng + pad, maxLat + pad]);

  const clippedExcluded = safeClipWithPlayArea(excludedPoly, playArea);
  const dividerLine = turf.lineString(
    [
      [minLng - 0.01, splitPoint.lat],
      [maxLng + 0.01, splitPoint.lat],
    ],
    { role: 'divider' }
  );

  const features: Feature[] = [dividerLine];
  if (clippedExcluded) {
    clippedExcluded.properties = { role: 'excluded' };
    features.push(clippedExcluded);
  }

  return {
    title: 'Nord/Süd-Teilung',
    answerText,
    detailText: isNorth
      ? 'Das Versteck liegt nördlich der gewählten Trennlinie (Südhälfte ausgeschlossen).'
      : 'Das Versteck liegt südlich der gewählten Trennlinie (Nordhälfte ausgeschlossen).',
    isPositiveHit: true,
    overlayGeoJson: turf.featureCollection(features),
    overlayStyle: 'EXCLUDED_AREA',
  };
}

/**
 * 1B: Ost/West-Teilung (+2 Min.)
 */
export function evaluateSplitEastWest(
  splitPoint: LatLng,
  anchorPoint: LatLng,
  playArea: Feature<Polygon>
): EvaluatedClueResult {
  const isEast = anchorPoint.lng >= splitPoint.lng;
  const answerText = isEast ? 'OSTEN' : 'WESTEN';
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(playArea);
  const pad = 0.08;

  const excludedPoly = isEast
    ? turf.bboxPolygon([minLng - pad, minLat - pad, splitPoint.lng, maxLat + pad])
    : turf.bboxPolygon([splitPoint.lng, minLat - pad, maxLng + pad, maxLat + pad]);

  const clippedExcluded = safeClipWithPlayArea(excludedPoly, playArea);
  const dividerLine = turf.lineString(
    [
      [splitPoint.lng, minLat - 0.01],
      [splitPoint.lng, maxLat + 0.01],
    ],
    { role: 'divider' }
  );

  const features: Feature[] = [dividerLine];
  if (clippedExcluded) {
    clippedExcluded.properties = { role: 'excluded' };
    features.push(clippedExcluded);
  }

  return {
    title: 'Ost/West-Teilung',
    answerText,
    detailText: isEast
      ? 'Das Versteck liegt östlich der gewählten Trennlinie (Westhälfte ausgeschlossen).'
      : 'Das Versteck liegt westlich der gewählten Trennlinie (Osthälfte ausgeschlossen).',
    isPositiveHit: true,
    overlayGeoJson: turf.featureCollection(features),
    overlayStyle: 'EXCLUDED_AREA',
  };
}

/**
 * 1C: Thermometer (100 m Laufweg, +2 Min.)
 * Berechnet die exakte metrische Mittelsenkrechte in der lokalen Tangentialebene
 * (korrigiert um cos(lat), damit Ost-West- und Nord-Süd-Maßstab verzerrungsfrei sind).
 */
export function evaluateThermometer(
  pointA: LatLng,
  pointB: LatLng,
  anchorPoint: LatLng,
  playArea: Feature<Polygon>
): EvaluatedClueResult {
  const distA = distanceMeters(pointA, anchorPoint);
  const distB = distanceMeters(pointB, anchorPoint);
  const isWarmer = distB < distA;
  const answerText = isWarmer
    ? 'WÄRMER (Näher dran)'
    : 'KÄLTER (Weiter weg)';

  const midLat = (pointA.lat + pointB.lat) / 2;
  const midLng = (pointA.lng + pointB.lng) / 2;
  const mPerLng = metersPerDegLngAt(midLat);

  const toLocalXY = (pt: LatLng): [number, number] => [
    (pt.lng - midLng) * mPerLng,
    (pt.lat - midLat) * METERS_PER_DEG_LAT,
  ];
  const toLatLngCoord = (x: number, y: number): [number, number] => [
    midLng + x / mPerLng,
    midLat + y / METERS_PER_DEG_LAT,
  ];

  const [ax, ay] = toLocalXY(pointA);
  const [bx, by] = toLocalXY(pointB);
  const vx = bx - ax;
  const vy = by - ay;
  const len = Math.hypot(vx, vy) || 1;
  // Einheitsvektor von A nach B
  const ux = vx / len;
  const uy = vy / len;
  // Senkrechter Einheitsvektor entlang der Mittelsenkrechten
  const nx = -uy;
  const ny = ux;

  // Bei WÄRMER ist B näher -> die A-Halbebene (Richtung -u) wird ausgeschlossen.
  // Bei KÄLTER ist A näher -> die B-Halbebene (Richtung +u) wird ausgeschlossen.
  const exDirX = isWarmer ? -ux : ux;
  const exDirY = isWarmer ? -uy : uy;

  const span = 25_000; // 25 km überdeckt ganz 81247 sicher
  const p1 = toLatLngCoord(nx * span, ny * span);
  const p2 = toLatLngCoord(-nx * span, -ny * span);
  const p3 = toLatLngCoord(-nx * span + exDirX * span, -ny * span + exDirY * span);
  const p4 = toLatLngCoord(nx * span + exDirX * span, ny * span + exDirY * span);

  const halfPlane = turf.polygon([[p1, p2, p3, p4, p1]]);
  const clippedExcluded = safeClipWithPlayArea(halfPlane, playArea);

  const lineSpan = 6_000;
  const bisectorLine = turf.lineString(
    [
      toLatLngCoord(-nx * lineSpan, -ny * lineSpan),
      toLatLngCoord(nx * lineSpan, ny * lineSpan),
    ],
    { role: 'divider' }
  );

  const features: Feature[] = [bisectorLine];
  if (clippedExcluded) {
    clippedExcluded.properties = { role: 'excluded' };
    features.push(clippedExcluded);
  }

  return {
    title: 'Thermometer (100 m)',
    answerText,
    detailText: isWarmer
      ? 'Endpunkt B liegt näher am Versteck als Startpunkt A.'
      : 'Startpunkt A lag näher am Versteck als Endpunkt B.',
    isPositiveHit: isWarmer,
    overlayGeoJson: turf.featureCollection(features),
    overlayStyle: 'EXCLUDED_AREA',
  };
}

/**
 * Erzeugt einen 45°-Geodäsie-Sektor (Öffnungswinkel ±22,5° um bearingDeg) als Polygon,
 * geclippt auf das Spielgebiet (für Live-Vorschau und Auswertung, sicher am 360°/0°-Übergang).
 */
export function buildCone45Polygon(
  origin: LatLng,
  bearingDeg: number,
  playArea: Feature<Polygon>,
  maxRangeMeters = 8_500
): Feature<Polygon | MultiPolygon> | null {
  const steps = 48;
  const halfAngle = 22.5;
  const startBearing = bearingDeg - halfAngle;
  const ring: [number, number][] = [[origin.lng, origin.lat]];

  for (let i = 0; i <= steps; i++) {
    const angle = (((startBearing + (i * 45) / steps) % 360) + 360) % 360;
    const pt = destinationPoint(origin, maxRangeMeters, angle);
    ring.push([pt.lng, pt.lat]);
  }
  ring.push([origin.lng, origin.lat]);

  const rawSector = turf.polygon([ring]);
  return safeClipWithPlayArea(rawSector, playArea);
}

/**
 * 1D: 45°-Radarkegel (+2 Min.)
 */
export function evaluateCone45(
  seekerOrigin: LatLng,
  bearingDeg: number,
  anchorPoint: LatLng,
  playArea: Feature<Polygon>
): EvaluatedClueResult {
  const normalizedTargetBearing = ((bearingDeg % 360) + 360) % 360;
  const dist = distanceMeters(seekerOrigin, anchorPoint);
  const actualAzimuth = dist < 0.05 ? normalizedTargetBearing : bearingDegrees(seekerOrigin, anchorPoint);
  const diff = smallestAngleDiffDeg(actualAzimuth, normalizedTargetBearing);
  const isHit = diff <= 22.5;

  const clippedCone = buildCone45Polygon(
    seekerOrigin,
    normalizedTargetBearing,
    playArea
  );

  return {
    title: `45°-Radarkegel (${Math.round(normalizedTargetBearing)}°)`,
    answerText: isHit ? 'TREFFER (Im Kegel)' : 'FEHLVERSUCH (Außerhalb)',
    detailText: isHit
      ? `Das Versteck liegt innerhalb des 45°-Sektors um ${Math.round(normalizedTargetBearing)}°.`
      : `Das Versteck liegt außerhalb des gescannten 45°-Sektors um ${Math.round(normalizedTargetBearing)}°.`,
    isPositiveHit: isHit,
    overlayGeoJson: clippedCone ? turf.featureCollection([clippedCone]) : null,
    overlayStyle: isHit ? 'HIT_AREA' : 'EXCLUDED_AREA',
  };
}

/**
 * 2A: ÖPNV-Nähe 150 m (+3 Min.)
 */
export function evaluateOsmTransit(
  anchorPoint: LatLng,
  transitStops: LatLng[],
  playArea: Feature<Polygon>
): EvaluatedClueResult {
  const isWithin150m = transitStops.some(
    (stop) => distanceMeters(anchorPoint, stop) <= 150
  );

  const bufferedStops: Feature[] = [];
  for (const stop of transitStops) {
    const circle = turf.circle([stop.lng, stop.lat], 150, {
      units: 'meters',
      steps: 28,
    });
    const clipped = safeClipWithPlayArea(circle, playArea);
    if (clipped) {
      bufferedStops.push(clipped);
    }
  }

  return {
    title: 'ÖPNV-Check (150 m)',
    answerText: isWithin150m
      ? 'JA (Innerhalb 150 m)'
      : 'NEIN (Weiter als 150 m)',
    detailText: isWithin150m
      ? 'Mindestens eine Haltestelle / S-Bahn-Station liegt höchstens 150 m vom Versteck entfernt.'
      : 'Keine ÖPNV-Haltestelle liegt im Umkreis von 150 m um das Versteck.',
    isPositiveHit: isWithin150m,
    overlayGeoJson: turf.featureCollection(bufferedStops),
    overlayStyle: 'TRANSIT_BUFFERS',
  };
}

/**
 * Hilfsfunktion: Prüft ob ein Punkt in einer Grünfläche oder maximal 20 m von ihrem Rand liegt.
 */
export function isPointInOrNearGreenPolygon(
  pt: LatLng,
  greenFeature: Feature<Polygon | MultiPolygon>,
  toleranceMeters = 20
): boolean {
  const turfPt = turf.point([pt.lng, pt.lat]);
  if (turf.booleanPointInPolygon(turfPt, greenFeature)) {
    return true;
  }
  const boundary = turf.polygonToLine(greenFeature);
  const flatLines = turf.flatten(boundary);
  return flatLines.features.some(
    (line) =>
      line.geometry.type === 'LineString' &&
      turf.pointToLineDistance(
        turfPt,
        line as Feature<GeoJSON.LineString>,
        { units: 'meters' }
      ) <= toleranceMeters
  );
}

/**
 * 2B: Park- & Grünflächen-Check (+3 Min.)
 */
export function evaluateOsmGreen(
  anchorPoint: LatLng,
  greenPolygons: Feature<Polygon | MultiPolygon>[],
  playArea: Feature<Polygon>
): EvaluatedClueResult {
  const inGreen = greenPolygons.some((poly) =>
    isPointInOrNearGreenPolygon(anchorPoint, poly, 20)
  );

  const visibleGreen: Feature[] = [];
  for (const poly of greenPolygons) {
    const clipped = safeClipWithPlayArea(poly, playArea);
    if (clipped) {
      visibleGreen.push(clipped);
    }
  }

  return {
    title: 'Grünflächen-Check',
    answerText: inGreen ? 'JA (In Grünfläche)' : 'NEIN (Außerhalb)',
    detailText: inGreen
      ? 'Das Versteck liegt in einem Park / Wald / Grünzug (inkl. 20 m Randtoleranz).'
      : 'Das Versteck liegt nicht in einer kartierten Grünfläche.',
    isPositiveHit: inGreen,
    overlayGeoJson: turf.featureCollection(visibleGreen),
    overlayStyle: 'GREEN_AREAS',
  };
}

/**
 * 3A: Radius-Radar (50 / 100 / 250 / 500 / 1000 m, +4 Min.)
 */
export function evaluateRadiusRadar(
  seekerOrigin: LatLng,
  radiusMeters: RadiusOptionMeters,
  anchorPoint: LatLng,
  playArea: Feature<Polygon>
): EvaluatedClueResult {
  const dist = distanceMeters(seekerOrigin, anchorPoint);
  const isInside = dist <= radiusMeters;
  const circle = turf.circle([seekerOrigin.lng, seekerOrigin.lat], radiusMeters, {
    units: 'meters',
    steps: 64,
  });
  const clipped = safeClipWithPlayArea(circle, playArea);

  return {
    title: `Radius-Radar (${radiusMeters} m)`,
    answerText: isInside ? 'TREFFER (Innerhalb)' : 'AUSSERHALB',
    detailText: isInside
      ? `Die Sardinen befinden sich innerhalb von ${radiusMeters} m um euren Anfrage-Standort.`
      : `Die Sardinen sind weiter als ${radiusMeters} m von eurem Anfrage-Standort entfernt.`,
    isPositiveHit: isInside,
    overlayGeoJson: clipped ? turf.featureCollection([clipped]) : turf.featureCollection([circle]),
    overlayStyle: isInside ? 'HIT_AREA' : 'EXCLUDED_AREA',
  };
}

/**
 * Klassifiziert eine Distanz in ein 200m-Donut-Band ohne exakten Meter-Leak.
 */
export function classifyDonutBand(distMeters: number): {
  label: DonutBandLabel;
  innerRadiusMeters: number;
  outerRadiusMeters: number | null;
} {
  if (distMeters < 200) {
    return { label: '0–200 m', innerRadiusMeters: 0, outerRadiusMeters: 200 };
  }
  if (distMeters < 400) {
    return { label: '200–400 m', innerRadiusMeters: 200, outerRadiusMeters: 400 };
  }
  if (distMeters < 600) {
    return { label: '400–600 m', innerRadiusMeters: 400, outerRadiusMeters: 600 };
  }
  if (distMeters < 800) {
    return { label: '600–800 m', innerRadiusMeters: 600, outerRadiusMeters: 800 };
  }
  if (distMeters < 1000) {
    return { label: '800–1000 m', innerRadiusMeters: 800, outerRadiusMeters: 1000 };
  }
  return { label: '1000 m+', innerRadiusMeters: 1000, outerRadiusMeters: null };
}

/**
 * 3B: Donut-Ring-Scanner (+4 Min. regulär bzw. 0 Min. als Timeout-/Ablehnungs-Ersatz)
 */
export function evaluateDonutRing(
  seekerOrigin: LatLng,
  anchorPoint: LatLng,
  playArea: Feature<Polygon>,
  isCompensation = false
): EvaluatedClueResult {
  const dist = distanceMeters(seekerOrigin, anchorPoint);
  const band = classifyDonutBand(dist);

  let bandGeometry: Feature<Polygon | MultiPolygon> | null = null;

  if (band.innerRadiusMeters === 0 && band.outerRadiusMeters !== null) {
    const fullCircle = turf.circle(
      [seekerOrigin.lng, seekerOrigin.lat],
      band.outerRadiusMeters,
      { units: 'meters', steps: 64 }
    );
    bandGeometry = safeClipWithPlayArea(fullCircle, playArea);
  } else if (band.outerRadiusMeters !== null) {
    const outerCircle = turf.circle(
      [seekerOrigin.lng, seekerOrigin.lat],
      band.outerRadiusMeters,
      { units: 'meters', steps: 64 }
    );
    const innerCircle = turf.circle(
      [seekerOrigin.lng, seekerOrigin.lat],
      band.innerRadiusMeters,
      { units: 'meters', steps: 64 }
    );
    // Echter Ring mit ausgestanztem Innenloch
    const ringPoly = turf.difference(
      turf.featureCollection([outerCircle, innerCircle])
    );
    if (ringPoly) {
      bandGeometry = safeClipWithPlayArea(ringPoly, playArea);
    }
  } else {
    // 1000 m+: Gesamtes Spielgebiet außerhalb des 1000m-Kreises
    const inner1000 = turf.circle([seekerOrigin.lng, seekerOrigin.lat], 1000, {
      units: 'meters',
      steps: 64,
    });
    bandGeometry = turf.difference(
      turf.featureCollection([playArea, inner1000])
    );
  }

  return {
    title: isCompensation
      ? 'Gratis-Donut-Ring (Ersatzhinweis)'
      : 'Donut-Ring-Scanner',
    answerText: `Distanzband: ${band.label}`,
    detailText: isCompensation
      ? `Kostenloser Ersatzhinweis wegen abgelaufener/abgelehnter Medienanfrage: Versteck liegt im Band ${band.label}.`
      : `Das Versteck liegt im Distanzring ${band.label} um euren Standort.`,
    isPositiveHit: true,
    overlayGeoJson: bandGeometry ? turf.featureCollection([bandGeometry]) : null,
    overlayStyle: 'RING_BAND',
  };
}

/**
 * Zentraler Dispatcher für alle deterministischen Geo-/OSM-Fragen (Kategorien 1–3).
 */
export function evaluateDeterministicQuestion(
  questionType: QuestionType,
  params: QuestionParams,
  seekerSnapshot: LatLng,
  anchorPoint: LatLng,
  playArea: Feature<Polygon>,
  osmData?: OsmEnvironmentData
): EvaluatedClueResult {
  switch (questionType) {
    case 'SPLIT_NS':
      return evaluateSplitNorthSouth(
        params.splitPoint ?? seekerSnapshot,
        anchorPoint,
        playArea
      );
    case 'SPLIT_EW':
      return evaluateSplitEastWest(
        params.splitPoint ?? seekerSnapshot,
        anchorPoint,
        playArea
      );
    case 'THERMOMETER':
      return evaluateThermometer(
        params.pointA ?? seekerSnapshot,
        params.pointB ?? seekerSnapshot,
        anchorPoint,
        playArea
      );
    case 'CONE_45':
      return evaluateCone45(
        seekerSnapshot,
        params.bearingDeg ?? 0,
        anchorPoint,
        playArea
      );
    case 'OSM_TRANSIT':
      return evaluateOsmTransit(
        anchorPoint,
        osmData?.transitStops ?? [],
        playArea
      );
    case 'OSM_GREEN':
      return evaluateOsmGreen(
        anchorPoint,
        osmData?.greenPolygons ?? [],
        playArea
      );
    case 'RADIUS_RADAR':
      return evaluateRadiusRadar(
        seekerSnapshot,
        params.radiusMeters ?? 250,
        anchorPoint,
        playArea
      );
    case 'DONUT_RING':
      return evaluateDonutRing(seekerSnapshot, anchorPoint, playArea, false);
    default:
      throw new Error(`Fragetyp ${questionType} ist keine deterministische Geo-Frage.`);
  }
}

/**
 * Erzeugt die Live-Kartenvorschau (GeoJSON) für jede mögliche Hinweis-Frage,
 * geclippt auf das 81247-Spielgebiet.
 */
export function buildQuestionPreviewGeoJson(
  questionType: QuestionType,
  params: QuestionParams,
  origin: LatLng | null,
  playArea: Feature<Polygon>
): FeatureCollection | Feature<Polygon | MultiPolygon> | null {
  const [minLng, minLat, maxLng, maxLat] = turf.bbox(playArea);
  const pad = 0.08;

  switch (questionType) {
    case 'SPLIT_NS': {
      if (!origin) return null;
      const northBox = turf.bboxPolygon([
        minLng - pad,
        origin.lat,
        maxLng + pad,
        maxLat + pad,
      ]);
      const clippedNorth = safeClipWithPlayArea(northBox, playArea);
      const dividerLine = turf.lineString(
        [
          [minLng - 0.01, origin.lat],
          [maxLng + 0.01, origin.lat],
        ],
        { role: 'divider' }
      );
      const features: Feature[] = [dividerLine];
      if (clippedNorth) features.push(clippedNorth);
      return turf.featureCollection(features);
    }

    case 'SPLIT_EW': {
      if (!origin) return null;
      const eastBox = turf.bboxPolygon([
        origin.lng,
        minLat - pad,
        maxLng + pad,
        maxLat + pad,
      ]);
      const clippedEast = safeClipWithPlayArea(eastBox, playArea);
      const dividerLine = turf.lineString(
        [
          [origin.lng, minLat - 0.01],
          [origin.lng, maxLat + 0.01],
        ],
        { role: 'divider' }
      );
      const features: Feature[] = [dividerLine];
      if (clippedEast) features.push(clippedEast);
      return turf.featureCollection(features);
    }

    case 'THERMOMETER': {
      const ptA = params.pointA ?? origin;
      const ptB = params.pointB ?? origin;
      if (!ptA) return null;
      if (!ptB || distanceMeters(ptA, ptB) < 5) {
        // Wenn nur Punkt A existiert: zeige 100m-Mindestlaufkreis um Punkt A
        const minWalkCircle = turf.circle([ptA.lng, ptA.lat], 100, {
          units: 'meters',
          steps: 48,
        });
        const clipped = safeClipWithPlayArea(minWalkCircle, playArea);
        return clipped ? turf.featureCollection([clipped]) : null;
      }

      const midLat = (ptA.lat + ptB.lat) / 2;
      const midLng = (ptA.lng + ptB.lng) / 2;
      const mPerLng = metersPerDegLngAt(midLat);
      const toLocalXY = (pt: LatLng): [number, number] => [
        (pt.lng - midLng) * mPerLng,
        (pt.lat - midLat) * METERS_PER_DEG_LAT,
      ];
      const toLatLngCoord = (x: number, y: number): [number, number] => [
        midLng + x / mPerLng,
        midLat + y / METERS_PER_DEG_LAT,
      ];

      const [ax, ay] = toLocalXY(ptA);
      const [bx, by] = toLocalXY(ptB);
      const vx = bx - ax;
      const vy = by - ay;
      const len = Math.hypot(vx, vy) || 1;
      const ux = vx / len;
      const uy = vy / len;
      const nx = -uy;
      const ny = ux;

      const span = 25_000;
      const p1 = toLatLngCoord(nx * span, ny * span);
      const p2 = toLatLngCoord(-nx * span, -ny * span);
      const p3 = toLatLngCoord(-nx * span + ux * span, -ny * span + uy * span);
      const p4 = toLatLngCoord(nx * span + ux * span, ny * span + uy * span);
      const warmerHalf = turf.polygon([[p1, p2, p3, p4, p1]]);
      const clippedWarmer = safeClipWithPlayArea(warmerHalf, playArea);

      const lineSpan = 6_000;
      const bisectorLine = turf.lineString(
        [
          toLatLngCoord(-nx * lineSpan, -ny * lineSpan),
          toLatLngCoord(nx * lineSpan, ny * lineSpan),
        ],
        { role: 'divider' }
      );
      const features: Feature[] = [bisectorLine];
      if (clippedWarmer) features.push(clippedWarmer);
      return turf.featureCollection(features);
    }

    case 'CONE_45': {
      if (!origin) return null;
      return buildCone45Polygon(origin, params.bearingDeg ?? 0, playArea);
    }

    case 'OSM_TRANSIT': {
      const features: Feature[] = [];
      for (const stop of FALLBACK_TRANSIT_STOPS_81247) {
        const circle = turf.circle([stop.lng, stop.lat], 150, {
          units: 'meters',
          steps: 28,
        });
        const clipped = safeClipWithPlayArea(circle, playArea);
        if (clipped) features.push(clipped);
      }
      return turf.featureCollection(features);
    }

    case 'RADIUS_RADAR': {
      if (!origin) return null;
      const r = params.radiusMeters ?? 250;
      const circle = turf.circle([origin.lng, origin.lat], r, {
        units: 'meters',
        steps: 64,
      });
      const clipped = safeClipWithPlayArea(circle, playArea);
      return clipped
        ? turf.featureCollection([clipped])
        : turf.featureCollection([circle]);
    }

    case 'DONUT_RING': {
      if (!origin) return null;
      const radii = [200, 400, 600, 800, 1000];
      const features: Feature[] = [];
      for (const r of radii) {
        const circlePoly = turf.circle([origin.lng, origin.lat], r, {
          units: 'meters',
          steps: 64,
        });
        const clipped = safeClipWithPlayArea(circlePoly, playArea);
        if (clipped) {
          const line = turf.polygonToLine(clipped);
          if (line.type === 'FeatureCollection') {
            features.push(...line.features);
          } else {
            features.push(line);
          }
        }
      }
      return turf.featureCollection(features);
    }

    case 'MEDIA_SKY':
    case 'MEDIA_GROUND':
    case 'MEDIA_AUDIO': {
      // Zeigt das gesamte aktive 81247-Suchgebiet als Hinweis-Zielbereich
      return turf.featureCollection([playArea]);
    }

    default:
      return null;
  }
}
