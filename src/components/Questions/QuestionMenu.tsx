import React, { useState } from 'react';
import {
  Compass,
  Thermometer,
  Radar,
  Train,
  Trees,
  CircleDot,
  Disc,
  Camera,
  Mic,
  Crosshair,
  Clock,
  Lock,
} from 'lucide-react';
import {
  MEDIA_RESPONSE_TIMEOUT_NET_MS,
  QUESTION_CATEGORY_MAP,
  QUESTION_PENALTY_MS,
} from '../../config/gameConfig';
import { distanceMeters } from '../../geo/distance';
import type { DatabaseAdapter } from '../../services/databaseAdapter';
import { generateRandomId } from '../../services/qrService';
import type {
  ClueRecord,
  ClueRequest,
  GeoFix,
  LatLng,
  MemberRecord,
  PublicGameState,
  QuestionParams,
  QuestionType,
  RadiusOptionMeters,
  TeamPublic,
} from '../../types/game';
import { formatDurationClock } from '../../utils/formatting';
import type { MapClickInteractionMode } from '../Map/GameMap';
import { ClueHistoryList } from './ClueHistoryList';

export interface QuestionMenuProps {
  adapter: DatabaseAdapter;
  publicState: PublicGameState;
  netElapsedMs: number;
  ownMember: MemberRecord;
  ownTeam: TeamPublic | null;
  ownFix: GeoFix | null;
  canUseMapClicks: boolean;
  teamRequests: Record<string, ClueRequest>;
  teamClues: Record<string, ClueRecord>;
  hiddenClueIds: Set<string>;
  onToggleClueOverlay: (clueId: string) => void;
  selectedSplitPoint: LatLng | null;
  onSelectSplitPoint: (pt: LatLng | null) => void;
  thermoPointA: LatLng | null;
  onSetThermoPointA: (pt: LatLng | null) => void;
  thermoPointB: LatLng | null;
  onSetThermoPointB: (pt: LatLng | null) => void;
  coneBearingDeg: number;
  onChangeConeBearingDeg: (deg: number) => void;
  conePreviewEnabled: boolean;
  onToggleConePreview: (enabled: boolean) => void;
  onRequestMapPointPick: (mode: MapClickInteractionMode) => void;
  onNavigateToMap: () => void;
}

const RADIUS_OPTIONS: RadiusOptionMeters[] = [50, 100, 250, 500, 1000];

