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

  // Initialisiere Leaflet-Karte einmalig mit expliziter Container-Prüfung und ResizeObserver
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
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
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

  // Layout-/Tab-Wechsel sauber an Leaflet melden
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const t = setTimeout(() => {
      map.invalidateSize({ pan: false });
    }, 50);
    return () => clearTimeout(t);
  }, [layoutInvalidationKey]);

  const hasFittedInitialBoundsRef = useRef(false);

  // 1. Spielfeld-Polygon + invertierte dunkle Weltmaske
  useEffect(() => {
    const group = boundaryLayerRef.current;
    const map = mapRef.current;
    if (!group) return;
    group.clearLayers();

    const mask = buildInvertedWorldMask(playArea);
    L.geoJSON(mask, {
      style: {
        stroke: false,
        fillColor: '#020617',
        fillOpacity: 0.62,
      },
      interactive: false,
    }).addTo(group);

    const polyLayer = L.geoJSON(playArea, {
      style: {
        color: playAreaConfirmed ? '#10b981' : '#f59e0b',
        weight: 3,
        dashArray: playAreaConfirmed ? undefined : '8 6',
        fillOpacity: 0.02,
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
          color: '#06b6d4',
          weight: 2,
          dashArray: '5 5',
          fillColor: '#06b6d4',
          fillOpacity: 0.18,
        },
        interactive: false,
      }).addTo(group);
    }

    if (selectedSplitPoint) {
      L.marker([selectedSplitPoint.lat, selectedSplitPoint.lng], {
        icon: createSelectionPinIcon('T', '#f59e0b'),
      })
        .bindTooltip('Gewählter Teilungspunkt')
        .addTo(group);
    }

    if (thermoPointA) {
      L.marker([thermoPointA.lat, thermoPointA.lng], {
        icon: createSelectionPinIcon('A', '#38bdf8'),
      })
        .bindTooltip('Thermometer Startpunkt A')
        .addTo(group);
    }

    if (thermoPointB) {
      L.marker([thermoPointB.lat, thermoPointB.lng], {
        icon: createSelectionPinIcon('B', '#10b981'),
      })
        .bindTooltip('Thermometer Endpunkt B')
        .addTo(group);
    }

    if (thermoPointA && thermoPointB) {
      L.polyline(
        [
          [thermoPointA.lat, thermoPointA.lng],
          [thermoPointB.lat, thermoPointB.lng],
        ],
        { color: '#38bdf8', weight: 2.5, dashArray: '4 4' }
      ).addTo(group);
    }
  }, [liveConePreview, selectedSplitPoint, thermoPointA, thermoPointB]);

  // 4. Schrumpf-Radar-Kreis (öffentlich ab 25:00)
  useEffect(() => {
    const group = radarLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (publishedRadar) {
      L.circle([publishedRadar.center.lat, publishedRadar.center.lng], {
        radius: publishedRadar.radiusMeters,
        color: '#f43f5e',
        weight: 3,
        dashArray: '6 4',
        fillColor: '#f43f5e',
        fillOpacity: 0.11,
        interactive: false,
      })
        .bindTooltip(
          `Radar Stufe ${publishedRadar.stage} (${publishedRadar.radiusMeters} m)`
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
        color: '#06b6d4',
        weight: 2.5,
        fillColor: '#06b6d4',
        fillOpacity: 0.18,
        interactive: false,
      }).addTo(group);

      L.marker([anchorPoint.lat, anchorPoint.lng], {
        icon: createAnchorPointIcon(),
      })
        .bindPopup(
          `<strong>Sardinen-Versteck (Anchor Point)</strong><br/>20m-Versteckradius aktiv (±${anchorPoint.accuracy} m)`
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
          ? ` (Ø aus ${loc.activeContributorCount} Spielern)`
          : '';

      L.marker([loc.lat, loc.lng], {
        icon: createTeamBeaconIcon(pub.name, pub.color),
      })
        .bindPopup(
          `<strong>${pub.name}</strong>${contributorInfo}<br/>Genauigkeit: ±${Math.round(loc.accuracy)} m`
        )
        .addTo(group);
    }

    if (ownFix) {
      L.circle([ownFix.lat, ownFix.lng], {
        radius: Math.min(80, Math.max(4, ownFix.accuracy)),
        color: isOwnSideHider ? '#06b6d4' : '#38bdf8',
        weight: 1,
        fillColor: isOwnSideHider ? '#06b6d4' : '#38bdf8',
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(group);

      L.marker([ownFix.lat, ownFix.lng], {
        icon: createOwnPositionIcon(isOwnSideHider),
      })
        .bindTooltip(
          `Dein Standort (±${Math.round(ownFix.accuracy)} m)`
        )
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
    <div className="relative h-full w-full bg-[#020617]">
      <div
        ref={containerRef}
        data-testid="leaflet-map-container"
        className="h-full w-full z-0"
      />
      {clickMode.kind !== 'NONE' && (
        <div className="pointer-events-none absolute bottom-20 left-1/2 -translate-x-1/2 z-[450] rounded-full border border-amber-400/70 bg-slate-950/90 px-4 py-1.5 text-xs font-semibold text-amber-300 shadow-lg backdrop-blur">
          {clickMode.label ?? 'Tippe auf die Karte, um den Punkt zu setzen'}
        </div>
      )}
    </div>
  );
};
