import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import {
  LEASH_RADIUS_METERS,
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_ZOOM,
} from '../../config/gameConfig';
import { buildInvertedWorldMask } from '../../geo/boundary';
import type {
  AnchorPoint,
  ClueRecord,
  GeoFix,
  LatLng,
  PublishedRadarCircle,
  TeamLocation,
  TeamPublic,
} from '../../types/game';
import { syncClueOverlaysToLayerGroup } from './ClueOverlays';
import {
  createAnchorPointIcon,
  createOwnPositionIcon,
  createSelectionPinIcon,
  createTeamBeaconIcon,
} from './CustomMarkers';

export interface MapClickInteractionMode {
  kind: 'NONE' | 'TEST_LOCATION' | 'PICK_SPLIT_POINT' | 'PICK_THERMO_A' | 'PICK_THERMO_B';
  label?: string;
}

export interface GameMapProps {
  playArea: Feature<Polygon>;
  playAreaConfirmed: boolean;
  ownFix: GeoFix | null;
  isOwnSideHider: boolean;
  anchorPoint: AnchorPoint | null;
  showAnchorAndLeash: boolean;
  publishedRadar: PublishedRadarCircle | null;
  visibleTeamLocations: Record<string, TeamLocation | null>;
  teamsPublic: Record<string, TeamPublic>;
  activeTeamIds?: string[];
  clues: ClueRecord[];
  hiddenClueIds: Set<string>;
  liveConePreview: Feature<Polygon | MultiPolygon> | null;
  selectedSplitPoint?: LatLng | null;
  thermoPointA?: LatLng | null;
  thermoPointB?: LatLng | null;
  clickMode: MapClickInteractionMode;
  onMapCoordinateClick?: (pt: LatLng) => void;
  layoutInvalidationKey?: string | number;
}

function resolveRadarHardwareColor(stage: number): string {
  // 3-stage hardware color progression: --cmf-teal -> --cmf-amber -> --cmf-orange
  if (stage <= 2) return '#00A896';
  if (stage <= 4) return '#F0A500';
  return '#FF4D00';
}

