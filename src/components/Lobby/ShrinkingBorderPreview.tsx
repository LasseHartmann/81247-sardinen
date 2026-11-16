import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as turf from '@turf/turf';
import L from 'leaflet';
import {
   Crosshair,
  Pause,
  Play,
  Radar,
  Shuffle,
} from 'lucide-react';
import {
  MANHUNT_RADAR_RADII,
  MAP_DEFAULT_CENTER,
  MAP_DEFAULT_ZOOM,
} from '../../config/gameConfig';
import { isPointInPlayArea, snapPointIntoPlayArea } from '../../geo/boundary';
import {
  buildExcludedOrangeMask,
  computePossibleHidingArea,
} from '../../geo/hidingArea';
import {
  generateInsideOutRadarStages,
  getClassicRadarRadiiForPlayArea,
  getPlayAreaAreaSqMeters,
} from '../../geo/radar';
import type {
  GameMode,
  LatLng,
  PlayAreaState,
  PublishedRadarCircle,
  RadarSchedule,
  RadarStageId,
} from '../../types/game';
import { formatDurationClock } from '../../utils/formatting';

export interface ShrinkingBorderPreviewProps {
  playArea: PlayAreaState;
  gameMode?: GameMode;
  radarSchedule: RadarSchedule;
}

type PreviewStageSelection = 'ALL' | 0 | RadarStageId;

const STAGE_RING_COLORS: Record<RadarStageId, string> = {
  1: '#38BDF8',
  2: '#2DD4BF',
  3: '#FACC15',
  4: '#FB923C',
  5: '#FF4D00',
};

function computePolygonCenterInside(playArea: PlayAreaState): LatLng {
  if (
    playArea.shapeType === 'CUSTOM_CIRCLE' &&
    playArea.circle &&
    Number.isFinite(playArea.circle.center.lat) &&
    Number.isFinite(playArea.circle.center.lng)
  ) {
    return {
      lat: playArea.circle.center.lat,
      lng: playArea.circle.center.lng,
    };
  }
  try {
    const centerFeat = turf.centerOfMass(playArea.polygon);
    const [lng, lat] = centerFeat.geometry.coordinates;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const candidate = { lat, lng };
      return isPointInPlayArea(candidate, playArea.polygon)
        ? candidate
        : snapPointIntoPlayArea(candidate, playArea.polygon);
    }
  } catch {
    // Fallback unten
  }
  return {
    lat: MAP_DEFAULT_CENTER[0],
    lng: MAP_DEFAULT_CENTER[1],
  };
}

function createSeededPreviewRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function formatAreaHumanDe(areaSqM: number): string {
  if (!Number.isFinite(areaSqM) || areaSqM <= 0) return '–';
  if (areaSqM >= 1_000_000) {
    return `${(areaSqM / 1_000_000).toFixed(2).replace('.', ',')} km²`;
  }
  return `${Math.round(areaSqM).toLocaleString('de-DE')} m²`;
}

