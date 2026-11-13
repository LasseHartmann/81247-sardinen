import type { Feature, Polygon } from 'geojson';
import {
  FALLBACK_GREEN_POLYGONS_81247,
  getFallbackRecyclingLatLngs81247,
  getFallbackTransitLatLngs81247,
} from '../config/fallbackOsm81247';
import type { OsmEnvironmentData } from '../geo/clueGeometry';

export function getCuratedFallbackOsmData(): OsmEnvironmentData {
  return {
    transitStops: getFallbackTransitLatLngs81247(),
    recyclingPoints: getFallbackRecyclingLatLngs81247(),
    greenPolygons: structuredClone(FALLBACK_GREEN_POLYGONS_81247),
    usedOfflineFallback: true,
  };
}

/**
 * Liefert die offiziellen 81247-Umgebungsdaten (45 Haltestellen, 14 Wertstoffinseln,
 * alle 81247-Grünflächen) sofort deterministisch ohne externe Netzwerk-Wartezeit.
 */
export async function fetchOsmEnvironment81247(
  _playArea: Feature<Polygon>,
  options?: { forceOffline?: boolean }
): Promise<OsmEnvironmentData> {
  return {
    transitStops: getFallbackTransitLatLngs81247(),
    recyclingPoints: getFallbackRecyclingLatLngs81247(),
    greenPolygons: structuredClone(FALLBACK_GREEN_POLYGONS_81247),
    usedOfflineFallback: Boolean(options?.forceOffline),
  };
}
