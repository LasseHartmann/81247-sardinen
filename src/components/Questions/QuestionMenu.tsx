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
  // Gemeinsamer Vorschau-/Auswahl-State mit der Hauptkarte
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
      <div className="h-full overflow-y-auto bg-slate-950/95 p-4 text-slate-100">
        <div className="mx-auto max-w-2xl space-y-4 pb-10">
          <div>
            <span className="text-xs font-extrabold tracking-wider text-cyan-400 uppercase">
              Hinweis-Logbuch
            </span>
            <h2 className="text-xl font-black text-white">
              Ausgewertete Hinweise & Overlays
            </h2>
            <p className="text-xs text-slate-400">
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
    <div className="h-full overflow-y-auto bg-slate-950/95 p-4 text-slate-100">
      <div className="mx-auto max-w-2xl space-y-5 pb-12">
        <div>
          <span className="text-xs font-extrabold tracking-wider text-amber-400 uppercase">
            Taktischer Hinweis-Shop • {ownTeam?.name}
          </span>
          <h2 className="text-xl font-black text-white">
            Hinweise gegen Zeitstrafe kaufen
          </h2>
          <p className="text-xs text-slate-400">
            Alle Ergebnisse & Karten-Overlays sind ausschließlich für euer eigenes Team sichtbar.
          </p>
        </div>

        {(isPaused || isHidingPhase || !ownFix) && (
          <div className="flex items-center gap-2.5 rounded-2xl border border-amber-500/50 bg-amber-950/40 p-3.5 text-xs font-semibold text-amber-200">
            <Lock className="h-5 w-5 shrink-0 text-amber-400" />
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
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-white">
              Kategorie 1: Richtungs- & Kartenteiler
            </h3>
            <span className="rounded-full bg-rose-950 px-2.5 py-0.5 text-xs font-black text-rose-300">
              +2 Min. Strafzeit
            </span>
          </div>

          {/* 1A/1B: Nord/Süd oder Ost/West */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
              <Compass className="h-4 w-4" /> Nord/Süd- oder Ost/West-Teilung
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSplitAxis('SPLIT_NS')}
                className={`min-h-[40px] flex-1 rounded-lg text-xs font-bold ${
                  splitAxis === 'SPLIT_NS'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'bg-slate-800 text-slate-300'
                }`}
              >
                Nord/Süd-Teilung
              </button>
              <button
                type="button"
                onClick={() => setSplitAxis('SPLIT_EW')}
                className={`min-h-[40px] flex-1 rounded-lg text-xs font-bold ${
                  splitAxis === 'SPLIT_EW'
                    ? 'bg-cyan-500 text-slate-950'
                    : 'bg-slate-800 text-slate-300'
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
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
              >
                <Crosshair className="h-3.5 w-3.5 text-amber-400" />
                {selectedSplitPoint
                  ? `Punkt gesetzt (${selectedSplitPoint.lat.toFixed(4)}, ${selectedSplitPoint.lng.toFixed(4)})`
                  : 'Teilungspunkt auf Karte wählen (sonst GPS)'}
              </button>
              {selectedSplitPoint && (
                <button
                  type="button"
                  onClick={() => onSelectSplitPoint(null)}
                  className="min-h-[40px] rounded-lg bg-slate-800 px-2.5 text-xs text-slate-400"
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
                  splitPoint: selectedSplitPoint ?? (ownFix ? { lat: ownFix.lat, lng: ownFix.lng } : undefined),
                })
              }
              className="min-h-[44px] w-full rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-40"
            >
              Hinweis kaufen (+2 Min.)
            </button>
          </div>

          {/* 1C: Thermometer (100m Laufweg) */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                <Thermometer className="h-4 w-4" /> Thermometer (100 m Laufweg)
              </span>
              {thermoPointA && (
                <span
                  className={`font-mono text-xs font-extrabold ${
                    thermoDistanceMeters >= 100
                      ? 'text-emerald-400'
                      : 'text-amber-300'
                  }`}
                >
                  Zurückgelegte Luftlinie: {thermoDistanceMeters} / 100 m
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
                className="min-h-[40px] flex-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-40"
              >
                {thermoPointA ? 'Startpunkt A neu setzen (GPS)' : 'Startpunkt setzen (Punkt A)'}
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
                    className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs font-semibold text-cyan-300"
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
                    className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 text-xs font-semibold text-emerald-300 disabled:opacity-40"
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
              className="min-h-[44px] w-full rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-40"
            >
              Endpunkt prüfen (Punkt B, +2 Min.)
            </button>
          </div>

          {/* 1D: 45-Grad-Radarkegel */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-bold text-cyan-300">
                <Radar className="h-4 w-4" /> 45-Grad-Radarkegel
              </span>
              <span className="font-mono text-xs font-black text-white">
                Peilung: {coneBearingDeg}°
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
              className="w-full accent-cyan-400"
            />

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onToggleConePreview(true);
                  onNavigateToMap();
                }}
                className="min-h-[40px] rounded-lg border border-cyan-500/40 bg-cyan-950/50 px-3 text-xs font-bold text-cyan-200"
              >
                Vorschau auf Karte
              </button>
              <button
                type="button"
                disabled={!canPurchase || busyType !== null}
                onClick={() =>
                  void purchaseClue('CONE_45', { bearingDeg: coneBearingDeg })
                }
                className="min-h-[44px] flex-1 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-40"
              >
                Kegel scannen (+2 Min.)
              </button>
            </div>
          </div>
        </section>

        {/* KATEGORIE 2: Umgebungs-Checks mit OSM/Overpass (+3 Min.) */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-white">
              Kategorie 2: 81247-Umgebungs-Checks (OSM)
            </h3>
            <span className="rounded-full bg-rose-950 px-2.5 py-0.5 text-xs font-black text-rose-300">
              +3 Min. Strafzeit
            </span>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            <button
              type="button"
              disabled={!canPurchase || busyType !== null}
              onClick={() => void purchaseClue('OSM_TRANSIT')}
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-sky-500/40 bg-slate-950 px-3.5 py-3 text-xs font-bold text-sky-200 hover:bg-slate-800 disabled:opacity-40"
            >
              <Train className="h-4 w-4 shrink-0 text-sky-400" />
              ÖPNV im Umkreis von 150 m? (+3 Min.)
            </button>

            <button
              type="button"
              disabled={!canPurchase || busyType !== null}
              onClick={() => void purchaseClue('OSM_GREEN')}
              className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-slate-950 px-3.5 py-3 text-xs font-bold text-emerald-200 hover:bg-slate-800 disabled:opacity-40"
            >
              <Trees className="h-4 w-4 shrink-0 text-emerald-400" />
              Liegt das Versteck in einer Grünfläche? (+3 Min.)
            </button>
          </div>
        </section>

        {/* KATEGORIE 3: Distanz-Scanner (+4 Min.) */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-white">
              Kategorie 3: Distanz-Scanner
            </h3>
            <span className="rounded-full bg-rose-950 px-2.5 py-0.5 text-xs font-black text-rose-300">
              +4 Min. Strafzeit
            </span>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
              <CircleDot className="h-4 w-4" /> Radius-Radar um euren Standort
            </div>
            <div className="flex flex-wrap gap-1.5">
              {RADIUS_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setSelectedRadius(r)}
                  className={`min-h-[38px] flex-1 rounded-lg px-2 text-xs font-bold ${
                    selectedRadius === r
                      ? 'bg-cyan-500 text-slate-950'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {r} m
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
              className="min-h-[44px] w-full rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-40"
            >
              Radius prüfen (+4 Min.)
            </button>
          </div>

          <button
            type="button"
            data-testid="buy-donut-clue-btn"
            disabled={!canPurchase || busyType !== null}
            onClick={() => void purchaseClue('DONUT_RING')}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-cyan-500/50 bg-cyan-950/50 px-4 py-3 text-xs font-extrabold text-cyan-200 hover:bg-cyan-900/60 disabled:opacity-40"
          >
            <Disc className="h-4 w-4 text-cyan-400" />
            Donut-Ring kaufen (+4 Min.) • Exaktes 200m-Distanzband
          </button>
        </section>

        {/* KATEGORIE 4: Manuelle Foto- & Audio-Hinweise (+5 Min.) */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-white">
              Kategorie 4: Live-Foto & 10s-Audio der Sardinen
            </h3>
            <span className="rounded-full bg-rose-950 px-2.5 py-0.5 text-xs font-black text-rose-300">
              +5 Min. Strafzeit
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Antwortfrist für die Verstecker: 120s Netto-Spielzeit. Bei Ablauf oder Ablehnung erhaltet ihr automatisch -5 Min. erstattet + einen kostenlosen Donut-Ring!
          </p>

          {openManualRequest ? (
            <div className="flex items-center justify-between rounded-xl border border-cyan-500/50 bg-cyan-950/40 p-3 text-xs text-cyan-200">
              <span className="flex items-center gap-2 font-bold">
                <Clock className="h-4 w-4 animate-spin text-cyan-400" />
                Warte auf Verstecker-Antwort ...
              </span>
              <span className="font-mono text-sm font-black text-white">
                {formatDurationClock(manualRemainingMs)}
              </span>
            </div>
          ) : (
            <div className="grid gap-2">
              <button
                type="button"
                disabled={!canPurchase || busyType !== null}
                onClick={() => void purchaseClue('MEDIA_SKY')}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs font-bold text-slate-100 hover:bg-slate-800 disabled:opacity-40"
              >
                <Camera className="h-4 w-4 text-cyan-400" />
                Foto vom Himmel / Blätterdach anfordern (+5 Min.)
              </button>
              <button
                type="button"
                disabled={!canPurchase || busyType !== null}
                onClick={() => void purchaseClue('MEDIA_GROUND')}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs font-bold text-slate-100 hover:bg-slate-800 disabled:opacity-40"
              >
                <Camera className="h-4 w-4 text-amber-400" />
                Foto vom Boden anfordern (+5 Min.)
              </button>
              <button
                type="button"
                disabled={!canPurchase || busyType !== null}
                onClick={() => void purchaseClue('MEDIA_AUDIO')}
                className="flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs font-bold text-slate-100 hover:bg-slate-800 disabled:opacity-40"
              >
                <Mic className="h-4 w-4 text-emerald-400" />
                10s Audio anfordern (+5 Min.)
              </button>
            </div>
          )}
        </section>

        {/* Bisherige Hinweise & Overlay-Schalter */}
        <section className="space-y-2.5">
          <h3 className="text-sm font-extrabold text-white">
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
