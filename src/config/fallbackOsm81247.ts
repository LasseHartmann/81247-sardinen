import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Point,
  Polygon,
} from 'geojson';
import greenAreasGeoJson from './greenAreas81247.geojson';
import recyclingGeoJson from './recycling81247.geojson';
import transitStopsGeoJson from './transitStops81247.geojson';
import type { LatLng } from '../types/game';

export interface CuratedTransitStop {
  id: string;
  name: string;
  kind: 'S-Bahn' | 'Bus';
  lat: number;
  lng: number;
}

export interface CuratedRecyclingStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface TransitStopProperties {
  '@id'?: string;
  name?: string;
  railway?: string;
  highway?: string;
}

interface RecyclingProperties {
  '@id'?: string;
  name?: string;
}

const rawTransitCollection =
  transitStopsGeoJson as unknown as FeatureCollection<Point, TransitStopProperties>;

const rawRecyclingCollection =
  recyclingGeoJson as unknown as FeatureCollection<Point, RecyclingProperties>;

const rawGreenCollection =
  greenAreasGeoJson as unknown as FeatureCollection<Polygon | MultiPolygon>;

/**
 * Vollständiger Satz aller 45 Overpass-ÖPNV-Haltestellen in & direkt an 81247 München
 * (Bussteige + S-Bahnhof Obermenzing aus export.geojson).
 */
export const FALLBACK_TRANSIT_STOPS_81247: CuratedTransitStop[] = (
  rawTransitCollection.features ?? []
)
  .filter((f) => f.geometry?.type === 'Point' && f.geometry.coordinates.length >= 2)
  .map((f, idx) => {
    const [lng, lat] = f.geometry.coordinates;
    const props = f.properties ?? {};
    const kind: 'S-Bahn' | 'Bus' = props.railway ? 'S-Bahn' : 'Bus';
    const baseName = props.name?.trim() || `Haltestelle ${idx + 1}`;
    return {
      id: String(f.id ?? props['@id'] ?? `stop-${idx + 1}`),
      name: baseName,
      kind,
      lat,
      lng,
    };
  });

/**
 * Vollständiger Satz aller 14 Wertstoffinseln in & direkt an 81247 München
 * (aus wertstoffinseln.geojson).
 */
export const FALLBACK_RECYCLING_STATIONS_81247: CuratedRecyclingStation[] = (
  rawRecyclingCollection.features ?? []
)
  .filter((f) => f.geometry?.type === 'Point' && f.geometry.coordinates.length >= 2)
  .map((f, idx) => {
    const [lng, lat] = f.geometry.coordinates;
    const props = f.properties ?? {};
    return {
      id: String(f.id ?? props['@id'] ?? `recycling-${idx + 1}`),
      name: props.name?.trim() || `Wertstoffinsel ${idx + 1}`,
      lat,
      lng,
    };
  });

/**
 * Vollständiger Satz aller Grünflächen & Parks in 81247 München
 * (aus grünfläche.geojson, vorab vereinigt und auf 81247 zugeschnitten).
 */
export const FALLBACK_GREEN_POLYGONS_81247: Feature<Polygon | MultiPolygon>[] = (
  rawGreenCollection.features ?? []
).filter(
  (f) =>
    f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'
);

export function getFallbackTransitLatLngs81247(): LatLng[] {
  return FALLBACK_TRANSIT_STOPS_81247.map((s) => ({ lat: s.lat, lng: s.lng }));
}

export function getFallbackRecyclingLatLngs81247(): LatLng[] {
  return FALLBACK_RECYCLING_STATIONS_81247.map((s) => ({
    lat: s.lat,
    lng: s.lng,
  }));
}
