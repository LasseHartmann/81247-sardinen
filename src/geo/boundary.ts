import * as turf from '@turf/turf';
import type { Feature, Polygon } from 'geojson';
import { DEFAULT_PLAY_AREA_FEATURE } from '../config/gameConfig';
import type { LatLng } from '../types/game';
import { distanceMeters } from './distance';

/**
 * Prüft, ob ein Punkt innerhalb oder auf dem Rand des offiziellen 81247-Gebiets liegt.
 */
export function isPointInOfficial81247(pt: LatLng): boolean {
  return isPointInPlayArea(pt, DEFAULT_PLAY_AREA_FEATURE);
}

/**
 * Zieht einen Punkt bei Bedarf in das offizielle 81247-Gebiet hinein.
 */
export function snapPointIntoOfficial81247(pt: LatLng): LatLng {
  return snapPointIntoPlayArea(pt, DEFAULT_PLAY_AREA_FEATURE);
}

/**
 * Prüft, ob ein Punkt innerhalb oder auf dem Rand des bestätigten Spielpolygons liegt.
 */
export function isPointInPlayArea(pt: LatLng, playArea: Feature<Polygon>): boolean {
  return turf.booleanPointInPolygon([pt.lng, pt.lat], playArea, {
    ignoreBoundary: false,
  });
}

/**
 * Prüft ein Spielgebiets-Polygon auf geometrische Wohlgeformtheit:
 * - mindestens 3 eindeutige Eckpunkte (Ringlänge >= 4)
 * - keine Selbstüberschneidungen (kinks === 0)
 * - Mindestfläche >= 10.000 m²
 */
export function isValidPlayAreaPolygon(playArea: Feature<Polygon>): {
  valid: boolean;
  reason?: string;
} {
  try {
    const coords = playArea?.geometry?.coordinates?.[0];
    if (!coords || coords.length < 4) {
      return {
        valid: false,
        reason: 'Das Spielgebiet benötigt mindestens 3 Eckpunkte.',
      };
    }
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      return {
        valid: false,
        reason: 'Der Polygon-Ring muss geschlossen sein.',
      };
    }
    const kinks = turf.kinks(playArea);
    if (kinks.features.length > 0) {
      return {
        valid: false,
        reason: 'Das Polygon darf sich nicht selbst überschneiden.',
      };
    }
    const areaSqM = turf.area(playArea);
    if (!Number.isFinite(areaSqM) || areaSqM < 10_000) {
      return {
        valid: false,
        reason: 'Das Spielgebiet ist zu klein (mindestens 10.000 m²).',
      };
    }
    return { valid: true };
  } catch {
    return {
      valid: false,
      reason: 'Ungültige Polygon-Geometrie.',
    };
  }
}

/**
 * Erzeugt ein Polygon aus einer Liste von [lat, lng]-Eckpunkten.
 */
export function buildPolygonFromVertices(vertices: LatLng[]): Feature<Polygon> {
  const ring = vertices.map((v) => [v.lng, v.lat]);
  if (
    ring.length > 0 &&
    (ring[0][0] !== ring[ring.length - 1][0] ||
      ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  return turf.polygon([ring], {
    name: '81247 Spielgebiet',
  });
}

/**
 * Extrahiert die offenen Eckpunkte (ohne duplizierten Schlusspunkt) aus einem Polygon.
 */
export function extractPolygonVertices(playArea: Feature<Polygon>): LatLng[] {
  const ring = playArea.geometry.coordinates[0] ?? [];
  if (ring.length <= 1) return [];
  return ring.slice(0, -1).map(([lng, lat]) => ({ lat, lng }));
}

/**
 * Erzeugt eine invertierte Weltmaske (Außenring Welt, Innenring = Spielpolygon)
 * für die abgedunkelte Kartendarstellung außerhalb von 81247.
 */
export function buildInvertedWorldMask(playArea: Feature<Polygon>): Feature<Polygon> {
  const outerWorldRing: [number, number][] = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];
  const innerHole = playArea.geometry.coordinates[0] as [number, number][];
  return turf.polygon([outerWorldRing, innerHole], {
    role: 'world-mask',
  });
}

/**
 * Findet bei einem Punkt außerhalb des Spielpolygons einen nahen gültigen Punkt im Inneren
 * (oder gibt den Punkt unverändert zurück, falls er bereits im Polygon liegt).
 */
export function snapPointIntoPlayArea(
  pt: LatLng,
  playArea: Feature<Polygon>
): LatLng {
  if (isPointInPlayArea(pt, playArea)) {
    return pt;
  }
  const line = turf.polygonToLine(playArea);
  const nearest =
    line.type === 'FeatureCollection'
      ? turf.nearestPointOnLine(line.features[0], [pt.lng, pt.lat])
      : turf.nearestPointOnLine(line, [pt.lng, pt.lat]);
  const center = turf.pointOnFeature(playArea);
  // 2 % Richtung innerer Referenzpunkt verschieben, damit der Punkt sicher im Polygon liegt
  const lng =
    nearest.geometry.coordinates[0] * 0.98 +
    center.geometry.coordinates[0] * 0.02;
  const lat =
    nearest.geometry.coordinates[1] * 0.98 +
    center.geometry.coordinates[1] * 0.02;
  if (isPointInPlayArea({ lat, lng }, playArea)) {
    return { lat, lng };
  }
  return {
    lat: center.geometry.coordinates[1],
    lng: center.geometry.coordinates[0],
  };
}

/**
 * Validiert eine manuell gewählte Versteck-Position der Verstecker:
 * 1. Muss innerhalb des 81247-Spielgebiets liegen.
 * 2. Ein aktuelles GPS-Signal der Person muss vorliegen.
 * 3. Muss innerhalb von `maxDistanceMeters` (Standard: 50 m) um die aktuelle GPS-Position liegen.
 */
export function validateManualAnchorSelection(params: {
  candidate: LatLng;
  gpsPosition: LatLng | null;
  playArea: Feature<Polygon>;
  maxDistanceMeters: number;
}): { valid: true; distanceMeters: number } | { valid: false; reason: string; distanceMeters?: number } {
  const { candidate, gpsPosition, playArea, maxDistanceMeters } = params;

  if (!isPointInPlayArea(candidate, playArea)) {
    return {
      valid: false,
      reason: 'Bitte tippe auf einen Punkt innerhalb der markierten 81247-Zone!',
    };
  }

  if (!gpsPosition) {
    return {
      valid: false,
      reason: `Kein eigener GPS-Standort verfügbar. Die genauere Position darf nur innerhalb von ${maxDistanceMeters} m um dein GPS gewählt werden.`,
    };
  }

  const dist = distanceMeters(gpsPosition, candidate);
  if (dist > maxDistanceMeters) {
    return {
      valid: false,
      distanceMeters: dist,
      reason: `Zu weit entfernt (${Math.round(dist)} m): Die genauere Versteck-Position darf maximal ${maxDistanceMeters} m von deinem aktuellen GPS-Standort entfernt liegen.`,
    };
  }

  return { valid: true, distanceMeters: dist };
}
