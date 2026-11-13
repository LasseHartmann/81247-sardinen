import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { LocateFixed, Maximize2 } from 'lucide-react';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import {
  ANCHOR_MANUAL_ADJUST_MAX_METERS,
  LEASH_RADIUS_METERS,
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_ZOOM,
} from '../../config/gameConfig';
import {
  buildExcludedOrangeMask,
  computePossibleHidingArea,
} from '../../geo/hidingArea';
import type {
  AnchorPoint,
  ClueRecord,
  EmergencyMessage,
  GeoFix,
  LatLng,
  PublishedRadarCircle,
  TeamLocation,
  TeamPublic,
} from '../../types/game';
import {
  createAnchorPointIcon,
  createEmergencyBeaconIcon,
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
  anchorGpsOrigin?: LatLng | null;
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
  onRequestGpsPermission?: () => Promise<GeoFix | null> | void;
  layoutInvalidationKey?: string | number;
  hasBottomDock?: boolean;
  emergencyMessages?: EmergencyMessage[];
  emergencyFocusTarget?: { lat: number; lng: number; seq: number } | null;
}

export const GameMap: React.FC<GameMapProps> = ({
  playArea,
  ownFix,
  anchorGpsOrigin = null,
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
  onRequestGpsPermission,
  layoutInvalidationKey,
  hasBottomDock = false,
  emergencyMessages = [],
  emergencyFocusTarget = null,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  const hidingZoneLayerRef = useRef<L.LayerGroup | null>(null);
  const previewLayerRef = useRef<L.LayerGroup | null>(null);
  const actorsLayerRef = useRef<L.LayerGroup | null>(null);

  const anchorMarkerRef = useRef<L.Marker | null>(null);
  const ownMarkerRef = useRef<L.Marker | null>(null);
  const teamMarkersRef = useRef<
    Map<string, { marker: L.Marker; name: string; color: string }>
  >(new Map());
  const emergencyMarkersRef = useRef<
    Map<string, { marker: L.Marker; senderName: string }>
  >(new Map());

  const onClickRef = useRef(onMapCoordinateClick);
  onClickRef.current = onMapCoordinateClick;
  const clickModeRef = useRef(clickMode);
  clickModeRef.current = clickMode;

  const cluesSignature = clues.map((c) => c.id).join('|');
  const hiddenSignature = Array.from(hiddenClueIds).sort().join('|');
  const radarSignature = publishedRadar
    ? `${publishedRadar.stage}_${publishedRadar.center.lat}_${publishedRadar.center.lng}_${publishedRadar.radiusMeters}`
    : '';

  const possibleHidingArea = useMemo(
    () =>
      computePossibleHidingArea({
        playArea,
        clues,
        hiddenClueIds,
        publishedRadar,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playArea, cluesSignature, hiddenSignature, radarSignature]
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
      anchorMarkerRef.current = null;
      ownMarkerRef.current = null;
      teamMarkersRef.current.clear();
      emergencyMarkersRef.current.clear();
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

    // Dauerhafter roter Außenrand des gesamten Spielbereichs (81247)
    L.geoJSON(playArea, {
      style: {
        color: '#DC2626',
        weight: 3.5,
        opacity: 0.95,
        fillOpacity: 0,
      },
      interactive: false,
    }).addTo(group);
  }, [playArea, possibleHidingArea, excludedOrangeMask]);

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

    if (clickMode.kind === 'PICK_ANCHOR_POINT' && anchorGpsOrigin) {
      L.circle([anchorGpsOrigin.lat, anchorGpsOrigin.lng], {
        radius: ANCHOR_MANUAL_ADJUST_MAX_METERS,
        color: '#00A896',
        weight: 2,
        dashArray: '6 5',
        fillColor: '#00A896',
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(group);
    }
  }, [liveConePreview, thermoPointA, thermoPointB, clickMode.kind, anchorGpsOrigin]);

  // 3. Eigene Position, autorisierte Team-Beacons sowie Hider-Anchor (in-place aktualisiert ohne Flackern!)
  useEffect(() => {
    const group = actorsLayerRef.current;
    if (!group) return;

    // 3a. Hider-Anchor Marker
    if (showAnchorAndLeash && anchorPoint) {
      const popupHtml = `<strong>SARDINEN-VERSTECK // HQ</strong><br/>RADIUS: ${LEASH_RADIUS_METERS}M (±${anchorPoint.accuracy}M)`;
      if (!anchorMarkerRef.current) {
        anchorMarkerRef.current = L.marker(
          [anchorPoint.lat, anchorPoint.lng],
          { icon: createAnchorPointIcon() }
        )
          .bindPopup(popupHtml)
          .addTo(group);
      } else {
        anchorMarkerRef.current.setLatLng([anchorPoint.lat, anchorPoint.lng]);
        anchorMarkerRef.current.setPopupContent(popupHtml);
      }
    } else if (anchorMarkerRef.current) {
      group.removeLayer(anchorMarkerRef.current);
      anchorMarkerRef.current = null;
    }

    // 3b. Team-Beacons
    const activeSet = activeTeamIds ? new Set(activeTeamIds) : null;
    const seenTeams = new Set<string>();

    for (const [teamId, loc] of Object.entries(visibleTeamLocations)) {
      if (!loc) continue;
      if (activeSet && !activeSet.has(teamId)) continue;
      const pub = teamsPublic[teamId];
      if (!pub || pub.status === 'JOINED_SARDINES' || pub.memberPlayerIds.length === 0) continue;

      seenTeams.add(teamId);
      const contributorInfo =
        loc.activeContributorCount && loc.activeContributorCount > 1
          ? ` [AVG:${loc.activeContributorCount}]`
          : '';
      const popupHtml = `<strong>${pub.name.toUpperCase()}</strong>${contributorInfo}<br/>GPS: ±${Math.round(loc.accuracy)}M`;

      const existing = teamMarkersRef.current.get(teamId);
      if (!existing) {
        const marker = L.marker([loc.lat, loc.lng], {
          icon: createTeamBeaconIcon(pub.name, pub.color),
        })
          .bindPopup(popupHtml)
          .addTo(group);
        teamMarkersRef.current.set(teamId, {
          marker,
          name: pub.name,
          color: pub.color,
        });
      } else {
        existing.marker.setLatLng([loc.lat, loc.lng]);
        existing.marker.setPopupContent(popupHtml);
        if (existing.name !== pub.name || existing.color !== pub.color) {
          existing.marker.setIcon(createTeamBeaconIcon(pub.name, pub.color));
          existing.name = pub.name;
          existing.color = pub.color;
        }
      }
    }

    for (const [teamId, entry] of teamMarkersRef.current.entries()) {
      if (!seenTeams.has(teamId)) {
        group.removeLayer(entry.marker);
        teamMarkersRef.current.delete(teamId);
      }
    }

    // 3c. Eigene Position
    if (ownFix) {
      const tooltipText = `POS // ±${Math.round(ownFix.accuracy)}M`;
      if (!ownMarkerRef.current) {
        ownMarkerRef.current = L.marker([ownFix.lat, ownFix.lng], {
          icon: createOwnPositionIcon(isOwnSideHider),
        })
          .bindTooltip(tooltipText)
          .addTo(group);
      } else {
        ownMarkerRef.current.setLatLng([ownFix.lat, ownFix.lng]);
        ownMarkerRef.current.setTooltipContent(tooltipText);
      }
    } else if (ownMarkerRef.current) {
      group.removeLayer(ownMarkerRef.current);
      ownMarkerRef.current = null;
    }

    // 4. Notfall-Standorte (SOS-Pins) für alle aktiven Notfallnachrichten mit Koordinaten
    const seenSosIds = new Set<string>();
    for (const msg of emergencyMessages) {
      if (
        typeof msg.lat === 'number' &&
        Number.isFinite(msg.lat) &&
        typeof msg.lng === 'number' &&
        Number.isFinite(msg.lng)
      ) {
        const sosKey = msg.uid || msg.senderName;
        seenSosIds.add(sosKey);
        const popupHtml = `<strong>NOTFALL // ${msg.senderName.toUpperCase()}</strong><br/>${msg.text}<br/>POS: ${msg.lat.toFixed(5)}, ${msg.lng.toFixed(5)}${typeof msg.accuracy === 'number' ? ` (±${Math.round(msg.accuracy)}M)` : ''}`;
        const existingSos = emergencyMarkersRef.current.get(sosKey);
        if (!existingSos) {
          const marker = L.marker([msg.lat, msg.lng], {
            icon: createEmergencyBeaconIcon(msg.senderName),
            zIndexOffset: 1000,
          })
            .bindPopup(popupHtml)
            .addTo(group);
          emergencyMarkersRef.current.set(sosKey, {
            marker,
            senderName: msg.senderName,
          });
        } else {
          existingSos.marker.setLatLng([msg.lat, msg.lng]);
          existingSos.marker.setPopupContent(popupHtml);
          if (existingSos.senderName !== msg.senderName) {
            existingSos.marker.setIcon(createEmergencyBeaconIcon(msg.senderName));
            existingSos.senderName = msg.senderName;
          }
        }
      }
    }

    for (const [sosKey, entry] of emergencyMarkersRef.current.entries()) {
      if (!seenSosIds.has(sosKey)) {
        group.removeLayer(entry.marker);
        emergencyMarkersRef.current.delete(sosKey);
      }
    }
  }, [
    ownFix,
    isOwnSideHider,
    anchorPoint,
    showAnchorAndLeash,
    visibleTeamLocations,
    teamsPublic,
    activeTeamIds,
    emergencyMessages,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !emergencyFocusTarget) return;
    map.flyTo([emergencyFocusTarget.lat, emergencyFocusTarget.lng], Math.max(map.getZoom(), 17), {
      duration: 0.5,
    });
  }, [emergencyFocusTarget]);

  const handleCenterOnOwnFix = useCallback(() => {
    const map = mapRef.current;
    if (map && ownFix) {
      map.flyTo([ownFix.lat, ownFix.lng], Math.max(map.getZoom(), 16), {
        duration: 0.45,
      });
    }

    const maybePromise = onRequestGpsPermission?.();
    if (!ownFix && maybePromise && typeof maybePromise.then === 'function') {
      void maybePromise.then((freshFix) => {
        const currentMap = mapRef.current;
        if (freshFix && currentMap) {
          currentMap.flyTo(
            [freshFix.lat, freshFix.lng],
            Math.max(currentMap.getZoom(), 16),
            { duration: 0.45 }
          );
        }
      });
    }
  }, [ownFix, onRequestGpsPermission]);

  const handleFitPlayArea = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const tempPoly = L.geoJSON(playArea);
    const bounds = tempPoly.getBounds();
    if (bounds.isValid()) {
      map.flyToBounds(bounds, { padding: [24, 24], maxZoom: 15, duration: 0.45 });
    }
  }, [playArea]);

  return (
    <div className="relative h-full w-full bg-[var(--bg-page)]">
      <div
        ref={containerRef}
        data-testid="leaflet-map-container"
        className="h-full w-full z-0"
      />

      {/* Einhand-Daumensteuerung rechts auf der Karte (Zentrieren & 81247-Übersicht) */}
      <div
        className={`pointer-events-auto absolute right-[max(0.65rem,env(safe-area-inset-right))] z-[390] flex flex-col gap-1.5 transition-all duration-200 ${
          hasBottomDock ? 'top-16 sm:top-auto sm:bottom-48' : 'bottom-6'
        }`}
      >
        <button
          type="button"
          data-testid="map-locate-me-btn"
          disabled={!ownFix && !onRequestGpsPermission}
          onClick={handleCenterOnOwnFix}
          aria-label="Auf eigenen Standort zentrieren"
          title="Auf eigenen Standort zentrieren (GPS-Freigabe anfordern)"
          className="cmf-chassis flex h-11 w-11 items-center justify-center rounded-2xl text-[var(--text-main)] shadow-lg disabled:opacity-40 active:scale-95"
        >
          <LocateFixed
            className={`h-5 w-5 ${
              ownFix ? 'text-[var(--cmf-teal)]' : 'text-[var(--text-muted)]'
            }`}
          />
        </button>

        <button
          type="button"
          data-testid="map-fit-zone-btn"
          onClick={handleFitPlayArea}
          aria-label="Gesamtes 81247-Gebiet anzeigen"
          title="Gesamtes 81247-Gebiet anzeigen"
          className="cmf-chassis flex h-11 w-11 items-center justify-center rounded-2xl text-[var(--text-main)] shadow-lg active:scale-95"
        >
          <Maximize2 className="h-4 w-4 text-[var(--cmf-orange)]" />
        </button>
      </div>

      {clickMode.kind !== 'NONE' && (
        <div className="cmf-oled pointer-events-none absolute top-14 right-3 left-3 z-[450] mx-auto flex max-w-sm items-center justify-center gap-2 px-3.5 py-2 text-center text-[11px] font-tech tracking-wide uppercase shadow-xl">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--cmf-amber)]" />
          <span className="text-[#F8FAFC]">
            {clickMode.label ?? 'Tippe auf die Karte, um den Punkt zu setzen'}
          </span>
        </div>
      )}
    </div>
  );
};
