import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import {
  ANCHOR_MANUAL_ADJUST_MAX_METERS,
  getActivePostalCodes,
  getRadiusRadarOptions,
  LEASH_RADIUS_METERS,
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_ZOOM,
  resolveQuestionRulesConfig,
} from '../../config/gameConfig';
import {
  getPreviewGreenPolygonsForPlayArea,
  getRecyclingLatLngsForPlayArea,
  getTransitLatLngsForPlayArea,
  preloadGreenPolygonsForPostalCode,
  preloadMunichAllGreenPreview,
} from '../../config/fallbackOsm81247';
import { destinationPoint, distanceMeters } from '../../geo/distance';
import {
  buildExcludedOrangeMask,
  computePossibleHidingArea,
} from '../../geo/hidingArea';
import type { TeamMemberMapMarker } from '../../services/databaseAdapter';
import type {
  AnchorPoint,
  ClueRecord,
  EmergencyMessage,
  GeoFix,
  LatLng,
  PublishedRadarCircle,
  QuestionRulesConfig,
  QuestionType,
  RadiusOptionMeters,
} from '../../types/game';
import {
  createAnchorPointIcon,
  createEmergencyBeaconIcon,
  createExposedHiderIcon,
  createLiveHiderOverviewIcon,
  createManhuntPingIcon,
  createOwnPositionIcon,
  createSelectionPinIcon,
  createTeamMemberFishIcon,
  renderTeamMemberFishPopupHtml,
} from './CustomMarkers';

export interface MapClickInteractionMode {
  kind:
    | 'NONE'
    | 'TEST_LOCATION'
    | 'PICK_ANCHOR_POINT'
    | 'PICK_PLAY_AREA_CIRCLE'
    | 'PICK_LOBBY_RULE_PREVIEW';
  label?: string;
}

function hasUsableMapViewport(map: L.Map): boolean {
  const container = map.getContainer();
  if (!container || container.clientWidth < 32 || container.clientHeight < 32) {
    return false;
  }
  map.invalidateSize({ pan: false });
  const size = map.getSize();
  return Boolean(
    size &&
      Number.isFinite(size.x) &&
      Number.isFinite(size.y) &&
      size.x >= 32 &&
      size.y >= 32
  );
}

const METERS_PER_DEG_LAT = 111132;

function metersPerDegLngAt(latDeg: number): number {
  return 111320 * Math.cos((latDeg * Math.PI) / 180);
}

function buildLatLngCircleRing(
  center: LatLng,
  radiusMeters: number,
  steps = 64
): L.LatLngExpression[] {
  const ring: L.LatLngExpression[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i * 360) / steps;
    const pt = destinationPoint(center, radiusMeters, angle);
    ring.push([pt.lat, pt.lng]);
  }
  return ring;
}

interface InternalLeafletCanvas {
  _ctx?: CanvasRenderingContext2D;
  _map?: L.Map;
  _redrawBounds?: L.Bounds | null;
  _drawing?: boolean;
  _drawFirst?: {
    layer: L.Path & { _pxBounds?: L.Bounds; _updatePath: () => void };
    next?: unknown;
  } | null;
}

/**
 * Erzeugt einen hardware-geclippten Leaflet-Canvas-Renderer, der alle Vorschau-Formen
 * direkt auf der GPU per `ctx.clip('evenodd')` exakt auf den erlaubten Spiel-/Versteckbereich
 * zuschneidet — komplett ohne teures `turf.union` oder `turf.intersect` auf dem Main-Thread.
 */
function createPlayAreaClippedCanvas(
  pane: string,
  getClipFeature: () => Feature<Polygon | MultiPolygon> | null
): L.Canvas {
  const ClippedCanvasClass = L.Canvas.extend({
    _draw(this: InternalLeafletCanvas) {
      const ctx = this._ctx;
      const map = this._map;
      if (!ctx || !map) return;

      const bounds = this._redrawBounds;
      ctx.save();
      if (bounds && bounds.min) {
        const size = bounds.getSize();
        ctx.beginPath();
        ctx.rect(bounds.min.x, bounds.min.y, size.x, size.y);
        ctx.clip();
      }

      const clipFeature = getClipFeature();
      if (clipFeature?.geometry) {
        ctx.beginPath();
        const polys =
          clipFeature.geometry.type === 'Polygon'
            ? [clipFeature.geometry.coordinates]
            : clipFeature.geometry.coordinates;
        for (const rings of polys) {
          for (const ring of rings) {
            for (let i = 0; i < ring.length; i++) {
              const pt = map.latLngToLayerPoint([ring[i][1], ring[i][0]]);
              if (i === 0) ctx.moveTo(pt.x, pt.y);
              else ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();
          }
        }
        ctx.clip('evenodd');
      }

      this._drawing = true;
      for (
        let order = this._drawFirst;
        order;
        order = order.next as typeof order
      ) {
        const layer = order.layer;
        if (!bounds || (layer._pxBounds && layer._pxBounds.intersects(bounds))) {
          layer._updatePath();
        }
      }
      this._drawing = false;
      ctx.restore();
    },
  });

  return new (ClippedCanvasClass as unknown as new (
    opts: L.RendererOptions
  ) => L.Canvas)({ padding: 0.35, pane });
}

export function safeFitGeoJsonBounds(
  map: L.Map,
  geojson: Feature<Polygon | MultiPolygon>,
  options: { padding: [number, number]; maxZoom: number; animate?: boolean }
): boolean {
  try {
    if (!hasUsableMapViewport(map)) return false;
    const bounds = L.geoJSON(geojson).getBounds();
    if (!bounds.isValid()) return false;
    const center = bounds.getCenter();
    if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
      return false;
    }
    const targetZoom = map.getBoundsZoom(
      bounds,
      false,
      L.point(options.padding[0] * 2, options.padding[1] * 2)
    );
    if (!Number.isFinite(targetZoom)) return false;
    map.fitBounds(bounds, {
      padding: options.padding,
      maxZoom: options.maxZoom,
      animate: Boolean(options.animate),
    });
    return true;
  } catch {
    return false;
  }
}

function safeCenterMapOnLatLng(
  map: L.Map,
  lat: number,
  lng: number,
  minZoom: number
): boolean {
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (!hasUsableMapViewport(map)) return false;
    const curZoom = map.getZoom();
    const targetZoom = Number.isFinite(curZoom)
      ? Math.max(curZoom, minZoom)
      : minZoom;
    map.setView([lat, lng], targetZoom, { animate: true });
    return true;
  } catch {
    return false;
  }
}

export interface GameMapActions {
  centerOnOwnFix: () => void;
  fitPlayArea: () => void;
}

