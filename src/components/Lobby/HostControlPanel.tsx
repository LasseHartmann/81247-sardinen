import React, { useEffect, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  UserPlus,
  UserX,
  Radio,
  MousePointerClick,
  Trash2,
  FastForward,
  Lock,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  buildManhuntRadarSchedule,
  buildManhuntRadarScheduleForHidingMs,
  buildRadarScheduleForHidingMinutes,
  buildRadarScheduleForHidingMs,
  createDefaultPublicState,
  createDefaultTeams,
  DEFAULT_CLASSIC_HIDING_MINUTES,
  DEFAULT_CLASSIC_SEARCH_MINUTES,
  DEFAULT_MANHUNT_HIDING_MINUTES,
  DEFAULT_MANHUNT_SHRINK_MINUTES,
  getManhuntPingStatusAtElapsedMs,
  getQuestionPenaltyMs,
  TEAM_PALETTE,
} from '../../config/gameConfig';
import { getDueRadarCircle, getPhaseForElapsedMs } from '../../geo/radar';
import {
  lockHiderAnchorAndGenerateRadar,
  resolveClassicHiderCandidateLocation,
} from '../../hooks/useControllerEngine';
import { HardwareKnob } from '../Common/HardwareKnob';
import {
  deduplicateEnabledMembers,
  filterOnlineEnabledMembers,
  getRequiredReadyHiderMembers,
  isPlayerOnline,
  type DatabaseAdapter,
} from '../../services/databaseAdapter';
import { generateRandomId, generateSessionSecrets } from '../../services/qrService';
import type {
  ClueRecord,
  ClueRequest,
  GameMode,
  GamePhase,
  HiderLoginLock,
  HiderPrivateState,
  JoinRequest,
  MemberRecord,
  PlayerSide,
  PresenceSession,
  PublicGameState,
  RadarStageId,
  TeamPublic,
} from '../../types/game';
import {
  computeNetElapsedMs,
  formatDurationClock,
  formatPenaltyMinutes,
} from '../../utils/formatting';

export interface HostControlPanelProps {
  adapter: DatabaseAdapter;
  ownMember: MemberRecord;
  publicState: PublicGameState;
  hiderPrivate: HiderPrivateState | null;
  activeHiderLock: HiderLoginLock | null;
  readyPlayerIds: string[];
  members: Record<string, MemberRecord>;
  joinRequests: Record<string, JoinRequest>;
  presence: Record<string, Record<string, PresenceSession>>;
  teamsPublic: Record<string, TeamPublic>;
  cluesByTeam?: Record<string, Record<string, ClueRecord>>;
  requestsByTeam?: Record<string, Record<string, ClueRequest>>;
  onNavigateToMap: () => void;
  onLeaveAndLockConsole?: () => void;
}

