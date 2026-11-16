import React, { useEffect, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Radio,
  MousePointerClick,
  Trash2,
  FastForward,
  LogOut,
  CheckCircle2,
  Clock,
  Copy,
  ArrowLeft,
  Link2,
  Pencil,
  SlidersHorizontal,
} from 'lucide-react';
import {
  buildManhuntRadarScheduleForHidingMs,
  buildRadarScheduleForHidingMs,
  createDefaultPublicState,
  createDefaultTeams,
  DEFAULT_CLASSIC_SEARCH_MINUTES,
  DEFAULT_MANHUNT_SHRINK_MINUTES,
  formatPostalCodesLabel,
  getActivePostalCodes,
  getManhuntPingStatusAtElapsedMs,
  TEAM_PALETTE,
} from '../../config/gameConfig';
import {
  getDueRadarCircle,
  getPhaseForElapsedMs,
} from '../../geo/radar';
import {
  lockHiderAnchorAndGenerateRadar,
  resolveClassicHiderCandidateLocation,
} from '../../hooks/useControllerEngine';
import { PlayerAvatar } from '../Common/PlayerAvatar';
import { AdminAccountManager } from './AdminAccountManager';
import { AdminLobbiesOverview } from './AdminLobbiesOverview';
import { isOverviewMember } from '../../config/players';
import {
  deduplicateEnabledMembers,
  getRequiredReadyHiderMembers,
  isPlayerOnline,
  type DatabaseAdapter,
} from '../../services/databaseAdapter';
import { generateRandomId, generateSessionSecrets } from '../../services/qrService';
import type {
  ClueRecord,
  ClueRequest,
  GamePhase,
  HiderPrivateState,
  MemberRecord,
  PresenceSession,
  PublicGameState,
  RadarStageId,
  TeamPublic,
} from '../../types/game';
import {
  computeNetElapsedMs,
  formatDurationClock,
  formatMinutesHumanDe,
  formatPenaltyMinutes,
} from '../../utils/formatting';

export interface HostControlPanelProps {
  adapter: DatabaseAdapter;
  ownMember: MemberRecord;
  publicState: PublicGameState;
  hiderPrivate: HiderPrivateState | null;
  readyPlayerIds: string[];
  members: Record<string, MemberRecord>;
  presence: Record<string, Record<string, PresenceSession>>;
  teamsPublic: Record<string, TeamPublic>;
  cluesByTeam?: Record<string, Record<string, ClueRecord>>;
  requestsByTeam?: Record<string, Record<string, ClueRequest>>;
  onNavigateToMap: () => void;
  onOpenLobbySettings?: () => void;
  recentRoomCodes?: string[];
  onSwitchRoom?: (roomCode: string) => Promise<void>;
  onLeaveRoom?: () => Promise<void>;
  onLogoutAdmin?: () => void;
}