export interface GameMapProps {
  playArea: Feature<Polygon | MultiPolygon>;
  playAreaConfirmed: boolean;
  official81247Boundary?: Feature<Polygon | MultiPolygon> | null;
  circlePlayAreaCenter?: LatLng | null;
  onChangeCirclePlayAreaCenter?: (pt: LatLng) => void;
  lobbyPreviewOrigin?: LatLng | null;
  onChangeLobbyPreviewOrigin?: (pt: LatLng) => void;
  ownFix: GeoFix | null;
  anchorGpsOrigin?: LatLng | null;
  isOwnSideHider: boolean;
  anchorPoint: AnchorPoint | null;
  showAnchorAndLeash: boolean;
  publishedRadar: PublishedRadarCircle | null;
  exposedHiderLocation?: {
    lat: number;
    lng: number;
    accuracy?: number;
  } | null;
  liveHiderLocations?: Record<string, { lat: number; lng: number; accuracy: number; label: string }>;
  teamMemberMarkers?: TeamMemberMapMarker[];
  clues: ClueRecord[];
  hiddenClueIds: Set<string>;
  activePreviewQuestion?: QuestionType | null;
  coneBearingDeg?: number;
  selectedRadius?: RadiusOptionMeters;
  thermoPointA?: LatLng | null;
  questionConfig?: Partial<QuestionRulesConfig> | null;
  clickMode: MapClickInteractionMode;
  onMapCoordinateClick?: (pt: LatLng) => void;
  onRequestGpsPermission?: () => Promise<GeoFix | null> | void;
  actionsRef?: React.MutableRefObject<GameMapActions | null>;
  layoutInvalidationKey?: string | number;
  emergencyMessages?: EmergencyMessage[];
  emergencyFocusTarget?: { lat: number; lng: number; seq: number } | null;
}

