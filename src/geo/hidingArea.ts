import * as turf from '@turf/turf';
import type {
  Feature,
  FeatureCollection,
  Geometry,
  MultiPolygon,
  Polygon,
  Position,
} from 'geojson';
import type { ClueRecord, PublishedRadarCircle } from '../types/game';

const WORLD_OUTER_RING: Position[] = [
  [-180, -85],
  [180, -85],
  [180, 85],
  [-180, 85],
  [-180, -85],
];

function extractPolygonsFromGeometry(
  geom: Geometry | null | undefined,
  out: Feature<Polygon | MultiPolygon>[]
): void {
  if (!geom) return;
  if (geom.type === 'Polygon') {
    out.push(turf.polygon(geom.coordinates));
  } else if (geom.type === 'MultiPolygon') {
    out.push(turf.multiPolygon(geom.coordinates));
  } else if (geom.type === 'GeometryCollection') {
    for (const sub of geom.geometries) {
      extractPolygonsFromGeometry(sub, out);
    }
  }
}

export function extractPolygons(
  geojson: FeatureCollection | Feature | null | undefined
): Feature<Polygon | MultiPolygon>[] {
  if (!geojson) return [];
  const out: Feature<Polygon | MultiPolygon>[] = [];
  if (geojson.type === 'FeatureCollection') {
    for (const f of geojson.features) {
      extractPolygonsFromGeometry(f?.geometry, out);
    }
  } else if (geojson.type === 'Feature') {
    extractPolygonsFromGeometry(geojson.geometry, out);
  }
  return out;
}

/**
 * Entfernt numerische Mikro-Artefakte (< minAreaSqMeters) nach Booleschen Polygon-Operationen,
 * damit auf der Karte niemals dünne Restlinien an gemeinsamen Polygonkanten stehen bleiben.
 */
function pruneMicroSlivers(
  feature: Feature<Polygon | MultiPolygon> | null,
  minAreaSqMeters = 2
): Feature<Polygon | MultiPolygon> | null {
  if (!feature) return null;
  const geom = feature.geometry;

  if (geom.type === 'Polygon') {
    return turf.area(feature) >= minAreaSqMeters ? feature : null;
  }

  if (geom.type === 'MultiPolygon') {
    const validParts: Position[][][] = [];
    for (const polyCoords of geom.coordinates) {
      const single = turf.polygon(polyCoords);
      if (turf.area(single) >= minAreaSqMeters) {
        validParts.push(polyCoords);
      }
    }
    if (validParts.length === 0) return null;
    if (validParts.length === 1) return turf.polygon(validParts[0]);
    return turf.multiPolygon(validParts);
  }

  return null;
}

function safeIntersect(
  a: Feature<Polygon | MultiPolygon>,
  b: Feature<Polygon | MultiPolygon>
): Feature<Polygon | MultiPolygon> | null {
  try {
    const res = turf.intersect(turf.featureCollection([a, b]));
    return pruneMicroSlivers(res);
  } catch {
    return a;
  }
}

function safeDifference(
  a: Feature<Polygon | MultiPolygon>,
  excluded: Feature<Polygon | MultiPolygon>
): Feature<Polygon | MultiPolygon> | null {
  try {
    // 0,2 m Puffer eliminiert Gleitkomma-Haarlinien entlang identischer Außenkanten des 81247-Polygons
    const slightlyBuffered = turf.buffer(excluded, 0.2, { units: 'meters' });
    const subtrahend =
      slightlyBuffered &&
      (slightlyBuffered.geometry.type === 'Polygon' ||
        slightlyBuffered.geometry.type === 'MultiPolygon')
        ? (slightlyBuffered as Feature<Polygon | MultiPolygon>)
        : excluded;
    const res = turf.difference(turf.featureCollection([a, subtrahend]));
    return pruneMicroSlivers(res);
  } catch {
    try {
      const fallback = turf.difference(turf.featureCollection([a, excluded]));
      return pruneMicroSlivers(fallback);
    } catch {
      return a;
    }
  }
}

