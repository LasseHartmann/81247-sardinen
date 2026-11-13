import React, { useState } from 'react';
import {
  Compass,
  Thermometer,
  Radar,
  Train,
  CircleDot,
  Disc,
  Camera,
  Clock,
  Lock,
  Eye,
  X,
  Filter,
  Map as MapIcon,
} from 'lucide-react';
import {
  getQuestionPenaltyMs,
  MEDIA_RESPONSE_TIMEOUT_NET_MS,
  QUESTION_CATEGORY_MAP,
  TEAM_PALETTE,
  THERMOMETER_MIN_DISTANCE_METERS,
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
import { HardwareKnob } from '../Common/HardwareKnob';
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
  cluesByTeam: Record<string, Record<string, ClueRecord>>;
  requestsByTeam: Record<string, Record<string, ClueRequest>>;
  teamsPublic: Record<string, TeamPublic>;
  activeTeamIds?: string[];
  hiderFilterTeamId: string;
  onChangeHiderFilterTeamId: (teamId: string) => void;
  hiddenClueIds: Set<string>;
  onToggleClueOverlay: (clueId: string) => void;
  thermoPointA: LatLng | null;
  onSetThermoPointA: (pt: LatLng | null) => void;
  thermoPointB: LatLng | null;
  onSetThermoPointB: (pt: LatLng | null) => void;
  coneBearingDeg: number;
  onChangeConeBearingDeg: (deg: number) => void;
  selectedRadius: RadiusOptionMeters;
  onChangeSelectedRadius: (r: RadiusOptionMeters) => void;
  activePreviewQuestion: QuestionType | null;
  onChangePreviewQuestion: (q: QuestionType | null) => void;
  onRequestMapPointPick: (mode: MapClickInteractionMode) => void;
  onNavigateToMap: () => void;
}

