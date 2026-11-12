import * as turf from '@turf/turf';
import type { LatLng } from '../types/game';

/**
 * Geodätische Haversine-Distanz auf der Kugel (Turf-kompatibler Erdradius 6.371.008,8 m).
 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  return turf.distance([a.lng, a.lat], [b.lng, b.lat], { units: 'meters' });
}

/**
 * Berechnet einen geodätischen Zielpunkt von `origin` in Distanz `distMeters` und Peilung `bearingDeg`.
 */
export function destinationPoint(
  origin: LatLng,
  distMeters: number,
  bearingDeg: number
): LatLng {
  if (distMeters <= 0) {
    return { lat: origin.lat, lng: origin.lng };
  }
  const dest = turf.destination(
    [origin.lng, origin.lat],
    distMeters,
    bearingDeg,
    { units: 'meters' }
  );
  const [lng, lat] = dest.geometry.coordinates;
  return { lat, lng };
}

/**
 * Geodätisches Anfangsazimut im Bereich [0°, 360°) (0° = Norden, im Uhrzeigersinn).
 */
export function bearingDegrees(from: LatLng, to: LatLng): number {
  const raw = turf.bearing([from.lng, from.lat], [to.lng, to.lat]);
  return ((raw % 360) + 360) % 360;
}

/**
 * Kleinste Winkeldifferenz in [0°, 180°] unter exakter Behandlung des 360°/0°-Nulldurchgangs.
 */
export function smallestAngleDiffDeg(alphaDeg: number, betaDeg: number): number {
  const normalized = ((((alphaDeg - betaDeg) % 360) + 540) % 360) - 180;
  return Math.abs(normalized);
}

/**
 * Rundet GPS-Koordinaten auf 5 Nachkommastellen (~1,1 m Präzision) zur Payload-Schonung.
 */
export function roundCoord5(value: number): number {
  return Math.round(value * 1e5) / 1e5;
}

export function roundLatLng5(pt: LatLng): LatLng {
  return {
    lat: roundCoord5(pt.lat),
    lng: roundCoord5(pt.lng),
  };
}
