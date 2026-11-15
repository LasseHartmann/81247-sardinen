import * as turf from '@turf/turf';
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Point,
  Polygon,
} from 'geojson';
import greenAreasGeoJson from './greenAreas81247.geojson';
import munichTransitAndRecyclingJson from './munichTransitAndRecycling.json';
import recyclingGeoJson from './recycling81247.geojson';
import transitStopsGeoJson from './transitStops81247.geojson';
import { DEFAULT_POSTAL_CODE, MUNICH_PLZ_LIST } from './gameConfig';
import { findMunichPlzAtPoint } from '../geo/boundary';
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

interface RawMunichTransitAndRecycling {
  transit: [number, number][];
  recycling: [number, number][];
}

const rawMunichData =
  munichTransitAndRecyclingJson as unknown as RawMunichTransitAndRecycling;

export const MUNICH_TRANSIT_LAT_LNGS: readonly LatLng[] = (
  rawMunichData.transit ?? []
).map(([lat, lng]) => ({ lat, lng }));

export const MUNICH_RECYCLING_LAT_LNGS: readonly LatLng[] = (
  rawMunichData.recycling ?? []
).map(([lat, lng]) => ({ lat, lng }));

const PLAY_AREA_OSM_BBOX_BUFFER_DEG = 0.0045; // ~400–500 m Puffer für 150m-Radius am Spielfeldrand

/**
 * Liefert alle Münchner ÖPNV-Haltestellen innerhalb (und bis ~450 m um) des aktuellen Spielfelds.
 */
export function getTransitLatLngsForPlayArea(
  playArea: Feature<Polygon | MultiPolygon>
): LatLng[] {
  try {
    const [minLng, minLat, maxLng, maxLat] = turf.bbox(playArea);
    const minLatBuf = minLat - PLAY_AREA_OSM_BBOX_BUFFER_DEG;
    const maxLatBuf = maxLat + PLAY_AREA_OSM_BBOX_BUFFER_DEG;
    const minLngBuf = minLng - PLAY_AREA_OSM_BBOX_BUFFER_DEG;
    const maxLngBuf = maxLng + PLAY_AREA_OSM_BBOX_BUFFER_DEG;

    const filtered = MUNICH_TRANSIT_LAT_LNGS.filter(
      (pt) =>
        pt.lat >= minLatBuf &&
        pt.lat <= maxLatBuf &&
        pt.lng >= minLngBuf &&
        pt.lng <= maxLngBuf
    );
    return filtered.length > 0 ? filtered : getFallbackTransitLatLngs81247();
  } catch {
    return getFallbackTransitLatLngs81247();
  }
}

/**
 * Liefert alle Münchner Wertstoffinseln innerhalb (und bis ~450 m um) des aktuellen Spielfelds.
 */
export function getRecyclingLatLngsForPlayArea(
  playArea: Feature<Polygon | MultiPolygon>
): LatLng[] {
  try {
    const [minLng, minLat, maxLng, maxLat] = turf.bbox(playArea);
    const minLatBuf = minLat - PLAY_AREA_OSM_BBOX_BUFFER_DEG;
    const maxLatBuf = maxLat + PLAY_AREA_OSM_BBOX_BUFFER_DEG;
    const minLngBuf = minLng - PLAY_AREA_OSM_BBOX_BUFFER_DEG;
    const maxLngBuf = maxLng + PLAY_AREA_OSM_BBOX_BUFFER_DEG;

    const filtered = MUNICH_RECYCLING_LAT_LNGS.filter(
      (pt) =>
        pt.lat >= minLatBuf &&
        pt.lat <= maxLatBuf &&
        pt.lng >= minLngBuf &&
        pt.lng <= maxLngBuf
    );
    return filtered.length > 0 ? filtered : getFallbackRecyclingLatLngs81247();
  } catch {
    return getFallbackRecyclingLatLngs81247();
  }
}

const greenPolygonsByPlzCache = new Map<
  string,
  Feature<Polygon | MultiPolygon>[]
>([[DEFAULT_POSTAL_CODE, FALLBACK_GREEN_POLYGONS_81247]]);

const inFlightGreenLoads = new Map<
  string,
  Promise<Feature<Polygon | MultiPolygon>[]>
