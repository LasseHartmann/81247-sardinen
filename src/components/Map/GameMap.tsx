import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { LocateFixed, Maximize2 } from 'lucide-react';
import type { Feature, Polygon } from 'geojson';
import {
  ANCHOR_MANUAL_ADJUST_MAX_METERS,
  LEASH_RADIUS_METERS,
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_ZOOM,
  THERMOMETER_MIN_DISTANCE_METERS,
} from '../../config/gameConfig';
import { buildQuestionPreviewGeoJson } from '../../geo/clueGeometry';
import { destinationPoint, distanceMeters } from '../../geo/distance';
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
  QuestionType,
  RadiusOptionMeters,
  TeamLocation,
  TeamPublic,
} from '../../types/game';
import {
  createAnchorPointIcon,
  createEmergencyBeaconIcon,
  createExposedHiderIcon,
  createLiveHiderOverviewIcon,
  createManhuntPingIcon,
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
  exposedHiderLocation?: {
    lat: number;
    lng: number;
    accuracy?: number;
  } | null;
  liveHiderLocations?: Record<string, { lat: number; lng: number; accuracy: number; label: string }>;
  visibleTeamLocations: Record<string, TeamLocation | null>;
  teamsPublic: Record<string, TeamPublic>;
  activeTeamIds?: string[];
  clues: ClueRecord[];
  hiddenClueIds: Set<string>;
  activePreviewQuestion?: QuestionType | null;
  coneBearingDeg?: number;
  selectedRadius?: RadiusOptionMeters;
  thermoPointA?: LatLng | null;
  thermoPointB?: LatLng | null;
  onChangeThermoPointA?: (pt: LatLng) => void;
  onChangeThermoPointB?: (pt: LatLng) => void;
  clickMode: MapClickInteractionMode;
  onMapCoordinateClick?: (pt: LatLng) => void;
  onRequestGpsPermission?: () => Promise<GeoFix | null> | void;
  layoutInvalidationKey?: string | number;
  hasBottomDock?: boolean;
  emergencyMessages?: EmergencyMessage[];
  emergencyFocusTarget?: { lat: number; lng: number; seq: number } | null;
}