export const QuestionMenu: React.FC<QuestionMenuProps> = ({
  adapter,
  publicState,
  netElapsedMs,
  ownMember,
  ownTeam,
  ownFix,
  canUseMapClicks,
  teamRequests,
  teamClues,
  hiddenClueIds,
  onToggleClueOverlay,
  selectedSplitPoint,
  onSelectSplitPoint,
  thermoPointA,
  onSetThermoPointA,
  thermoPointB,
  onSetThermoPointB,
  coneBearingDeg,
  onChangeConeBearingDeg,
  conePreviewEnabled,
  onToggleConePreview,
  onRequestMapPointPick,
  onNavigateToMap,
}) => {
  const [splitAxis, setSplitAxis] = useState<'SPLIT_NS' | 'SPLIT_EW'>('SPLIT_NS');
  const [selectedRadius, setSelectedRadius] = useState<RadiusOptionMeters>(250);
  const [busyType, setBusyType] = useState<QuestionType | null>(null);

  const isPaused = publicState.status === 'PAUSED' || publicState.pausedAt !== null;
  const isHidingPhase =
    publicState.status !== 'RUNNING' || publicState.currentPhase === 'HIDING';
  const isSeekerActive = Boolean(
    ownMember.side === 'SEEKER' && ownTeam && ownTeam.status === 'ACTIVE'
  );

  const canPurchase = Boolean(
    isSeekerActive && !isPaused && !isHidingPhase && ownFix
  );

  const allRequests = Object.values(teamRequests);
  const openManualRequest = allRequests.find(
    (r) =>
      r.sessionId === publicState.sessionId &&
      r.category === 4 &&
      (r.status === 'PENDING' ||
        r.status === 'PROCESSING' ||
        r.status === 'AWAITING_HIDER_MEDIA')
  );

  const effectiveEndpointB: LatLng | null = thermoPointB ?? ownFix;
  const thermoDistanceMeters =
    thermoPointA && effectiveEndpointB
      ? Math.round(distanceMeters(thermoPointA, effectiveEndpointB))
      : 0;

  const purchaseClue = async (
    questionType: QuestionType,
    params: QuestionParams = {}
  ) => {
    if (!canPurchase || !ownTeam || !ownFix) return;
    setBusyType(questionType);
    try {
      const category = QUESTION_CATEGORY_MAP[questionType];
      const penaltyMs = QUESTION_PENALTY_MS[category];
      const req: ClueRequest = {
        id: generateRandomId('req'),
        teamId: ownTeam.id,
        requestedByUid: ownMember.uid,
        sessionId: publicState.sessionId,
        questionType,
        category,
        params,
        status: 'PENDING',
        penaltyMs,
        penaltyApplied: false,
        refundedMs: 0,
        createdAt: adapter.getServerNow(),
        requesterSnapshotLocation: {
          lat: ownFix.lat,
          lng: ownFix.lng,
          accuracy: Math.round(ownFix.accuracy),
        },
      };
      await adapter.createClueRequest(req);
      if (questionType === 'THERMOMETER') {
        onSetThermoPointA(null);
        onSetThermoPointB(null);
      }
      if (questionType === 'CONE_45') {
        onToggleConePreview(false);
      }
    } finally {
      setBusyType(null);
    }
  };

  // Für Verstecker & Spielleiter zeigt dieser Tab das Protokoll aller Hinweise im Spiel
  if (!isSeekerActive) {
    return (
      <div className="cmf-drafting-bg h-full overflow-y-auto p-4 text-[var(--text-main)]">
        <div className="mx-auto max-w-2xl space-y-4 pb-10">
          <div className="cmf-chassis p-5">
            <span className="cmf-badge-teal inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
              TELEMETRIE // LOGBUCH
            </span>
            <h2 className="font-dot mt-1.5 text-xl text-[var(--text-main)]">
              Ausgewertete Hinweise & Overlays
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {ownTeam?.status === 'JOINED_SARDINES'
                ? 'Ihr seid bereits bei den Sardinen! Hier seht ihr eure bisherigen Hinweise.'
                : 'Übersicht aller ausgewerteten Team-Hinweise der laufenden Runde.'}
            </p>
          </div>

          <ClueHistoryList
            clues={Object.values(teamClues)}
            requestsMap={teamRequests}
            hiddenClueIds={hiddenClueIds}
            gameStartTimestamp={publicState.gameStartTimestamp}
            onToggleClueOverlay={onToggleClueOverlay}
            onAcknowledgeMedia={(tId, rId) =>
              adapter.acknowledgeAndStripMedia(tId, rId, adapter.getServerNow())
            }
          />
        </div>
      </div>
    );
  }

  const manualRemainingMs = openManualRequest
    ? Math.max(
        0,
        (openManualRequest.mediaDeadlineNetElapsedMs ??
          netElapsedMs + MEDIA_RESPONSE_TIMEOUT_NET_MS) - netElapsedMs
      )
    : 0;

  return (
    <div className="cmf-drafting-bg h-full overflow-y-auto p-4 text-[var(--text-main)]">
      <div className="mx-auto max-w-2xl space-y-5 pb-12">
        <div className="cmf-chassis p-5">
          <span className="cmf-badge-amber inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
            HINWEIS-INSTRUMENTE // {ownTeam?.name}
          </span>
          <h2 className="font-dot mt-1.5 text-xl text-[var(--text-main)]">
            Hinweise gegen Zeitstrafe kaufen
          </h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Alle Ergebnisse & Karten-Overlays sind ausschließlich für euer eigenes Team sichtbar.
          </p>
        </div>

        {(isPaused || isHidingPhase || !ownFix) && (
          <div className="cmf-module flex items-center gap-3 p-3.5 text-xs font-medium text-[var(--text-main)]">
            <div className="cmf-oled flex h-9 w-9 shrink-0 items-center justify-center text-[var(--cmf-amber)]">
              <Lock className="h-4 w-4" />
            </div>
            <span>
              {isPaused
                ? 'Hinweis-Käufe sind während einer Spielpause gesperrt.'
                : isHidingPhase
                  ? 'Hinweis-Käufe starten ab 10:00 (sobald die Versteckphase beendet ist).'
                  : 'Warte auf gültige GPS-Position für deinen Anfrage-Snapshot ...'}
            </span>
          </div>
        )}

        {/* KATEGORIE 1: Richtungs- & Kartenteiler (+2 Min.) */}
        <section className="cmf-module p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between border-b cmf-divider pb-3">
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              Kategorie 1: Richtungs- & Kartenteiler
            </h3>
            <span className="cmf-badge-teal rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
              +2 Min. Strafzeit
            </span>
          </div>

          {/* 1A/1B: Nord/Süd oder Ost/West */}
          <div className="cmf-well p-3.5 space-y-3">
            <div className="flex items-center gap-2 font-tech text-[11px] font-bold tracking-wider text-[var(--text-main)] uppercase">
              <Compass className="h-4 w-4 text-[var(--cmf-teal)]" />
              Nord/Süd- oder Ost/West-Teilung
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSplitAxis('SPLIT_NS')}
                className={`font-tech min-h-[40px] flex-1 px-3 text-xs font-bold uppercase ${
                  splitAxis === 'SPLIT_NS' ? 'cmf-btn-active' : 'cmf-btn-secondary'
                }`}
              >
                Nord/Süd-Teilung
              </button>
              <button
                type="button"
                onClick={() => setSplitAxis('SPLIT_EW')}
                className={`font-tech min-h-[40px] flex-1 px-3 text-xs font-bold uppercase ${
                  splitAxis === 'SPLIT_EW' ? 'cmf-btn-active' : 'cmf-btn-secondary'
                }`}
              >
                Ost/West-Teilung
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  onRequestMapPointPick({
                    kind: 'PICK_SPLIT_POINT',
                    label: 'Tippe auf die Karte, um den Teilungspunkt zu wählen',
                  });
                  onNavigateToMap();
                }}
                className="cmf-btn-secondary font-tech inline-flex min-h-[38px] items-center gap-1.5 bg-white/60 px-3 py-1.5 text-[11px] font-bold text-[var(--text-main)] uppercase"
              >
                <Crosshair className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                {selectedSplitPoint
                  ? `Punkt [${selectedSplitPoint.lat.toFixed(4)}, ${selectedSplitPoint.lng.toFixed(4)}]`
                  : 'Teilungspunkt auf Karte wählen (sonst GPS)'}
              </button>
              {selectedSplitPoint && (
                <button
                  type="button"
                  onClick={() => onSelectSplitPoint(null)}
                  className="cmf-btn-secondary font-tech min-h-[38px] px-2.5 text-[11px] font-bold uppercase"
                >
                  Auf GPS zurücksetzen
                </button>
              )}
            </div>
            <button
              type="button"
              data-testid="buy-split-clue-btn"
              disabled={!canPurchase || busyType !== null}
              onClick={() =>
                void purchaseClue(splitAxis, {
                  splitPoint:
                    selectedSplitPoint ??
                    (ownFix ? { lat: ownFix.lat, lng: ownFix.lng } : undefined),
                })
              }
              className="cmf-btn-primary font-dot min-h-[44px] w-full px-4 py-2 text-xs font-bold"
            >
              Hinweis kaufen (+2 Min.)
            </button>
          </div>

          {/* 1C: Thermometer (100m Laufweg) */}
          <div className="cmf-well p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-tech text-[11px] font-bold tracking-wider text-[var(--text-main)] uppercase">
                <Thermometer className="h-4 w-4 text-[var(--cmf-teal)]" />
                Thermometer (100 m Laufweg)
              </span>
              {thermoPointA && (
                <span
                  className={`cmf-oled px-2.5 py-1 font-tech text-[11px] font-bold ${
                    thermoDistanceMeters >= 100
                      ? 'text-[var(--cmf-teal)]'
                      : 'text-[var(--cmf-amber)]'
                  }`}
                >
                  DISTANZ: {thermoDistanceMeters} / 100 M
                </span>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!ownFix}
                onClick={() =>
                  ownFix && onSetThermoPointA({ lat: ownFix.lat, lng: ownFix.lng })
                }
                className={`font-tech min-h-[40px] flex-1 px-3 py-1.5 text-xs font-bold uppercase ${
                  thermoPointA ? 'cmf-btn-active' : 'cmf-btn-secondary bg-white/60 text-[var(--text-main)]'
                }`}
              >
                {thermoPointA
                  ? 'Startpunkt A neu setzen (GPS)'
                  : 'Startpunkt setzen (Punkt A)'}
              </button>

              {canUseMapClicks && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onRequestMapPointPick({
                        kind: 'PICK_THERMO_A',
                        label: 'Tippe auf die Karte für Thermometer-Punkt A',
                      });
                      onNavigateToMap();
                    }}
                    className="cmf-btn-secondary font-tech min-h-[40px] bg-white/60 px-2.5 text-[11px] font-bold text-[var(--text-main)] uppercase"
                  >
                    A per Klick
                  </button>
                  <button
                    type="button"
                    disabled={!thermoPointA}
                    onClick={() => {
                      onRequestMapPointPick({
                        kind: 'PICK_THERMO_B',
                        label: 'Tippe mindestens 100 m entfernt für Punkt B',
                      });
                      onNavigateToMap();
                    }}
                    className="cmf-btn-secondary font-tech min-h-[40px] bg-white/60 px-2.5 text-[11px] font-bold text-[var(--text-main)] uppercase"
                  >
                    B per Klick
                  </button>
                </>
              )}
            </div>

            <button
              type="button"
              disabled={
                !canPurchase ||
                !thermoPointA ||
                !effectiveEndpointB ||
                thermoDistanceMeters < 100 ||
                busyType !== null
              }
              onClick={() =>
                thermoPointA &&
                effectiveEndpointB &&
                void purchaseClue('THERMOMETER', {
                  pointA: thermoPointA,
                  pointB: effectiveEndpointB,
                })
              }
              className="cmf-btn-primary font-dot min-h-[44px] w-full px-4 py-2 text-xs font-bold"
            >
              Endpunkt prüfen (Punkt B, +2 Min.)
            </button>
          </div>

          {/* 1D: 45-Grad-Radarkegel */}
          <div className="cmf-well p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-tech text-[11px] font-bold tracking-wider text-[var(--text-main)] uppercase">
                <Radar className="h-4 w-4 text-[var(--cmf-teal)]" />
                45-Grad-Radarkegel
              </span>
              <span className="cmf-oled px-2.5 py-1 font-dot text-xs text-[var(--cmf-amber)]">
                PEILUNG {coneBearingDeg}°
              </span>
            </div>

            <input
              type="range"
              min={0}
              max={360}
              step={1}
              aria-label="Kegel-Richtung in Grad"
              value={coneBearingDeg}
              onChange={(e) => {
                onChangeConeBearingDeg(Number(e.target.value));
                if (!conePreviewEnabled) onToggleConePreview(true);
              }}
              className="cmf-range w-full"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onToggleConePreview(true);
                  onNavigateToMap();
                }}
                className="cmf-btn-secondary font-tech min-h-[44px] bg-white/60 px-3 text-[11px] font-bold text-[var(--text-main)] uppercase"
              >
                Vorschau auf Karte
              </button>
              <button
                type="button"
                disabled={!canPurchase || busyType !== null}
                onClick={() =>
                  void purchaseClue('CONE_45', { bearingDeg: coneBearingDeg })
                }
                className="cmf-btn-primary font-dot min-h-[44px] flex-1 px-4 py-2 text-xs font-bold"
              >
                Kegel scannen (+2 Min.)
              </button>
            </div>
          </div>
        </section>

        {/* KATEGORIE 2: Umgebungs-Checks mit OSM/Overpass (+3 Min.) */}
        <section className="cmf-module p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between border-b cmf-divider pb-3">
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              Kategorie 2: 81247-Umgebungs-Checks (OSM)
            </h3>
            <span className="cmf-badge-amber rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
              +3 Min. Strafzeit
            </span>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              disabled={!canPurchase || busyType !== null}
              onClick={() => void purchaseClue('OSM_TRANSIT')}
              className="cmf-btn-secondary flex min-h-[54px] items-center justify-center gap-2 px-3.5 py-3 text-xs font-bold text-[var(--text-main)]"
            >
              <Train className="h-4 w-4 shrink-0 text-[var(--cmf-amber)]" />
              <span>ÖPNV im Umkreis von 150 m? (+3 Min.)</span>
            </button>

            <button
              type="button"
              disabled={!canPurchase || busyType !== null}
              onClick={() => void purchaseClue('OSM_GREEN')}
              className="cmf-btn-secondary flex min-h-[54px] items-center justify-center gap-2 px-3.5 py-3 text-xs font-bold text-[var(--text-main)]"
            >
              <Trees className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
              <span>Liegt das Versteck in einer Grünfläche? (+3 Min.)</span>
            </button>
          </div>
        </section>

        {/* KATEGORIE 3: Distanz-Scanner (+4 Min.) */}
        <section className="cmf-module p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between border-b cmf-divider pb-3">
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              Kategorie 3: Distanz-Scanner
            </h3>
            <span className="cmf-badge-amber rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
              +4 Min. Strafzeit
            </span>
          </div>

          <div className="cmf-well p-3.5 space-y-3">
            <div className="flex items-center gap-2 font-tech text-[11px] font-bold tracking-wider text-[var(--text-main)] uppercase">
              <CircleDot className="h-4 w-4 text-[var(--cmf-teal)]" />
              Radius-Radar um euren Standort
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelectedRadius(r)}
                  className={`font-tech min-h-[38px] flex-1 px-2 text-xs font-bold ${
                    selectedRadius === r ? 'cmf-btn-active' : 'cmf-btn-secondary'
                  }`}
                >
                  {r}m
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!canPurchase || busyType !== null}
              onClick={() =>
                void purchaseClue('RADIUS_RADAR', {
                  radiusMeters: selectedRadius,
                })
              }
              className="cmf-btn-primary font-dot min-h-[44px] w-full px-4 py-2 text-xs font-bold"
            >
              Radius prüfen (+4 Min.)
            </button>
          </div>

          <button
            type="button"
            data-testid="buy-donut-clue-btn"
            disabled={!canPurchase || busyType !== null}
            onClick={() => void purchaseClue('DONUT_RING')}
            className="cmf-btn-active font-dot flex min-h-[48px] w-full items-center justify-center gap-2 px-4 py-3 text-xs font-bold"
          >
            <Disc className="h-4 w-4 text-[var(--cmf-teal)]" />
            Donut-Ring kaufen (+4 Min.) • 200m-Distanzband
          </button>
        </section>

        {/* KATEGORIE 4: Manuelle Foto- & Audio-Hinweise (+5 Min.) */}
        <section className="cmf-module p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between border-b cmf-divider pb-3">
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              Kategorie 4: Live-Foto & 10s-Audio der Sardinen
            </h3>
            <span className="cmf-badge-orange rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
              +5 Min. Strafzeit
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Antwortfrist für die Verstecker: 120s Netto-Spielzeit. Bei Ablauf oder Ablehnung erhaltet ihr automatisch -5 Min. erstattet + einen kostenlosen Donut-Ring!
          </p>

          {openManualRequest ? (
            <div className="cmf-oled flex items-center justify-between p-3.5 text-xs">
              <span className="flex items-center gap-2 font-tech font-bold text-[#F8FAFC] uppercase">
                <Clock className="h-4 w-4 animate-spin text-[var(--cmf-amber)]" />
                Warte auf Verstecker-Antwort ...
              </span>
              <span className="font-dot text-base text-[var(--cmf-amber)]">
                {formatDurationClock(manualRemainingMs)}
              </span>
            </div>
          ) : (
            <div className="grid gap-2">
              <button
                type="button"
                disabled={!canPurchase || busyType !== null}
                onClick={() => void purchaseClue('MEDIA_SKY')}
                className="cmf-btn-secondary flex min-h-[46px] items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-bold text-[var(--text-main)]"
              >
                <Camera className="h-4 w-4 text-[var(--cmf-teal)]" />
                Foto vom Himmel / Blätterdach anfordern (+5 Min.)
              </button>
              <button
                type="button"
                disabled={!canPurchase || busyType !== null}
                onClick={() => void purchaseClue('MEDIA_GROUND')}
                className="cmf-btn-secondary flex min-h-[46px] items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-bold text-[var(--text-main)]"
              >
                <Camera className="h-4 w-4 text-[var(--cmf-amber)]" />
                Foto vom Boden anfordern (+5 Min.)
              </button>
              <button
                type="button"
                disabled={!canPurchase || busyType !== null}
                onClick={() => void purchaseClue('MEDIA_AUDIO')}
                className="cmf-btn-secondary flex min-h-[46px] items-center justify-center gap-2 px-3.5 py-2.5 text-xs font-bold text-[var(--text-main)]"
              >
                <Mic className="h-4 w-4 text-[var(--cmf-orange)]" />
                10s Audio anfordern (+5 Min.)
              </button>
            </div>
          )}
        </section>

        {/* Bisherige Hinweise & Overlay-Schalter */}
        <section className="space-y-2.5">
          <h3 className="font-industrial px-1 text-base text-[var(--text-main)]">
            Eure ausgewerteten Hinweise ({Object.keys(teamClues).length})
          </h3>
          <ClueHistoryList
            clues={Object.values(teamClues)}
            requestsMap={teamRequests}
            hiddenClueIds={hiddenClueIds}
            gameStartTimestamp={publicState.gameStartTimestamp}
            onToggleClueOverlay={onToggleClueOverlay}
            onAcknowledgeMedia={(tId, rId) =>
              adapter.acknowledgeAndStripMedia(tId, rId, adapter.getServerNow())
            }
          />
        </section>
      </div>
    </div>
  );
};