>();

/**
 * Ermittelt die zum Spielfeld gehörende(n) Münchner PLZ(s).
 */
export function resolvePlayAreaPostalCodes(
  playArea: Feature<Polygon | MultiPolygon>,
  explicitPostalCode?: string | null
): string[] {
  const propPlz =
    explicitPostalCode?.trim() ||
    (typeof playArea?.properties?.postalCode === 'string'
      ? playArea.properties.postalCode.trim()
      : '');

  const codes = new Set<string>();
  if (propPlz && MUNICH_PLZ_LIST.some((p) => p.postalCode === propPlz)) {
    codes.add(propPlz);
  }

  try {
    const centerPt = turf.pointOnFeature(playArea);
    const detected = findMunichPlzAtPoint({
      lat: centerPt.geometry.coordinates[1],
      lng: centerPt.geometry.coordinates[0],
    });
    if (detected) {
      codes.add(detected);
    }
  } catch {
    // Ignorieren
  }

  if (codes.size === 0) {
    codes.add(DEFAULT_POSTAL_CODE);
  }
  return Array.from(codes);
}

/**
 * Lädt die vorab aufbereiteten Grünflächen einer Münchner PLZ aus `/osm-green/<plz>.json`
 * und legt sie im Speicher-Cache ab.
 */
export async function preloadGreenPolygonsForPostalCode(
  postalCode?: string | null
): Promise<Feature<Polygon | MultiPolygon>[]> {
  const code = postalCode?.trim() || DEFAULT_POSTAL_CODE;
  const cached = greenPolygonsByPlzCache.get(code);
  if (cached) {
    return cached;
  }

  const existingPromise = inFlightGreenLoads.get(code);
  if (existingPromise) {
    return existingPromise;
  }

  const loadPromise = (async (): Promise<Feature<Polygon | MultiPolygon>[]> => {
    try {
      if (typeof fetch !== 'function') {
        return FALLBACK_GREEN_POLYGONS_81247;
      }
      const res = await fetch(`/osm-green/${encodeURIComponent(code)}.json`);
      if (!res.ok) {
        return FALLBACK_GREEN_POLYGONS_81247;
      }
      const data = (await res.json()) as
        | Feature<Polygon | MultiPolygon>
        | FeatureCollection<Polygon | MultiPolygon>;
      let features: Feature<Polygon | MultiPolygon>[] = [];
      if (data?.type === 'FeatureCollection' && Array.isArray(data.features)) {
        features = data.features.filter(
          (f) =>
            f.geometry?.type === 'Polygon' ||
            f.geometry?.type === 'MultiPolygon'
        );
      } else if (
        data?.type === 'Feature' &&
        (data.geometry?.type === 'Polygon' ||
          data.geometry?.type === 'MultiPolygon')
      ) {
        features = [data];
      }
      if (features.length > 0) {
        greenPolygonsByPlzCache.set(code, features);
        return features;
      }
    } catch {
      // Offline oder Testumgebung ohne HTTP-Server -> Fallback
    }
    return FALLBACK_GREEN_POLYGONS_81247;
  })();

  inFlightGreenLoads.set(code, loadPromise);
  try {
    return await loadPromise;
  } finally {
    inFlightGreenLoads.delete(code);
  }
}

/**
 * Liefert synchron die bereits geladenen Grünflächen für ein Spielfeld
 * (und stößt im Hintergrund das Nachladen an, falls die PLZ noch nicht im Cache liegt).
 */
export function getLoadedGreenPolygonsForPlayArea(
  playArea: Feature<Polygon | MultiPolygon>,
  explicitPostalCode?: string | null
): Feature<Polygon | MultiPolygon>[] {
  const codes = resolvePlayAreaPostalCodes(playArea, explicitPostalCode);
  const collected: Feature<Polygon | MultiPolygon>[] = [];
  for (const code of codes) {
    const cached = greenPolygonsByPlzCache.get(code);
    if (cached) {
      collected.push(...cached);
    } else {
      void preloadGreenPolygonsForPostalCode(code);
    }
  }
  return collected.length > 0 ? collected : FALLBACK_GREEN_POLYGONS_81247;
}