const GameMapInner: React.FC<GameMapProps> = ({
  playArea,
  ownFix,
  anchorGpsOrigin = null,
  isOwnSideHider,
  anchorPoint,
  showAnchorAndLeash,
  publishedRadar,
  exposedHiderLocation = null,
  liveHiderLocations,
  visibleTeamLocations,
  teamsPublic,
  activeTeamIds,
  clues,
  hiddenClueIds,
  activePreviewQuestion = null,
  coneBearingDeg = 0,
  selectedRadius = 250,
  thermoPointA,
  thermoPointB,
  onChangeThermoPointA,
  onChangeThermoPointB,
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
  const canvasRendererRef = useRef<L.Canvas | null>(null);

  const hidingZoneLayerRef = useRef<L.LayerGroup | null>(null);
  const previewLayerRef = useRef<L.LayerGroup | null>(null);
  const actorsLayerRef = useRef<L.LayerGroup | null>(null);

  const anchorMarkerRef = useRef<L.Marker | null>(null);
  const manhuntPingMarkerRef = useRef<L.Marker | null>(null);
  const manhuntPingCircleRef = useRef<L.Circle | null>(null);
  const exposedHiderMarkerRef = useRef<L.Marker | null>(null);
  const liveHiderMarkersRef = useRef<Map<string, { marker: L.Marker; label: string }>>(
    new Map()
  );
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
  const activePreviewRef = useRef(activePreviewQuestion);
  activePreviewRef.current = activePreviewQuestion;
  const onThermoARef = useRef(onChangeThermoPointA);
  onThermoARef.current = onChangeThermoPointA;
  const onThermoBRef = useRef(onChangeThermoPointB);
  onThermoBRef.current = onChangeThermoPointB;

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

  const previewOriginLat = anchorGpsOrigin?.lat ?? null;
  const previewOriginLng = anchorGpsOrigin?.lng ?? null;

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

  const effectiveThermoB = useMemo<LatLng | null>(() => {
    if (
      thermoPointB &&
      (!effectiveThermoA || distanceMeters(effectiveThermoA, thermoPointB) >= 5)
    ) {
      return thermoPointB;
    }
    if (activePreviewQuestion === 'THERMOMETER' && effectiveThermoA) {
      return destinationPoint(effectiveThermoA, THERMOMETER_MIN_DISTANCE_METERS, 45);
    }
    return thermoPointB ?? null;
  }, [thermoPointB, effectiveThermoA, activePreviewQuestion]);

  const liveConePreview = useMemo(() => {
    if (!activePreviewQuestion) return null;
    const originPt =
      previewOriginLat !== null && previewOriginLng !== null
        ? { lat: previewOriginLat, lng: previewOriginLng }
        : null;
    return buildQuestionPreviewGeoJson(
      activePreviewQuestion,
      {
        bearingDeg: coneBearingDeg,
        radiusMeters: selectedRadius,
        pointA: effectiveThermoA ?? undefined,
        pointB: effectiveThermoB ?? undefined,
      },
      originPt,
      possibleHidingArea ?? playArea
    );
  }, [
    activePreviewQuestion,
    coneBearingDeg,
    selectedRadius,
    effectiveThermoA,
    effectiveThermoB,
    previewOriginLat,
    previewOriginLng,
    possibleHidingArea,
    playArea,
  ]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const canvasRenderer = L.canvas({ padding: 0.35 });
    canvasRendererRef.current = canvasRenderer;

    const map = L.map(el, {
      center: MAP_DEFAULT_CENTER,
      zoom: MAP_DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
      renderer: canvasRenderer,
      fadeAnimation: false,
    });

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
    actorsLayerRef.current = L.layerGroup().addTo(map);

    map.on('click', (ev: L.LeafletMouseEvent) => {
      const pt = {
        lat: ev.latlng.lat,
        lng: ev.latlng.lng,
      };
      if (clickModeRef.current.kind !== 'NONE' && onClickRef.current) {
        onClickRef.current(pt);
        return;
      }
      if (activePreviewRef.current === 'THERMOMETER' && onThermoBRef.current) {
        onThermoBRef.current(pt);
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
      manhuntPingMarkerRef.current = null;
      manhuntPingCircleRef.current = null;
      exposedHiderMarkerRef.current = null;
      liveHiderMarkersRef.current.clear();
      ownMarkerRef.current = null;
      teamMarkersRef.current.clear();
      emergencyMarkersRef.current.clear();
      canvasRendererRef.current = null;
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

    // Dauerhafter roter Außenrand des gesamten Spielbereichs (81247)
    L.geoJSON(playArea, {
      style: {
        renderer,
        color: '#DC2626',
        weight: 3.5,
        opacity: 0.95,
        fillOpacity: 0,
      },
      interactive: false,
    }).addTo(group);
  }, [playArea, possibleHidingArea, excludedOrangeMask]);

  const anchorPickLat =
    clickMode.kind === 'PICK_ANCHOR_POINT' ? (anchorGpsOrigin?.lat ?? null) : null;
  const anchorPickLng =
    clickMode.kind === 'PICK_ANCHOR_POINT' ? (anchorGpsOrigin?.lng ?? null) : null;

  // 2. Optionale Live-Vorschau (nur wenn aktiv im Hinweis-Menü eingeschaltet) + Thermometer-Pins A/B
  useEffect(() => {
    const group = previewLayerRef.current;
    if (!group) return;
    group.clearLayers();
    const renderer = canvasRendererRef.current ?? undefined;

    const isThermoPreview = activePreviewQuestion === 'THERMOMETER';
    const thermoDist =
      effectiveThermoA && effectiveThermoB
        ? distanceMeters(effectiveThermoA, effectiveThermoB)
        : 0;
    const isThermoValid =
      !isThermoPreview || thermoDist >= THERMOMETER_MIN_DISTANCE_METERS;
    const previewColor = isThermoValid ? '#00A896' : '#F59E0B';

    if (liveConePreview) {
      L.geoJSON(liveConePreview, {
        style: {
          renderer,
          color: previewColor,
          weight: 2.2,
          fillColor: previewColor,
          fillOpacity: 0.2,
        },
        interactive: false,
      }).addTo(group);
    }

    let abLine: L.Polyline | null = null;
    if (isThermoPreview && effectiveThermoA) {
      // 250-Meter-Mindestradius um Startpunkt A als Orientierungskreis
      L.circle([effectiveThermoA.lat, effectiveThermoA.lng], {
        renderer,
        radius: THERMOMETER_MIN_DISTANCE_METERS,
        color: '#64748B',
        weight: 1.5,
        dashArray: '5 5',
        fillOpacity: 0,
        interactive: false,
      }).addTo(group);

      if (effectiveThermoB) {
        abLine = L.polyline(
          [
            [effectiveThermoA.lat, effectiveThermoA.lng],
            [effectiveThermoB.lat, effectiveThermoB.lng],
          ],
          {
            renderer,
            color: previewColor,
            weight: 2.5,
            dashArray: '6 4',
            interactive: false,
          }
        ).addTo(group);
      }
    }

    if (effectiveThermoA && (thermoPointA || isThermoPreview)) {
      const markerA = L.marker([effectiveThermoA.lat, effectiveThermoA.lng], {
        icon: createSelectionPinIcon('A', 'primary'),
        draggable: Boolean(isThermoPreview && onThermoARef.current),
      })
        .bindTooltip('THERMOMETER START [A]')
        .addTo(group);

      markerA.on('drag', () => {
        const pos = markerA.getLatLng();
        if (abLine && effectiveThermoB) {
          abLine.setLatLngs([
            [pos.lat, pos.lng],
            [effectiveThermoB.lat, effectiveThermoB.lng],
          ]);
        }
      });
      markerA.on('dragend', () => {
        const pos = markerA.getLatLng();
        onThermoARef.current?.({ lat: pos.lat, lng: pos.lng });
      });
    }

    if (effectiveThermoB && (thermoPointB || isThermoPreview)) {
      const markerB = L.marker([effectiveThermoB.lat, effectiveThermoB.lng], {
        icon: createSelectionPinIcon('B', 'secondary'),
        draggable: Boolean(onThermoBRef.current),
      })
        .bindTooltip(
          `THERMOMETER ENDE [B] (${Math.round(thermoDist)} m) — Ziehen oder Karte antippen`
        )
        .addTo(group);

      markerB.on('drag', () => {
        const pos = markerB.getLatLng();
        if (abLine && effectiveThermoA) {
          abLine.setLatLngs([
            [effectiveThermoA.lat, effectiveThermoA.lng],
            [pos.lat, pos.lng],
          ]);
        }
      });
      markerB.on('dragend', () => {
        const pos = markerB.getLatLng();
        onThermoBRef.current?.({ lat: pos.lat, lng: pos.lng });
      });
    }

    if (anchorPickLat !== null && anchorPickLng !== null) {
      L.circle([anchorPickLat, anchorPickLng], {
        renderer,
        radius: ANCHOR_MANUAL_ADJUST_MAX_METERS,
        color: '#00A896',
        weight: 2,
        dashArray: '6 5',
        fillColor: '#00A896',
        fillOpacity: 0.1,
        interactive: false,
      }).addTo(group);
    }
  }, [
    liveConePreview,
    activePreviewQuestion,
    effectiveThermoA,
    effectiveThermoB,
    thermoPointA,
    thermoPointB,
    anchorPickLat,
    anchorPickLng,
  ]);

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
      const exposedPopup = `<strong>LIVE // VERSTECKER-STANDORT FREIGEGEBEN</strong><br/>Zonen-/Bereichsverstoß > 2 Min.${
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
        const hPopup = `<strong>VERSTECKER // ${hLoc.label.toUpperCase()}</strong><br/>GPS: ±${Math.round(hLoc.accuracy)}M`;
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
    publishedRadar?.lastPing,
    exposedHiderLocation,
    liveHiderLocations,
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
    <div className="sardinen-map-viewport relative h-full w-full bg-[var(--bg-page)]">
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

      {(clickMode.kind !== 'NONE' || activePreviewQuestion === 'THERMOMETER') && (
        <div className="cmf-oled pointer-events-none absolute top-14 right-3 left-3 z-[450] mx-auto flex max-w-sm items-center justify-center gap-2 px-3.5 py-2 text-center text-[11px] font-tech tracking-wide uppercase shadow-xl">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--cmf-amber)]" />
          <span className="text-[#F8FAFC]">
            {clickMode.kind !== 'NONE'
              ? (clickMode.label ?? 'Tippe auf die Karte, um den Punkt zu setzen')
              : 'Tippe auf die Karte oder ziehe Pin B, um den Endpunkt zu wählen'}
          </span>
        </div>
      )}
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

function sameTeamLocations(
  a: Record<string, TeamLocation | null>,
  b: Record<string, TeamLocation | null>
): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    const la = a[k];
    const lb = b[k];
    if (la === lb) continue;
    if (!la || !lb) return false;
    if (
      la.lat !== lb.lat ||
      la.lng !== lb.lng ||
      la.accuracy !== lb.accuracy ||
      la.activeContributorCount !== lb.activeContributorCount
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
    prev.isOwnSideHider !== next.isOwnSideHider ||
    prev.showAnchorAndLeash !== next.showAnchorAndLeash ||
    prev.activePreviewQuestion !== next.activePreviewQuestion ||
    prev.coneBearingDeg !== next.coneBearingDeg ||
    prev.selectedRadius !== next.selectedRadius ||
    prev.layoutInvalidationKey !== next.layoutInvalidationKey ||
    prev.hasBottomDock !== next.hasBottomDock ||
    prev.teamsPublic !== next.teamsPublic ||
    prev.activeTeamIds !== next.activeTeamIds ||
    prev.hiddenClueIds !== next.hiddenClueIds ||
    prev.emergencyMessages !== next.emergencyMessages ||
    prev.emergencyFocusTarget !== next.emergencyFocusTarget ||
    prev.clickMode.kind !== next.clickMode.kind ||
    prev.clickMode.label !== next.clickMode.label
  ) {
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
  if (!sameLatLng(prev.thermoPointB, next.thermoPointB)) return false;
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

  if (!sameTeamLocations(prev.visibleTeamLocations, next.visibleTeamLocations)) {
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