export const HostControlPanel: React.FC<HostControlPanelProps> = ({
  adapter,
  ownMember,
  publicState,
  hiderPrivate,
  activeHiderLock,
  readyPlayerIds,
  members,
  joinRequests,
  presence,
  teamsPublic,
  cluesByTeam = {},
  requestsByTeam = {},
  onNavigateToMap,
  onLeaveAndLockConsole,
}) => {
  const [selectedMode, setSelectedMode] = useState<GameMode>(() =>
    publicState.gameMode === 'MANHUNT' ? 'MANHUNT' : 'CLASSIC'
  );
  useEffect(() => {
    setSelectedMode(publicState.gameMode === 'MANHUNT' ? 'MANHUNT' : 'CLASSIC');
  }, [publicState.gameMode]);
  const isManhunt = selectedMode === 'MANHUNT';

  const [classicHidingMin, setClassicHidingMin] = useState(() => {
    if (publicState.gameMode === 'MANHUNT') return DEFAULT_CLASSIC_HIDING_MINUTES;
    const mins = Math.round(publicState.radarSchedule.hidingDurationMs / 60_000);
    return Math.min(55, Math.max(5, Math.round(mins / 5) * 5));
  });

  const [classicSearchMin, setClassicSearchMin] = useState(() => {
    const rawSearchMs =
      publicState.classicSearchDurationMs ??
      DEFAULT_CLASSIC_SEARCH_MINUTES * 60_000;
    const mins = Math.round(rawSearchMs / 60_000);
    return Math.min(90, Math.max(30, Math.round(mins / 15) * 15));
  });

  const [manhuntHeadStartMin, setManhuntHeadStartMin] = useState(() => {
    if (publicState.gameMode !== 'MANHUNT') return DEFAULT_MANHUNT_HIDING_MINUTES;
    const mins = Math.round(publicState.radarSchedule.hidingDurationMs / 60_000);
    return Math.min(30, Math.max(0, mins));
  });

  const [manhuntShrinkMin, setManhuntShrinkMin] = useState(() => {
    const rawShrinkMs =
      publicState.manhuntShrinkDurationMs ??
      DEFAULT_MANHUNT_SHRINK_MINUTES * 60_000;
    const mins = Math.round(rawShrinkMs / 60_000);
    return Math.min(80, Math.max(10, Math.round(mins / 5) * 5));
  });

  const handleSelectGameMode = (nextMode: GameMode) => {
    setSelectedMode(nextMode);
    const nextSchedule =
      nextMode === 'MANHUNT'
        ? buildManhuntRadarSchedule(manhuntHeadStartMin, manhuntShrinkMin)
        : buildRadarScheduleForHidingMinutes(classicHidingMin, classicSearchMin);
    void adapter
      .savePublicStateByHost({
        ...publicState,
        gameMode: nextMode,
        classicSearchDurationMs: classicSearchMin * 60_000,
        manhuntShrinkDurationMs: manhuntShrinkMin * 60_000,
        radarSchedule: nextSchedule,
      })
      .catch(() => {});
  };

  const openRequests = Object.values(joinRequests).sort(
    (a, b) => a.requestedAt - b.requestedAt
  );

  const [hostNowMs, setHostNowMs] = useState(() => adapter.getServerNow());
  const [customTimeMinutesInput, setCustomTimeMinutesInput] = useState('');

  useEffect(() => {
    setHostNowMs(adapter.getServerNow());
    if (publicState.status !== 'RUNNING' && publicState.status !== 'PAUSED') {
      return;
    }
    const id = setInterval(() => {
      setHostNowMs(adapter.getServerNow());
    }, 1000);
    return () => clearInterval(id);
  }, [adapter, publicState.status]);

  const enabledMembers = deduplicateEnabledMembers(members, presence);
  const onlineMembers = filterOnlineEnabledMembers(
    members,
    presence,
    ownMember.uid
  );
  const requiredHiderMembers = getRequiredReadyHiderMembers(members, presence);
  const lobbyEditableMembers = [
    ...requiredHiderMembers,
    ...onlineMembers.filter((m) => m.side !== 'HIDER'),
  ];
  const activeGroupMembers =
    publicState.status === 'LOBBY' ? lobbyEditableMembers : enabledMembers;
  const offlineLobbyMembers =
    publicState.status === 'LOBBY'
      ? enabledMembers.filter(
          (m) =>
            m.side !== 'HIDER' &&
            !isPlayerOnline(m.playerId, members, presence, ownMember.uid)
        )
      : [];

  const readySet = new Set(readyPlayerIds);
  const readyCount = requiredHiderMembers.filter((m) =>
    readySet.has(m.playerId)
  ).length;
  const hiderCount = requiredHiderMembers.length;

  const handleStartRound = async () => {
    const now = adapter.getServerNow();
    const fallbackSecrets = generateSessionSecrets();
    const preservedQrSecret =
      hiderPrivate?.qrSecret?.trim() || fallbackSecrets.qrSecret;
    const preservedShortCode =
      hiderPrivate?.shortCode?.trim() || fallbackSecrets.shortCode;

    const seekerSource = onlineMembers.some(
      (m) => m.side === 'SEEKER' && Boolean(m.teamId)
    )
      ? onlineMembers
      : enabledMembers;

    const nextTeams = createDefaultTeams();
    for (const m of seekerSource) {
      if (m.enabled && m.side === 'SEEKER' && m.teamId && nextTeams[m.teamId]) {
        if (!nextTeams[m.teamId].memberPlayerIds.includes(m.playerId)) {
          nextTeams[m.teamId].memberPlayerIds.push(m.playerId);
        }
        nextTeams[m.teamId].beaconPlayerId =
          nextTeams[m.teamId].memberPlayerIds[0] ?? null;
      }
    }

    const occupiedTeamIds = Object.values(nextTeams)
      .filter((t) => t.memberPlayerIds.length > 0)
      .map((t) => t.id);

    const activeSchedule = isManhunt
      ? buildManhuntRadarSchedule(manhuntHeadStartMin, manhuntShrinkMin)
      : buildRadarScheduleForHidingMinutes(classicHidingMin, classicSearchMin);
    const immediateOpenSearch = activeSchedule.hidingDurationMs <= 0;

    const nextPublicState: PublicGameState = {
      ...publicState,
      gameMode: selectedMode,
      classicSearchDurationMs: classicSearchMin * 60_000,
      manhuntShrinkDurationMs: manhuntShrinkMin * 60_000,
      status: 'RUNNING',
      currentPhase: immediateOpenSearch ? 'OPEN_SEARCH' : 'HIDING',
      gameStartTimestamp: now,
      searchStartTimestamp: immediateOpenSearch ? now : null,
      pausedAt: null,
      totalPausedMs: 0,
      pausedBeforeSearchMs: 0,
      anchorLocked: false,
      radarCircle: null,
      emergencyStopReason: null,
      leashAlertActive: false,
      activeTeamIds: occupiedTeamIds,
      hiderLock: activeHiderLock,
      radarSchedule: activeSchedule,
    };

    await adapter.resetRoundByHost(nextPublicState, nextTeams, {
      anchorPoint: null,
      radarStages: [],
      qrSecret: preservedQrSecret,
      shortCode: preservedShortCode,
      hiderLocations: {},
    });
    if (activeHiderLock) {
      await adapter.savePublicStateByHost(nextPublicState).catch(() => {});
    }
    onNavigateToMap();
  };

  const handleTogglePause = async () => {
    const now = adapter.getServerNow();
    if (publicState.status === 'RUNNING') {
      await adapter.savePublicStateByHost({
        ...publicState,
        status: 'PAUSED',
        pausedAt: now,
      });
    } else if (publicState.status === 'PAUSED' && publicState.pausedAt !== null) {
      const addedPause = Math.max(0, now - publicState.pausedAt);
      await adapter.savePublicStateByHost({
        ...publicState,
        status: 'RUNNING',
        pausedAt: null,
        totalPausedMs: publicState.totalPausedMs + addedPause,
      });
    }
  };

  const syncClassicPrivateRadarStages = async (
    nextSched: PublicGameState['radarSchedule'],
    basePrivate: HiderPrivateState | null
  ): Promise<HiderPrivateState | null> => {
    if (
      !basePrivate ||
      !basePrivate.anchorPoint ||
      basePrivate.radarStages.length !== 5
    ) {
      return basePrivate;
    }
    const schedMap: Record<RadarStageId, number> = {
      1: nextSched.stage1Ms,
      2: nextSched.stage2Ms,
      3: nextSched.stage3Ms,
      4: nextSched.stage4Ms,
      5: nextSched.stage5Ms,
    };
    const synced: HiderPrivateState = {
      ...basePrivate,
      radarStages: basePrivate.radarStages.map((s) => ({
        ...s,
        triggerElapsedMs: schedMap[s.stage],
      })),
    };
    await adapter.saveHiderPrivate(synced);
    return synced;
  };

  const handleForceStartOpenSearch = async () => {
    const now = adapter.getServerNow();
    const addedPause =
      publicState.status === 'PAUSED' && publicState.pausedAt !== null
        ? Math.max(0, now - publicState.pausedAt)
        : 0;
    const nextTotalPausedMs = publicState.totalPausedMs + addedPause;
    const unpausedState: PublicGameState = {
      ...publicState,
      status: 'RUNNING',
      pausedAt: null,
      totalPausedMs: nextTotalPausedMs,
    };
    const currentNetMs = computeNetElapsedMs(unpausedState, now);

    if (isManhunt) {
      const shrinkDurationMs =
        publicState.manhuntShrinkDurationMs ?? manhuntShrinkMin * 60_000;
      const nextSched = buildManhuntRadarScheduleForHidingMs(
        currentNetMs,
        shrinkDurationMs
      );
      await adapter.savePublicStateByHost({
        ...unpausedState,
        currentPhase: 'OPEN_SEARCH',
        searchStartTimestamp: publicState.searchStartTimestamp ?? now,
        pausedBeforeSearchMs: nextTotalPausedMs,
        anchorLocked: false,
        radarSchedule: nextSched,
      });
      setHostNowMs(now);
      return;
    }

    const searchDurationMs =
      publicState.classicSearchDurationMs ?? classicSearchMin * 60_000;
    const nextSched = buildRadarScheduleForHidingMs(
      currentNetMs,
      searchDurationMs
    );

    const nextPublicBase: PublicGameState = {
      ...unpausedState,
      currentPhase: 'OPEN_SEARCH',
      searchStartTimestamp: publicState.searchStartTimestamp ?? now,
      pausedBeforeSearchMs: nextTotalPausedMs,
      radarSchedule: nextSched,
    };

    let effectivePrivate = hiderPrivate;
    if (effectivePrivate?.anchorPoint) {
      effectivePrivate = await syncClassicPrivateRadarStages(
        nextSched,
        effectivePrivate
      );
    } else if (effectivePrivate) {
      const candidate = resolveClassicHiderCandidateLocation({
        hiderPrivate: effectivePrivate,
        serverNowMs: now,
      });
      if (candidate) {
        effectivePrivate = await lockHiderAnchorAndGenerateRadar({
          adapter,
          uid: ownMember.uid,
          targetLocation: { lat: candidate.lat, lng: candidate.lng },
          accuracy: candidate.accuracy,
          serverNowMs: now,
          publicState: nextPublicBase,
          currentHiderPrivate: effectivePrivate,
          startSearchImmediately: false,
        });
      }
    }

    await adapter.savePublicStateByHost({
      ...nextPublicBase,
      anchorLocked: Boolean(effectivePrivate?.anchorPoint),
    });
    setHostNowMs(now);
  };

  const handleAdjustHidingTimeMs = async (deltaMs: number) => {
    const now = adapter.getServerNow();
    const currentNetMs = computeNetElapsedMs(publicState, now);
    const nextHidingDurationMs = Math.max(
      0,
      publicState.radarSchedule.hidingDurationMs + deltaMs
    );
    if (nextHidingDurationMs <= currentNetMs) {
      await handleForceStartOpenSearch();
      return;
    }

    const nextSched = isManhunt
      ? buildManhuntRadarScheduleForHidingMs(
          nextHidingDurationMs,
          publicState.manhuntShrinkDurationMs ?? manhuntShrinkMin * 60_000
        )
      : buildRadarScheduleForHidingMs(
          nextHidingDurationMs,
          publicState.classicSearchDurationMs ?? classicSearchMin * 60_000
        );

    if (!isManhunt && hiderPrivate?.anchorPoint) {
      await syncClassicPrivateRadarStages(nextSched, hiderPrivate);
    }

    await adapter.savePublicStateByHost({
      ...publicState,
      radarSchedule: nextSched,
    });
    setHostNowMs(now);
  };

  const handleAdjustSearchTimeMs = async (deltaMs: number) => {
    if (publicState.gameStartTimestamp === null) return;
    const now = adapter.getServerNow();
    const currentNetMs = computeNetElapsedMs(publicState, now);
    const hidingMs = publicState.radarSchedule.hidingDurationMs;
    const currentSearchElapsedMs = Math.max(0, currentNetMs - hidingMs);
    const effectiveDeltaMs = Math.max(-currentSearchElapsedMs, deltaMs);
    if (effectiveDeltaMs === 0) return;

    const nextNetMs = currentNetMs + effectiveDeltaMs;
    const baseSearchStart = publicState.searchStartTimestamp ?? now;

    let nextPhase: GamePhase = publicState.currentPhase;
    let nextRadar = publicState.radarCircle;

    if (isManhunt) {
      const huntDurationMs =
        publicState.manhuntShrinkDurationMs ?? manhuntShrinkMin * 60_000;
      const pingStatus = getManhuntPingStatusAtElapsedMs(
        nextNetMs,
        hidingMs,
        huntDurationMs
      );
      nextPhase =
        pingStatus.dueStageId === null
          ? 'OPEN_SEARCH'
          : pingStatus.dueStageId === 5
            ? 'ENDGAME'
            : (`RADAR_${pingStatus.dueStageId}` as GamePhase);
      if (pingStatus.dueStageId === null) {
        nextRadar = null;
      }
    } else {
      const rawPhase = getPhaseForElapsedMs(nextNetMs, publicState.radarSchedule);
      nextPhase = rawPhase === 'HIDING' ? 'OPEN_SEARCH' : rawPhase;
      if (hiderPrivate?.radarStages && hiderPrivate.radarStages.length > 0) {
        nextRadar = getDueRadarCircle(
          nextNetMs,
          hiderPrivate.radarStages,
          now
        );
      } else if (nextNetMs < publicState.radarSchedule.stage1Ms) {
        nextRadar = null;
      }
    }

    // Offene Foto-Fristen um dasselbe Netto-Zeitdelta verschieben, damit Vorspulen kein Sofort-Timeout auslöst
    for (const [teamId, teamMap] of Object.entries(requestsByTeam)) {
      for (const req of Object.values(teamMap ?? {})) {
        if (
          req.sessionId === publicState.sessionId &&
          req.status === 'AWAITING_HIDER_MEDIA' &&
          typeof req.mediaDeadlineNetElapsedMs === 'number'
        ) {
          await adapter
            .updateClueRequest(teamId, req.id, {
              ...req,
              netElapsedAtRequestMs:
                typeof req.netElapsedAtRequestMs === 'number'
                  ? req.netElapsedAtRequestMs + effectiveDeltaMs
                  : req.netElapsedAtRequestMs,
              mediaDeadlineNetElapsedMs:
                req.mediaDeadlineNetElapsedMs + effectiveDeltaMs,
            })
            .catch(() => {});
        }
      }
    }

    await adapter.savePublicStateByHost({
      ...publicState,
      gameStartTimestamp: publicState.gameStartTimestamp - effectiveDeltaMs,
      searchStartTimestamp: baseSearchStart - effectiveDeltaMs,
      currentPhase: nextPhase,
      radarCircle: nextRadar,
    });
    setHostNowMs(now);
  };

  const handleApplyCustomTimeMinutes = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = Number(customTimeMinutesInput.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) return;
    const now = adapter.getServerNow();
    const currentNetMs = computeNetElapsedMs(publicState, now);

    if (publicState.currentPhase === 'HIDING') {
      const currentRemMs = Math.max(
        0,
        publicState.radarSchedule.hidingDurationMs - currentNetMs
      );
      const targetRemMs = Math.round(parsed * 60_000);
      await handleAdjustHidingTimeMs(targetRemMs - currentRemMs);
    } else {
      const currentSearchMs = Math.max(
        0,
        currentNetMs - publicState.radarSchedule.hidingDurationMs
      );
      const targetSearchMs = Math.round(parsed * 60_000);
      await handleAdjustSearchTimeMs(targetSearchMs - currentSearchMs);
    }
    setCustomTimeMinutesInput('');
  };

  const handleResetRound = async () => {
    const sessionId = generateRandomId('session');
    const secrets = generateSessionSecrets();
    const resetPublic = createDefaultPublicState(
      sessionId,
      publicState.playArea
    );
    resetPublic.allowTestClicks = publicState.allowTestClicks;
    resetPublic.gameMode = selectedMode;
    resetPublic.classicSearchDurationMs = classicSearchMin * 60_000;
    resetPublic.manhuntShrinkDurationMs = manhuntShrinkMin * 60_000;
    resetPublic.radarSchedule = isManhunt
      ? buildManhuntRadarSchedule(manhuntHeadStartMin, manhuntShrinkMin)
      : buildRadarScheduleForHidingMinutes(classicHidingMin, classicSearchMin);

    const resetTeams = createDefaultTeams();
    for (const m of enabledMembers) {
      if (m.enabled && m.side === 'SEEKER' && m.teamId && resetTeams[m.teamId]) {
        resetTeams[m.teamId].memberPlayerIds.push(m.playerId);
        resetTeams[m.teamId].beaconPlayerId =
          teamsPublic[m.teamId]?.beaconPlayerId ?? m.playerId;
      }
    }

    await adapter.resetRoundByHost(resetPublic, resetTeams, {
      anchorPoint: null,
      radarStages: [],
      qrSecret: secrets.qrSecret,
      shortCode: secrets.shortCode,
      hiderLocations: {},
    });
  };

  const handleAssignMember = async (
    member: MemberRecord,
    nextSelection: string
  ) => {
    let side: PlayerSide = 'UNASSIGNED';
    let teamId: string | null = null;
    if (nextSelection === 'HIDER') {
      side = 'HIDER';
    } else if (nextSelection.startsWith('team-')) {
      side = 'SEEKER';
      teamId = nextSelection;
    }

    for (const m of Object.values(members)) {
      if (m.playerId === member.playerId) {
        await adapter.updateMember(m.uid, {
          ...m,
          side,
          teamId,
        });
      }
    }
    await adapter.savePlayerAssignment(member.playerId, side, teamId);

    for (const palette of TEAM_PALETTE) {
      const curTeam = teamsPublic[palette.id];
      if (!curTeam) continue;
      const filtered = curTeam.memberPlayerIds.filter(
        (pid) => pid !== member.playerId
      );
      if (teamId === palette.id && !filtered.includes(member.playerId)) {
        filtered.push(member.playerId);
      }
      const nextBeacon =
        filtered.length === 0
          ? null
          : curTeam.beaconPlayerId && filtered.includes(curTeam.beaconPlayerId)
            ? curTeam.beaconPlayerId
            : filtered[0];

      await adapter.saveTeamPublic(palette.id, {
        ...curTeam,
        memberPlayerIds: filtered,
        beaconPlayerId: nextBeacon,
      });
    }
  };

  const handleKickMember = async (member: MemberRecord) => {
    const matchingUids = Object.values(members)
      .filter((m) => m.playerId === member.playerId)
      .map((m) => m.uid);
    if (!matchingUids.includes(member.uid)) {
      matchingUids.push(member.uid);
    }
    await adapter.kickPlayerByHost(member.playerId, matchingUids);
  };

  // NUR besetzte Teams anzeigen (vor Start ausschließlich mit aktuell online verbundenen Spielern!)
  const occupiedTeams = TEAM_PALETTE.map((palette) => {
    const team = teamsPublic[palette.id];
    const assignedMembers = activeGroupMembers.filter(
      (m) => m.side === 'SEEKER' && m.teamId === palette.id
    );
    return {
      id: palette.id,
      name: team?.name ?? palette.name,
      color: team?.color ?? palette.color,
      memberNames: assignedMembers.map((m) => m.name),
    };
  }).filter((t) => t.memberNames.length > 0);

  return (
    <div className="cmf-drafting-bg cmf-scroll-area cmf-view-enter h-full px-3 py-3.5 sm:p-4 text-[var(--text-main)]">
      <div className="mx-auto max-w-3xl space-y-4 sm:space-y-5 pb-12">
        {/* Kopfzeile (Admin-Zugriff bleibt beim Tab-Wechsel & Neuladen erhalten) */}
        <div className="cmf-chassis cmf-card-enter flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <span className="cmf-badge-teal inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
              SPIELLEITER // KONSOLE
            </span>
            <h2 className="font-dot mt-1 text-lg sm:text-xl text-[var(--text-main)]">
              Rundensteuerung & Teams
            </h2>
          </div>
          <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
            ADMIN-MODUS DAUERHAFT AKTIV
          </span>
        </div>

        {/* 1. Offene Beitrittswünsche */}
        {openRequests.length > 0 && (
          <section className="cmf-module p-4 sm:p-5 space-y-3">
            <h3 className="font-industrial flex items-center gap-2 text-sm text-[var(--text-main)]">
              <UserPlus className="h-4 w-4 text-[var(--cmf-orange)]" />
              Offene Beitrittswünsche ({openRequests.length})
            </h3>
            <div className="space-y-2">
              {openRequests.map((req) => (
                <div
                  key={req.uid}
                  className="cmf-well flex flex-wrap items-center justify-between gap-2 p-3"
                >
                  <div>
                    <p className="text-sm font-bold text-[var(--text-main)]">{req.name}</p>
                    <p className="font-tech text-[10px] text-[var(--text-muted)]">
                      UID // {req.uid}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid={`approve-player-${req.playerId}`}
                    onClick={() => void adapter.approveJoinRequest(req)}
                    className="cmf-btn-primary font-dot min-h-[40px] px-3.5 py-2 text-xs font-bold"
                  >
                    Spieler freischalten
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 2. Rundenstart, Spielmodus, Bereitschafts-Status, Pause & Reset */}
        <section className="cmf-module p-4 sm:p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-3">
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              Systemsteuerung
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold tracking-wider uppercase ${
                isManhunt ? 'cmf-badge-orange' : 'cmf-badge-teal'
              }`}
            >
              MODUS // {isManhunt ? 'MANHUNT' : 'KLASSISCH'}
            </span>
          </div>

          {/* Spielmodus-Umschalter (Klassisch vs. Manhunt) */}
          <div className="space-y-2">
            <span className="block font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              Spielmodus wählen
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="mode-select-classic"
                disabled={
                  publicState.status !== 'LOBBY' &&
                  publicState.status !== 'FINISHED'
                }
                onClick={() => handleSelectGameMode('CLASSIC')}
                className={`flex flex-col items-start gap-1 rounded-2xl p-3 text-left transition-all ${
                  !isManhunt
                    ? 'cmf-btn-active ring-1 ring-[var(--cmf-teal)]'
                    : 'cmf-well opacity-80 hover:opacity-100'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="font-dot text-xs font-bold uppercase">
                  Klassisch (Sardinen)
                </span>
                <span className="text-[11px] leading-snug opacity-80">
                  Festes Versteck (50 m) • Hinweis-Fragen • Endspiel-Radar
                </span>
              </button>

              <button
                type="button"
                data-testid="mode-select-manhunt"
                disabled={
                  publicState.status !== 'LOBBY' &&
                  publicState.status !== 'FINISHED'
                }
                onClick={() => handleSelectGameMode('MANHUNT')}
                className={`flex flex-col items-start gap-1 rounded-2xl p-3 text-left transition-all ${
                  isManhunt
                    ? 'cmf-btn-active ring-1 ring-[var(--cmf-orange)]'
                    : 'cmf-well opacity-80 hover:opacity-100'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <span className="font-dot text-xs font-bold uppercase">
                  Manhunt
                </span>
                <span className="text-[11px] leading-snug opacity-80">
                  Dauerhaft in Bewegung (kein festes Versteck) • Ping alle 10/5 Min. • Schrumpf-Zone
                </span>
              </button>
            </div>
          </div>

          {!isManhunt ? (
            (() => {
              const classicPreviewSchedule = buildRadarScheduleForHidingMinutes(
                classicHidingMin,
                classicSearchMin
              );
              const searchDurationMs = classicSearchMin * 60_000;
              const splitMin = Math.round(
                getQuestionPenaltyMs('SPLIT_NS', searchDurationMs) / 60_000
              );
              const thermoMin = Math.round(
                getQuestionPenaltyMs('THERMOMETER', searchDurationMs) / 60_000
              );
              const photoMin = Math.round(
                getQuestionPenaltyMs('MEDIA_SKY', searchDurationMs) / 60_000
              );
              const donutMin = Math.round(
                getQuestionPenaltyMs('DONUT_RING', searchDurationMs) / 60_000
              );
              const envMin = Math.round(
                getQuestionPenaltyMs('OSM_TRANSIT', searchDurationMs) / 60_000
              );

              return (
                <div className="space-y-2.5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <HardwareKnob
                      label="VERSTECKZEIT (STANDARD 15 MIN)"
                      ariaLabel="Versteckzeit in Minuten"
                      dataTestId="hiding-time-knob"
                      value={classicHidingMin}
                      min={5}
                      max={55}
                      step={5}
                      unit=" Min."
                      onChange={(nextMin) => {
                        setClassicHidingMin(nextMin);
                        const nextSched = buildRadarScheduleForHidingMinutes(
                          nextMin,
                          classicSearchMin
                        );
                        if (!isManhunt && hiderPrivate?.anchorPoint) {
                          void syncClassicPrivateRadarStages(
                            nextSched,
                            hiderPrivate
                          );
                        }
                        void adapter
                          .savePublicStateByHost({
                            ...publicState,
                            gameMode: 'CLASSIC',
                            classicSearchDurationMs: classicSearchMin * 60_000,
                            radarSchedule: nextSched,
                          })
                          .catch(() => {});
                      }}
                    />

                    <HardwareKnob
                      label="SPIELZEIT / SUCHDAUER BIS 25M (30-90 MIN)"
                      ariaLabel="Spielzeit und Suchdauer in Minuten"
                      dataTestId="classic-search-time-knob"
                      value={classicSearchMin}
                      min={30}
                      max={90}
                      step={15}
                      unit=" Min."
                      onChange={(nextSearchMin) => {
                        setClassicSearchMin(nextSearchMin);
                        const effectiveHidingMs =
                          publicState.status !== 'LOBBY' &&
                          publicState.currentPhase !== 'HIDING'
                            ? publicState.radarSchedule.hidingDurationMs
                            : classicHidingMin * 60_000;
                        const nextSched = buildRadarScheduleForHidingMs(
                          effectiveHidingMs,
                          nextSearchMin * 60_000
                        );
                        if (!isManhunt && hiderPrivate?.anchorPoint) {
                          void syncClassicPrivateRadarStages(
                            nextSched,
                            hiderPrivate
                          );
                        }
                        void adapter
                          .savePublicStateByHost({
                            ...publicState,
                            gameMode: 'CLASSIC',
                            classicSearchDurationMs: nextSearchMin * 60_000,
                            radarSchedule: nextSched,
                          })
                          .catch(() => {});
                      }}
                    />
                  </div>

                  <div className="cmf-well px-3.5 py-2 text-center font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase space-y-0.5">
                    <div>
                      RADAR-STUFEN AB SUCHSTART (800M → 400M → 200M → 100M → 25M):{' '}
                      <span className="text-[var(--text-main)]">
                        +{formatDurationClock(classicPreviewSchedule.stage1Ms - classicPreviewSchedule.hidingDurationMs)} → +
                        {formatDurationClock(classicPreviewSchedule.stage2Ms - classicPreviewSchedule.hidingDurationMs)} → +
                        {formatDurationClock(classicPreviewSchedule.stage3Ms - classicPreviewSchedule.hidingDurationMs)} → +
                        {formatDurationClock(classicPreviewSchedule.stage4Ms - classicPreviewSchedule.hidingDurationMs)} → +
                        {formatDurationClock(classicPreviewSchedule.stage5Ms - classicPreviewSchedule.hidingDurationMs)}
                      </span>
                    </div>
                    <div>
                      ANGEPASSTE TIPP-PREISE:{' '}
                      <span className="text-[var(--cmf-teal)]">
                        RICHTUNG/RADAR +{splitMin} MIN. • THERMO +{thermoMin} MIN. • FOTO +{photoMin} MIN. • DONUT +{donutMin} MIN. • UMGEBUNG +{envMin} MIN.
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="space-y-2.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <HardwareKnob
                  label="VORSPRUNG VERSTECKER (STD. 5 MIN)"
                  ariaLabel="Vorsprung der Verstecker in Minuten"
                  dataTestId="hiding-time-knob"
                  value={manhuntHeadStartMin}
                  min={0}
                  max={30}
                  step={1}
                  unit=" Min."
                  onChange={(nextHeadStart) => {
                    setManhuntHeadStartMin(nextHeadStart);
                    void adapter
                      .savePublicStateByHost({
                        ...publicState,
                        gameMode: 'MANHUNT',
                        manhuntShrinkDurationMs: manhuntShrinkMin * 60_000,
                        radarSchedule: buildManhuntRadarSchedule(
                          nextHeadStart,
                          manhuntShrinkMin
                        ),
                      })
                      .catch(() => {});
                  }}
                />

                <HardwareKnob
                  label="SPIELZEIT / SCHRUMPEN BIS 150M (10-80 MIN)"
                  ariaLabel="Gesamtdauer bis zur kleinsten Zone in Minuten"
                  dataTestId="manhunt-shrink-time-knob"
                  value={manhuntShrinkMin}
                  min={10}
                  max={80}
                  step={5}
                  unit=" Min."
                  onChange={(nextShrinkMin) => {
                    setManhuntShrinkMin(nextShrinkMin);
                    const effectiveHeadStartMs =
                      publicState.status !== 'LOBBY' &&
                      publicState.currentPhase !== 'HIDING'
                        ? publicState.radarSchedule.hidingDurationMs
                        : manhuntHeadStartMin * 60_000;
                    void adapter
                      .savePublicStateByHost({
                        ...publicState,
                        gameMode: 'MANHUNT',
                        manhuntShrinkDurationMs: nextShrinkMin * 60_000,
                        radarSchedule: buildManhuntRadarScheduleForHidingMs(
                          effectiveHeadStartMs,
                          nextShrinkMin * 60_000
                        ),
                      })
                      .catch(() => {});
                  }}
                />
              </div>

              <div className="cmf-well px-3.5 py-2 text-center font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                KEIN FESTES VERSTECK • PING ALLE 10 MIN. & IM LETZTEN VIERTEL (AB{' '}
                {formatDurationClock(Math.round(manhuntShrinkMin * 60_000 * 0.75))}
                ) ALLE 5 MIN. • ZONE: 1200M → 800M → 500M → 300M → 150M
              </div>
            </div>
          )}

          {/* OLED Status- & Bereitschafts-Anzeige */}
          <div className="cmf-oled flex flex-wrap items-center justify-between gap-3 p-3.5">
            <div className="flex items-center gap-2.5">
              {publicState.status === 'RUNNING' ? (
                <span className="nothing-red-dot" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-[var(--cmf-teal)]" />
              )}
              <span className="font-tech text-xs font-bold tracking-wider text-[#F8FAFC] uppercase">
                STATUS: {publicState.status} // {publicState.currentPhase}
              </span>
            </div>

            {publicState.status === 'LOBBY' && (
              <span className="font-dot text-sm text-[var(--cmf-teal)]">
                VERSTECKER BEREIT: {readyCount} / {requiredHiderMembers.length}
              </span>
            )}
          </div>

          {publicState.status === 'LOBBY' && (
            <div className="cmf-well flex items-center gap-2 px-3.5 py-2.5 text-xs text-[var(--text-muted)]">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
              <span>
                {activeHiderLock?.passwordHash
                  ? 'Runde startet automatisch, sobald alle eingeteilten Verstecker (auch offline) auf „Bereit“ gedrückt haben!'
                  : 'Wartet darauf, dass die Verstecker in der Lobby ihr Passwort festlegen.'}
              </span>
            </div>
          )}

          {/* Live-Zeitbearbeitung während laufender oder pausierter Runde */}
          {(publicState.status === 'RUNNING' ||
            publicState.status === 'PAUSED') &&
            (() => {
              const liveNetMs = computeNetElapsedMs(publicState, hostNowMs);
              const isHidingNow = publicState.currentPhase === 'HIDING';
              const remHidingMs = Math.max(
                0,
                publicState.radarSchedule.hidingDurationMs - liveNetMs
              );
              const searchElapsedMs = Math.max(
                0,
                liveNetMs - publicState.radarSchedule.hidingDurationMs
              );

              return (
                <div
                  data-testid="host-live-time-editor"
                  className="cmf-well space-y-2.5 p-3.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 font-tech text-[11px] font-bold tracking-wider text-[var(--text-main)] uppercase">
                      <Clock className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                      {isHidingNow
                        ? 'Zeitbearbeitung // Verbleibende Versteckzeit'
                        : 'Zeitbearbeitung // Aktuelle Suchzeit'}
                    </span>
                    <span
                      data-testid="host-live-time-readout"
                      className="cmf-oled rounded-lg px-2.5 py-1 font-dot text-sm text-[var(--cmf-amber)]"
                    >
                      {isHidingNow
                        ? `Noch ${formatDurationClock(remHidingMs)}`
                        : `Suche ${formatDurationClock(searchElapsedMs)}`}
                    </span>
                  </div>

                  <div className="grid grid-cols-4 gap-1.5">
                    {([-5, -1, 1, 5] as const).map((deltaMin) => {
                      const label =
                        deltaMin > 0 ? `+${deltaMin} Min.` : `${deltaMin} Min.`;
                      return (
                        <button
                          key={deltaMin}
                          type="button"
                          data-testid={`host-time-delta-${deltaMin}`}
                          onClick={() =>
                            void (isHidingNow
                              ? handleAdjustHidingTimeMs(deltaMin * 60_000)
                              : handleAdjustSearchTimeMs(deltaMin * 60_000))
                          }
                          className="cmf-btn-secondary font-tech min-h-[40px] px-2 py-1.5 text-xs font-bold uppercase"
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  <form
                    onSubmit={(e) => void handleApplyCustomTimeMinutes(e)}
                    className="flex flex-wrap items-center gap-2 pt-0.5"
                  >
                    <input
                      type="number"
                      min={0}
                      max={300}
                      step="any"
                      inputMode="decimal"
                      data-testid="host-custom-time-input"
                      value={customTimeMinutesInput}
                      onChange={(e) => setCustomTimeMinutesInput(e.target.value)}
                      placeholder={
                        isHidingNow
                          ? 'Rest-Versteckzeit in Min. (z. B. 10)'
                          : 'Suchzeit in Min. setzen (z. B. 15)'
                      }
                      className="cmf-input min-h-[40px] min-w-0 flex-1 px-3 py-1.5 font-tech text-xs font-semibold"
                    />
                    <button
                      type="submit"
                      data-testid="host-custom-time-apply-btn"
                      disabled={!customTimeMinutesInput.trim()}
                      className="cmf-btn-active font-tech min-h-[40px] shrink-0 px-3.5 py-1.5 text-xs font-bold uppercase disabled:opacity-50"
                    >
                      {isHidingNow ? 'Restzeit setzen' : 'Suchzeit setzen'}
                    </button>
                  </form>
                </div>
              );
            })()}

          {hiderCount === 0 && (
            <div className="cmf-badge-orange rounded-xl p-3 text-xs font-semibold">
              Hinweis: Mindestens ein Spieler sollte als Verstecker („Die Sardinen“) eingeteilt sein.
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2.5 pt-1">
            {publicState.status === 'LOBBY' ||
            publicState.status === 'FINISHED' ? (
              <button
                type="button"
                data-testid="host-start-round-btn"
                disabled={hiderCount === 0 || occupiedTeams.length === 0}
                onClick={() => void handleStartRound()}
                className="cmf-btn-primary font-dot inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold"
              >
                <Play className="h-4 w-4" />
                Runde manuell sofort starten
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleTogglePause()}
                  className="cmf-btn-active font-dot inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold"
                >
                  {publicState.status === 'PAUSED' ? (
                    <>
                      <Play className="h-4 w-4 text-[var(--cmf-teal)]" /> Spiel fortsetzen
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 text-[var(--cmf-amber)]" /> Spiel pausieren
                    </>
                  )}
                </button>

                {publicState.currentPhase === 'HIDING' && (
                  <button
                    type="button"
                    onClick={() => void handleForceStartOpenSearch()}
                    className="cmf-btn-primary font-dot inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold"
                  >
                    <FastForward className="h-4 w-4" />
                    {isManhunt
                      ? 'Jagd sofort freigeben'
                      : 'Offene Suche sofort freigeben'}
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={() => void handleResetRound()}
              className="cmf-btn-secondary font-tech inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold uppercase"
            >
              <RotateCcw className="h-4 w-4" />
              Runde zurücksetzen
            </button>
          </div>
        </section>

        {/* 3. Indoor-Testmodus Schalter */}
        <section className="cmf-module p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <MousePointerClick className="mt-0.5 h-5 w-5 shrink-0 text-[var(--cmf-teal)]" />
              <div>
                <h3 className="font-industrial text-sm text-[var(--text-main)]">
                  Testmodus: Standort per Kartenklick setzen erlauben
                </h3>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Ideal für Indoor-Generalproben vor dem Spieltag. Im echten Outdoor-Spiel in 81247 bitte deaktivieren!
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={publicState.allowTestClicks}
              onClick={() =>
                void adapter.savePublicStateByHost({
                  ...publicState,
                  allowTestClicks: !publicState.allowTestClicks,
                })
              }
              className={`font-tech min-h-[40px] shrink-0 px-4 py-2 text-xs font-bold tracking-wider uppercase ${
                publicState.allowTestClicks
                  ? 'cmf-btn-active'
                  : 'cmf-btn-secondary'
              }`}
            >
              {publicState.allowTestClicks ? 'AKTIV' : 'AUS'}
            </button>
          </div>
        </section>

        {/* 4. Spieler- & Team-Zuweisung + Nur besetzte Teams anzeigen */}
        <section className="cmf-module p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-3">
            <div>
              <h3 className="font-industrial text-base text-[var(--text-main)]">
                Spieler- & Team-Zuweisung
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Unten werden automatisch nur die Teams angezeigt, in denen mindestens ein Spieler eingeteilt ist.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void adapter.cleanupOrphanedPresence()}
              className="cmf-btn-secondary font-tech inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Sitzungen bereinigen
            </button>
          </div>

          <div className="space-y-2">
            {activeGroupMembers.map((m) => {
              const currentValue =
                m.side === 'HIDER'
                  ? 'HIDER'
                  : m.side === 'SEEKER' && m.teamId
                    ? m.teamId
                    : 'UNASSIGNED';
              const online = isPlayerOnline(
                m.playerId,
                members,
                presence,
                ownMember.uid
              );
              const isReady = readySet.has(m.playerId);

              return (
                <div
                  key={m.uid}
                  className="cmf-well flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        online ? 'bg-[var(--cmf-teal)]' : 'bg-[#9AA4AE]'
                      }`}
                    />
                    <span className="text-sm font-bold text-[var(--text-main)]">{m.name}</span>
                    {m.isHost && (
                      <span className="cmf-badge-teal rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                        Host
                      </span>
                    )}
                    {!online && (
                      <span className="cmf-badge-amber rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                        Offline
                      </span>
                    )}
                    {m.side === 'HIDER' && isReady && (
                      <span className="cmf-badge-teal rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                        ✓ Bereit
                      </span>
                    )}
                  </div>

                  <div className="flex w-full min-w-0 sm:w-auto items-center gap-2">
                    <select
                      aria-label={`Rolle für ${m.name}`}
                      value={currentValue}
                      onChange={(e) => void handleAssignMember(m, e.target.value)}
                      className="cmf-input min-h-[44px] min-w-0 flex-1 sm:flex-initial sm:max-w-[220px] px-3 py-2 text-base sm:text-xs font-semibold"
                    >
                      <option value="HIDER">Verstecker (Die Sardinen)</option>
                      {TEAM_PALETTE.map((t) => (
                        <option key={t.id} value={t.id}>
                          Sucher: {t.name}
                        </option>
                      ))}
                      <option value="UNASSIGNED">Nicht zugewiesen</option>
                    </select>

                    {m.uid !== ownMember.uid && (
                      <button
                        type="button"
                        data-testid={`kick-player-${m.playerId}`}
                        onClick={() => void handleKickMember(m)}
                        title={`${m.name} aus der Runde kicken`}
                        className="cmf-btn-secondary font-tech inline-flex min-h-[44px] shrink-0 items-center gap-1 px-3 py-2 text-[11px] font-bold text-[var(--cmf-orange)] uppercase"
                      >
                        <UserX className="h-4 w-4" />
                        <span>Kicken</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {offlineLobbyMembers.length > 0 && (
              <div className="cmf-well space-y-1.5 p-2.5 text-xs text-[var(--text-muted)]">
                <span className="font-tech text-[10px] font-bold tracking-wider uppercase block">
                  Aktuell offline (vor Start nicht in Gruppen & ohne Bereit-Pflicht):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {offlineLobbyMembers.map((m) => (
                    <span
                      key={m.uid}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/60 px-2.5 py-1 text-[11px] text-[var(--text-muted)]"
                    >
                      <span className="h-2 w-2 rounded-full bg-[#9AA4AE]" />
                      <span>{m.name}</span>
                      <button
                        type="button"
                        data-testid={`kick-player-${m.playerId}`}
                        onClick={() => void handleKickMember(m)}
                        title={`${m.name} entfernen`}
                        className="ml-1 font-tech text-[10px] font-bold text-[var(--cmf-orange)] uppercase hover:underline"
                      >
                        [X]
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Teams-Anzeige: zeigt ausschließlich Teams an, in denen jemand drinnen ist! */}
          <div className="space-y-2 border-t cmf-divider pt-3">
            <h4 className="font-tech text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              Besetzte Sucher-Teams ({occupiedTeams.length})
            </h4>
            {occupiedTeams.length === 0 ? (
              <p className="cmf-well p-3 text-xs text-[var(--text-muted)]">
                Aktuell ist noch kein Sucher-Team besetzt.
              </p>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {occupiedTeams.map((team) => {
                  const pubTeam = teamsPublic[team.id];
                  const teamPenaltyMs = pubTeam?.penaltyMs ?? 0;
                  return (
                    <div key={team.id} className="cmf-well p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-industrial flex items-center gap-2 text-sm text-[var(--text-main)]">
                          <span
                            className="h-3 w-3 rounded-full border border-white/60"
                            style={{ backgroundColor: team.color }}
                          />
                          {team.name}
                        </span>
                        <span className="cmf-badge-teal rounded px-2 py-0.5 text-[10px] font-bold uppercase">
                          {team.memberNames.length} Spieler
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 font-tech text-[11px] text-[var(--text-muted)]">
                        <Radio className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-teal)]" />
                        <span>
                          GPS-AVG:{' '}
                          <strong className="text-[var(--text-main)]">
                            {team.memberNames.join(', ')}
                          </strong>
                        </span>
                      </div>
                      {!isManhunt && publicState.status !== 'LOBBY' && (
                        <div className="space-y-1.5 border-t cmf-divider pt-2">
                          <div className="flex items-center justify-between font-tech text-[10px] font-bold uppercase">
                            <span className="text-[var(--text-muted)]">
                              STRAFZEIT / BONUS
                            </span>
                            <span
                              className={
                                teamPenaltyMs > 0
                                  ? 'text-[var(--cmf-orange)]'
                                  : teamPenaltyMs < 0
                                    ? 'text-[var(--cmf-teal)]'
                                    : 'text-[var(--text-main)]'
                              }
                            >
                              {formatPenaltyMinutes(teamPenaltyMs)}
                            </span>
                          </div>
                          <div className="grid grid-cols-4 gap-1">
                            {([-5, -1, 1, 5] as const).map((deltaMin) => (
                              <button
                                key={deltaMin}
                                type="button"
                                data-testid={`host-team-penalty-${team.id}-${deltaMin}`}
                                onClick={() =>
                                  void adapter.adjustTeamPenaltyAndClueCountAtomically(
                                    team.id,
                                    deltaMin * 60_000,
                                    0
                                  )
                                }
                                className="cmf-btn-secondary font-tech min-h-[32px] px-1.5 py-1 text-[10px] font-bold uppercase"
                              >
                                {deltaMin > 0 ? `+${deltaMin}m` : `${deltaMin}m`}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* 4b. Gekaufte Tipps verwalten / Rückgängig machen (nur im klassischen Modus) */}
        {!isManhunt &&
          (() => {
          const allRoundClues = Object.values(cluesByTeam)
            .flatMap((teamMap) => Object.values(teamMap ?? {}))
            .filter((c) => c.sessionId === publicState.sessionId)
            .sort((a, b) => b.createdAt - a.createdAt);

          return (
            <section className="cmf-module p-4 sm:p-5 space-y-3">
              <div className="flex items-center justify-between border-b cmf-divider pb-3">
                <div>
                  <h3 className="font-industrial text-base text-[var(--text-main)]">
                    Gekaufte Tipps ({allRoundClues.length})
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Tipps einzelner Teams rückgängig machen (löscht Tipp + Karten-Overlay und zieht die Strafzeit wieder ab).
                  </p>
                </div>
              </div>

              {allRoundClues.length === 0 ? (
                <p className="cmf-well p-3 text-xs text-[var(--text-muted)]">
                  In dieser Runde wurden noch keine Tipps gekauft.
                </p>
              ) : (
                <div className="space-y-2">
                  {allRoundClues.map((clue) => {
                    const team = teamsPublic[clue.teamId];
                    const relTimeMs =
                      publicState.gameStartTimestamp !== null
                        ? Math.max(
                            0,
                            clue.createdAt - publicState.gameStartTimestamp
                          )
                        : 0;
                    return (
                      <div
                        key={clue.id}
                        className="cmf-well flex flex-wrap items-center justify-between gap-2 p-3 text-xs"
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--shell-border)] bg-white/85 px-2 py-0.5 font-tech text-[10px] font-bold text-[var(--text-main)] uppercase">
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{
                                  backgroundColor: team?.color ?? '#FF4D00',
                                }}
                              />
                              {team?.name ?? clue.teamId}
                            </span>
                            <span className="font-industrial text-sm text-[var(--text-main)]">
                              {clue.title}
                            </span>
                            <span className="cmf-badge-orange rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                              {clue.refundedMs && clue.refundedMs > 0
                                ? `-${Math.round(clue.refundedMs / 60000)} Min.`
                                : formatPenaltyMinutes(clue.penaltyMs)}
                            </span>
                            <span className="font-tech text-[10px] text-[var(--text-muted)]">
                              @{formatDurationClock(relTimeMs)}
                            </span>
                          </div>
                          <p className="text-xs font-bold text-[var(--cmf-teal)]">
                            {clue.answerText}
                          </p>
                        </div>

                        <button
                          type="button"
                          data-testid={`host-undo-clue-${clue.id}`}
                          onClick={() =>
                            void adapter.undoClueByHost(clue.teamId, clue)
                          }
                          className="cmf-btn-secondary font-tech inline-flex min-h-[38px] shrink-0 items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-[var(--cmf-orange)] uppercase"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Rückgängig</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })()}

        {/* 5. Admin-Bereich explizit sperren (ganz unten im Admin-Bereich) */}
        {onLeaveAndLockConsole && (
          <section className="cmf-module p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="font-industrial text-sm text-[var(--text-main)]">
                  Admin-Zugriff beenden
                </h3>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Dein Admin-Zugriff bleibt auch beim Wechseln des Tabs oder Neuladen aktiv, bis du ihn hier unten ausdrücklich sperrst.
                </p>
              </div>
              <button
                type="button"
                data-testid="lock-admin-console-btn"
                onClick={onLeaveAndLockConsole}
                className="cmf-btn-secondary font-tech inline-flex min-h-[48px] w-full sm:w-auto shrink-0 items-center justify-center gap-2 border-[var(--cmf-orange)]/40 px-4 py-2.5 text-xs font-bold text-[var(--cmf-orange)] uppercase"
              >
                <Lock className="h-4 w-4 shrink-0 text-[var(--cmf-orange)]" />
                Admin-Bereich sperren & verlassen
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
