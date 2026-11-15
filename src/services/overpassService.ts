import type { Feature, MultiPolygon, Polygon } from 'geojson';
import {
  FALLBACK_GREEN_POLYGONS_81247,
  getFallbackRecyclingLatLngs81247,
  getFallbackTransitLatLngs81247,
  getLoadedGreenPolygonsForPlayArea,
  getRecyclingLatLngsForPlayArea,
  getTransitLatLngsForPlayArea,
  preloadGreenPolygonsForPostalCode,
  resolvePlayAreaPostalCodes,
} from '../config/fallbackOsm81247';
import type { OsmEnvironmentData } from '../geo/clueGeometry';

export function getCuratedFallbackOsmData(
  playArea?: Feature<Polygon | MultiPolygon> | null
): OsmEnvironmentData {
  if (!playArea) {
    return {
      transitStops: getFallbackTransitLatLngs81247(),
      recyclingPoints: getFallbackRecyclingLatLngs81247(),
      greenPolygons: structuredClone(FALLBACK_GREEN_POLYGONS_81247),
      usedOfflineFallback: true,
    };
  }
  return {
    transitStops: getTransitLatLngsForPlayArea(playArea),
    recyclingPoints: getRecyclingLatLngsForPlayArea(playArea),
    greenPolygons: structuredClone(getLoadedGreenPolygonsForPlayArea(playArea)),
    usedOfflineFallback: true,
  };
}

/**
 * Liefert die offiziellen Münchner Umgebungsdaten (ÖPNV-Haltestellen, Wertstoffinseln,
 * Grünflächen) passend zum gewählten PLZ-/Kreis-Spielfeld.
 */
export async function fetchOsmEnvironment81247(
  playArea: Feature<Polygon | MultiPolygon>,
  options?: { forceOffline?: boolean; postalCode?: string | readonly string[] }
): Promise<OsmEnvironmentData> {
  const postalCodes = resolvePlayAreaPostalCodes(
    playArea,
    options?.postalCode
  );
  await Promise.all(
    postalCodes.map((code) => preloadGreenPolygonsForPostalCode(code))
  );
  const greenPolygons = getLoadedGreenPolygonsForPlayArea(
    playArea,
    options?.postalCode
  );

  return {
    transitStops: getTransitLatLngsForPlayArea(playArea),
    recyclingPoints: getRecyclingLatLngsForPlayArea(playArea),
    greenPolygons: structuredClone(greenPolygons),
    usedOfflineFallback: Boolean(options?.forceOffline),
  };
}