const GameMapInner: React.FC<GameMapProps> = ({
  playArea,
  official81247Boundary = null,
  circlePlayAreaCenter = null,
  onChangeCirclePlayAreaCenter,
  lobbyPreviewOrigin = null,
  onChangeLobbyPreviewOrigin,
  ownFix,
  anchorGpsOrigin = null,
  isOwnSideHider,
  anchorPoint,
  showAnchorAndLeash,
  publishedRadar,
  exposedHiderLocation = null,
  liveHiderLocations,
  teamMemberMarkers = [],
  clues,
  hiddenClueIds,
  activePreviewQuestion = null,
  coneBearingDeg = 0,
  selectedRadius = 250,
  thermoPointA,
  questionConfig = null,
  clickMode,
  onMapCoordinateClick,
  onRequestGpsPermission,
  actionsRef,
  layoutInvalidationKey,
  emergencyMessages = [],
  emergencyFocusTarget = null,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const canvasRendererRef = useRef<L.Canvas | null>(null);
  const previewFillRendererRef = useRef<L.Canvas | null>(null);
  const previewStrokeRendererRef = useRef<L.Canvas | null>(null);

  const hidingZoneLayerRef = useRef<L.LayerGroup | null>(null);
  const previewLayerRef = useRef<L.LayerGroup | null>(null);
  const previewPoiDotsLayerRef = useRef<L.LayerGroup | null>(null);
  const actorsLayerRef = useRef<L.LayerGroup | null>(null);

  const anchorMarkerRef = useRef<L.Marker | null>(null);
  const manhuntPingMarkerRef = useRef<L.Marker | null>(null);
  const manhuntPingCircleRef = useRef<L.Circle | null>(null);
  const exposedHiderMarkerRef = useRef<L.Marker | null>(null);
  const liveHiderMarkersRef = useRef<Map<string, { marker: L.Marker; label: string }>>(
    new Map()
  );
  const ownMarkerRef = useRef<L.Marker | null>(null);
  const memberFishMarkersRef = useRef<
    Map<
      string,
      {
        marker: L.Marker;
        iconSignature: string;
      }
    >
  >(new Map());
  const emergencyMarkersRef = useRef<
    Map<string, { marker: L.Marker; senderName: string }>
  >(new Map());

  const onClickRef = useRef(onMapCoordinateClick);
  onClickRef.current = onMapCoordinateClick;
  const clickModeRef = useRef(clickMode);
  clickModeRef.current = clickMode;
  const onCircleCenterRef = useRef(onChangeCirclePlayAreaCenter);
  onCircleCenterRef.current = onChangeCirclePlayAreaCenter;
  const onLobbyPreviewOriginRef = useRef(onChangeLobbyPreviewOrigin);
  onLobbyPreviewOriginRef.current = onChangeLobbyPreviewOrigin;

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

  const clipFeatureRef = useRef<Feature<Polygon | MultiPolygon> | null>(
    possibleHidingArea ?? playArea
  );
  clipFeatureRef.current = possibleHidingArea ?? playArea;

  const effectivePreviewOriginSource = lobbyPreviewOrigin ?? anchorGpsOrigin;
  const previewOriginLat = effectivePreviewOriginSource?.lat ?? null;
  const previewOriginLng = effectivePreviewOriginSource?.lng ?? null;

  const effectiveThermoA = useMemo<LatLng | null>(() => {
    if (thermoPointA) return thermoPointA;
    if (
      activePreviewQuestion === 'THERMOMETER' &&
      previewOriginLat !== null &&
      previewOriginLng !== null
    ) {
      return { lat: previewOriginLat, lng: previewOriginLng };
    }
    return null;
  }, [thermoPointA, activePreviewQuestion, previewOriginLat, previewOriginLng]);

  const qConfig = useMemo(
    () => resolveQuestionRulesConfig(questionConfig),
    [questionConfig]
  );
  const thermoTargetDistanceMeters = qConfig.thermometerDistanceMeters;

  const effectiveThermoB = useMemo<LatLng | null>(() => {
    const liveFix =
      previewOriginLat !== null && previewOriginLng !== null
        ? { lat: previewOriginLat, lng: previewOriginLng }
        : null;
    if (
      liveFix &&
      effectiveThermoA &&
      distanceMeters(effectiveThermoA, liveFix) >= 5
    ) {
      return liveFix;
    }
    if (activePreviewQuestion === 'THERMOMETER' && effectiveThermoA) {
      return destinationPoint(effectiveThermoA, thermoTargetDistanceMeters, 45);
    }
    return liveFix;
  }, [
    effectiveThermoA,
    activePreviewQuestion,
    previewOriginLat,
    previewOriginLng,
    thermoTargetDistanceMeters,
  ]);

  const [greenDataRev, setGreenDataRev] = useState(0);
  const [viewportRev, setViewportRev] = useState(0);

  useEffect(() => {
    if (activePreviewQuestion !== 'OSM_GREEN') return;
    const rawCodes =
      (playArea.properties?.postalCodes as string[] | undefined) ??
      (playArea.properties?.postalCode
        ? [String(playArea.properties.postalCode)]
        : getActivePostalCodes(null));
    let cancelled = false;
    const loader =
      rawCodes.length > 4
        ? preloadMunichAllGreenPreview()
        : Promise.all(
            rawCodes.map((code) => preloadGreenPolygonsForPostalCode(code))
          );
    void loader.then(() => {
      if (!cancelled) {
        setGreenDataRev((v) => v + 1);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activePreviewQuestion, playArea]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: false,
      preferCanvas: true,
      fadeAnimation: false,
    });

    // Dedizierte Panes für Option 1:
    // 1. Preview-Fill-Pane mit Pane-weiter CSS-Deckkraft (verschmilzt tausende Kreise ohne turf.union!)
    const previewFillPane = map.createPane('sardinenPreviewFillPane');
    previewFillPane.style.zIndex = '404';
    previewFillPane.style.opacity = '0.26';
    previewFillPane.style.pointerEvents = 'none';

    // 2. Preview-Stroke-Pane (geclippt auf das Spielfeld)
    const previewStrokePane = map.createPane('sardinenPreviewStrokePane');
    previewStrokePane.style.zIndex = '406';
    previewStrokePane.style.pointerEvents = 'none';

    // 3. Masken- & Spielfeldrand-Pane oberhalb der Vorschau
    const hidingMaskPane = map.createPane('sardinenHidingMaskPane');
    hidingMaskPane.style.zIndex = '410';
    hidingMaskPane.style.pointerEvents = 'none';

    const canvasRenderer = L.canvas({
      padding: 0.35,
      pane: 'sardinenHidingMaskPane',
    }).addTo(map);
    canvasRendererRef.current = canvasRenderer;

    previewFillRendererRef.current = createPlayAreaClippedCanvas(
      'sardinenPreviewFillPane',
      () => clipFeatureRef.current
    ).addTo(map);
    previewStrokeRendererRef.current = createPlayAreaClippedCanvas(
      'sardinenPreviewStrokePane',
      () => clipFeatureRef.current
    ).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      keepBuffer: 2,
      updateWhenIdle: true,
      updateWhenZooming: false,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> // 81247',
    }).addTo(map);

    hidingZoneLayerRef.current = L.layerGroup().addTo(map);
    previewLayerRef.current = L.layerGroup().addTo(map);
    previewPoiDotsLayerRef.current = L.layerGroup().addTo(map);
    actorsLayerRef.current = L.layerGroup().addTo(map);

    map.on('moveend', () => {
      setViewportRev((v) => v + 1);
    });

    map.on('click', (ev: L.LeafletMouseEvent) => {
      const pt = {
        lat: ev.latlng.lat,
        lng: ev.latlng.lng,
      };
      if (clickModeRef.current.kind !== 'NONE' && onClickRef.current) {
        onClickRef.current(pt);
      }
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        map.invalidateSize({ pan: false });
      }
    });
    resizeObserver.observe(el);

    const initResizeTimer = setTimeout(() => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        map.invalidateSize({ pan: false });
      }
    }, 80);

    return () => {
      clearTimeout(initResizeTimer);
      resizeObserver.disconnect();
      anchorMarkerRef.current = null;
      manhuntPingMarkerRef.current = null;
      manhuntPingCircleRef.current = null;
      exposedHiderMarkerRef.current = null;
      liveHiderMarkersRef.current.clear();
      ownMarkerRef.current = null;
      memberFishMarkersRef.current.clear();
      emergencyMarkersRef.current.clear();
      canvasRendererRef.current = null;
      previewFillRendererRef.current = null;
      previewStrokeRendererRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (
      map.getContainer().clientWidth > 0 &&
      map.getContainer().clientHeight > 0
    ) {
      map.invalidateSize({ pan: false });
    }
    const t = setTimeout(() => {
      const c = map.getContainer();
      if (c.clientWidth > 0 && c.clientHeight > 0) {
        map.invalidateSize({ pan: false });
      }
    }, 50);
    return () => clearTimeout(t);
  }, [layoutInvalidationKey]);

  const hasFittedInitialBoundsRef = useRef(false);

  // Initialer Kartenausschnitt auf das 81247-Gebiet / Spielgebiet
  useEffect(() => {
    const map = mapRef.current;
    if (!map || hasFittedInitialBoundsRef.current) return;
    if (
      safeFitGeoJsonBounds(map, playArea, {
        padding: [24, 24],
        maxZoom: 16,
        animate: false,
      })
    ) {
      hasFittedInitialBoundsRef.current = true;
    }
  }, [playArea]);

  const circlePickerFittedRef = useRef(false);
  useEffect(() => {
    if (
      clickMode.kind !== 'PICK_PLAY_AREA_CIRCLE' &&
      clickMode.kind !== 'PICK_LOBBY_RULE_PREVIEW'
    ) {
      circlePickerFittedRef.current = false;
      return;
    }
    if (circlePickerFittedRef.current) return;

    const map = mapRef.current;
    const refBoundary =
      clickMode.kind === 'PICK_PLAY_AREA_CIRCLE'
        ? (official81247Boundary ?? playArea)
        : playArea;
    if (!map || !refBoundary) return;

    if (
      safeFitGeoJsonBounds(map, refBoundary, {
        padding: [28, 28],
        maxZoom: 14,
        animate: false,
      })
    ) {
      circlePickerFittedRef.current = true;
      return;
    }

    // Falls der Karten-Container beim Tab-Wechsel erst einen Frame später Layout-Größe erhält
    const retryTimer = setTimeout(() => {
      const currentMap = mapRef.current;
      if (
        currentMap &&
        safeFitGeoJsonBounds(currentMap, refBoundary, {
          padding: [28, 28],
          maxZoom: 14,
          animate: false,
        })
      ) {
        circlePickerFittedRef.current = true;
      }
    }, 70);
    return () => clearTimeout(retryTimer);
  }, [clickMode.kind, official81247Boundary, playArea]);

  // 1. Einheitlicher möglicher Versteckbereich:
  //    - Nur die Grenze des noch möglichen Versteckbereichs wird gezeichnet.
  //    - Der gesamte ausgeschlossene Rest wird einheitlich orange gefärbt (keine überlappenden Linien!).
  useEffect(() => {
    const group = hidingZoneLayerRef.current;
    if (!group) return;
    group.clearLayers();

    const renderer = canvasRendererRef.current ?? undefined;

    L.geoJSON(excludedOrangeMask, {
      style: {
        renderer,
        stroke: false,
        fillColor: '#FF4D00',
        fillOpacity: 0.34,
      },
      interactive: false,
    }).addTo(group);

    if (possibleHidingArea) {
      L.geoJSON(possibleHidingArea, {
        style: {
          renderer,
          color: '#FF4D00',
          weight: 2.5,
          opacity: 0.95,
          fillOpacity: 0,
        },
        interactive: false,
      }).addTo(group);
    }

    // Dauerhafter roter Außenrand des gesamten Spielbereichs
    L.geoJSON(playArea, {
      style: {
        renderer,
        color: '#DC2626',
        weight: 3.5,
        opacity: 0.96,
        fillOpacity: 0,
      },
      interactive: false,
    }).addTo(group);

    // Clip-Pfad der Vorschau-Renderer bei Gebietswechsel sicher aktualisieren
    for (const r of [
      previewFillRendererRef.current,
      previewStrokeRendererRef.current,
    ]) {
      const internal = r as (InternalLeafletCanvas & { _redraw?: () => void }) | null;
      if (internal && internal._ctx && internal._map) {
        internal._redraw?.();
      }
    }
  }, [playArea, possibleHidingArea, excludedOrangeMask]);

  const anchorPickLat =
    clickMode.kind === 'PICK_ANCHOR_POINT' ? (anchorGpsOrigin?.lat ?? null) : null;
  const anchorPickLng =
    clickMode.kind === 'PICK_ANCHOR_POINT' ? (anchorGpsOrigin?.lng ?? null) : null;

  // 2. Optionale Live-Vorschau per GPU-geclippten Canvas-Panes (ohne turf.union / turf.intersect!)
  useEffect(() => {
    const group = previewLayerRef.current;
    if (!group) return;
    group.clearLayers();

    const fillRenderer = previewFillRendererRef.current ?? undefined;
    const strokeRenderer = previewStrokeRendererRef.current ?? undefined;
    const maskRenderer = canvasRendererRef.current ?? undefined;

    const isThermoPreview =
      activePreviewQuestion === 'THERMOMETER' || Boolean(thermoPointA);
    const thermoDist =
      effectiveThermoA && effectiveThermoB
        ? distanceMeters(effectiveThermoA, effectiveThermoB)
        : 0;
    const isThermoValid =
      !isThermoPreview || thermoDist >= thermoTargetDistanceMeters;
    const previewColor =
      activePreviewQuestion === 'OSM_GREEN'
        ? '#16A34A'
        : isThermoValid
          ? '#0D9488'
          : '#F59E0B';
    const refRingColor = '#64748B';
    const refAccentColor = '#0D9488';

    const originPt =
      previewOriginLat !== null && previewOriginLng !== null
        ? { lat: previewOriginLat, lng: previewOriginLng }
        : null;

    // 2a. Schnelle native Canvas-Vorschau je Fragetyp (0 Polygon-Unions!)
    if (activePreviewQuestion === 'OSM_TRANSIT' || activePreviewQuestion === 'OSM_RECYCLING') {
      const pts =
        activePreviewQuestion === 'OSM_TRANSIT'
          ? getTransitLatLngsForPlayArea(playArea)
          : getRecyclingLatLngsForPlayArea(playArea);
      const radiusM = Math.max(
        10,
        Math.round(
          activePreviewQuestion === 'OSM_TRANSIT'
            ? (qConfig.transitDistanceMeters ?? qConfig.environmentDistanceMeters)
            : qConfig.environmentDistanceMeters
        )
      );
      for (const pt of pts) {
        L.circle([pt.lat, pt.lng], {
          renderer: fillRenderer,
          radius: radiusM,
          stroke: false,
          fillColor: previewColor,
          fillOpacity: 1,
          interactive: false,
        }).addTo(group);
      }
    } else if (activePreviewQuestion === 'OSM_GREEN') {
      void greenDataRev;
      const greenFeatures = getPreviewGreenPolygonsForPlayArea(playArea);
      for (const feat of greenFeatures) {
        L.geoJSON(feat, {
          style: {
            renderer: fillRenderer,
            stroke: false,
            fillColor: previewColor,
            fillOpacity: 1,
          },
          interactive: false,
        }).addTo(group);
      }
    } else if (activePreviewQuestion === 'RADIUS_RADAR' && originPt) {
      L.circle([originPt.lat, originPt.lng], {
        renderer: fillRenderer,
        radius: selectedRadius,
        stroke: false,
        fillColor: previewColor,
        fillOpacity: 1,
        interactive: false,
      }).addTo(group);
      L.circle([originPt.lat, originPt.lng], {
        renderer: strokeRenderer,
        radius: selectedRadius,
        color: previewColor,
        weight: 2.2,
        fill: false,
        interactive: false,
      }).addTo(group);
    } else if (activePreviewQuestion === 'DONUT_RING' && originPt) {
      const step = Math.max(10, Math.round(qConfig.donutRingStepMeters));
      L.circle([originPt.lat, originPt.lng], {
        renderer: fillRenderer,
        radius: step,
        stroke: false,
        fillColor: previewColor,
        fillOpacity: 1,
        interactive: false,
      }).addTo(group);

      for (const [innerMul, outerMul] of [
        [2, 3],
        [4, 5],
      ] as const) {
        const outerRing = buildLatLngCircleRing(originPt, outerMul * step, 64);
        const innerRing = buildLatLngCircleRing(originPt, innerMul * step, 64).reverse();
        L.polygon([outerRing, innerRing], {
          renderer: fillRenderer,
          stroke: false,
          fillColor: previewColor,
          fillOpacity: 1,
          fillRule: 'evenodd',
          interactive: false,
        }).addTo(group);
      }

      for (let k = 1; k <= 5; k++) {
        L.circle([originPt.lat, originPt.lng], {
          renderer: strokeRenderer,
          radius: k * step,
          color: previewColor,
          weight: 1.8,
          fill: false,
          interactive: false,
        }).addTo(group);
      }
    } else if (activePreviewQuestion === 'CONE_45' && originPt) {
      const steps = 48;
      const startBearing = coneBearingDeg - 22.5;
      const conePts: L.LatLngExpression[] = [[originPt.lat, originPt.lng]];
      for (let i = 0; i <= steps; i++) {
        const angle = (((startBearing + (i * 45) / steps) % 360) + 360) % 360;
        const pt = destinationPoint(originPt, 25_000, angle);
        conePts.push([pt.lat, pt.lng]);
      }
      L.polygon(conePts, {
        renderer: fillRenderer,
        stroke: false,
        fillColor: previewColor,
        fillOpacity: 1,
        interactive: false,
      }).addTo(group);
      L.polygon(conePts, {
        renderer: strokeRenderer,
        color: previewColor,
        weight: 2.2,
        fill: false,
        interactive: false,
      }).addTo(group);
    } else if (activePreviewQuestion === 'SPLIT_NS' && originPt) {
      const halfPts: L.LatLngExpression[] = [
        [originPt.lat, originPt.lng - 0.6],
        [originPt.lat, originPt.lng + 0.6],
        [originPt.lat + 0.45, originPt.lng + 0.6],
        [originPt.lat + 0.45, originPt.lng - 0.6],
      ];
      L.polygon(halfPts, {
        renderer: fillRenderer,
        stroke: false,
        fillColor: previewColor,
        fillOpacity: 1,
        interactive: false,
      }).addTo(group);
      L.polyline(
        [
          [originPt.lat, originPt.lng - 0.6],
          [originPt.lat, originPt.lng + 0.6],
        ],
        {
          renderer: strokeRenderer,
          color: previewColor,
          weight: 2.2,
          interactive: false,
        }
      ).addTo(group);
    } else if (activePreviewQuestion === 'SPLIT_EW' && originPt) {
      const halfPts: L.LatLngExpression[] = [
        [originPt.lat - 0.45, originPt.lng],
        [originPt.lat + 0.45, originPt.lng],
        [originPt.lat + 0.45, originPt.lng + 0.6],
        [originPt.lat - 0.45, originPt.lng + 0.6],
      ];
      L.polygon(halfPts, {
        renderer: fillRenderer,
        stroke: false,
        fillColor: previewColor,
        fillOpacity: 1,
        interactive: false,
      }).addTo(group);
      L.polyline(
        [
          [originPt.lat - 0.45, originPt.lng],
          [originPt.lat + 0.45, originPt.lng],
        ],
        {
          renderer: strokeRenderer,
          color: previewColor,
          weight: 2.2,
          interactive: false,
        }
      ).addTo(group);
    } else if (isThermoPreview && effectiveThermoA && effectiveThermoB) {
      const midLat = (effectiveThermoA.lat + effectiveThermoB.lat) / 2;
      const midLng = (effectiveThermoA.lng + effectiveThermoB.lng) / 2;
      const mPerLng = metersPerDegLngAt(midLat);
      const ax = (effectiveThermoA.lng - midLng) * mPerLng;
      const ay = (effectiveThermoA.lat - midLat) * METERS_PER_DEG_LAT;
      const bx = (effectiveThermoB.lng - midLng) * mPerLng;
      const by = (effectiveThermoB.lat - midLat) * METERS_PER_DEG_LAT;
      const vx = bx - ax;
      const vy = by - ay;
      const len = Math.hypot(vx, vy) || 1;
      const ux = vx / len;
      const uy = vy / len;
      const nx = -uy;
      const ny = ux;
      const span = 25_000;
      const toLL = (x: number, y: number): [number, number] => [
        midLat + y / METERS_PER_DEG_LAT,
        midLng + x / mPerLng,
      ];
      const p1 = toLL(nx * span, ny * span);
      const p2 = toLL(-nx * span, -ny * span);
      const p3 = toLL(-nx * span + ux * span, -ny * span + uy * span);
      const p4 = toLL(nx * span + ux * span, ny * span + uy * span);

      if (activePreviewQuestion === 'THERMOMETER') {
        L.polygon([p1, p2, p3, p4], {
          renderer: fillRenderer,
          stroke: false,
          fillColor: previewColor,
          fillOpacity: 1,
          interactive: false,
        }).addTo(group);
        L.polyline([p1, p2], {
          renderer: strokeRenderer,
          color: previewColor,
          weight: 2.2,
          interactive: false,
        }).addTo(group);
      }
    }

    if (isThermoPreview && effectiveThermoA) {
      // Zielkreis um Startpunkt A
      L.circle([effectiveThermoA.lat, effectiveThermoA.lng], {
        renderer: strokeRenderer,
        radius: thermoTargetDistanceMeters,
        color: refRingColor,
        weight: 1.5,
        dashArray: '5 5',
        fillOpacity: 0,
        interactive: false,
      }).addTo(group);

      if (effectiveThermoB) {
        L.polyline(
          [
            [effectiveThermoA.lat, effectiveThermoA.lng],
            [effectiveThermoB.lat, effectiveThermoB.lng],
          ],
          {
            renderer: strokeRenderer,
            color: previewColor,
            weight: 2.5,
            dashArray: '6 4',
            interactive: false,
          }
        ).addTo(group);

        if (activePreviewQuestion === 'THERMOMETER' && !thermoPointA) {
          L.marker([effectiveThermoB.lat, effectiveThermoB.lng], {
            icon: createSelectionPinIcon('B', 'secondary'),
            draggable: false,
          })
            .bindTooltip(`STOPP [B] (${thermoTargetDistanceMeters} m)`)
            .addTo(group);
        }
      }

      const isLobbyRuleMode = clickMode.kind === 'PICK_LOBBY_RULE_PREVIEW';
      const markerA = L.marker([effectiveThermoA.lat, effectiveThermoA.lng], {
        icon: createSelectionPinIcon('A', 'primary'),
        draggable: isLobbyRuleMode && Boolean(onLobbyPreviewOriginRef.current),
      })
        .bindTooltip(
          isLobbyRuleMode
            ? 'START [A] — Karte antippen oder ziehen zum Verschieben'
            : 'THERMOMETER START [A]'
        )
        .addTo(group);

      if (isLobbyRuleMode) {
        markerA.on('dragend', () => {
          const pos = markerA.getLatLng();
          onLobbyPreviewOriginRef.current?.({ lat: pos.lat, lng: pos.lng });
        });
      }
    }

    // Lobby-Vorschau: Zusätzliche Hilfsringe für alle Radar-Distanzen + verschiebbarer Pin P
    if (clickMode.kind === 'PICK_LOBBY_RULE_PREVIEW') {
      if (
        (activePreviewQuestion === 'DONUT_RING' ||
          activePreviewQuestion === 'RADIUS_RADAR') &&
        previewOriginLat !== null &&
        previewOriginLng !== null
      ) {
        if (activePreviewQuestion === 'RADIUS_RADAR') {
          const allRadii = getRadiusRadarOptions(questionConfig);
          for (const r of allRadii) {
            if (r === selectedRadius) continue;
            L.circle([previewOriginLat, previewOriginLng], {
              renderer: strokeRenderer,
              radius: r,
              color: refRingColor,
              weight: 1.5,
              dashArray: '5 4',
              fillOpacity: 0,
              interactive: false,
            }).addTo(group);
          }
        }

        const markerP = L.marker([previewOriginLat, previewOriginLng], {
          icon: createSelectionPinIcon('P', 'primary'),
          draggable: Boolean(onLobbyPreviewOriginRef.current),
        })
          .bindTooltip('MITTELPUNKT [P] — Karte antippen oder ziehen')
          .addTo(group);

        markerP.on('dragend', () => {
          const pos = markerP.getLatLng();
          onLobbyPreviewOriginRef.current?.({ lat: pos.lat, lng: pos.lng });
        });
      }
    }

    if (anchorPickLat !== null && anchorPickLng !== null) {
      L.circle([anchorPickLat, anchorPickLng], {
        renderer: maskRenderer,
        radius: ANCHOR_MANUAL_ADJUST_MAX_METERS,
        color: refAccentColor,
        weight: 2,
        dashArray: '6 5',
        fillColor: refAccentColor,
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(group);
    }

    if (clickMode.kind === 'PICK_PLAY_AREA_CIRCLE') {
      if (official81247Boundary) {
        L.geoJSON(official81247Boundary, {
          style: {
            renderer: maskRenderer,
            color: refAccentColor,
            weight: 2.5,
            dashArray: '7 5',
            fillColor: refAccentColor,
            fillOpacity: 0.04,
          },
          interactive: false,
        }).addTo(group);
      }

      if (circlePlayAreaCenter) {
        const markerCenter = L.marker(
          [circlePlayAreaCenter.lat, circlePlayAreaCenter.lng],
          {
            icon: createSelectionPinIcon('M', 'primary'),
            draggable: Boolean(onCircleCenterRef.current),
          }
        )
          .bindTooltip(
            'KREIS-MITTELPUNKT [M] — Ziehen oder innerhalb von 81247 antippen'
          )
          .addTo(group);

        markerCenter.on('dragend', () => {
          const pos = markerCenter.getLatLng();
          onCircleCenterRef.current?.({ lat: pos.lat, lng: pos.lng });
        });
      }
    }
  }, [
    activePreviewQuestion,
    coneBearingDeg,
    effectiveThermoA,
    effectiveThermoB,
    thermoPointA,
    thermoTargetDistanceMeters,
    anchorPickLat,
    anchorPickLng,
    clickMode.kind,
    official81247Boundary,
    circlePlayAreaCenter,
    previewOriginLat,
    previewOriginLng,
    playArea,
    possibleHidingArea,
    qConfig,
    questionConfig,
    selectedRadius,
    greenDataRev,
  ]);

  // 2b. Viewport-gefilterte Standort-Punkte für Haltestellen/Wertstoffinseln beim Hineinzoomen
  useEffect(() => {
    const dotsGroup = previewPoiDotsLayerRef.current;
    const map = mapRef.current;
    if (!dotsGroup || !map) return;
    dotsGroup.clearLayers();

    if (
      clickMode.kind !== 'PICK_LOBBY_RULE_PREVIEW' ||
      (activePreviewQuestion !== 'OSM_RECYCLING' &&
        activePreviewQuestion !== 'OSM_TRANSIT')
    ) {
      return;
    }

    const strokeRenderer = previewStrokeRendererRef.current ?? undefined;
    const allPts =
      activePreviewQuestion === 'OSM_RECYCLING'
        ? getRecyclingLatLngsForPlayArea(playArea)
        : getTransitLatLngsForPlayArea(playArea);

    let visiblePts = allPts;
    if (allPts.length > 300) {
      if (!hasUsableMapViewport(map) || map.getZoom() < 13) {
        return;
      }
      const viewBounds = map.getBounds().pad(0.15);
      visiblePts = allPts.filter((pt) =>
        viewBounds.contains([pt.lat, pt.lng])
      );
      if (visiblePts.length > 450) {
        return;
      }
    }

    for (const pt of visiblePts) {
      L.circleMarker([pt.lat, pt.lng], {
        renderer: strokeRenderer,
        radius: 4,
        color: '#FFFFFF',
        weight: 1.5,
        fillColor: '#0F766E',
        fillOpacity: 1,
        interactive: false,
      }).addTo(dotsGroup);
    }
  }, [
    clickMode.kind,
    activePreviewQuestion,
    playArea,
    viewportRev,
  ]);

  // 3. Eigene Position, autorisierte Team-Beacons sowie Hider-Anchor (in-place aktualisiert ohne Flackern!)
  useEffect(() => {
    const group = actorsLayerRef.current;
    if (!group) return;

    // 3a. Hider-Anchor Marker
    if (showAnchorAndLeash && anchorPoint) {
      const popupHtml = `<strong>Versteck</strong><br/>Radius: ${LEASH_RADIUS_METERS} m (±${anchorPoint.accuracy} m)`;
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

    // 3a2. Manhunt Verstecker-Ping Marker & Unschärfe-Kreis (für Sucher & Verstecker sichtbar)
    const lastPing = publishedRadar?.lastPing ?? null;
    if (lastPing) {
      const isFallbackSource = lastPing.source !== 'LIVE_GPS';
      const sourceLabel =
        lastPing.source === 'LIVE_GPS'
          ? 'Live-GPS'
          : lastPing.source === 'LAST_KNOWN_GPS'
            ? `Letzter bekannter GPS-Standort${
                typeof lastPing.lastFixAgeMs === 'number'
                  ? ` (vor ${Math.max(1, Math.round(lastPing.lastFixAgeMs / 60000))} Min.)`
                  : ''
              }`
            : 'Zonen-Fallback (kein GPS-Signal der Verstecker verfügbar)';
      const pingPopupHtml = `<strong>VERSTECKER-PING #${lastPing.pingNumber}</strong><br/>Quelle: ${sourceLabel}<br/>Genauigkeit: ±${Math.round(lastPing.accuracy)} m`;
      const pingRadius = Math.max(15, Math.min(250, Math.round(lastPing.accuracy)));
      const ringColor = isFallbackSource ? '#F59E0B' : '#FF4D00';

      if (!manhuntPingCircleRef.current) {
        manhuntPingCircleRef.current = L.circle([lastPing.lat, lastPing.lng], {
          renderer: canvasRendererRef.current ?? undefined,
          radius: pingRadius,
          color: ringColor,
          weight: 2,
          dashArray: '5 4',
          fillColor: ringColor,
          fillOpacity: 0.14,
          interactive: false,
        }).addTo(group);
      } else {
        manhuntPingCircleRef.current.setLatLng([lastPing.lat, lastPing.lng]);
        manhuntPingCircleRef.current.setRadius(pingRadius);
        manhuntPingCircleRef.current.setStyle({
          color: ringColor,
          fillColor: ringColor,
        });
      }

      const nextIcon = createManhuntPingIcon(lastPing.pingNumber, isFallbackSource);
      if (!manhuntPingMarkerRef.current) {
        manhuntPingMarkerRef.current = L.marker([lastPing.lat, lastPing.lng], {
          icon: nextIcon,
          zIndexOffset: 650,
        })
          .bindPopup(pingPopupHtml)
          .addTo(group);
      } else {
        manhuntPingMarkerRef.current.setLatLng([lastPing.lat, lastPing.lng]);
        manhuntPingMarkerRef.current.setIcon(nextIcon);
        manhuntPingMarkerRef.current.setPopupContent(pingPopupHtml);
      }
    } else {
      if (manhuntPingMarkerRef.current) {
        group.removeLayer(manhuntPingMarkerRef.current);
        manhuntPingMarkerRef.current = null;
      }
      if (manhuntPingCircleRef.current) {
        group.removeLayer(manhuntPingCircleRef.current);
        manhuntPingCircleRef.current = null;
      }
    }

    // 3a3. Freigegebener Live-Verstecker-Standort nach Ablauf der weiteren Minute (für alle Teams sichtbar)
    if (
      exposedHiderLocation &&
      Number.isFinite(exposedHiderLocation.lat) &&
      Number.isFinite(exposedHiderLocation.lng)
    ) {
      const exposedPopup = `<strong>Verstecker-Standort freigegeben</strong><br/>Zonenverstoß > 2 Min.${
        typeof exposedHiderLocation.accuracy === 'number'
          ? `<br/>GPS: ±${Math.round(exposedHiderLocation.accuracy)} m`
          : ''
      }`;
      if (!exposedHiderMarkerRef.current) {
        exposedHiderMarkerRef.current = L.marker(
          [exposedHiderLocation.lat, exposedHiderLocation.lng],
          {
            icon: createExposedHiderIcon(),
            zIndexOffset: 900,
          }
        )
          .bindPopup(exposedPopup)
          .addTo(group);
      } else {
        exposedHiderMarkerRef.current.setLatLng([
          exposedHiderLocation.lat,
          exposedHiderLocation.lng,
        ]);
        exposedHiderMarkerRef.current.setPopupContent(exposedPopup);
      }
    } else if (exposedHiderMarkerRef.current) {
      group.removeLayer(exposedHiderMarkerRef.current);
      exposedHiderMarkerRef.current = null;
    }

    // 3a4. Live-Verstecker-Standorte für Overview-Account & Sardinen-Rudel
    const seenLiveHiders = new Set<string>();
    if (liveHiderLocations) {
      for (const [uidKey, hLoc] of Object.entries(liveHiderLocations)) {
        if (!hLoc || !Number.isFinite(hLoc.lat) || !Number.isFinite(hLoc.lng)) continue;
        seenLiveHiders.add(uidKey);
        const hPopup = `<strong>Verstecker · ${hLoc.label}</strong><br/>GPS: ±${Math.round(hLoc.accuracy)} m`;
        const existingH = liveHiderMarkersRef.current.get(uidKey);
        if (!existingH) {
          const marker = L.marker([hLoc.lat, hLoc.lng], {
            icon: createLiveHiderOverviewIcon(hLoc.label),
            zIndexOffset: 700,
          })
            .bindPopup(hPopup)
            .addTo(group);
          liveHiderMarkersRef.current.set(uidKey, { marker, label: hLoc.label });
        } else {
          existingH.marker.setLatLng([hLoc.lat, hLoc.lng]);
          existingH.marker.setPopupContent(hPopup);
          if (existingH.label !== hLoc.label) {
            existingH.marker.setIcon(createLiveHiderOverviewIcon(hLoc.label));
            existingH.label = hLoc.label;
          }
        }
      }
    }
    for (const [uidKey, entry] of liveHiderMarkersRef.current.entries()) {
      if (!seenLiveHiders.has(uidKey)) {
        group.removeLayer(entry.marker);
        liveHiderMarkersRef.current.delete(uidKey);
      }
    }

    // 3b. Individuelle Fisch-Positionen aller sichtbaren Sucher-Teammitglieder (kein Team-Logo / keine Büchse)
    const seenMemberKeys = new Set<string>();
    let ownSeekerFishRendered = false;
    const nowMs = Date.now();

    for (const mItem of teamMemberMarkers) {
      if (!Number.isFinite(mItem.lat) || !Number.isFinite(mItem.lng)) continue;
      seenMemberKeys.add(mItem.key);
      if (mItem.isOwnPlayer) {
        ownSeekerFishRendered = true;
      }

      const iconSignature = [
        mItem.playerId,
        mItem.playerName,
        mItem.avatar ?? '',
        mItem.teamName,
        mItem.teamColor,
        mItem.isOnlineNow ? '1' : '0',
        mItem.offsetPxX,
        mItem.offsetPxY,
      ].join('|');

      const popupHtml = renderTeamMemberFishPopupHtml({
        playerId: mItem.playerId,
        playerName: mItem.playerName,
        avatar: mItem.avatar,
        teamName: mItem.teamName,
        teamColor: mItem.teamColor,
        accuracyMeters: mItem.accuracy,
        isOnlineNow: mItem.isOnlineNow,
        lastOnlineAt: mItem.lastOnlineAt,
        nowMs,
      });

      const existing = memberFishMarkersRef.current.get(mItem.key);
      if (!existing) {
        const marker = L.marker([mItem.lat, mItem.lng], {
          icon: createTeamMemberFishIcon(mItem),
          zIndexOffset: mItem.isOwnPlayer ? 620 : 560,
        })
          .bindPopup(popupHtml)
          .addTo(group);
        memberFishMarkersRef.current.set(mItem.key, {
          marker,
          iconSignature,
        });
      } else {
        existing.marker.setLatLng([mItem.lat, mItem.lng]);
        existing.marker.setPopupContent(popupHtml);
        if (existing.iconSignature !== iconSignature) {
          existing.marker.setIcon(createTeamMemberFishIcon(mItem));
          existing.iconSignature = iconSignature;
        }
      }
    }

    for (const [mKey, entry] of memberFishMarkersRef.current.entries()) {
      if (!seenMemberKeys.has(mKey)) {
        group.removeLayer(entry.marker);
        memberFishMarkersRef.current.delete(mKey);
      }
    }

    // 3c. Eigene Position (wird ausgeblendet, wenn der eigene Sucher-Fisch bereits exakt dort gezeichnet wird)
    if (ownFix && !ownSeekerFishRendered) {
      const tooltipText = `Genauigkeit ±${Math.round(ownFix.accuracy)} m`;
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
        const popupHtml = `<strong>Notfall · ${msg.senderName}</strong><br/>${msg.text}<br/>Standort: ${msg.lat.toFixed(5)}, ${msg.lng.toFixed(5)}${typeof msg.accuracy === 'number' ? ` (±${Math.round(msg.accuracy)} m)` : ''}`;
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
    publishedRadar?.lastPing,
    exposedHiderLocation,
    liveHiderLocations,
    teamMemberMarkers,
    emergencyMessages,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !emergencyFocusTarget) return;
    safeCenterMapOnLatLng(
      map,
      emergencyFocusTarget.lat,
      emergencyFocusTarget.lng,
      17
    );
  }, [emergencyFocusTarget]);

  const handleCenterOnOwnFix = useCallback(() => {
    const map = mapRef.current;
    if (map && ownFix) {
      safeCenterMapOnLatLng(map, ownFix.lat, ownFix.lng, 16);
    }

    const maybePromise = onRequestGpsPermission?.();
    if (!ownFix && maybePromise && typeof maybePromise.then === 'function') {
      void maybePromise.then((freshFix) => {
        const currentMap = mapRef.current;
        if (freshFix && currentMap) {
          safeCenterMapOnLatLng(currentMap, freshFix.lat, freshFix.lng, 16);
        }
      });
    }
  }, [ownFix, onRequestGpsPermission]);

  const handleFitPlayArea = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    safeFitGeoJsonBounds(map, playArea, {
      padding: [36, 52],
      maxZoom: 16,
      animate: false,
    });
  }, [playArea]);

  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = {
      centerOnOwnFix: handleCenterOnOwnFix,
      fitPlayArea: handleFitPlayArea,
    };
    return () => {
      if (actionsRef.current) {
        actionsRef.current = null;
      }
    };
  }, [actionsRef, handleCenterOnOwnFix, handleFitPlayArea]);

  return (
    <div className="sardinen-map-viewport relative h-full w-full bg-[var(--bg-page)]">
      <div
        ref={containerRef}
        data-testid="leaflet-map-container"
        className="h-full w-full z-0"
      />
    </div>
  );
};

