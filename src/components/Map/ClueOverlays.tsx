import L from 'leaflet';
import type { ClueOverlayStyle, ClueRecord } from '../../types/game';

function resolveStyleOptions(
  overlayStyle: ClueOverlayStyle | undefined,
  featureRole?: string
): L.PathOptions {
  if (featureRole === 'divider') {
    return {
      color: '#FF4D00',
      weight: 2.5,
      dashArray: '6, 6',
      fillOpacity: 0,
    };
  }

  switch (overlayStyle) {
    case 'EXCLUDED_AREA':
      return {
        color: '#FF4D00',
        weight: 2,
        dashArray: '6, 6',
        fillColor: '#FF4D00',
        fillOpacity: 0.13,
      };
    case 'HIT_AREA':
    case 'RING_BAND':
    case 'GREEN_AREAS':
      return {
        color: '#00A896',
        weight: 2,
        dashArray: '6, 6',
        fillColor: '#00A896',
        fillOpacity: 0.14,
      };
    case 'TRANSIT_BUFFERS':
      return {
        color: '#F0A500',
        weight: 2,
        dashArray: '6, 6',
        fillColor: '#F0A500',
        fillOpacity: 0.14,
      };
    default:
      return {
        color: '#00A896',
        weight: 2,
        dashArray: '6, 6',
        fillColor: '#00A896',
        fillOpacity: 0.14,
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

    geoLayer.bindTooltip(`${clue.title.toUpperCase()} // ${clue.answerText}`, {
      sticky: true,
      direction: 'top',
    });

    geoLayer.addTo(layerGroup);
  }
}
