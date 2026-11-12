import * as turf from '@turf/turf';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import {
  FALLBACK_GREEN_POLYGONS_81247,
  getFallbackTransitLatLngs81247,
} from '../config/fallbackOsm81247';
import type { OsmEnvironmentData } from '../geo/clueGeometry';
import type { LatLng } from '../types/game';

const OSM_CACHE_KEY = 'sardinen_81247_osm_cache_v1';
const OSM_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 Stunden
const OVERPASS_TIMEOUT_MS = 6_000; // 6 Sekunden Schutzlimit
const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

interface CachedOsmPayload {
  version: 1;
  savedAt: number;
  transitStops: LatLng[];
  greenPolygons: Feature<Polygon | MultiPolygon>[];
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}

function readValidCache(nowMs = Date.now()): OsmEnvironmentData | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(OSM_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedOsmPayload;
    if (
      parsed.version !== 1 ||
      typeof parsed.savedAt !== 'number' ||
      nowMs - parsed.savedAt > OSM_CACHE_TTL_MS ||
      !Array.isArray(parsed.transitStops) ||
      !Array.isArray(parsed.greenPolygons)
    ) {
      return null;
    }
    return {
      transitStops: parsed.transitStops,
      greenPolygons: parsed.greenPolygons,
      usedOfflineFallback: false,
    };
  } catch {
    return null;
  }
}

function writeCache(
  transitStops: LatLng[],
  greenPolygons: Feature<Polygon | MultiPolygon>[]
): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const payload: CachedOsmPayload = {
      version: 1,
      savedAt: Date.now(),
      transitStops,
      greenPolygons,
    };
    localStorage.setItem(OSM_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Speicherlimit-Fehler stillschweigend ignorieren
  }
}

export function getCuratedFallbackOsmData(): OsmEnvironmentData {
  return {
    transitStops: getFallbackTransitLatLngs81247(),
    greenPolygons: structuredClone(FALLBACK_GREEN_POLYGONS_81247),
    usedOfflineFallback: true,
  };
}

/**
 * Lädt ÖPNV-Haltestellen und Grünflächen im/am 81247-Spielgebiet aus dem 24h-Cache
 * oder live über die Overpass API (6s Timeout) mit nahtlosem Fallback auf echte 81247-Ortsdaten.
 */
export async function fetchOsmEnvironment81247(
  playArea: Feature<Polygon>,
  options?: { forceOffline?: boolean }
): Promise<OsmEnvironmentData> {
  if (options?.forceOffline) {
    return getCuratedFallbackOsmData();
  }

  const cached = readValidCache();
  if (cached) {
    return cached;
  }

  if (typeof fetch === 'undefined') {
    return getCuratedFallbackOsmData();
  }

  const [minLng, minLat, maxLng, maxLat] = turf.bbox(playArea);
  // Leicht erweiterte BBox (+ ~250 m), damit 150m-ÖPNV-Ränder am Spielfeldrand erfasst werden
  const south = (minLat - 0.0025).toFixed(5);
  const west = (minLng - 0.0035).toFixed(5);
  const north = (maxLat + 0.0025).toFixed(5);
  const east = (maxLng + 0.0035).toFixed(5);
  const bboxStr = `${south},${west},${north},${east}`;

  const query = `
[out:json][timeout:5];
(
  node["highway"="bus_stop"](${bboxStr});
  node["railway"~"^(station|tram_stop|subway_entrance)$"](${bboxStr});
  way["leisure"~"^(park|garden)$"](${bboxStr});
  way["landuse"~"^(forest|grass)$"](${bboxStr});
);
out body geom;
`.trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);

  try {
    const response = await fetch(OVERPASS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: controller.signal,
    });

    if (!response.ok) {
      return getCuratedFallbackOsmData();
    }

    const json = (await response.json()) as { elements?: OverpassElement[] };
    const elements = json.elements ?? [];

    const transitStops: LatLng[] = [];
    const greenPolygons: Feature<Polygon | MultiPolygon>[] = [];

    for (const el of elements) {
      const tags = el.tags ?? {};
      const isTransit =
        tags.highway === 'bus_stop' ||
        tags.railway === 'station' ||
        tags.railway === 'tram_stop' ||
        tags.railway === 'subway_entrance';

      if (isTransit) {
        const lat = el.lat ?? el.center?.lat;
        const lng = el.lon ?? el.center?.lon;
        if (typeof lat === 'number' && typeof lng === 'number') {
          transitStops.push({ lat, lng });
        }
        continue;
      }

      const isGreen =
        tags.leisure === 'park' ||
        tags.leisure === 'garden' ||
        tags.landuse === 'forest' ||
        tags.landuse === 'grass';

      if (isGreen && Array.isArray(el.geometry) && el.geometry.length >= 4) {
        const ring: [number, number][] = el.geometry.map((pt) => [
          pt.lon,
          pt.lat,
        ]);
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          ring.push([first[0], first[1]]);
        }
        if (ring.length >= 4) {
          greenPolygons.push(
            turf.polygon([ring], {
              id: `osm_${el.id}`,
              name: tags.name ?? 'Grünfläche',
            })
          );
        }
      }
    }

    if (transitStops.length === 0 && greenPolygons.length === 0) {
      return getCuratedFallbackOsmData();
    }

    // Falls Overpass nur Teilmengen liefert, ergänze fehlende Kategorie aus 81247-Basisdaten
    const finalTransit =
      transitStops.length > 0 ? transitStops : getFallbackTransitLatLngs81247();
    const finalGreen =
      greenPolygons.length > 0
        ? greenPolygons
        : structuredClone(FALLBACK_GREEN_POLYGONS_81247);

    writeCache(finalTransit, finalGreen);
    return {
      transitStops: finalTransit,
      greenPolygons: finalGreen,
      usedOfflineFallback: false,
    };
  } catch {
    return getCuratedFallbackOsmData();
  } finally {
    clearTimeout(timeoutId);
  }
}
