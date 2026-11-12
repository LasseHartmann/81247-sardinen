import L from 'leaflet';
import type { ClueOverlayStyle, ClueRecord } from '../../types/game';

function resolveStyleOptions(
  overlayStyle: ClueOverlayStyle | undefined,
  featureRole?: string
): L.PathOptions {
  if (featureRole === 'divider') {
    return {
      color: '#f43f5e',
      weight: 3,
      dashArray: '8 6',
      fillOpacity: 0,
    };
  }

  switch (overlayStyle) {
    case 'EXCLUDED_AREA':
      return {
        color: '#f43f5e',
        weight: 2,
        fillColor: '#f43f5e',
        fillOpacity: 0.24,
      };
    case 'HIT_AREA':
      return {
        color: '#10b981',
        weight: 2.5,
        fillColor: '#10b981',
        fillOpacity: 0.22,
      };
    case 'RING_BAND':
      return {
        color: '#06b6d4',
        weight: 2.5,
        fillColor: '#06b6d4',
        fillOpacity: 0.2,
      };
    case 'TRANSIT_BUFFERS':
      return {
        color: '#38bdf8',
        weight: 1.8,
        dashArray: '4 4',
        fillColor: '#38bdf8',
        fillOpacity: 0.16,
      };
    case 'GREEN_AREAS':
      return {
        color: '#22c55e',
        weight: 2,
        fillColor: '#22c55e',
        fillOpacity: 0.22,
      };
    default:
      return {
        color: '#f59e0b',
        weight: 2,
        fillColor: '#f59e0b',
        fillOpacity: 0.18,
      };
  }
}

/**
 * Synchronisiert alle sichtbaren GeoJSON-Hinweis-Overlays auf eine Leaflet-LayerGroup.
 */
export function syncClueOverlaysToLayerGroup(
  layerGroup: L.LayerGroup,
  clues: ClueRecord[],
  hiddenClueIds: Set<string>
): void {
  layerGroup.clearLayers();

  for (const clue of clues) {
    if (hiddenClueIds.has(clue.id) || !clue.overlayGeoJson) {
      continue;
    }

    const geoLayer = L.geoJSON(clue.overlayGeoJson, {
      style: (feature) =>
        resolveStyleOptions(
          clue.overlayStyle,
          feature?.properties?.role as string | undefined
        ),
    });

    geoLayer.bindTooltip(`${clue.title}: ${clue.answerText}`, {
      sticky: true,
      direction: 'top',
    });

    geoLayer.addTo(layerGroup);
  }
}
