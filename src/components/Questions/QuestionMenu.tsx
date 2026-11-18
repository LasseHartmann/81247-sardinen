import React, { useState } from 'react';
import {
  Compass,
  Thermometer,
  Radar,
  Train,
  Recycle,
  Trees,
  CircleDot,
  Disc,
  Camera,
  Clock,
  Lock,
  Eye,
  X,
  Map as MapIcon,
  Settings2,
} from 'lucide-react';
import {
  getMediaRefundMs,
  getQuestionPenaltyMs,
  getRadiusRadarOptions,
  MEDIA_RESPONSE_TIMEOUT_NET_MS,
  QUESTION_CATEGORY_MAP,
  resolveQuestionRulesConfig,
  TEAM_PALETTE,
} from '../../config/gameConfig';
import { isOverviewMember } from '../../config/players';
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
import {
  formatCompassDirectionDe,
  formatDurationClock,
} from '../../utils/formatting';
import { HardwareKnob } from '../Common/HardwareKnob';
import { HostQuestionRulesEditor } from '../Lobby/HostQuestionRulesEditor';
import { ClueHistoryList } from './ClueHistoryList';

export interface QuestionMenuProps {
  adapter: DatabaseAdapter;
  publicState: PublicGameState;
  netElapsedMs: number;
  ownMember: MemberRecord;
  ownTeam: TeamPublic | null;
  ownFix: GeoFix | null;
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
  coneBearingDeg: number;
  onChangeConeBearingDeg: (deg: number) => void;
  selectedRadius: RadiusOptionMeters;
  onChangeSelectedRadius: (r: RadiusOptionMeters) => void;
  activePreviewQuestion: QuestionType | null;
  onChangePreviewQuestion: (q: QuestionType | null) => void;
  onNavigateToMap: () => void;
}