function safeUnionAll(
  polys: Feature<Polygon | MultiPolygon>[]
): Feature<Polygon | MultiPolygon> | null {
  if (polys.length === 0) return null;
  if (polys.length === 1) return polys[0];
  try {
    const united = turf.union(turf.featureCollection(polys));
    return pruneMicroSlivers(united);
  } catch {
    let acc: Feature<Polygon | MultiPolygon> = polys[0];
    for (let i = 1; i < polys.length; i++) {
      try {
        const next = turf.union(turf.featureCollection([acc, polys[i]]));
        if (next) acc = next;
      } catch {
        // Einzelnes defektes Teilpolygon überspringen
      }
    }
    return pruneMicroSlivers(acc);
  }
}

/**
 * Berechnet den exakt verbleibenden möglichen Versteckbereich aus:
 * - dem 81247-Spielgebiet (`playArea`),
 * - dem öffentlichen Schrumpf-Radar (`publishedRadar`),
 * - allen sichtbaren Hinweisen (`clues` ohne `hiddenClueIds`).
 *
 * Dadurch entstehen keinerlei überlappende Einzellinien auf der Karte:
 * Es existiert nur noch die saubere Grenze des verbleibenden Suchbereichs.
 */
export function computePossibleHidingArea(params: {
  playArea: Feature<Polygon>;
  clues: ClueRecord[];
  hiddenClueIds: Set<string>;
  publishedRadar: PublishedRadarCircle | null;
}): Feature<Polygon | MultiPolygon> | null {
  const { playArea, clues, hiddenClueIds, publishedRadar } = params;
  let current: Feature<Polygon | MultiPolygon> | null = playArea;

  if (publishedRadar && current) {
    const radarPoly = turf.circle(
      [publishedRadar.center.lng, publishedRadar.center.lat],
      publishedRadar.radiusMeters,
      { units: 'meters', steps: 96 }
    );
    current = safeIntersect(current, radarPoly);
  }

  for (const clue of clues) {
    if (!current) break;
    if (hiddenClueIds.has(clue.id) || !clue.overlayGeoJson) continue;

    const polys = extractPolygons(clue.overlayGeoJson);
    if (polys.length === 0) continue;

    if (
      clue.overlayStyle === 'EXCLUDED_AREA' ||
      ((clue.overlayStyle === 'TRANSIT_BUFFERS' ||
        clue.overlayStyle === 'GREEN_AREAS') &&
        !clue.isPositiveHit)
    ) {
      for (const exPoly of polys) {
        if (!current) break;
        current = safeDifference(current, exPoly);
      }
    } else if (
      clue.overlayStyle === 'HIT_AREA' ||
      clue.overlayStyle === 'RING_BAND'
    ) {
      const hitUnion = safeUnionAll(polys);
      if (hitUnion) {
        current = safeIntersect(current, hitUnion);
      }
    } else if (
      (clue.overlayStyle === 'TRANSIT_BUFFERS' ||
        clue.overlayStyle === 'GREEN_AREAS') &&
      clue.isPositiveHit
    ) {
      const bufferUnion = safeUnionAll(polys);
      if (bufferUnion) {
        current = safeIntersect(current, bufferUnion);
      }
    }
  }

  return current;
}

/**
 * Erzeugt die einheitliche Außenmaske („der Rest“ außerhalb des möglichen Versteckbereichs),
 * die auf der Karte flächig orange eingefärbt wird — ohne doppelte Überlappungen oder Hilfslinien.
 */
export function buildExcludedOrangeMask(
  possibleHidingArea: Feature<Polygon | MultiPolygon> | null
): Feature<Polygon | MultiPolygon> {
  const worldPoly = turf.polygon([WORLD_OUTER_RING]);
  if (!possibleHidingArea) {
    return worldPoly;
  }
  try {
    const diff = turf.difference(
      turf.featureCollection([worldPoly, possibleHidingArea])
    );
    return diff ?? worldPoly;
  } catch {
    return worldPoly;
  }
}