export const GameMap: React.FC<GameMapProps> = ({
  playArea,
  playAreaConfirmed,
  ownFix,
  isOwnSideHider,
  anchorPoint,
  showAnchorAndLeash,
  publishedRadar,
  visibleTeamLocations,
  teamsPublic,
  activeTeamIds,
  clues,
  hiddenClueIds,
  liveConePreview,
  selectedSplitPoint,
  thermoPointA,
  thermoPointB,
  clickMode,
  onMapCoordinateClick,
  layoutInvalidationKey,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const boundaryLayerRef = useRef<L.LayerGroup | null>(null);
  const clueLayerRef = useRef<L.LayerGroup | null>(null);
  const previewLayerRef = useRef<L.LayerGroup | null>(null);
  const radarLayerRef = useRef<L.LayerGroup | null>(null);
  const actorsLayerRef = useRef<L.LayerGroup | null>(null);

  const onClickRef = useRef(onMapCoordinateClick);
  onClickRef.current = onMapCoordinateClick;
  const clickModeRef = useRef(clickMode);
  clickModeRef.current = clickMode;

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: true,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      keepBuffer: 1,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OSM</a> // 81247',
    }).addTo(map);

    boundaryLayerRef.current = L.layerGroup().addTo(map);
    clueLayerRef.current = L.layerGroup().addTo(map);
    previewLayerRef.current = L.layerGroup().addTo(map);
    radarLayerRef.current = L.layerGroup().addTo(map);
    actorsLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (ev: L.LeafletMouseEvent) => {
      if (clickModeRef.current.kind !== 'NONE' && onClickRef.current) {
        onClickRef.current({
          lat: ev.latlng.lat,
          lng: ev.latlng.lng,
        });
      }
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
    });
    resizeObserver.observe(el);

    setTimeout(() => {
      map.invalidateSize({ pan: false });
    }, 80);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => {
      map.invalidateSize({ pan: false });
    }, 50);
    return () => clearTimeout(t);
  }, [layoutInvalidationKey]);

  const hasFittedInitialBoundsRef = useRef(false);

  // 1. Spielfeld-Polygon + mattierte Außenmaske im Raw-Light-Hardware-Look
  useEffect(() => {
    const group = boundaryLayerRef.current;
    const map = mapRef.current;
    if (!group) return;
    group.clearLayers();

    const mask = buildInvertedWorldMask(playArea);
    L.geoJSON(mask, {
      style: {
        stroke: false,
        fillColor: '#9AA4AE',
        fillOpacity: 0.34,
      },
      interactive: false,
    }).addTo(group);

    const strokeColor = playAreaConfirmed ? '#00A896' : '#F0A500';
    const polyLayer = L.geoJSON(playArea, {
      style: {
        color: strokeColor,
        weight: 2.5,
        dashArray: '6, 6',
        fillColor: '#00A896',
        fillOpacity: 0.04,
      },
      interactive: false,
    }).addTo(group);

    if (map && !hasFittedInitialBoundsRef.current) {
      const bounds = polyLayer.getBounds();
      if (bounds.isValid()) {
        hasFittedInitialBoundsRef.current = true;
        map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
      }
    }
  }, [playArea, playAreaConfirmed]);

  // 2. Hinweis-Overlays
  useEffect(() => {
    const group = clueLayerRef.current;
    if (!group) return;
    syncClueOverlaysToLayerGroup(group, clues, hiddenClueIds);
  }, [clues, hiddenClueIds]);

  // 3. Live-Vorschau (45°-Radarkegel, Teilungspunkt, Thermometer A/B)
  useEffect(() => {
    const group = previewLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (liveConePreview) {
      L.geoJSON(liveConePreview, {
        style: {
          color: '#00A896',
          weight: 2,
          dashArray: '6, 6',
          fillColor: '#00A896',
          fillOpacity: 0.14,
        },
        interactive: false,
      }).addTo(group);
    }

    if (selectedSplitPoint) {
      L.marker([selectedSplitPoint.lat, selectedSplitPoint.lng], {
        icon: createSelectionPinIcon('T', 'primary'),
      })
        .bindTooltip('TEILUNGSPUNKT [T]')
        .addTo(group);
    }

    if (thermoPointA) {
      L.marker([thermoPointA.lat, thermoPointA.lng], {
        icon: createSelectionPinIcon('A', 'primary'),
      })
        .bindTooltip('THERMOMETER START [A]')
        .addTo(group);
    }

    if (thermoPointB) {
      L.marker([thermoPointB.lat, thermoPointB.lng], {
        icon: createSelectionPinIcon('B', 'secondary'),
      })
        .bindTooltip('THERMOMETER ENDE [B]')
        .addTo(group);
    }

    if (thermoPointA && thermoPointB) {
      L.polyline(
        [
          [thermoPointA.lat, thermoPointA.lng],
          [thermoPointB.lat, thermoPointB.lng],
        ],
        { color: '#FF4D00', weight: 2, dashArray: '6, 6' }
      ).addTo(group);
    }
  }, [liveConePreview, selectedSplitPoint, thermoPointA, thermoPointB]);

  // 4. Schrumpf-Radar-Kreis (öffentlich ab 25:00 — 3-stufige Hardware-Farbprogression)
  useEffect(() => {
    const group = radarLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (publishedRadar) {
      const stageColor = resolveRadarHardwareColor(publishedRadar.stage);
      L.circle([publishedRadar.center.lat, publishedRadar.center.lng], {
        radius: publishedRadar.radiusMeters,
        color: stageColor,
        weight: 2.5,
        dashArray: '6, 6',
        fillColor: stageColor,
        fillOpacity: 0.14,
        interactive: false,
      })
        .bindTooltip(
          `RADAR STUFE ${publishedRadar.stage} // ${publishedRadar.radiusMeters}M`
        )
        .addTo(group);
    }
  }, [publishedRadar]);

  // 5. Eigene Position, autorisierte Team-Beacons sowie Hider-Anchor + 20m-Leash
  useEffect(() => {
    const group = actorsLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (showAnchorAndLeash && anchorPoint) {
      L.circle([anchorPoint.lat, anchorPoint.lng], {
        radius: LEASH_RADIUS_METERS,
        color: '#00A896',
        weight: 2,
        dashArray: '6, 6',
        fillColor: '#00A896',
        fillOpacity: 0.14,
        interactive: false,
      }).addTo(group);

      L.marker([anchorPoint.lat, anchorPoint.lng], {
        icon: createAnchorPointIcon(),
      })
        .bindPopup(
          `<strong>SARDINEN-VERSTECK // HQ</strong><br/>RADIUS: 20M (±${anchorPoint.accuracy}M)`
        )
        .addTo(group);
    }

    const activeSet = activeTeamIds ? new Set(activeTeamIds) : null;

    for (const [teamId, loc] of Object.entries(visibleTeamLocations)) {
      if (!loc) continue;
      if (activeSet && !activeSet.has(teamId)) continue;
      const pub = teamsPublic[teamId];
      if (!pub || pub.status === 'JOINED_SARDINES' || pub.memberPlayerIds.length === 0) continue;

      const contributorInfo =
        loc.activeContributorCount && loc.activeContributorCount > 1
          ? ` [AVG:${loc.activeContributorCount}]`
          : '';

      L.marker([loc.lat, loc.lng], {
        icon: createTeamBeaconIcon(pub.name, pub.color),
      })
        .bindPopup(
          `<strong>${pub.name.toUpperCase()}</strong>${contributorInfo}<br/>GPS: ±${Math.round(loc.accuracy)}M`
        )
        .addTo(group);
    }

    if (ownFix) {
      L.circle([ownFix.lat, ownFix.lng], {
        radius: Math.min(80, Math.max(4, ownFix.accuracy)),
        color: '#00A896',
        weight: 1.5,
        dashArray: '4, 4',
        fillColor: '#00A896',
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(group);

      L.marker([ownFix.lat, ownFix.lng], {
        icon: createOwnPositionIcon(isOwnSideHider),
      })
        .bindTooltip(`POS // ±${Math.round(ownFix.accuracy)}M`)
        .addTo(group);
    }
  }, [
    ownFix,
    isOwnSideHider,
    anchorPoint,
    showAnchorAndLeash,
    visibleTeamLocations,
    teamsPublic,
    activeTeamIds,
  ]);

  return (
    <div className="relative h-full w-full bg-[var(--bg-page)]">
      <div
        ref={containerRef}
        data-testid="leaflet-map-container"
        className="h-full w-full z-0"
      />
      {clickMode.kind !== 'NONE' && (
        <div className="cmf-oled pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 z-[450] flex items-center gap-2 px-4 py-2 text-[11px] font-tech tracking-wide uppercase shadow-xl">
          <span className="h-2 w-2 rounded-full bg-[var(--cmf-amber)]" />
          <span className="text-[#F8FAFC]">
            {clickMode.label ?? 'Tippe auf die Karte, um den Punkt zu setzen'}
          </span>
        </div>
      )}
    </div>
  );
};