const RADIUS_OPTIONS: readonly RadiusOptionMeters[] = [50, 100, 250, 500, 1000];

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
  cluesByTeam,
  requestsByTeam,
  teamsPublic,
  activeTeamIds,
  hiderFilterTeamId,
  onChangeHiderFilterTeamId,
  hiddenClueIds,
  onToggleClueOverlay,
  thermoPointA,
  onSetThermoPointA,
  thermoPointB,
  onSetThermoPointB,
  coneBearingDeg,
  onChangeConeBearingDeg,
  selectedRadius,
  onChangeSelectedRadius,
  activePreviewQuestion,
  onChangePreviewQuestion,
  onRequestMapPointPick,
  onNavigateToMap,
}) => {
  const [splitAxis, setSplitAxis] = useState<'SPLIT_NS' | 'SPLIT_EW'>('SPLIT_NS');
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

  const toggleOrShowMapPreview = (qType: QuestionType) => {
    if (activePreviewQuestion === qType) {
      onChangePreviewQuestion(null);
    } else {
      onChangePreviewQuestion(qType);
      onNavigateToMap();
    }
  };

  const renderPreviewButton = (qType: QuestionType) => {
    const isActive = activePreviewQuestion === qType;
    return (
      <button
        type="button"
        data-testid={`preview-btn-${qType}`}
        onClick={() => toggleOrShowMapPreview(qType)}
        className={`font-tech inline-flex min-h-[46px] items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase ${
          isActive
            ? 'cmf-btn-active'
            : 'cmf-btn-secondary bg-white/60 text-[var(--text-main)]'
        }`}
      >
        {isActive ? (
          <>
            <X className="h-4 w-4 shrink-0 text-[var(--cmf-orange)]" />
            <span>Vorschau aus</span>
          </>
        ) : (
          <>
            <Eye className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
            <span>Vorschau</span>
          </>
        )}
      </button>
    );
  };

  const purchaseClue = async (
    questionType: QuestionType,
    params: QuestionParams = {}
  ) => {
    if (!canPurchase || !ownTeam || !ownFix) return;
    setBusyType(questionType);
    try {
      const category = QUESTION_CATEGORY_MAP[questionType];
      const penaltyMs = getQuestionPenaltyMs(questionType);
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
      if (activePreviewQuestion) {
        onChangePreviewQuestion(null);
      }
    } finally {
      setBusyType(null);
    }
  };

  // Für Verstecker, im Versteck angekommene Sardinen-Teams & Spielleiter:
  // Team-individuelle Filterung aller freigeschalteten Hinweise pro Team!
  if (!isSeekerActive) {
    const activeSet = activeTeamIds ? new Set(activeTeamIds) : null;
    const filterableTeams = TEAM_PALETTE.map((p) => {
      const pub = teamsPublic[p.id];
      const teamClueList = Object.values(cluesByTeam[p.id] ?? {}).filter(
        (c) => c.sessionId === publicState.sessionId
      );
      return {
        id: p.id,
        name: pub?.name ?? p.name,
        color: pub?.color ?? p.color,
        status: pub?.status ?? 'ACTIVE',
        memberCount: pub?.memberPlayerIds.length ?? 0,
        clues: teamClueList,
      };
    }).filter(
      (t) =>
        t.memberCount > 0 ||
        t.clues.length > 0 ||
        (activeSet ? activeSet.has(t.id) : false)
    );

    const effectiveLogTeamFilter =
      hiderFilterTeamId === 'NONE' ||
      (hiderFilterTeamId !== 'ALL' &&
        !filterableTeams.some((t) => t.id === hiderFilterTeamId))
        ? 'ALL'
        : hiderFilterTeamId;

    const allSessionClues = filterableTeams.flatMap((t) => t.clues);
    const filteredClues =
      effectiveLogTeamFilter === 'ALL'
        ? allSessionClues
        : (filterableTeams.find((t) => t.id === effectiveLogTeamFilter)?.clues ??
          []);

    const combinedRequestsMap: Record<string, ClueRequest> = Object.assign(
      {},
      ...Object.values(requestsByTeam)
    );
    const selectedTeamMeta = filterableTeams.find(
      (t) => t.id === effectiveLogTeamFilter
    );

    return (
      <div className="cmf-drafting-bg cmf-scroll-area cmf-view-enter h-full px-3 py-3.5 sm:p-4 text-[var(--text-main)]">
        <div className="mx-auto max-w-2xl space-y-4 pb-10">
          <div className="cmf-chassis p-4 sm:p-5 space-y-3">
            <div>
              <span className="cmf-badge-teal inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
                <Filter className="h-3 w-3" />
                TEAM-TIPPS
              </span>
              <h2 className="font-dot mt-1.5 text-lg sm:text-xl text-[var(--text-main)]">
                Tipps der Teams
              </h2>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Wähle ein Team, um dessen gekaufte Tipps zu sehen.
              </p>
            </div>

            {/* Team-Filter-Leiste */}
            <div
              data-testid="hider-team-clue-filter"
              className="flex flex-wrap gap-1.5 border-t cmf-divider pt-3"
            >
              <button
                type="button"
                data-testid="filter-team-ALL"
                onClick={() => onChangeHiderFilterTeamId('ALL')}
                className={`font-tech inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold uppercase ${
                  effectiveLogTeamFilter === 'ALL'
                    ? 'cmf-btn-active'
                    : 'cmf-btn-secondary bg-white/75 text-[var(--text-main)]'
                }`}
              >
                <span>Alle Teams</span>
                <span className="rounded-full bg-black/15 px-1.5 py-0.2 text-[10px]">
                  {allSessionClues.length}
                </span>
              </button>

              {filterableTeams.map((teamItem) => {
                const isSelected = effectiveLogTeamFilter === teamItem.id;
                return (
                  <button
                    key={teamItem.id}
                    type="button"
                    data-testid={`filter-team-${teamItem.id}`}
                    onClick={() => onChangeHiderFilterTeamId(teamItem.id)}
                    className={`font-tech inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold uppercase ${
                      isSelected
                        ? 'cmf-btn-active'
                        : 'cmf-btn-secondary bg-white/75 text-[var(--text-main)]'
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: teamItem.color }}
                    />
                    <span>{teamItem.name}</span>
                    <span className="rounded-full bg-black/15 px-1.5 py-0.2 text-[10px]">
                      {teamItem.clues.length}
                    </span>
                    {teamItem.status === 'JOINED_SARDINES' && (
                      <span className="text-[9px] text-[var(--cmf-teal)]">
                        [IM HQ]
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedTeamMeta && (
              <div className="cmf-oled flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: selectedTeamMeta.color }}
                  />
                  <span className="font-tech font-bold text-[#F8FAFC] uppercase">
                    {selectedTeamMeta.name}: {selectedTeamMeta.clues.length} Hinweis
                    {selectedTeamMeta.clues.length === 1 ? '' : 'e'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onChangeHiderFilterTeamId(selectedTeamMeta.id);
                    onNavigateToMap();
                  }}
                  className="cmf-btn-primary font-dot inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold"
                >
                  <MapIcon className="h-3.5 w-3.5" />
                  <span>Karten-Sicht von {selectedTeamMeta.name}</span>
                </button>
              </div>
            )}
          </div>

          <ClueHistoryList
            clues={filteredClues}
            requestsMap={combinedRequestsMap}
            hiddenClueIds={hiddenClueIds}
            gameStartTimestamp={publicState.gameStartTimestamp}
            onToggleClueOverlay={onToggleClueOverlay}
            getServerNow={() => adapter.getServerNow()}
            teamsPublic={teamsPublic}
            showTeamBadge={effectiveLogTeamFilter === 'ALL'}
            emptyMessage={
              selectedTeamMeta
                ? `${selectedTeamMeta.name} hat in dieser Runde noch keine Hinweise freigeschaltet.`
                : 'Noch kein Sucher-Team hat in dieser Runde Hinweise freigeschaltet.'
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

  const scrollToSection = (sectionId: string) => {
    document
      .getElementById(sectionId)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="cmf-drafting-bg cmf-scroll-area cmf-view-enter h-full px-3 py-3.5 sm:p-4 text-[var(--text-main)]">
      <div className="mx-auto max-w-2xl space-y-4 pb-12">
        <div className="cmf-chassis p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="cmf-badge-amber inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
                TIPPS // {ownTeam?.name}
              </span>
              <h2 className="font-dot mt-1 text-lg sm:text-xl text-[var(--text-main)]">
                Tipps kaufen
              </h2>
            </div>

            {activePreviewQuestion && (
              <button
                type="button"
                data-testid="menu-clear-preview-btn"
                onClick={() => onChangePreviewQuestion(null)}
                className="cmf-btn-active font-tech inline-flex min-h-[40px] items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase"
              >
                <X className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                Vorschau aus
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Nur für euer Team sichtbar.
          </p>
        </div>

        {/* Sticky Smartphone-Schnellsprungleiste für Einhand-Navigation */}
        <div className="sticky top-0 z-10 -mx-1 px-1 py-1 backdrop-blur-md">
          <div className="cmf-no-scrollbar flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-[var(--shell-border)] bg-[var(--shell-bg)] p-1.5 shadow-sm">
            {[
              { id: 'q-cat-1', label: 'Richtung & Thermo' },
              { id: 'q-cat-2', label: 'Haltestelle' },
              { id: 'q-cat-3', label: 'Radar' },
              { id: 'q-cat-4', label: 'Fotos' },
              {
                id: 'q-history',
                label: `Verlauf (${Object.keys(teamClues).length})`,
              },
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => scrollToSection(pill.id)}
                className="cmf-btn-secondary shrink-0 rounded-xl bg-white/75 px-3 py-2 font-tech text-[11px] font-bold text-[var(--text-main)] uppercase"
              >
                {pill.label}
              </button>
            ))}
          </div>
        </div>

        {(isPaused || isHidingPhase || !ownFix) && (
          <div className="cmf-module flex items-center gap-3 p-3.5 text-xs font-medium text-[var(--text-main)]">
            <div className="cmf-oled flex h-9 w-9 shrink-0 items-center justify-center text-[var(--cmf-amber)]">
              <Lock className="h-4 w-4" />
            </div>
            <span>
              {isPaused
                ? 'Spiel ist pausiert.'
                : isHidingPhase
                  ? `Tipps erst ab ${formatDurationClock(publicState.radarSchedule.hidingDurationMs)} verfügbar.`
                  : 'Warte auf GPS-Signal ...'}
            </span>
          </div>
        )}

        {/* KATEGORIE 1: Richtung & Thermometer */}
        <section id="q-cat-1" className="cmf-module scroll-mt-14 p-3.5 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between border-b cmf-divider pb-3">
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              Richtung & Thermometer
            </h3>
            <span className="cmf-badge-teal rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
              +10 / +15 Min.
            </span>
          </div>

          {/* 1A/1B: Nord/Süd oder Ost/West */}
          <div className="cmf-well p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-tech text-[11px] font-bold tracking-wider text-[var(--text-main)] uppercase">
                <Compass className="h-4 w-4 text-[var(--cmf-teal)]" />
                Himmelsrichtung
              </span>
              <span className="cmf-badge-teal rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
                +15 Min.
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setSplitAxis('SPLIT_NS');
                  if (activePreviewQuestion === 'SPLIT_EW') {
                    onChangePreviewQuestion('SPLIT_NS');
                  }
                }}
                className={`font-tech min-h-[40px] flex-1 px-3 text-xs font-bold uppercase ${
                  splitAxis === 'SPLIT_NS' ? 'cmf-btn-active' : 'cmf-btn-secondary'
                }`}
              >
                Nord / Süd
              </button>
              <button
                type="button"
                onClick={() => {
                  setSplitAxis('SPLIT_EW');
                  if (activePreviewQuestion === 'SPLIT_NS') {
                    onChangePreviewQuestion('SPLIT_EW');
                  }
                }}
                className={`font-tech min-h-[40px] flex-1 px-3 text-xs font-bold uppercase ${
                  splitAxis === 'SPLIT_EW' ? 'cmf-btn-active' : 'cmf-btn-secondary'
                }`}
              >
                Ost / West
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {renderPreviewButton(splitAxis)}
              <button
                type="button"
                data-testid="buy-split-clue-btn"
                disabled={!canPurchase || busyType !== null}
                onClick={() =>
                  void purchaseClue(splitAxis, {
                    splitPoint: ownFix
                      ? { lat: ownFix.lat, lng: ownFix.lng }
                      : undefined,
                  })
                }
                className="cmf-btn-primary font-dot min-h-[42px] flex-1 px-4 py-2 text-xs font-bold"
              >
                Richtung prüfen (+15 Min.)
              </button>
            </div>
          </div>

          {/* 1C: Thermometer (250m) */}
          <div className="cmf-well p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-tech text-[11px] font-bold tracking-wider text-[var(--text-main)] uppercase">
                <Thermometer className="h-4 w-4 text-[var(--cmf-teal)]" />
                Thermometer ({THERMOMETER_MIN_DISTANCE_METERS} m)
              </span>
              <div className="flex items-center gap-1.5">
                <span className="cmf-badge-teal rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
                  +10 Min.
                </span>
                {thermoPointA && (
                  <span
                    className={`cmf-oled px-2.5 py-1 font-tech text-[11px] font-bold ${
                      thermoDistanceMeters >= THERMOMETER_MIN_DISTANCE_METERS
                        ? 'text-[var(--cmf-teal)]'
                        : 'text-[var(--cmf-amber)]'
                    }`}
                  >
                    {thermoDistanceMeters} / {THERMOMETER_MIN_DISTANCE_METERS} M
                  </span>
                )}
              </div>
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
                  ? 'Startpunkt neu setzen'
                  : 'Startpunkt hier setzen'}
              </button>

              {canUseMapClicks && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onRequestMapPointPick({
                        kind: 'PICK_THERMO_A',
                        label: 'Tippe auf die Karte für Punkt A',
                      });
                      onNavigateToMap();
                    }}
                    className="cmf-btn-secondary font-tech min-h-[40px] bg-white/60 px-2.5 text-[11px] font-bold text-[var(--text-main)] uppercase"
                  >
                    A wählen
                  </button>
                  <button
                    type="button"
                    disabled={!thermoPointA}
                    onClick={() => {
                      onRequestMapPointPick({
                        kind: 'PICK_THERMO_B',
                        label: `Mindestens ${THERMOMETER_MIN_DISTANCE_METERS} m entfernt für Punkt B tippen`,
                      });
                      onNavigateToMap();
                    }}
                    className="cmf-btn-secondary font-tech min-h-[40px] bg-white/60 px-2.5 text-[11px] font-bold text-[var(--text-main)] uppercase"
                  >
                    B wählen
                  </button>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {renderPreviewButton('THERMOMETER')}
              <button
                type="button"
                disabled={
                  !canPurchase ||
                  !thermoPointA ||
                  !effectiveEndpointB ||
                  thermoDistanceMeters < THERMOMETER_MIN_DISTANCE_METERS ||
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
                className="cmf-btn-primary font-dot min-h-[42px] flex-1 px-4 py-2 text-xs font-bold"
              >
                Wärmer oder kälter? (+10 Min.)
              </button>
            </div>
          </div>

          {/* 1D: 45-Grad-Kegel */}
          <div className="cmf-well p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-tech text-[11px] font-bold tracking-wider text-[var(--text-main)] uppercase">
                <Radar className="h-4 w-4 text-[var(--cmf-teal)]" />
                45°-Kegel
              </span>
              <span className="cmf-badge-teal rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
                +15 Min.
              </span>
            </div>

            <HardwareKnob
              label="RICHTUNG (GRAD)"
              ariaLabel="Kegel-Richtung in Grad"
              dataTestId="cone-bearing-knob"
              value={coneBearingDeg}
              min={0}
              max={355}
              step={5}
              wrapAround
              unit="°"
              onChange={(nextDeg) => {
                onChangeConeBearingDeg(nextDeg);
              }}
            />

            <div className="flex flex-wrap gap-2">
              {renderPreviewButton('CONE_45')}
              <button
                type="button"
                disabled={!canPurchase || busyType !== null}
                onClick={() =>
                  void purchaseClue('CONE_45', { bearingDeg: coneBearingDeg })
                }
                className="cmf-btn-primary font-dot min-h-[42px] flex-1 px-4 py-2 text-xs font-bold"
              >
                Kegel prüfen (+15 Min.)
              </button>
            </div>
          </div>
        </section>

        {/* KATEGORIE 2: Haltestelle */}
        <section id="q-cat-2" className="cmf-module scroll-mt-14 p-3.5 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between border-b cmf-divider pb-3">
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              Haltestellen
            </h3>
            <span className="cmf-badge-amber rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
              +3 Min.
            </span>
          </div>

          <div className="cmf-well p-3.5 space-y-3">
            <div className="flex items-center gap-2 font-tech text-[11px] font-bold tracking-wider text-[var(--text-main)] uppercase">
              <Train className="h-4 w-4 shrink-0 text-[var(--cmf-amber)]" />
              <span>Haltestelle im Umkreis (150 m)?</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {renderPreviewButton('OSM_TRANSIT')}
              <button
                type="button"
                disabled={!canPurchase || busyType !== null}
                onClick={() => void purchaseClue('OSM_TRANSIT')}
                className="cmf-btn-primary font-dot flex min-h-[42px] flex-1 items-center justify-center gap-2 px-3.5 py-2 text-xs font-bold"
              >
                <Train className="h-4 w-4 shrink-0" />
                <span>Haltestelle prüfen (+3 Min.)</span>
              </button>
            </div>
          </div>
        </section>

        {/* KATEGORIE 3: Radar & Abstand */}
        <section id="q-cat-3" className="cmf-module scroll-mt-14 p-3.5 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between border-b cmf-divider pb-3">
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              Radar & Abstand
            </h3>
            <span className="cmf-badge-amber rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
              +15 / +4 Min.
            </span>
          </div>

          <div className="cmf-well p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-tech text-[11px] font-bold tracking-wider text-[var(--text-main)] uppercase">
                <CircleDot className="h-4 w-4 text-[var(--cmf-teal)]" />
                Radius-Radar
              </span>
              <span className="cmf-badge-teal rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
                +15 Min.
              </span>
            </div>

            <HardwareKnob
              label="RADIUS (METER)"
              ariaLabel="Radius-Radar Distanz in Metern"
              dataTestId="radius-radar-knob"
              value={selectedRadius}
              options={RADIUS_OPTIONS}
              unit=" m"
              onChange={(nextR) =>
                onChangeSelectedRadius(nextR as RadiusOptionMeters)
              }
            />

            <div className="flex flex-wrap gap-2">
              {renderPreviewButton('RADIUS_RADAR')}
              <button
                type="button"
                data-testid="buy-radius-radar-btn"
                disabled={!canPurchase || busyType !== null}
                onClick={() =>
                  void purchaseClue('RADIUS_RADAR', {
                    radiusMeters: selectedRadius,
                  })
                }
                className="cmf-btn-primary font-dot min-h-[42px] flex-1 px-4 py-2 text-xs font-bold"
              >
                Radius prüfen (+15 Min.)
              </button>
            </div>
          </div>

          <div className="cmf-well p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 font-tech text-[11px] font-bold tracking-wider text-[var(--text-main)] uppercase">
                <Disc className="h-4 w-4 text-[var(--cmf-teal)]" />
                Donut-Ring (200 m Schritte)
              </span>
              <span className="cmf-badge-amber rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
                +4 Min.
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {renderPreviewButton('DONUT_RING')}
              <button
                type="button"
                data-testid="buy-donut-clue-btn"
                disabled={!canPurchase || busyType !== null}
                onClick={() => void purchaseClue('DONUT_RING')}
                className="cmf-btn-active font-dot flex min-h-[42px] flex-1 items-center justify-center gap-2 px-4 py-2 text-xs font-bold"
              >
                <Disc className="h-4 w-4 text-[var(--cmf-teal)]" />
                Donut-Ring (+4 Min.)
              </button>
            </div>
          </div>
        </section>

        {/* KATEGORIE 4: Fotos (+5 Min., ohne Kartenvorschau) */}
        <section id="q-cat-4" className="cmf-module scroll-mt-14 p-3.5 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between border-b cmf-divider pb-3">
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              Fotos
            </h3>
            <span className="cmf-badge-orange rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
              +5 Min.
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            Die Verstecker haben <strong className="text-[var(--text-main)]">5 Min.</strong> Zeit. Kommt kein Foto, kriegt ihr <strong className="text-[var(--cmf-teal)]">-10 Min.</strong> Zeitgutschrift + einen Gratis-Donut-Ring.
          </p>

          {openManualRequest ? (
            <div className="cmf-oled flex items-center justify-between p-3.5 text-xs">
              <span className="flex items-center gap-2 font-tech font-bold text-[#F8FAFC] uppercase">
                <Clock className="h-4 w-4 animate-spin text-[var(--cmf-amber)]" />
                Warte auf Foto ...
              </span>
              <span className="font-dot text-base text-[var(--cmf-amber)]">
                {formatDurationClock(manualRemainingMs)}
              </span>
            </div>
          ) : (
            <div className="space-y-2.5">
              <button
                type="button"
                disabled={!canPurchase || busyType !== null}
                onClick={() => void purchaseClue('MEDIA_SKY')}
                className="cmf-btn-secondary flex min-h-[44px] w-full items-center justify-center gap-2 px-3.5 py-2 text-xs font-bold text-[var(--text-main)]"
              >
                <Camera className="h-4 w-4 text-[var(--cmf-teal)]" />
                Foto nach oben (+5 Min.)
              </button>
              <button
                type="button"
                disabled={!canPurchase || busyType !== null}
                onClick={() => void purchaseClue('MEDIA_GROUND')}
                className="cmf-btn-secondary flex min-h-[44px] w-full items-center justify-center gap-2 px-3.5 py-2 text-xs font-bold text-[var(--text-main)]"
              >
                <Camera className="h-4 w-4 text-[var(--cmf-amber)]" />
                Foto nach unten (+5 Min.)
              </button>
            </div>
          )}
        </section>

        {/* Bisherige Tipps & Overlay-Schalter */}
        <section id="q-history" className="scroll-mt-14 space-y-2.5">
          <h3 className="font-industrial px-1 text-base text-[var(--text-main)]">
            Eure Tipps ({Object.keys(teamClues).length})
          </h3>
          <ClueHistoryList
            clues={Object.values(teamClues)}
            requestsMap={teamRequests}
            hiddenClueIds={hiddenClueIds}
            gameStartTimestamp={publicState.gameStartTimestamp}
            onToggleClueOverlay={onToggleClueOverlay}
            getServerNow={() => adapter.getServerNow()}
            onDownloadMedia={(tId, rId) =>
              adapter.markMediaDownloadedAndShortenExpiry(
                tId,
                rId,
                adapter.getServerNow()
              )
            }
            onAcknowledgeMedia={(tId, rId) =>
              adapter.acknowledgeAndStripMedia(tId, rId, adapter.getServerNow())
            }
          />
        </section>
      </div>
    </div>
  );
};