function sameLatLng(
  a: { lat: number; lng: number } | null | undefined,
  b: { lat: number; lng: number } | null | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.lat === b.lat && a.lng === b.lng;
}

function sameTeamMemberMarkers(
  a: TeamMemberMapMarker[] = [],
  b: TeamMemberMapMarker[] = []
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ma = a[i];
    const mb = b[i];
    if (
      ma.key !== mb.key ||
      ma.lat !== mb.lat ||
      ma.lng !== mb.lng ||
      ma.accuracy !== mb.accuracy ||
      ma.playerName !== mb.playerName ||
      ma.avatar !== mb.avatar ||
      ma.teamName !== mb.teamName ||
      ma.teamColor !== mb.teamColor ||
      ma.isOnlineNow !== mb.isOnlineNow ||
      ma.offsetPxX !== mb.offsetPxX ||
      ma.offsetPxY !== mb.offsetPxY
    ) {
      return false;
    }
  }
  return true;
}

export const GameMap = React.memo(GameMapInner, (prev, next) => {
  if (
    prev.playArea !== next.playArea ||
    prev.playAreaConfirmed !== next.playAreaConfirmed ||
    prev.official81247Boundary !== next.official81247Boundary ||
    prev.isOwnSideHider !== next.isOwnSideHider ||
    prev.showAnchorAndLeash !== next.showAnchorAndLeash ||
    prev.activePreviewQuestion !== next.activePreviewQuestion ||
    prev.coneBearingDeg !== next.coneBearingDeg ||
    prev.selectedRadius !== next.selectedRadius ||
    prev.layoutInvalidationKey !== next.layoutInvalidationKey ||
    prev.hiddenClueIds !== next.hiddenClueIds ||
    prev.emergencyMessages !== next.emergencyMessages ||
    prev.emergencyFocusTarget !== next.emergencyFocusTarget ||
    prev.clickMode.kind !== next.clickMode.kind ||
    prev.clickMode.label !== next.clickMode.label
  ) {
    return false;
  }

  if (!sameLatLng(prev.circlePlayAreaCenter, next.circlePlayAreaCenter)) {
    return false;
  }

  if (
    !sameLatLng(prev.ownFix, next.ownFix) ||
    (prev.ownFix?.accuracy ?? null) !== (next.ownFix?.accuracy ?? null)
  ) {
    return false;
  }

  if (!sameLatLng(prev.anchorGpsOrigin, next.anchorGpsOrigin)) {
    return false;
  }

  if (
    !sameLatLng(prev.anchorPoint, next.anchorPoint) ||
    (prev.anchorPoint?.accuracy ?? null) !== (next.anchorPoint?.accuracy ?? null)
  ) {
    return false;
  }

  if (!sameLatLng(prev.thermoPointA, next.thermoPointA)) return false;
  if (prev.questionConfig !== next.questionConfig) return false;
  if (!sameLatLng(prev.exposedHiderLocation, next.exposedHiderLocation)) return false;
  if (prev.liveHiderLocations !== next.liveHiderLocations) return false;

  if (prev.publishedRadar !== next.publishedRadar) {
    if (!prev.publishedRadar || !next.publishedRadar) return false;
    if (
      prev.publishedRadar.stage !== next.publishedRadar.stage ||
      prev.publishedRadar.radiusMeters !== next.publishedRadar.radiusMeters ||
      !sameLatLng(prev.publishedRadar.center, next.publishedRadar.center) ||
      (prev.publishedRadar.lastPing?.triggerElapsedMs ?? null) !==
        (next.publishedRadar.lastPing?.triggerElapsedMs ?? null) ||
      (prev.publishedRadar.lastPing?.pingNumber ?? null) !==
        (next.publishedRadar.lastPing?.pingNumber ?? null) ||
      !sameLatLng(prev.publishedRadar.lastPing, next.publishedRadar.lastPing)
    ) {
      return false;
    }
  }

  if (!sameTeamMemberMarkers(prev.teamMemberMarkers, next.teamMemberMarkers)) {
    return false;
  }

  if (prev.clues !== next.clues) {
    if (prev.clues.length !== next.clues.length) return false;
    for (let i = 0; i < prev.clues.length; i++) {
      if (prev.clues[i].id !== next.clues[i].id) return false;
    }
  }

  return true;
});