export const HostControlPanel: React.FC<HostControlPanelProps> = ({
  adapter,
  ownMember,
  publicState,
  hiderPrivate,
  readyPlayerIds,
  members,
  presence,
  teamsPublic,
  cluesByTeam = {},
  requestsByTeam = {},
  onNavigateToMap,
  onOpenLobbySettings,
  recentRoomCodes = [],
  onSwitchRoom,
  onLeaveRoom,
  onLogoutAdmin,
}) => {
  const roomCode = publicState.roomCode ?? adapter.getRoomCode();
  const [copiedKind, setCopiedKind] = useState<'CODE' | 'LINK' | null>(null);
  const [focusedTeamNameId, setFocusedTeamNameId] = useState<string | null>(
    null
  );
  const [savedTeamNameId, setSavedTeamNameId] = useState<string | null>(null);
  const [teamNameDrafts, setTeamNameDrafts] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        TEAM_PALETTE.map((t) => [t.id, teamsPublic[t.id]?.name ?? t.name])
      )
  );

  useEffect(() => {
    setTeamNameDrafts((prev) => {
      const next = { ...prev };
      for (const t of TEAM_PALETTE) {
        if (focusedTeamNameId !== t.id) {
          next[t.id] = teamsPublic[t.id]?.name ?? t.name;
        }
      }
      return next;
    });
  }, [teamsPublic, focusedTeamNameId]);

  const handleSaveTeamName = async (teamId: string, rawName: string) => {
    const paletteEntry = TEAM_PALETTE.find((t) => t.id === teamId);
    if (!paletteEntry) return;
    const trimmed = rawName.trim().slice(0, 28);
    const nextName = trimmed.length > 0 ? trimmed : paletteEntry.name;
    setTeamNameDrafts((prev) => ({ ...prev, [teamId]: nextName }));

    const currentTeam = teamsPublic[teamId] ?? createDefaultTeams()[teamId];
    if (!currentTeam) return;
    if (currentTeam.name === nextName && teamsPublic[teamId]) {
      return;
    }

    await adapter.saveTeamPublic(teamId, {
      ...currentTeam,
      id: teamId,
      color: currentTeam.color ?? paletteEntry.color,
      name: nextName,
    });
    setSavedTeamNameId(teamId);
    setTimeout(() => {
      setSavedTeamNameId((cur) => (cur === teamId ? null : cur));
    }, 1800);
  };

  const handleResetAllTeamNames = async () => {
    const defaults = createDefaultTeams();
    const nextDrafts: Record<string, string> = {};
    await Promise.all(
      TEAM_PALETTE.map(async (t) => {
        nextDrafts[t.id] = t.name;
        const cur = teamsPublic[t.id] ?? defaults[t.id];
        if (cur && cur.name !== t.name) {
          await adapter.saveTeamPublic(t.id, {
            ...cur,
            id: t.id,
            name: t.name,
          });
        }
      })
    );
    setTeamNameDrafts(nextDrafts);
  };

  const hasCustomTeamNames = TEAM_PALETTE.some(
    (t) => (teamsPublic[t.id]?.name ?? t.name) !== t.name
  );

  const handleCopyRoomCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedKind('CODE');
      setTimeout(() => setCopiedKind(null), 2000);
    } catch {
      // Clipboard nicht verfügbar
    }
  };

  const handleCopyInviteLink = async () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', roomCode);
      await navigator.clipboard.writeText(url.toString());
      setCopiedKind('LINK');
      setTimeout(() => setCopiedKind(null), 2000);
    } catch {
      // Clipboard nicht verfügbar
    }
  };

  const [confirmDeleteCurrentRoom, setConfirmDeleteCurrentRoom] =
    useState(false);
  const [deletingCurrentRoom, setDeletingCurrentRoom] = useState(false);

  const handleDeleteCurrentLobby = async () => {
    if (deletingCurrentRoom) return;
    setDeletingCurrentRoom(true);
    try {
      await adapter.deleteLobbyRoom(roomCode);
      setConfirmDeleteCurrentRoom(false);
      if (onLeaveRoom) {
        await onLeaveRoom();
      }
    } finally {
      setDeletingCurrentRoom(false);
    }
  };
  const isCirclePlayArea = publicState.playArea.shapeType === 'CUSTOM_CIRCLE';
  const activePostalCodesLabel = formatPostalCodesLabel(
    getActivePostalCodes(publicState.playArea)
  );
  const isManhunt = publicState.gameMode === 'MANHUNT';
  const classicSearchDurationMs =
    publicState.classicSearchDurationMs ??
    DEFAULT_CLASSIC_SEARCH_MINUTES * 60_000;
  const manhuntShrinkDurationMs =
    publicState.manhuntShrinkDurationMs ??
    DEFAULT_MANHUNT_SHRINK_MINUTES * 60_000;

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
  const requiredHiderMembers = getRequiredReadyHiderMembers(members, presence);
  // Alle aktivierten Spieler (außer dem reinen Admin-Konto) können jederzeit einem Team zugewiesen werden
  const activeGroupMembers = enabledMembers
    .filter((m) => !isOverviewMember(m))
    .sort((a, b) => {
      const aOnline = isPlayerOnline(a.playerId, members, presence, ownMember.uid);
      const bOnline = isPlayerOnline(b.playerId, members, presence, ownMember.uid);
      if (aOnline !== bOnline) return aOnline ? -1 : 1;
      return a.name.localeCompare(b.name, 'de');
    });

  const readySet = new Set(readyPlayerIds);
  const readyCount = requiredHiderMembers.filter((m) =>
    readySet.has(m.playerId)
  ).length;
  const hiderCount = requiredHiderMembers.length;

  const handleStartRound = async () => {
    const now = adapter.getServerNow();
    const fallbackSecrets = generateSessionSecrets();
    const hasValidRandomSecrets = Boolean(
      hiderPrivate?.qrSecret &&
        /^[0-9a-f]{32}$/i.test(hiderPrivate.qrSecret) &&
        hiderPrivate?.shortCode &&
        hiderPrivate.shortCode.length === 6
    );
    const preservedQrSecret = hasValidRandomSecrets
      ? hiderPrivate!.qrSecret
      : fallbackSecrets.qrSecret;
    const preservedShortCode = hasValidRandomSecrets
      ? hiderPrivate!.shortCode
      : fallbackSecrets.shortCode;

    const nextTeams = createDefaultTeams();
    for (const [id, team] of Object.entries(nextTeams)) {
      const customName = teamsPublic[id]?.name?.trim();
      if (customName) {
        team.name = customName;
      }
    }
    for (const m of enabledMembers) {
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

    const activeSchedule = publicState.radarSchedule;
    const immediateOpenSearch = activeSchedule.hidingDurationMs <= 0;

    const nextPublicState: PublicGameState = {
      ...publicState,
      gameMode: isManhunt ? 'MANHUNT' : 'CLASSIC',
      classicSearchDurationMs,
      manhuntShrinkDurationMs,
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
      radarSchedule: activeSchedule,
    };

    await adapter.resetRoundByHost(nextPublicState, nextTeams, {
      anchorPoint: null,
      radarStages: [],
      qrSecret: preservedQrSecret,
      shortCode: preservedShortCode,
      hiderLocations: {},
    });
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
      const nextSched = buildManhuntRadarScheduleForHidingMs(
        currentNetMs,
        manhuntShrinkDurationMs
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

    const nextSched = buildRadarScheduleForHidingMs(
      currentNetMs,
      classicSearchDurationMs
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
          manhuntShrinkDurationMs
        )
      : buildRadarScheduleForHidingMs(
          nextHidingDurationMs,
          classicSearchDurationMs
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
      const pingStatus = getManhuntPingStatusAtElapsedMs(
        nextNetMs,
        hidingMs,
        manhuntShrinkDurationMs
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
    resetPublic.roomCode = roomCode;
    resetPublic.hostPlayerId = publicState.hostPlayerId;
    resetPublic.hostName = publicState.hostName;
    resetPublic.createdAt = publicState.createdAt;
    resetPublic.allowTestClicks = publicState.allowTestClicks;
    resetPublic.gameMode = isManhunt ? 'MANHUNT' : 'CLASSIC';
    resetPublic.classicSearchDurationMs = classicSearchDurationMs;
    resetPublic.manhuntShrinkDurationMs = manhuntShrinkDurationMs;
    resetPublic.radarSchedule = publicState.radarSchedule;

    const resetTeams = createDefaultTeams();
    for (const [id, team] of Object.entries(resetTeams)) {
      const customName = teamsPublic[id]?.name?.trim();
      if (customName) {
        team.name = customName;
      }
    }
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

  // Alle Teams und ihre Mitglieder für die Admin-Übersicht (inklusive Sardinen)
  const hiderMembers = activeGroupMembers.filter((m) => m.side === 'HIDER');
  const unassignedMembers = activeGroupMembers.filter(
    (m) => m.side === 'UNASSIGNED' || (m.side === 'SEEKER' && !m.teamId)
  );
  const occupiedTeams = TEAM_PALETTE.map((palette) => {
    const team = teamsPublic[palette.id];
    const assignedMembers = activeGroupMembers.filter(
      (m) => m.side === 'SEEKER' && m.teamId === palette.id
    );
    return {
      id: palette.id,
      name: team?.name ?? palette.name,
      color: team?.color ?? palette.color,
      members: assignedMembers,
      memberNames: assignedMembers.map((m) => m.name),
    };
  }).filter((t) => t.memberNames.length > 0);

  return (
    <div className="cmf-drafting-bg cmf-scroll-area cmf-view-enter h-full px-3 py-3.5 sm:p-4 text-[var(--text-main)]">
      <div className="mx-auto max-w-3xl space-y-4 sm:space-y-5 pb-12">
        {/* Kopfzeile & Spiel-Code zum Teilen */}
        <div
          data-testid="host-room-code-card"
          className="cmf-chassis cmf-card-enter space-y-3.5 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="cmf-badge-teal inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
                ADMIN // SPIELLEITER-KONSOLE
              </span>
              <h2 className="font-dot mt-1 text-lg sm:text-xl text-[var(--text-main)]">
                Admin-Konsole &amp; Spielraum-Steuerung
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {confirmDeleteCurrentRoom ? (
                <div className="flex items-center gap-1.5 rounded-xl border border-[#DC2626]/50 bg-[#DC2626]/10 px-2.5 py-1">
                  <span className="font-tech text-[10px] font-bold text-[#DC2626] uppercase">
                    Lobby {roomCode} wirklich löschen?
                  </span>
                  <button
                    type="button"
                    data-testid="host-confirm-delete-current-lobby-btn"
                    disabled={deletingCurrentRoom}
                    onClick={() => void handleDeleteCurrentLobby()}
                    className="inline-flex min-h-[30px] items-center gap-1 rounded-lg bg-[#DC2626] px-2.5 py-1 font-tech text-[10px] font-bold text-white uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>
                      {deletingCurrentRoom ? 'Lösche ...' : 'Ja, löschen'}
                    </span>
                  </button>
                  <button
                    type="button"
                    data-testid="host-cancel-delete-current-lobby-btn"
                    disabled={deletingCurrentRoom}
                    onClick={() => setConfirmDeleteCurrentRoom(false)}
                    className="cmf-btn-secondary inline-flex min-h-[30px] items-center px-2 py-1 font-tech text-[10px] font-bold uppercase"
                  >
                    Abbrechen
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="host-delete-current-lobby-btn"
                  onClick={() => setConfirmDeleteCurrentRoom(true)}
                  className="cmf-btn-secondary font-tech inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-[#DC2626] uppercase hover:border-[#DC2626]/50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Lobby löschen</span>
                </button>
              )}

              {onLeaveRoom && (
                <button
                  type="button"
                  data-testid="host-leave-room-btn"
                  onClick={() => void onLeaveRoom()}
                  className="cmf-btn-secondary font-tech inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Raum wechseln</span>
                </button>
              )}
            </div>
          </div>

          <div className="cmf-oled flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="font-tech block text-[10px] font-bold tracking-wider text-[#9AA4AE] uppercase">
                SPIEL-CODE ZUM BEITRETEN (MIT MITSPIELERN TEILEN)
              </span>
              <div className="mt-1 flex items-baseline gap-2.5">
                <span
                  data-testid="host-room-code-value"
                  className="font-dot text-2xl font-bold tracking-[0.2em] text-[#F8FAFC] sm:text-3xl"
                >
                  {roomCode}
                </span>
                {publicState.hostName && (
                  <span className="font-tech text-[11px] text-[#9AA4AE]">
                    Host: {publicState.hostName}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="host-copy-code-btn"
                onClick={() => void handleCopyRoomCode()}
                className="cmf-btn-primary font-tech inline-flex min-h-[40px] items-center gap-1.5 px-3.5 py-2 text-[11px] font-bold uppercase"
              >
                {copiedKind === 'CODE' ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Kopiert!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Code kopieren</span>
                  </>
                )}
              </button>
              <button
                type="button"
                data-testid="host-copy-link-btn"
                onClick={() => void handleCopyInviteLink()}
                className="cmf-btn-secondary font-tech inline-flex min-h-[40px] items-center gap-1.5 bg-white/95 px-3 py-2 text-[11px] font-bold text-[var(--text-main)] uppercase"
              >
                {copiedKind === 'LINK' ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                    <span>Link kopiert!</span>
                  </>
                ) : (
                  <>
                    <Link2 className="h-3.5 w-3.5" />
                    <span>Einladungslink</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 0. Admin-Gesamtübersicht aller aktiven Lobbys & Spielräume */}
        <AdminLobbiesOverview
          adapter={adapter}
          currentRoomCode={roomCode}
          hintRoomCodes={recentRoomCodes}
          variant="console"
          onOpenLobby={async (targetCode) => {
            if (onSwitchRoom) {
              await onSwitchRoom(targetCode);
            }
          }}
          onAfterDeleteCurrentLobby={async () => {
            if (onLeaveRoom) {
              await onLeaveRoom();
            }
          }}
        />

        {isOverviewMember(ownMember) && (
          <AdminAccountManager adapter={adapter} defaultCollapsed />
        )}

        {/* 2. Live-Rundensteuerung, Status, Zeitbearbeitung, Pause & Reset */}
        <section className="cmf-module p-4 sm:p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-3">
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              Rundensteuerung &amp; Live-Status
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold tracking-wider uppercase ${
                isManhunt ? 'cmf-badge-orange' : 'cmf-badge-teal'
              }`}
            >
              MODUS // {isManhunt ? 'MANHUNT' : 'KLASSISCH'}
            </span>
          </div>

          {/* Kompakte Übersicht der aktuellen Spieleinstellungen + Direkt-Link zur Lobby */}
          <div className="cmf-well flex flex-wrap items-center justify-between gap-2.5 px-3.5 py-2.5 text-xs">
            <div className="space-y-0.5">
              <div className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                AKTUELLE KONFIGURATION
              </div>
              <div className="font-tech text-xs font-bold text-[var(--text-main)]">
                {isCirclePlayArea
                  ? `Kreis in ${activePostalCodesLabel} (R = ${publicState.playArea.circle?.radiusMeters ?? 500} m)`
                  : `Gebiet: ${activePostalCodesLabel}`}{' '}
                • Versteckzeit:{' '}
                {formatMinutesHumanDe(
                  Math.round(publicState.radarSchedule.hidingDurationMs / 60_000)
                )}{' '}
                •{' '}
                {isManhunt
                  ? `Jagd: ${formatMinutesHumanDe(Math.round(manhuntShrinkDurationMs / 60_000))}`
                  : `Suchdauer: ${formatMinutesHumanDe(Math.round(classicSearchDurationMs / 60_000))}`}
              </div>
            </div>

            {(publicState.status === 'LOBBY' ||
              publicState.status === 'FINISHED') &&
              onOpenLobbySettings && (
                <button
                  type="button"
                  data-testid="host-open-lobby-settings-btn"
                  onClick={onOpenLobbySettings}
                  className="cmf-btn-secondary font-tech inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                  <span>Spieleinstellungen &amp; Gebiet in der Lobby ändern</span>
                </button>
              )}
          </div>

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
                Runde startet automatisch, sobald alle eingeteilten Verstecker (auch offline) auf „Bereit“ gedrückt haben!
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
                      max={600}
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
              className={`font-tech inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-bold uppercase ${
                publicState.allowTestClicks
                  ? 'cmf-btn-active'
                  : 'cmf-btn-secondary'
              }`}
            >
              <MousePointerClick className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
              <span>
                Test-Klicks: {publicState.allowTestClicks ? 'AKTIV' : 'AUS'}
              </span>
            </button>
          </div>
        </section>

        {/* 4. Teams & Mitglieder (Reine Live-Übersicht inklusive Die Sardinen) */}
        <section
          data-testid="host-teams-overview-section"
          className="cmf-module p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-3">
            <div>
              <h3 className="font-industrial text-base text-[var(--text-main)]">
                Teams &amp; Mitglieder (Übersicht)
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Jeder Spieler wählt sein Team selbst in der Lobby. Hier siehst du alle Teams und ihre Mitglieder inklusive der Sardinen.
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

          {/* Teamnamen bearbeiten (Team 1 – Team 6) */}
          <div
            data-testid="host-team-names-editor"
            className="cmf-well space-y-2.5 p-3.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Pencil className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                <span className="font-tech text-[11px] font-bold tracking-wider text-[var(--text-main)] uppercase">
                  Teamnamen bearbeiten (Sucher-Teams 1–6)
                </span>
              </div>
              {hasCustomTeamNames && (
                <button
                  type="button"
                  data-testid="host-reset-team-names-btn"
                  onClick={() => void handleResetAllTeamNames()}
                  className="cmf-btn-secondary font-tech min-h-[28px] px-2.5 py-1 text-[10px] font-bold uppercase"
                >
                  Standardnamen
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {TEAM_PALETTE.map((t) => {
                const draftVal = teamNameDrafts[t.id] ?? t.name;
                const currentSavedName = teamsPublic[t.id]?.name ?? t.name;
                const isDirty =
                  draftVal.trim().length > 0 &&
                  draftVal.trim() !== currentSavedName;
                const isJustSaved = savedTeamNameId === t.id;
                return (
                  <form
                    key={t.id}
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSaveTeamName(t.id, draftVal);
                    }}
                    className="flex items-center gap-1.5 rounded-xl border border-[var(--shell-border)] bg-[var(--surface-raised)] px-2.5 py-1.5"
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-full border border-white/60"
                      style={{
                        backgroundColor: teamsPublic[t.id]?.color ?? t.color,
                      }}
                    />
                    <input
                      type="text"
                      maxLength={28}
                      aria-label={`Teamname für ${t.name}`}
                      data-testid={`host-team-name-input-${t.id}`}
                      value={draftVal}
                      onFocus={() => setFocusedTeamNameId(t.id)}
                      onBlur={() => {
                        setFocusedTeamNameId((cur) =>
                          cur === t.id ? null : cur
                        );
                        void handleSaveTeamName(t.id, draftVal);
                      }}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTeamNameDrafts((prev) => ({
                          ...prev,
                          [t.id]: val,
                        }));
                      }}
                      placeholder={t.name}
                      className="cmf-input min-h-[34px] min-w-0 flex-1 px-2.5 py-1 text-xs font-bold text-[var(--text-main)]"
                    />
                    <button
                      type="submit"
                      data-testid={`host-team-name-save-${t.id}`}
                      disabled={!isDirty && !isJustSaved}
                      className={`font-tech min-h-[32px] shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase transition-all ${
                        isJustSaved
                          ? 'cmf-badge-teal'
                          : isDirty
                            ? 'cmf-btn-active'
                            : 'cmf-btn-secondary opacity-50'
                      }`}
                    >
                      {isJustSaved ? '✓' : 'OK'}
                    </button>
                  </form>
                );
              })}
            </div>
          </div>

          {/* 4a. Die Sardinen (Verstecker-Team) */}
          <div
            data-testid="host-sardinen-team-overview"
            className="cmf-well p-3.5 text-xs space-y-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-industrial flex items-center gap-2 text-sm text-[var(--text-main)]">
                <span className="h-3 w-3 rounded-full border border-white/60 bg-[var(--cmf-orange)]" />
                Die Sardinen (Verstecker)
              </span>
              <div className="flex items-center gap-1.5">
                <span className="cmf-badge-orange rounded px-2 py-0.5 text-[10px] font-bold uppercase">
                  {hiderMembers.length} Spieler
                </span>
                <span className="cmf-badge-teal rounded px-2 py-0.5 text-[10px] font-bold uppercase">
                  {readyCount}/{hiderCount} Bereit
                </span>
              </div>
            </div>

            {hiderMembers.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                Aktuell hat sich noch kein Spieler für Die Sardinen (Verstecker) eingetragen.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {hiderMembers.map((m) => {
                  const online = isPlayerOnline(
                    m.playerId,
                    members,
                    presence,
                    ownMember.uid
                  );
                  const isReady = readySet.has(m.playerId);
                  return (
                    <span
                      key={m.uid}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--shell-border)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs font-bold text-[var(--text-main)]"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          online ? 'bg-[var(--cmf-teal)]' : 'bg-[#9AA4AE]'
                        }`}
                      />
                      <PlayerAvatar avatar={m.avatar} playerId={m} size="xs" />
                      <span>{m.name}</span>
                      {isReady && (
                        <span className="cmf-badge-teal rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                          ✓ Bereit
                        </span>
                      )}
                      {!online && (
                        <span className="cmf-badge-amber rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                          Offline
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4b. Besetzte Sucher-Teams */}
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        {team.members.map((m) => {
                          const online = isPlayerOnline(
                            m.playerId,
                            members,
                            presence,
                            ownMember.uid
                          );
                          return (
                            <span
                              key={m.uid}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shell-border)] bg-[var(--surface-raised)] px-2 py-1 text-xs font-bold text-[var(--text-main)]"
                            >
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${
                                  online ? 'bg-[var(--cmf-teal)]' : 'bg-[#9AA4AE]'
                                }`}
                              />
                              <PlayerAvatar avatar={m.avatar} playerId={m} size="xs" />
                              <span>{m.name}</span>
                            </span>
                          );
                        })}
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

          {/* 4c. Noch ohne Team (falls Spieler noch kein Team gewählt haben) */}
          {unassignedMembers.length > 0 && (
            <div className="space-y-2 border-t cmf-divider pt-3">
              <h4 className="font-tech text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                Noch ohne Team ({unassignedMembers.length})
              </h4>
              <div className="flex flex-wrap items-center gap-2">
                {unassignedMembers.map((m) => {
                  const online = isPlayerOnline(
                    m.playerId,
                    members,
                    presence,
                    ownMember.uid
                  );
                  return (
                    <span
                      key={m.uid}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--shell-border)] bg-[var(--surface-raised)] px-2.5 py-1.5 text-xs font-bold text-[var(--text-main)]"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          online ? 'bg-[var(--cmf-teal)]' : 'bg-[#9AA4AE]'
                        }`}
                      />
                      <PlayerAvatar avatar={m.avatar} playerId={m} size="xs" />
                      <span>{m.name}</span>
                      {!online && (
                        <span className="cmf-badge-amber rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                          Offline
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
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

        {/* 5. Konto wechseln / Abmelden */}
        {onLogoutAdmin && (
          <section className="cmf-module p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="font-industrial text-sm text-[var(--text-main)]">
                  Admin-Konto wechseln / Abmelden
                </h3>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Melde dich hier vom Admin-Konto ab, um zu einem normalen Spielerkonto zu wechseln.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {onLeaveRoom && (
                  <button
                    type="button"
                    onClick={() => void onLeaveRoom()}
                    className="cmf-btn-secondary font-tech inline-flex min-h-[48px] w-full sm:w-auto shrink-0 items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold uppercase"
                  >
                    <ArrowLeft className="h-4 w-4 shrink-0" />
                    Raum wechseln
                  </button>
                )}
                <button
                  type="button"
                  data-testid="logout-admin-console-btn"
                  onClick={onLogoutAdmin}
                  className="cmf-btn-secondary font-tech inline-flex min-h-[48px] w-full sm:w-auto shrink-0 items-center justify-center gap-2 border-[var(--cmf-orange)]/40 px-4 py-2.5 text-xs font-bold text-[var(--cmf-orange)] uppercase"
                >
                  <LogOut className="h-4 w-4 shrink-0 text-[var(--cmf-orange)]" />
                  Konto abmelden
                </button>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