export const QuestionMenu: React.FC<QuestionMenuProps> = ({
  adapter,
  publicState,
  netElapsedMs,
  ownMember,
  ownTeam,
  ownFix,
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
  coneBearingDeg,
  onChangeConeBearingDeg,
  selectedRadius,
  onChangeSelectedRadius,
  activePreviewQuestion,
  onChangePreviewQuestion,
  onNavigateToMap,
}) => {
  const [splitAxis, setSplitAxis] = useState<'SPLIT_NS' | 'SPLIT_EW'>('SPLIT_NS');
  const [busyType, setBusyType] = useState<QuestionType | null>(null);
  const [confirmingType, setConfirmingType] = useState<QuestionType | null>(null);
  const [showHostRulesEditor, setShowHostRulesEditor] = useState(false);

  const isHostOrAdmin = Boolean(
    ownMember.isHost || isOverviewMember(ownMember)
  );
  const isPaused = publicState.status === 'PAUSED' || publicState.pausedAt !== null;
  const isHidingPhase =
    publicState.status !== 'RUNNING' || publicState.currentPhase === 'HIDING';
  const isSeekerActive = Boolean(
    ownMember.side === 'SEEKER' && ownTeam && ownTeam.status === 'ACTIVE'
  );

  const classicSearchDurationMs = publicState.classicSearchDurationMs;
  const qConfig = resolveQuestionRulesConfig(publicState.questionConfig);
  const radiusOptions = getRadiusRadarOptions(publicState.questionConfig);

  const directionMin = Math.round(
    getQuestionPenaltyMs(
      'SPLIT_NS',
      classicSearchDurationMs,
      publicState.questionConfig
    ) / 60_000
  );
  const thermoMin = Math.round(
    getQuestionPenaltyMs(
      'THERMOMETER',
      classicSearchDurationMs,
      publicState.questionConfig
    ) / 60_000
  );
  const radiusRadarMin = Math.round(
    getQuestionPenaltyMs(
      'RADIUS_RADAR',
      classicSearchDurationMs,
      publicState.questionConfig
    ) / 60_000
  );
  const envMin = Math.round(
    getQuestionPenaltyMs(
      'OSM_TRANSIT',
      classicSearchDurationMs,
      publicState.questionConfig
    ) / 60_000
  );
  const donutMin = Math.round(
    getQuestionPenaltyMs(
      'DONUT_RING',
      classicSearchDurationMs,
      publicState.questionConfig
    ) / 60_000
  );
  const photoMin = Math.round(
    getQuestionPenaltyMs(
      'MEDIA_SKY',
      classicSearchDurationMs,
      publicState.questionConfig
    ) / 60_000
  );
  const photoRefundMin = Math.round(
    getMediaRefundMs(classicSearchDurationMs, publicState.questionConfig) /
      60_000
  );
  const thermoTargetMeters = qConfig.thermometerDistanceMeters;
  const donutStepMeters = qConfig.donutRingStepMeters;
  const envDistanceMeters = qConfig.environmentDistanceMeters;

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

  const thermoDistanceMeters =
    thermoPointA && ownFix
      ? Math.round(distanceMeters(thermoPointA, ownFix))
      : 0;

  const toggleOrShowMapPreview = (qType: QuestionType) => {
    setConfirmingType(null);
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
        className={`font-tech inline-flex min-h-[44px] items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase ${
          isActive
            ? 'cmf-btn-active'
            : 'cmf-btn-secondary bg-white/80 text-[var(--text-main)]'
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
    setConfirmingType(null);
    setBusyType(questionType);
    try {
      const category = QUESTION_CATEGORY_MAP[questionType];
      const penaltyMs = getQuestionPenaltyMs(
        questionType,
        classicSearchDurationMs,
        publicState.questionConfig
      );
      const enrichedParams: QuestionParams = {
        thermometerDistanceMeters: thermoTargetMeters,
        donutStepMeters,
        environmentDistanceMeters: envDistanceMeters,
        ...params,
      };
      const req: ClueRequest = {
        id: generateRandomId('req'),
        teamId: ownTeam.id,
        requestedByUid: ownMember.uid,
        sessionId: publicState.sessionId,
        questionType,
        category,
        params: enrichedParams,
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
      }
      if (activePreviewQuestion) {
        onChangePreviewQuestion(null);
      }
    } finally {
      setBusyType(null);
    }
  };

  const renderBuyButton = (opts: {
    questionType: QuestionType;
    penaltyMin: number;
    label: string;
    disabled?: boolean;
    testId?: string;
    params?: QuestionParams;
  }) => {
    const isConfirming = confirmingType === opts.questionType;
    const isBusy = busyType === opts.questionType;
    const isDisabled = Boolean(!canPurchase || busyType !== null || opts.disabled);

    if (isConfirming) {
      return (
        <div className="flex flex-1 items-center gap-1.5">
          <button
            type="button"
            data-testid={opts.testId}
            disabled={isDisabled}
            onClick={() => void purchaseClue(opts.questionType, opts.params)}
            className="cmf-btn-primary font-dot flex min-h-[44px] flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold"
          >
            <span>Jetzt kaufen (+{opts.penaltyMin} Min.)</span>
          </button>
          <button
            type="button"
            aria-label="Abbrechen"
            onClick={() => setConfirmingType(null)}
            className="cmf-btn-secondary flex min-h-[44px] w-11 shrink-0 items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      );
    }

    return (
      <button
        type="button"
        data-testid={opts.testId}
        disabled={isDisabled}
        onClick={() => setConfirmingType(opts.questionType)}
        className="cmf-btn-primary font-dot flex min-h-[44px] flex-1 items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold disabled:opacity-45"
      >
        <span>
          {isBusy ? 'Sende ...' : `${opts.label} (+${opts.penaltyMin} Min.)`}
        </span>
      </button>
    );
  };

  // Ansicht für Verstecker, gefundene Teams & Spielleiter
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-dot text-lg sm:text-xl text-[var(--text-main)]">
                Gekaufte Tipps der Teams
              </h2>
              {isHostOrAdmin && (
                <button
                  type="button"
                  data-testid="toggle-host-question-rules-btn"
                  onClick={() => setShowHostRulesEditor((v) => !v)}
                  className={`font-tech inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-[11px] font-bold uppercase ${
                    showHostRulesEditor ? 'cmf-btn-active' : 'cmf-btn-secondary'
                  }`}
                >
                  <Settings2 className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                  <span>Preise &amp; Distanzen</span>
                </button>
              )}
            </div>

            {isHostOrAdmin && showHostRulesEditor && (
              <div className="border-t cmf-divider pt-3">
                <HostQuestionRulesEditor
                  questionConfig={publicState.questionConfig}
                  onOpenRulePreview={(target, initialRadius) => {
                    if (initialRadius !== undefined) {
                      onChangeSelectedRadius(initialRadius);
                    }
                    onChangePreviewQuestion(target);
                    onNavigateToMap();
                  }}
                  onChange={(nextQuestionConfig) => {
                    void adapter
                      .savePublicStateByHost({
                        ...publicState,
                        questionConfig: nextQuestionConfig,
                      })
                      .catch(() => {});
                  }}
                />
              </div>
            )}

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
                <span>Alle</span>
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
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedTeamMeta && (
              <div className="cmf-oled flex flex-wrap items-center justify-between gap-2 p-3 text-xs">
                <span className="font-tech font-bold text-[#F8FAFC] uppercase">
                  {selectedTeamMeta.name}: {selectedTeamMeta.clues.length} Tipps
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onChangeHiderFilterTeamId(selectedTeamMeta.id);
                    onNavigateToMap();
                  }}
                  className="cmf-btn-primary font-dot inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold"
                >
                  <MapIcon className="h-3.5 w-3.5" />
                  <span>Auf Karte zeigen</span>
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
            onUndoClue={
              ownMember.isHost || isOverviewMember(ownMember)
                ? (clue) => adapter.undoClueByHost(clue.teamId, clue)
                : undefined
            }
            teamsPublic={teamsPublic}
            showTeamBadge={effectiveLogTeamFilter === 'ALL'}
            emptyMessage={
              selectedTeamMeta
                ? `${selectedTeamMeta.name} hat noch keine Tipps gekauft.`
                : 'Noch keine Tipps gekauft.'
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
        <div className="cmf-chassis p-4 sm:p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-dot text-lg sm:text-xl text-[var(--text-main)]">
              Tipps kaufen
            </h2>

            <div className="flex flex-wrap items-center gap-2">
              {isHostOrAdmin && (
                <button
                  type="button"
                  data-testid="toggle-host-question-rules-btn"
                  onClick={() => setShowHostRulesEditor((v) => !v)}
                  className={`font-tech inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold uppercase ${
                    showHostRulesEditor ? 'cmf-btn-active' : 'cmf-btn-secondary'
                  }`}
                >
                  <Settings2 className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                  <span>Preise &amp; Distanzen</span>
                </button>
              )}

              {activePreviewQuestion && (
                <button
                  type="button"
                  data-testid="menu-clear-preview-btn"
                  onClick={() => onChangePreviewQuestion(null)}
                  className="cmf-btn-active font-tech inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase"
                >
                  <X className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                  Vorschau aus
                </button>
              )}
            </div>
          </div>

          {isHostOrAdmin && showHostRulesEditor && (
            <div className="border-t cmf-divider pt-3">
              <HostQuestionRulesEditor
                questionConfig={publicState.questionConfig}
                onOpenRulePreview={(target, initialRadius) => {
                  if (initialRadius !== undefined) {
                    onChangeSelectedRadius(initialRadius);
                  }
                  onChangePreviewQuestion(target);
                  onNavigateToMap();
                }}
                onChange={(nextQuestionConfig) => {
                  void adapter
                    .savePublicStateByHost({
                      ...publicState,
                      questionConfig: nextQuestionConfig,
                    })
                    .catch(() => {});
                }}
              />
            </div>
          )}
        </div>

        {/* Schnellsprungleiste */}
        <div className="sticky top-0 z-10 -mx-1 px-1 py-1 backdrop-blur-md">
          <div className="cmf-no-scrollbar flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-[var(--shell-border)] bg-[var(--shell-bg)] p-1.5 shadow-sm">
            {[
              { id: 'q-cat-1', label: 'Richtung' },
              { id: 'q-cat-3', label: 'Abstand' },
              { id: 'q-cat-2', label: 'Umgebung' },
              { id: 'q-cat-4', label: 'Fotos' },
              {
                id: 'q-history',
                label: `Eure Tipps (${Object.keys(teamClues).length})`,
              },
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => scrollToSection(pill.id)}
                className="cmf-btn-secondary shrink-0 rounded-xl bg-white/80 px-3 py-1.5 font-tech text-[11px] font-bold text-[var(--text-main)] uppercase"
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
                  ? `Verstecker verstecken sich noch – Tipps ab ${formatDurationClock(publicState.radarSchedule.hidingDurationMs)} verfügbar.`
                  : 'Warte auf GPS-Signal ...'}
            </span>
          </div>
        )}

        {/* KATEGORIE 1: Richtung & Warm/Kalt */}
        <section id="q-cat-1" className="cmf-module scroll-mt-14 p-3.5 sm:p-5 space-y-3.5">
          <h3 className="font-industrial border-b cmf-divider pb-2.5 text-base text-[var(--text-main)]">
            1. Richtung &amp; Warm/Kalt
          </h3>

          {/* 1A: Nord/Süd oder Ost/West */}
          <div className="cmf-well p-3.5 space-y-2.5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-industrial text-sm font-bold text-[var(--text-main)]">
                  <Compass className="h-4 w-4 text-[var(--cmf-teal)]" />
                  Himmelsrichtung
                </span>
                <span className="cmf-badge-teal rounded-full px-2 py-0.5 font-tech text-[10px] font-bold uppercase">
                  +{directionMin} Min.
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Teilt die Karte an eurem Standort in zwei Hälften (z. B. nördlich oder südlich).
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setSplitAxis('SPLIT_NS');
                  if (activePreviewQuestion === 'SPLIT_EW') {
                    onChangePreviewQuestion('SPLIT_NS');
                  }
                }}
                className={`font-tech min-h-[38px] px-3 text-xs font-bold uppercase ${
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
                className={`font-tech min-h-[38px] px-3 text-xs font-bold uppercase ${
                  splitAxis === 'SPLIT_EW' ? 'cmf-btn-active' : 'cmf-btn-secondary'
                }`}
              >
                Ost / West
              </button>
            </div>

            <div className="flex flex-wrap gap-2 pt-0.5">
              {renderPreviewButton(splitAxis)}
              {renderBuyButton({
                questionType: splitAxis,
                penaltyMin: directionMin,
                label: 'Kaufen',
                testId: 'buy-split-clue-btn',
                params: {
                  splitPoint: ownFix
                    ? { lat: ownFix.lat, lng: ownFix.lng }
                    : undefined,
                },
              })}
            </div>
          </div>

          {/* 1B: Richtungs-Kegel (45°) */}
          <div className="cmf-well p-3.5 space-y-2.5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-industrial text-sm font-bold text-[var(--text-main)]">
                  <Radar className="h-4 w-4 text-[var(--cmf-teal)]" />
                  Richtungs-Kegel (45°)
                </span>
                <span className="cmf-badge-teal rounded-full px-2 py-0.5 font-tech text-[10px] font-bold uppercase">
                  +{directionMin} Min.
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Prüft, ob das Versteck in eurer gewählten Blickrichtung liegt.
              </p>
            </div>

            <HardwareKnob
              label="BLICKRICHTUNG"
              ariaLabel="Kegel-Richtung in Grad"
              dataTestId="cone-bearing-knob"
              value={coneBearingDeg}
              min={0}
              max={355}
              step={15}
              wrapAround
              formatValue={formatCompassDirectionDe}
              onChange={(nextDeg) => {
                onChangeConeBearingDeg(nextDeg);
              }}
            />

            <div className="flex flex-wrap gap-2 pt-0.5">
              {renderPreviewButton('CONE_45')}
              {renderBuyButton({
                questionType: 'CONE_45',
                penaltyMin: directionMin,
                label: 'Kaufen',
                params: { bearingDeg: coneBearingDeg },
              })}
            </div>
          </div>

          {/* 1C: Warm oder Kalt (Thermometer – stoppt automatisch nach konfigurierter Bewegung) */}
          <div className="cmf-well p-3.5 space-y-2.5">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-industrial text-sm font-bold text-[var(--text-main)]">
                  <Thermometer className="h-4 w-4 text-[var(--cmf-teal)]" />
                  Warm oder Kalt ({thermoTargetMeters} m)
                </span>
                <span className="cmf-badge-teal rounded-full px-2 py-0.5 font-tech text-[10px] font-bold uppercase">
                  +{thermoMin} Min.
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Startet an eurem aktuellen Standort und stoppt automatisch, sobald ihr euch {thermoTargetMeters} m bewegt habt.
              </p>
            </div>

            {thermoPointA ? (
              <div
                data-testid="thermometer-active-tracker"
                className="space-y-2.5 pt-0.5"
              >
                <div className="cmf-oled space-y-2 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-tech font-bold text-[#F8FAFC] uppercase">
                      Thermometer läuft ...
                    </span>
                    <span className="font-dot text-sm text-[var(--cmf-amber)]">
                      {thermoDistanceMeters} / {thermoTargetMeters} m
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
                    <div
                      className="h-full rounded-full bg-[var(--cmf-teal)] transition-all duration-300"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (thermoDistanceMeters / thermoTargetMeters) * 100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-[#9AA4AE]">
                    Bewegt euch weiter – bei {thermoTargetMeters} m stoppt das Thermometer automatisch!
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onChangePreviewQuestion('THERMOMETER');
                      onNavigateToMap();
                    }}
                    className="cmf-btn-secondary font-tech inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 bg-white/80 px-3 py-2 text-[11px] font-bold text-[var(--text-main)] uppercase"
                  >
                    <MapIcon className="h-4 w-4 text-[var(--cmf-teal)]" />
                    <span>Auf Karte zeigen</span>
                  </button>
                  <button
                    type="button"
                    data-testid="cancel-thermometer-btn"
                    onClick={() => {
                      onSetThermoPointA(null);
                      if (activePreviewQuestion === 'THERMOMETER') {
                        onChangePreviewQuestion(null);
                      }
                    }}
                    className="cmf-btn-secondary font-tech inline-flex min-h-[42px] items-center justify-center gap-1 px-3.5 py-2 text-[11px] font-bold text-[var(--cmf-orange)] uppercase"
                  >
                    <X className="h-4 w-4" />
                    <span>Abbrechen</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pt-0.5">
                {renderPreviewButton('THERMOMETER')}
                <button
                  type="button"
                  data-testid="start-thermometer-btn"
                  disabled={!canPurchase || busyType !== null}
                  onClick={() => {
                    if (!ownFix) return;
                    onSetThermoPointA({ lat: ownFix.lat, lng: ownFix.lng });
                  }}
                  className="cmf-btn-primary font-dot flex min-h-[44px] flex-1 items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold disabled:opacity-45"
                >
                  <span>Thermometer starten (+{thermoMin} Min.)</span>
                </button>
              </div>
            )}
          </div>
        </section>

        {/* KATEGORIE 2: Abstand & Umkreis */}
        <section id="q-cat-3" className="cmf-module scroll-mt-14 p-3.5 sm:p-5 space-y-3.5">
          <h3 className="font-industrial border-b cmf-divider pb-2.5 text-base text-[var(--text-main)]">
            2. Abstand &amp; Umkreis
          </h3>

          <div className="cmf-well p-3.5 space-y-2.5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-industrial text-sm font-bold text-[var(--text-main)]">
                  <CircleDot className="h-4 w-4 text-[var(--cmf-teal)]" />
                  Umkreis-Check
                </span>
                <span className="cmf-badge-teal rounded-full px-2 py-0.5 font-tech text-[10px] font-bold uppercase">
                  +{radiusRadarMin} Min.
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Prüft, ob die Verstecker innerhalb des gewählten Radius um euch sind.
              </p>
            </div>

            <HardwareKnob
              label="RADIUS UM EUCH"
              ariaLabel="Umkreis-Check Distanz in Metern"
              dataTestId="radius-radar-knob"
              value={selectedRadius}
              options={radiusOptions}
              unit=" m"
              onChange={(nextR) =>
                onChangeSelectedRadius(nextR as RadiusOptionMeters)
              }
            />

            <div className="flex flex-wrap gap-2 pt-0.5">
              {renderPreviewButton('RADIUS_RADAR')}
              {renderBuyButton({
                questionType: 'RADIUS_RADAR',
                penaltyMin: radiusRadarMin,
                label: 'Kaufen',
                testId: 'buy-radius-radar-btn',
                params: { radiusMeters: selectedRadius },
              })}
            </div>
          </div>

          <div className="cmf-well p-3.5 space-y-2.5">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-industrial text-sm font-bold text-[var(--text-main)]">
                  <Disc className="h-4 w-4 text-[var(--cmf-teal)]" />
                  Entfernungs-Ring
                </span>
                <span className="cmf-badge-amber rounded-full px-2 py-0.5 font-tech text-[10px] font-bold uppercase">
                  +{donutMin} Min.
                </span>
              </div>
              <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                Verrät euren Abstand in einem genauen {donutStepMeters}m-Ring (z. B. {donutStepMeters * 2}–{donutStepMeters * 3} m entfernt).
              </p>
            </div>

            <div className="flex flex-wrap gap-2 pt-0.5">
              {renderPreviewButton('DONUT_RING')}
              {renderBuyButton({
                questionType: 'DONUT_RING',
                penaltyMin: donutMin,
                label: 'Kaufen',
                testId: 'buy-donut-clue-btn',
                params: { donutStepMeters },
              })}
            </div>
          </div>
        </section>

        {/* KATEGORIE 3: Umgebung */}
        <section id="q-cat-2" className="cmf-module scroll-mt-14 p-3.5 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between border-b cmf-divider pb-2.5">
            <div>
              <h3 className="font-industrial text-base text-[var(--text-main)]">
                3. Umgebungs-Check
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Prüft, was sich direkt beim Versteck befindet.
              </p>
            </div>
            <span className="cmf-badge-amber rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold uppercase">
              +{envMin} Min.
            </span>
          </div>

          <div className="cmf-well p-3.5 space-y-2.5">
            <span className="flex items-center gap-2 font-industrial text-sm font-bold text-[var(--text-main)]">
              <Train className="h-4 w-4 shrink-0 text-[var(--cmf-amber)]" />
              Haltestelle im Umkreis von {envDistanceMeters} m?
            </span>
            <div className="flex flex-wrap gap-2">
              {renderPreviewButton('OSM_TRANSIT')}
              {renderBuyButton({
                questionType: 'OSM_TRANSIT',
                penaltyMin: envMin,
                label: 'Kaufen',
                params: { environmentDistanceMeters: envDistanceMeters },
              })}
            </div>
          </div>

          <div className="cmf-well p-3.5 space-y-2.5">
            <span className="flex items-center gap-2 font-industrial text-sm font-bold text-[var(--text-main)]">
              <Recycle className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
              Wertstoffinsel im Umkreis von {envDistanceMeters} m?
            </span>
            <div className="flex flex-wrap gap-2">
              {renderPreviewButton('OSM_RECYCLING')}
              {renderBuyButton({
                questionType: 'OSM_RECYCLING',
                penaltyMin: envMin,
                label: 'Kaufen',
                params: { environmentDistanceMeters: envDistanceMeters },
              })}
            </div>
          </div>

          <div className="cmf-well p-3.5 space-y-2.5">
            <span className="flex items-center gap-2 font-industrial text-sm font-bold text-[var(--text-main)]">
              <Trees className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
              Liegt das Versteck in einer Grünfläche?
            </span>
            <div className="flex flex-wrap gap-2">
              {renderPreviewButton('OSM_GREEN')}
              {renderBuyButton({
                questionType: 'OSM_GREEN',
                penaltyMin: envMin,
                label: 'Kaufen',
              })}
            </div>
          </div>
        </section>

        {/* KATEGORIE 4: Live-Fotos der Verstecker */}
        <section id="q-cat-4" className="cmf-module scroll-mt-14 p-3.5 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between border-b cmf-divider pb-2.5">
            <div>
              <h3 className="font-industrial text-base text-[var(--text-main)]">
                4. Live-Foto anfordern
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                5 Min. Antwortzeit – sonst erhaltet ihr -{photoRefundMin} Min. Bonus + Gratis-Ring.
              </p>
            </div>
            <span className="cmf-badge-orange rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold uppercase">
              +{photoMin} Min.
            </span>
          </div>

          {openManualRequest ? (
            <div className="cmf-oled flex items-center justify-between p-3.5 text-xs">
              <span className="flex items-center gap-2 font-tech font-bold text-[#F8FAFC] uppercase">
                <Clock className="h-4 w-4 animate-spin text-[var(--cmf-amber)]" />
                Warte auf Foto der Verstecker ...
              </span>
              <span className="font-dot text-base text-[var(--cmf-amber)]">
                {formatDurationClock(manualRemainingMs)}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="cmf-well p-3 space-y-2">
                <span className="flex items-center gap-2 font-industrial text-sm font-bold text-[var(--text-main)]">
                  <Camera className="h-4 w-4 text-[var(--cmf-teal)]" />
                  Foto nach oben (Himmel/Bäume)
                </span>
                <div className="flex">
                  {renderBuyButton({
                    questionType: 'MEDIA_SKY',
                    penaltyMin: photoMin,
                    label: 'Anfordern',
                  })}
                </div>
              </div>

              <div className="cmf-well p-3 space-y-2">
                <span className="flex items-center gap-2 font-industrial text-sm font-bold text-[var(--text-main)]">
                  <Camera className="h-4 w-4 text-[var(--cmf-amber)]" />
                  Foto nach unten (Boden)
                </span>
                <div className="flex">
                  {renderBuyButton({
                    questionType: 'MEDIA_GROUND',
                    penaltyMin: photoMin,
                    label: 'Anfordern',
                  })}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Bisherige Tipps */}
        <section id="q-history" className="scroll-mt-14 space-y-2.5">
          <h3 className="font-industrial px-1 text-base text-[var(--text-main)]">
            Eure gekauften Tipps ({Object.keys(teamClues).length})
          </h3>
          <ClueHistoryList
            clues={Object.values(teamClues)}
            requestsMap={teamRequests}
            hiddenClueIds={hiddenClueIds}
            gameStartTimestamp={publicState.gameStartTimestamp}
            onToggleClueOverlay={onToggleClueOverlay}
            getServerNow={() => adapter.getServerNow()}
            onUndoClue={
              ownMember.isHost || isOverviewMember(ownMember)
                ? (clue) => adapter.undoClueByHost(clue.teamId, clue)
                : undefined
            }
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
