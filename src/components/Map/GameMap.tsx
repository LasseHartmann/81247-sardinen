import React, { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM } from '../../config/gameConfig';
import {
  buildExcludedOrangeMask,
  computePossibleHidingArea,
} from '../../geo/hidingArea';
import type {
  AnchorPoint,
  ClueRecord,
  GeoFix,
  LatLng,
  PublishedRadarCircle,
  TeamLocation,
  TeamPublic,
} from '../../types/game';
import {
  createAnchorPointIcon,
  createOwnPositionIcon,
  createSelectionPinIcon,
  createTeamBeaconIcon,
} from './CustomMarkers';

export interface MapClickInteractionMode {
  kind:
    | 'NONE'
    | 'TEST_LOCATION'
    | 'PICK_ANCHOR_POINT'
    | 'PICK_THERMO_A'
    | 'PICK_THERMO_B';
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
  liveConePreview: FeatureCollection | Feature<Polygon | MultiPolygon> | null;
  thermoPointA?: LatLng | null;
  thermoPointB?: LatLng | null;
  clickMode: MapClickInteractionMode;
  onMapCoordinateClick?: (pt: LatLng) => void;
  layoutInvalidationKey?: string | number;
}

export const GameMap: React.FC<GameMapProps> = ({
  playArea,
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
  thermoPointA,
  thermoPointB,
  clickMode,
  onMapCoordinateClick,
  layoutInvalidationKey,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const hidingZoneLayerRef = useRef<L.LayerGroup | null>(null);
  const previewLayerRef = useRef<L.LayerGroup | null>(null);
  const actorsLayerRef = useRef<L.LayerGroup | null>(null);

  const onClickRef = useRef(onMapCoordinateClick);
  onClickRef.current = onMapCoordinateClick;
  const clickModeRef = useRef(clickMode);
  clickModeRef.current = clickMode;

  const possibleHidingArea = useMemo(
    () =>
      computePossibleHidingArea({
        playArea,
        clues,
        hiddenClueIds,
        publishedRadar,
      }),
    [playArea, clues, hiddenClueIds, publishedRadar]
  );

  const excludedOrangeMask = useMemo(
    () => buildExcludedOrangeMask(possibleHidingArea),
    [possibleHidingArea]
  );

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

    hidingZoneLayerRef.current = L.layerGroup().addTo(map);
    previewLayerRef.current = L.layerGroup().addTo(map);
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

  // Initialer Kartenausschnitt auf das 81247-Gebiet
  useEffect(() => {
    const map = mapRef.current;
    if (!map || hasFittedInitialBoundsRef.current) return;
    const tempPoly = L.geoJSON(playArea);
    const bounds = tempPoly.getBounds();
    if (bounds.isValid()) {
      hasFittedInitialBoundsRef.current = true;
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
    }
  }, [playArea]);

  // 1. Einheitlicher möglicher Versteckbereich:
  //    - Nur die Grenze des noch möglichen Versteckbereichs wird gezeichnet.
  //    - Der gesamte ausgeschlossene Rest wird einheitlich orange gefärbt (keine überlappenden Linien!).
  useEffect(() => {
    const group = hidingZoneLayerRef.current;
    if (!group) return;
    group.clearLayers();

    L.geoJSON(excludedOrangeMask, {
      style: {
        stroke: false,
        fillColor: '#FF4D00',
        fillOpacity: 0.34,
      },
      interactive: false,
    }).addTo(group);

    if (possibleHidingArea) {
      L.geoJSON(possibleHidingArea, {
        style: {
          color: '#FF4D00',
          weight: 2.5,
          opacity: 0.95,
          fillOpacity: 0,
        },
        interactive: false,
      }).addTo(group);
    }
  }, [possibleHidingArea, excludedOrangeMask]);

  // 2. Optionale Live-Vorschau (nur wenn aktiv im Hinweis-Menü eingeschaltet) + Thermometer-Pins A/B
  useEffect(() => {
    const group = previewLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (liveConePreview) {
      L.geoJSON(liveConePreview, {
        style: {
          color: '#00A896',
          weight: 2,
          fillColor: '#00A896',
          fillOpacity: 0.18,
        },
        interactive: false,
      }).addTo(group);
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
  }, [liveConePreview, thermoPointA, thermoPointB]);

  // 3. Eigene Position, autorisierte Team-Beacons sowie Hider-Anchor (ohne störende Kreislinien)
  useEffect(() => {
    const group = actorsLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (showAnchorAndLeash && anchorPoint) {
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