export const ShrinkingBorderPreview: React.FC<ShrinkingBorderPreviewProps> = ({
  playArea,
  gameMode = 'CLASSIC',
  radarSchedule,
}) => {
  const isManhunt = gameMode === 'MANHUNT';
  const [selectedStage, setSelectedStage] =
    useState<PreviewStageSelection>('ALL');
  const [isPlaying, setIsPlaying] = useState(false);
  const [seedCounter, setSeedCounter] = useState(1);
  const [customAnchor, setCustomAnchor] = useState<LatLng | null>(null);

  const defaultAnchor = useMemo(
    () => computePolygonCenterInside(playArea),
    [playArea]
  );

  // Wenn das Gebiet wechselt und customAnchor außerhalb liegt, auf neuen Mittelpunkt zurücksetzen
  const effectiveAnchor = useMemo<LatLng>(() => {
    if (
      customAnchor &&
      isPointInPlayArea(customAnchor, playArea.polygon)
    ) {
      return customAnchor;
    }
    return defaultAnchor;
  }, [customAnchor, defaultAnchor, playArea.polygon]);

  const stageRadii = useMemo<Record<RadarStageId, number>>(() => {
    if (isManhunt) {
      return { ...MANHUNT_RADAR_RADII };
    }
    return getClassicRadarRadiiForPlayArea(playArea);
  }, [isManhunt, playArea]);

  const mapAreaSqM = useMemo(
    () => getPlayAreaAreaSqMeters(playArea),
    [playArea]
  );

  const simulatedStages = useMemo(() => {
    const rng = createSeededPreviewRng(81247 + seedCounter * 7919);
    return generateInsideOutRadarStages(
      effectiveAnchor,
      radarSchedule,
      rng,
      stageRadii
    );
  }, [effectiveAnchor, radarSchedule, seedCounter, stageRadii]);

  // Automatische Schrumpf-Animation durch die Stufen 0 -> 1 -> 2 -> 3 -> 4 -> 5
  useEffect(() => {
    if (!isPlaying) return;
    const sequence: PreviewStageSelection[] = [0, 1, 2, 3, 4, 5];
    const timer = setInterval(() => {
      setSelectedStage((prev) => {
        const idx = sequence.indexOf(prev);
        if (idx < 0 || idx >= sequence.length - 1) {
          return sequence[0];
        }
        return sequence[idx + 1];
      });
    }, 1350);
    return () => clearInterval(timer);
  }, [isPlaying]);

  const activeStageSecret = useMemo(() => {
    if (typeof selectedStage !== 'number' || selectedStage === 0) {
      return null;
    }
    return simulatedStages.find((s) => s.stage === selectedStage) ?? null;
  }, [selectedStage, simulatedStages]);

  // Leaflet-Vorschaukarte
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const playAreaPolygonRef = useRef(playArea.polygon);
  playAreaPolygonRef.current = playArea.polygon;

  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el || mapRef.current) return;
    if (el.clientWidth < 16 || el.clientHeight < 16) return;

    try {
      const map = L.map(el, {
        center: [effectiveAnchor.lat, effectiveAnchor.lng],
        zoom: MAP_DEFAULT_ZOOM,
        zoomControl: false,
        attributionControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
      }).addTo(map);

      layerGroupRef.current = L.layerGroup().addTo(map);

      map.on('click', (ev: L.LeafletMouseEvent) => {
        const pt = { lat: ev.latlng.lat, lng: ev.latlng.lng };
        const poly = playAreaPolygonRef.current;
        const safePt = isPointInPlayArea(pt, poly)
          ? pt
          : snapPointIntoPlayArea(pt, poly);
        setCustomAnchor(safePt);
      });

      mapRef.current = map;
    } catch {
      // Ignoriere in Headless-/JSDOM-Tests ohne Layout
    }

    return () => {
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {
          // Ignorieren
        }
        mapRef.current = null;
        layerGroupRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bei Änderung des Spielgebiets auf dessen Bounds einpassen
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    try {
      map.invalidateSize({ pan: false });
      const bounds = L.geoJSON(playArea.polygon).getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [18, 18], maxZoom: 15, animate: false });
      }
    } catch {
      // Ignorieren
    }
  }, [playArea.polygon]);

  // Zeichne Spielgebiet, ausgeschlossene orange Maske & alle / gewählte Schrumpfstufe(n)
  useEffect(() => {
    const group = layerGroupRef.current;
    const map = mapRef.current;
    if (!group || !map) return;

    try {
      group.clearLayers();

      if (activeStageSecret) {
        const pubRadar: PublishedRadarCircle = {
          stage: activeStageSecret.stage,
          radiusMeters: activeStageSecret.radiusMeters,
          center: activeStageSecret.center,
        };
        const possibleArea = computePossibleHidingArea({
          playArea: playArea.polygon,
          clues: [],
          hiddenClueIds: new Set(),
          publishedRadar: pubRadar,
        });
        const orangeMask = buildExcludedOrangeMask(possibleArea);

        L.geoJSON(orangeMask, {
          style: {
            stroke: false,
            fillColor: '#FF4D00',
            fillOpacity: 0.34,
          },
          interactive: false,
        }).addTo(group);

        if (possibleArea) {
          L.geoJSON(possibleArea, {
            style: {
              color: '#FF4D00',
              weight: 2.5,
              opacity: 0.95,
              fillOpacity: 0,
            },
            interactive: false,
          }).addTo(group);
        }
      }

      // Roter Außenrand des gesamten Spielgebiets
      L.geoJSON(playArea.polygon, {
        style: {
          color: '#DC2626',
          weight: 2.8,
          opacity: 0.9,
          fillOpacity: selectedStage === 0 ? 0.06 : 0,
          fillColor: '#0D9488',
        },
        interactive: false,
      }).addTo(group);

      // Alle 5 geschachtelten Schrumpf-Kreise einzeichnen
      for (const st of simulatedStages) {
        const isSelected =
          selectedStage === 'ALL' || selectedStage === st.stage;
        const ringColor = STAGE_RING_COLORS[st.stage];
        L.circle([st.center.lat, st.center.lng], {
          radius: st.radiusMeters,
          color: isSelected ? ringColor : '#64748B',
          weight: selectedStage === st.stage ? 3 : isSelected ? 2 : 1.2,
          opacity: isSelected ? 0.95 : 0.35,
          dashArray: selectedStage === st.stage ? undefined : '5 4',
          fillColor: ringColor,
          fillOpacity:
            selectedStage === st.stage
              ? 0.14
              : selectedStage === 'ALL'
                ? 0.05
                : 0,
          interactive: false,
        }).addTo(group);
      }

      // Beispiel-Versteckpunkt (Anker) einzeichnen
      L.circleMarker([effectiveAnchor.lat, effectiveAnchor.lng], {
        radius: 6,
        color: '#FFFFFF',
        weight: 2,
        fillColor: '#FF4D00',
        fillOpacity: 1,
      })
        .bindTooltip('Beispiel-Versteck (Karte antippen zum Verschieben)')
        .addTo(group);
    } catch {
      // Ignoriere in JSDOM
    }
  }, [
    activeStageSecret,
    effectiveAnchor,
    playArea.polygon,
    selectedStage,
    simulatedStages,
  ]);

  const stageTriggerRelMs: Record<RadarStageId, number> = {
    1: Math.max(0, radarSchedule.stage1Ms - radarSchedule.hidingDurationMs),
    2: Math.max(0, radarSchedule.stage2Ms - radarSchedule.hidingDurationMs),
    3: Math.max(0, radarSchedule.stage3Ms - radarSchedule.hidingDurationMs),
    4: Math.max(0, radarSchedule.stage4Ms - radarSchedule.hidingDurationMs),
    5: Math.max(0, radarSchedule.stage5Ms - radarSchedule.hidingDurationMs),
  };

  return (
    <div
      data-testid="shrinking-border-preview"
      className="cmf-well space-y-3 rounded-2xl p-3.5"
    >
      {/* Kopfzeile mit Titel, Flächeninfo & Animations-Steuerung */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="cmf-oled flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--cmf-orange)]">
            <Radar className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--cmf-orange)] uppercase">
                SCHRUMPF-GRENZEN // LIVE-VORSCHAU
              </span>
              <span
                data-testid="shrink-preview-area-badge"
                className="cmf-oled rounded-full px-2 py-0.5 font-tech text-[9px] font-bold text-[#F8FAFC]"
              >
                Fläche: {formatAreaHumanDe(mapAreaSqM)}
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)]">
              So zieht sich die Grenze von der Kartengröße ({stageRadii[1]} m)
              bis auf {stageRadii[5]} m um das Versteck zusammen.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="shrink-preview-play-btn"
            onClick={() => {
              if (!isPlaying && selectedStage === 'ALL') {
                setSelectedStage(0);
              }
              setIsPlaying((prev) => !prev);
            }}
            className={`font-tech inline-flex min-h-[34px] items-center gap-1.5 rounded-xl px-3 py-1 text-[10px] font-bold uppercase transition-all ${
              isPlaying
                ? 'cmf-btn-primary'
                : 'cmf-btn-secondary bg-white/90 text-[var(--text-main)]'
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                <span>Stopp</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                <span>Schrumpfen animieren</span>
              </>
            )}
          </button>

          <button
            type="button"
            data-testid="shrink-preview-reroll-btn"
            onClick={() => setSeedCounter((c) => c + 1)}
            title="Zufällige Kreis-Verschiebung neu würfeln"
            className="cmf-btn-secondary inline-flex min-h-[34px] items-center gap-1 rounded-xl px-2.5 py-1 font-tech text-[10px] font-bold uppercase"
          >
            <Shuffle className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Neu würfeln</span>
          </button>
        </div>
      </div>

      {/* Stufen-Auswahlleiste (Alle, Offene Suche, Stufe 1..5) */}
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-7">
        <button
          type="button"
          data-testid="shrink-preview-stage-all"
          onClick={() => {
            setIsPlaying(false);
            setSelectedStage('ALL');
          }}
          className={`flex flex-col items-center justify-center rounded-xl px-2 py-1.5 font-tech transition-all ${
            selectedStage === 'ALL'
              ? 'cmf-btn-active ring-1 ring-[var(--cmf-teal)]'
              : 'cmf-btn-secondary bg-white/80'
          }`}
        >
          <span className="text-[9px] font-bold uppercase opacity-75">
            Übersicht
          </span>
          <span className="font-dot text-xs font-bold">Alle 5 Ringe</span>
        </button>

        <button
          type="button"
          data-testid="shrink-preview-stage-0"
          onClick={() => {
            setIsPlaying(false);
            setSelectedStage(0);
          }}
          className={`flex flex-col items-center justify-center rounded-xl px-2 py-1.5 font-tech transition-all ${
            selectedStage === 0
              ? 'cmf-btn-active ring-1 ring-[var(--cmf-teal)]'
              : 'cmf-btn-secondary bg-white/80'
          }`}
        >
          <span className="text-[9px] font-bold uppercase opacity-75">
            Start (+00:00)
          </span>
          <span className="font-dot text-xs font-bold">Volle Karte</span>
        </button>

        {([1, 2, 3, 4, 5] as RadarStageId[]).map((stageId) => {
          const active = selectedStage === stageId;
          const radius = stageRadii[stageId];
          const relMs = stageTriggerRelMs[stageId];
          return (
            <button
              key={stageId}
              type="button"
              data-testid={`shrink-preview-stage-${stageId}`}
              onClick={() => {
                setIsPlaying(false);
                setSelectedStage(stageId);
              }}
              className={`flex flex-col items-center justify-center rounded-xl px-2 py-1.5 font-tech transition-all ${
                active
                  ? 'cmf-btn-active ring-2 ring-[var(--cmf-orange)]'
                  : 'cmf-btn-secondary bg-white/80'
              }`}
            >
              <span className="flex items-center gap-1 text-[9px] font-bold uppercase opacity-80">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: STAGE_RING_COLORS[stageId] }}
                />
                <span>
                  Stufe {stageId} (+{formatDurationClock(relMs)})
                </span>
              </span>
              <span
                data-testid={`shrink-preview-radius-${stageId}`}
                className="font-dot text-xs font-bold"
              >
                {radius} m
              </span>
            </button>
          );
        })}
      </div>

      {/* Interaktive Karten-Vorschau */}
      <div className="relative overflow-hidden rounded-2xl border border-[var(--shell-border)] bg-[#0F172A] shadow-inner">
        <div
          ref={mapContainerRef}
          data-testid="shrink-preview-map-canvas"
          className="h-56 w-full sm:h-64"
        />

        {/* Kompakte Status-Legende auf der Vorschaukarte */}
        <div className="pointer-events-none absolute right-2 bottom-2 left-2 z-[400] flex flex-wrap items-center justify-between gap-1.5">
          <div className="cmf-oled inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-tech text-[10px] font-bold text-[#F8FAFC]">
            <Crosshair className="h-3 w-3 text-[var(--cmf-orange)]" />
            <span>
              {selectedStage === 'ALL'
                ? `Alle 5 Stufen: ${stageRadii[1]} m → ${stageRadii[2]} m → ${stageRadii[3]} m → ${stageRadii[4]} m → ${stageRadii[5]} m`
                : selectedStage === 0
                  ? 'Offene Suche: Gesamtes Spielgebiet aktiv'
                  : `Stufe ${selectedStage}: Radius ${stageRadii[selectedStage]} m (ab +${formatDurationClock(stageTriggerRelMs[selectedStage])} Suche)`}
            </span>
          </div>
          <span className="cmf-oled hidden rounded-lg px-2 py-1 font-tech text-[9px] text-[#9AA4AE] sm:inline-block">
            Karte antippen = Beispiel-Versteck verschieben
          </span>
        </div>
      </div>
    </div>
  );
};
