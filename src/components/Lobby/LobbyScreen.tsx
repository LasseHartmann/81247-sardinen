import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  Crosshair,
  EyeOff,
  Link2,
  LocateFixed,
  Minus,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  ALL_MUNICH_POSTAL_CODES,
  buildCustomCirclePlayAreaState,
  buildManhuntRadarSchedule,
  buildMunichPlzPlayAreaState,
  buildOfficial81247PlayAreaState,
  buildRadarScheduleForHidingMinutes,
  CLASSIC_SEARCH_DURATION_MAX_MINUTES,
  CLASSIC_SEARCH_DURATION_MIN_MINUTES,
  CLASSIC_SEARCH_DURATION_STEP_MINUTES,
  clampPlayAreaCircleRadius,
  createDefaultTeams,
  DEFAULT_CLASSIC_HIDING_MINUTES,
  DEFAULT_CLASSIC_SEARCH_MINUTES,
  DEFAULT_MANHUNT_HIDING_MINUTES,
  DEFAULT_MANHUNT_SHRINK_MINUTES,
  DEFAULT_PLAY_AREA_CIRCLE_CENTER,
  DEFAULT_PLAY_AREA_CIRCLE_RADIUS_METERS,
  DEFAULT_POSTAL_CODE,
  formatPostalCodesLabel,
  GAME_ID,
  getActivePostalCodes,
  getMunichPlzEntry,
  isAllMunichPostalCodes,
  isDefaultQuestionRulesConfig,
  parseAndValidateMunichPostalCodes,
  PLAY_AREA_CIRCLE_MAX_RADIUS_METERS,
  PLAY_AREA_CIRCLE_MIN_RADIUS_METERS,
  PLAY_AREA_CIRCLE_STEP_METERS,
  TEAM_PALETTE,
} from '../../config/gameConfig';
import { preloadGreenPolygonsForPostalCode } from '../../config/fallbackOsm81247';
import { isOverviewMember } from '../../config/players';
import {
  isPointInMunichPlz,
  snapPointIntoMunichPlz,
} from '../../geo/boundary';
import { getClassicRadarRadiiForPlayArea } from '../../geo/radar';
import type { GpsPermissionState } from '../../hooks/useGeolocation';
import {
  deduplicateEnabledMembers,
  filterOnlineEnabledMembers,
  getRequiredReadyHiderMembers,
  isPlayerOnline,
  type DatabaseAdapter,
} from '../../services/databaseAdapter';
import {
  generateRandomId,
  generateSessionSecrets,
} from '../../services/qrService';
import type {
  GameMode,
  GeoFix,
  HiderPrivateState,
  MemberRecord,
  PresenceSession,
  PublicGameState,
  TeamPublic,
} from '../../types/game';
import { formatMinutesHumanDe } from '../../utils/formatting';
import { PlayerAvatar } from '../Common/PlayerAvatar';
import { HostQuestionRulesEditor } from './HostQuestionRulesEditor';
import { PlayerHostedLobbiesSection } from './PlayerHostedLobbiesSection';

export interface LobbyScreenProps {
  adapter: DatabaseAdapter;
  publicState: PublicGameState;
  hiderPrivate: HiderPrivateState | null;
  ownMember: MemberRecord;
  members: Record<string, MemberRecord>;
  presence: Record<string, Record<string, PresenceSession>>;
  teamsPublic: Record<string, TeamPublic>;
  readyPlayerIds: string[];
  ownFix?: GeoFix | null;
  gpsStatus?: GpsPermissionState;
  gpsError?: string | null;
  onRetryGps?: () => Promise<GeoFix | null> | void;
  onSelectOwnRole: (nextSelection: string) => Promise<void>;
  onToggleOwnReady: (nextReady: boolean) => Promise<void>;
  onViewMap: () => void;
  onOpenCircleMapEditor: () => void;
  onOpenHostConsole?: () => void;
  onLeaveRoom?: () => Promise<void>;
  recentRoomCodes?: string[];
  onSwitchRoom?: (roomCode: string) => Promise<void>;
}

export const LobbyScreen: React.FC<LobbyScreenProps> = ({
  adapter,
  publicState,
  hiderPrivate,
  ownMember,
  members,
  presence,
  teamsPublic,
  readyPlayerIds,
  ownFix = null,
  gpsStatus = 'IDLE',
  gpsError = null,
  onRetryGps,
  onSelectOwnRole,
  onToggleOwnReady,
  onViewMap,
  onOpenCircleMapEditor,
  onOpenHostConsole,
  onLeaveRoom,
  recentRoomCodes = [],
  onSwitchRoom,
}) => {
  const isOverviewAccount = isOverviewMember(ownMember);
  const isHost = Boolean(
    ownMember.isHost ||
      isOverviewAccount ||
      (publicState.hostPlayerId &&
        publicState.hostPlayerId === ownMember.playerId)
  );
  const canEditSettings = isHost && publicState.status === 'LOBBY';

  const roomCode = publicState.roomCode ?? adapter.getRoomCode() ?? GAME_ID;
  const [copiedKind, setCopiedKind] = useState<'CODE' | 'LINK' | null>(null);
  const [changingRoleTo, setChangingRoleTo] = useState<string | null>(null);
  const [togglingReady, setTogglingReady] = useState(false);
  const [startingRound, setStartingRound] = useState(false);
  const [confirmDeleteLobby, setConfirmDeleteLobby] = useState(false);
  const [deletingLobby, setDeletingLobby] = useState(false);
  const [showAllSeekerTeams, setShowAllSeekerTeams] = useState(false);

  const handleDeleteCurrentLobby = async () => {
    if (!isHost || deletingLobby) return;
    setDeletingLobby(true);
    try {
      await adapter.deleteLobbyRoom(roomCode);
      setConfirmDeleteLobby(false);
      if (onLeaveRoom) {
        await onLeaveRoom();
      }
    } finally {
      setDeletingLobby(false);
    }
  };

  // Teamnamen-Bearbeitung durch den Host
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [savingTeamName, setSavingTeamName] = useState(false);
  const [showQuestionRules, setShowQuestionRules] = useState(false);

  // Gebiets- & PLZ-Zustand
  const isCirclePlayArea = publicState.playArea.shapeType === 'CUSTOM_CIRCLE';
  const activePostalCodes = getActivePostalCodes(publicState.playArea);
  const isFullMunich = isAllMunichPostalCodes(activePostalCodes);
  const activePostalCode = activePostalCodes[0];
  const activePostalCodesLabel = formatPostalCodesLabel(activePostalCodes);
  const activePlzEntries = activePostalCodes.map((c) => getMunichPlzEntry(c));
  const activePlzEntry = activePlzEntries[0];
  const activeDistrictsSummary = isFullMunich
    ? 'Alle 75 Münchner PLZ-Gebiete'
    : Array.from(new Set(activePlzEntries.map((e) => e.district))).join(' / ');

  const nonFullPlzLabel = isFullMunich
    ? DEFAULT_POSTAL_CODE
    : activePostalCodesLabel;
  const [plzInputText, setPlzInputText] = useState(nonFullPlzLabel);
  const [isPlzInputFocused, setIsPlzInputFocused] = useState(false);
  const [plzValidationError, setPlzValidationError] = useState<string | null>(
    null
  );

  useEffect(() => {
    if (!isPlzInputFocused && !isFullMunich) {
      setPlzInputText(activePostalCodesLabel);
    }
  }, [activePostalCodesLabel, isFullMunich, isPlzInputFocused]);

  const circleCenter =
    publicState.playArea.circle?.center ??
    activePlzEntry.center ??
    DEFAULT_PLAY_AREA_CIRCLE_CENTER;
  const circleRadiusMeters = clampPlayAreaCircleRadius(
    publicState.playArea.circle?.radiusMeters ??
      DEFAULT_PLAY_AREA_CIRCLE_RADIUS_METERS
  );

  // Modus- & Zeiten-Zustand (live aus publicState abgeleitet)
  const gameMode: GameMode =
    publicState.gameMode === 'MANHUNT' ? 'MANHUNT' : 'CLASSIC';
  const isManhunt = gameMode === 'MANHUNT';

  const classicHidingMin = Math.min(
    55,
    Math.max(
      5,
      Math.round(
        (isManhunt
          ? DEFAULT_CLASSIC_HIDING_MINUTES * 60_000
          : publicState.radarSchedule.hidingDurationMs) / 60_000 / 5
      ) * 5
    )
  );
  const classicSearchMin = Math.min(
    CLASSIC_SEARCH_DURATION_MAX_MINUTES,
    Math.max(
      CLASSIC_SEARCH_DURATION_MIN_MINUTES,
      Math.round(
        (publicState.classicSearchDurationMs ??
          DEFAULT_CLASSIC_SEARCH_MINUTES * 60_000) /
          60_000 /
          CLASSIC_SEARCH_DURATION_STEP_MINUTES
      ) * CLASSIC_SEARCH_DURATION_STEP_MINUTES
    )
  );
  const manhuntHeadStartMin = Math.min(
    30,
    Math.max(
      0,
      Math.round(
        (isManhunt
          ? publicState.radarSchedule.hidingDurationMs
          : DEFAULT_MANHUNT_HIDING_MINUTES * 60_000) / 60_000
      )
    )
  );
  const manhuntShrinkMin = Math.min(
    80,
    Math.max(
      10,
      Math.round(
        (publicState.manhuntShrinkDurationMs ??
          DEFAULT_MANHUNT_SHRINK_MINUTES * 60_000) /
          60_000 /
          5
      ) * 5
    )
  );

  // Mitglieder & Teams
  const onlineMemberList = filterOnlineEnabledMembers(
    members,
    presence,
    ownMember.uid
  );
  const allEnabledMembers = deduplicateEnabledMembers(members, presence);
  const playableMembers = allEnabledMembers
    .filter((m) => !isOverviewMember(m))
    .sort((a, b) => {
      const aOn = isPlayerOnline(a.playerId, members, presence, ownMember.uid);
      const bOn = isPlayerOnline(b.playerId, members, presence, ownMember.uid);
      if (aOn !== bOn) return aOn ? -1 : 1;
      return a.name.localeCompare(b.name, 'de');
    });

  const requiredHiderMembers = getRequiredReadyHiderMembers(members, presence);
  const readySet = new Set(readyPlayerIds);
  const readyCount = requiredHiderMembers.filter((m) =>
    readySet.has(m.playerId)
  ).length;
  const totalRequiredReady = requiredHiderMembers.length;
  const isOwnReady = readySet.has(ownMember.playerId);

  const hiderMembers = playableMembers.filter((m) => m.side === 'HIDER');
  const seekerMembers = playableMembers.filter(
    (m) => m.side === 'SEEKER' && Boolean(m.teamId)
  );
  const unassignedMembers = playableMembers.filter(
    (m) => m.side === 'UNASSIGNED' || (m.side === 'SEEKER' && !m.teamId)
  );

  const seekerTeams = TEAM_PALETTE.map((palette) => {
    const pub = teamsPublic[palette.id];
    const teamMembers = playableMembers.filter(
      (m) => m.side === 'SEEKER' && m.teamId === palette.id
    );
    return {
      id: palette.id,
      defaultName: palette.name,
      name: pub?.name ?? palette.name,
      color: pub?.color ?? palette.color,
      members: teamMembers,
    };
  });

  const hasCustomTeamNames = seekerTeams.some((t) => t.name !== t.defaultName);

  const ownSelection =
    ownMember.side === 'HIDER'
      ? 'HIDER'
      : ownMember.side === 'SEEKER' && ownMember.teamId
        ? ownMember.teamId
        : 'UNASSIGNED';

  const isOwnHider = ownMember.side === 'HIDER' && !isOverviewAccount;
  const canStartOrReady =
    requiredHiderMembers.length > 0 && seekerMembers.length > 0;

  const isGpsNotWorking = Boolean(
    !isOverviewAccount &&
      (!ownFix || gpsStatus === 'DENIED' || gpsStatus === 'UNSUPPORTED')
  );

  // Copy-Handler
  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopiedKind('CODE');
      setTimeout(() => setCopiedKind(null), 2000);
    } catch {
      // Clipboard nicht verfügbar
    }
  };

  const handleCopyLink = async () => {
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

  // Team-Auswahl-Handler
  const handleChooseTeam = async (targetSelection: string) => {
    if (changingRoleTo !== null || isOverviewAccount) return;
    setChangingRoleTo(targetSelection);
    try {
      await onSelectOwnRole(targetSelection);
    } finally {
      setChangingRoleTo(null);
    }
  };

  // Teamnamen speichern / zurücksetzen (Host)
  const handleSaveTeamName = async (teamId: string, rawName: string) => {
    if (!isHost) return;
    const paletteEntry = TEAM_PALETTE.find((t) => t.id === teamId);
    if (!paletteEntry) return;
    const trimmed = rawName.trim().slice(0, 28);
    const nextName = trimmed.length > 0 ? trimmed : paletteEntry.name;
    const currentTeam = teamsPublic[teamId] ?? createDefaultTeams()[teamId];
    if (!currentTeam) return;

    setSavingTeamName(true);
    try {
      if (currentTeam.name !== nextName || !teamsPublic[teamId]) {
        await adapter.saveTeamPublic(teamId, {
          ...currentTeam,
          id: teamId,
          color: currentTeam.color ?? paletteEntry.color,
          name: nextName,
        });
      }
      setEditingTeamId(null);
    } finally {
      setSavingTeamName(false);
    }
  };

  const handleResetAllTeamNames = async () => {
    if (!isHost) return;
    const defaults = createDefaultTeams();
    await Promise.all(
      TEAM_PALETTE.map(async (t) => {
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
    setEditingTeamId(null);
  };

  // Host-Einstellungs-Handler: Spielmodus
  const handleSelectGameMode = (nextMode: GameMode) => {
    if (!canEditSettings) return;
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

  // Host-Einstellungs-Handler: Zeiten
  const handleChangeClassicHidingMin = (nextMin: number) => {
    if (!canEditSettings) return;
    const clamped = Math.min(55, Math.max(5, Math.round(nextMin / 5) * 5));
    const nextSched = buildRadarScheduleForHidingMinutes(
      clamped,
      classicSearchMin
    );
    void adapter
      .savePublicStateByHost({
        ...publicState,
        gameMode: 'CLASSIC',
        classicSearchDurationMs: classicSearchMin * 60_000,
        radarSchedule: nextSched,
      })
      .catch(() => {});
  };

  const handleChangeClassicSearchMin = (nextSearchMin: number) => {
    if (!canEditSettings) return;
    const clamped = Math.min(
      CLASSIC_SEARCH_DURATION_MAX_MINUTES,
      Math.max(
        CLASSIC_SEARCH_DURATION_MIN_MINUTES,
        Math.round(nextSearchMin / CLASSIC_SEARCH_DURATION_STEP_MINUTES) *
          CLASSIC_SEARCH_DURATION_STEP_MINUTES
      )
    );
    const nextSched = buildRadarScheduleForHidingMinutes(
      classicHidingMin,
      clamped
    );
    void adapter
      .savePublicStateByHost({
        ...publicState,
        gameMode: 'CLASSIC',
        classicSearchDurationMs: clamped * 60_000,
        radarSchedule: nextSched,
      })
      .catch(() => {});
  };

  const handleChangeManhuntHeadStartMin = (nextHeadStart: number) => {
    if (!canEditSettings) return;
    const clamped = Math.min(30, Math.max(0, Math.round(nextHeadStart)));
    void adapter
      .savePublicStateByHost({
        ...publicState,
        gameMode: 'MANHUNT',
        manhuntShrinkDurationMs: manhuntShrinkMin * 60_000,
        radarSchedule: buildManhuntRadarSchedule(clamped, manhuntShrinkMin),
      })
      .catch(() => {});
  };

  const handleChangeManhuntShrinkMin = (nextShrinkMin: number) => {
    if (!canEditSettings) return;
    const clamped = Math.min(80, Math.max(10, Math.round(nextShrinkMin / 5) * 5));
    void adapter
      .savePublicStateByHost({
        ...publicState,
        gameMode: 'MANHUNT',
        manhuntShrinkDurationMs: clamped * 60_000,
        radarSchedule: buildManhuntRadarSchedule(manhuntHeadStartMin, clamped),
      })
      .catch(() => {});
  };

  // Host-Einstellungs-Handler: Spielgebiet / Grenzen
  const formatNotFoundPlzMessage = (notFoundCodes: string[]): string => {
    if (notFoundCodes.length === 1) {
      return `PLZ nicht in München gefunden: "${notFoundCodes[0]}".`;
    }
    return `Folgende PLZ wurden nicht in München gefunden: ${notFoundCodes
      .map((c) => `"${c}"`)
      .join(', ')}.`;
  };

  const applyPostalCodesAsZone = (nextCodes: string[]) => {
    if (!canEditSettings || nextCodes.length === 0) return;
    if (nextCodes.length <= 8) {
      for (const code of nextCodes) {
        void preloadGreenPolygonsForPostalCode(code);
      }
    }
    void adapter
      .savePublicStateByHost({
        ...publicState,
        playArea: buildMunichPlzPlayAreaState(
          nextCodes,
          ownMember.uid,
          adapter.getServerNow()
        ),
      })
      .catch(() => {});
  };

  const handleSelectPlzZoneTab = () => {
    if (!canEditSettings) return;
    setPlzValidationError(null);
    const targetCodes = isFullMunich ? [DEFAULT_POSTAL_CODE] : activePostalCodes;
    setPlzInputText(targetCodes.join(', '));
    void adapter
      .savePublicStateByHost({
        ...publicState,
        playArea: buildOfficial81247PlayAreaState(
          ownMember.uid,
          adapter.getServerNow(),
          targetCodes
        ),
      })
      .catch(() => {});
  };

  const handleSelectFullMunichZoneTab = () => {
    if (!canEditSettings) return;
    setPlzValidationError(null);
    void adapter
      .savePublicStateByHost({
        ...publicState,
        playArea: buildMunichPlzPlayAreaState(
          ALL_MUNICH_POSTAL_CODES,
          ownMember.uid,
          adapter.getServerNow()
        ),
      })
      .catch(() => {});
  };

  const handleSelectOrResizeCircleZone = (nextRadiusMeters: number) => {
    if (!canEditSettings) return;
    setPlzValidationError(null);
    const snappedCenter = isPointInMunichPlz(circleCenter, activePostalCodes)
      ? circleCenter
      : snapPointIntoMunichPlz(activePlzEntry.center, activePostalCodes);
    if (activePostalCodes.length <= 8) {
      for (const code of activePostalCodes) {
        void preloadGreenPolygonsForPostalCode(code);
      }
    }
    void adapter
      .savePublicStateByHost({
        ...publicState,
        playArea: buildCustomCirclePlayAreaState({
          center: snappedCenter,
          radiusMeters: clampPlayAreaCircleRadius(nextRadiusMeters),
          confirmedByUid: ownMember.uid,
          nowMs: adapter.getServerNow(),
          postalCode: activePostalCode,
          postalCodes: activePostalCodes,
        }),
      })
      .catch(() => {});
  };

  const handleApplyPlzInput = (rawText: string, syncText: boolean) => {
    if (!canEditSettings) return;
    const { validCodes, notFoundCodes } =
      parseAndValidateMunichPostalCodes(rawText);
    if (notFoundCodes.length > 0) {
      setPlzValidationError(formatNotFoundPlzMessage(notFoundCodes));
    } else if (validCodes.length === 0) {
      setPlzValidationError(
        'Bitte mindestens eine gültige Münchner PLZ eingeben (z. B. 81247 oder 81247, 81245).'
      );
    } else {
      setPlzValidationError(null);
    }

    if (validCodes.length > 0) {
      applyPostalCodesAsZone(validCodes);
      if (syncText && notFoundCodes.length === 0) {
        setPlzInputText(formatPostalCodesLabel(validCodes));
      }
    }
  };

  // Manueller Spielstart durch den Host direkt aus der Lobby
  const handleStartRoundByHost = async () => {
    if (!isHost || !canStartOrReady || startingRound) return;
    setStartingRound(true);
    try {
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
      for (const m of allEnabledMembers) {
        if (
          m.enabled &&
          m.side === 'SEEKER' &&
          m.teamId &&
          nextTeams[m.teamId]
        ) {
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
        gameMode,
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
        radarSchedule: activeSchedule,
      };

      await adapter.resetRoundByHost(nextPublicState, nextTeams, {
        anchorPoint: null,
        radarStages: [],
        qrSecret: preservedQrSecret,
        shortCode: preservedShortCode,
        hiderLocations: {},
      });
    } finally {
      setStartingRound(false);
    }
  };

  // Hilfswerte für verständliche Einstellungs-Zusammenfassung
  const classicRadii = getClassicRadarRadiiForPlayArea(publicState.playArea);
  const radarStartAfterSearchMin = Math.round(
    (publicState.radarSchedule.stage1Ms -
      publicState.radarSchedule.hidingDurationMs) /
      60_000
  );

  // Zeige standardmäßig alle besetzten Sucher-Teams + 2 freie Teams (Rest aufklappbar)
  const visibleSeekerTeams = showAllSeekerTeams
    ? seekerTeams
    : (() => {
        let freeShown = 0;
        return seekerTeams.filter((t) => {
          if (t.members.length > 0 || ownSelection === t.id || editingTeamId === t.id) {
            return true;
          }
          if (freeShown < 2) {
            freeShown += 1;
            return true;
          }
          return false;
        });
      })();
  const hiddenSeekerTeamCount = seekerTeams.length - visibleSeekerTeams.length;

  const activeZoneSummaryTitle = isCirclePlayArea
    ? `Kreis (Radius ${circleRadiusMeters} m)`
    : isFullMunich
      ? 'Ganz München'
      : `PLZ ${activePostalCodesLabel}`;

  const activeZoneSummaryDetail = isCirclePlayArea
    ? `Ø ${circleRadiusMeters * 2} m in ${activePostalCodesLabel}`
    : activeDistrictsSummary;

  return (
    <div
      data-testid="lobby-screen"
      className="cmf-drafting-bg cmf-scroll-area cmf-view-enter h-full px-3 py-3.5 sm:p-4 text-[var(--text-main)]"
    >
      <div className="mx-auto max-w-3xl space-y-4 pb-12">
        {/* KOPFBEREICH: VERLASSEN + SPIEL-CODE + EINLADEN */}
        <section
          data-testid="lobby-room-header"
          className="cmf-chassis cmf-card-enter space-y-3 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {onLeaveRoom && (
                <button
                  type="button"
                  data-testid="lobby-leave-room-btn"
                  onClick={() => void onLeaveRoom()}
                  className="cmf-btn-secondary font-tech inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Lobby verlassen</span>
                </button>
              )}
              {isHost && (
                <span className="cmf-badge-orange rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold uppercase">
                  {isOverviewAccount ? 'Admin' : 'Host'}
                </span>
              )}
            </div>

            {isOverviewAccount && onOpenHostConsole && (
              <button
                type="button"
                data-testid="lobby-open-host-console-btn"
                onClick={onOpenHostConsole}
                className="cmf-btn-primary font-tech inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase"
              >
                <Shield className="h-3.5 w-3.5" />
                <span>Admin-Konsole</span>
              </button>
            )}
          </div>

          <div className="cmf-well flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="nothing-red-dot" aria-hidden="true" />
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  Lobby-Code
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-baseline gap-3">
                <span
                  data-testid="lobby-room-code"
                  className="font-dot text-2xl tracking-[0.18em] text-[var(--text-main)] sm:text-3xl"
                >
                  {roomCode}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {publicState.hostName ? `Host: ${publicState.hostName} · ` : ''}
                  {onlineMemberList.length} online
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="lobby-copy-code-btn"
                onClick={() => void handleCopyCode()}
                className="cmf-btn-primary inline-flex min-h-[38px] items-center gap-1.5 px-4 py-1.5 text-xs font-medium"
              >
                {copiedKind === 'CODE' ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Kopiert</span>
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
                data-testid="lobby-copy-link-btn"
                onClick={() => void handleCopyLink()}
                className="cmf-btn-secondary inline-flex min-h-[38px] items-center gap-1.5 px-4 py-1.5 text-xs font-medium"
              >
                {copiedKind === 'LINK' ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Kopiert</span>
                  </>
                ) : (
                  <>
                    <Link2 className="h-3.5 w-3.5" />
                    <span>Link teilen</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {isGpsNotWorking && (
            <div
              role="alert"
              data-testid="lobby-gps-warning"
              className="cmf-badge-orange flex flex-col gap-2 rounded-xl p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {gpsStatus === 'DENIED'
                    ? 'Standort blockiert – bitte im Browser freigeben.'
                    : (gpsError ?? 'Bitte GPS vor dem Start aktivieren.')}
                </span>
              </div>
              {onRetryGps && (
                <button
                  type="button"
                  data-testid="lobby-retry-gps-btn"
                  onClick={() => void onRetryGps()}
                  className="cmf-btn-secondary font-tech inline-flex min-h-[34px] shrink-0 items-center justify-center gap-1.5 bg-white/95 px-3 py-1 text-[11px] font-bold text-[var(--text-main)] uppercase"
                >
                  <LocateFixed className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                  <span>GPS aktivieren</span>
                </button>
              )}
            </div>
          )}
        </section>

        {/* WEITERE OFFENE LOBBYS DES SPIELERS (nur sichtbar bei 2+ gehosteten Lobbys) */}
        {!isOverviewAccount && (
          <PlayerHostedLobbiesSection
            adapter={adapter}
            playerId={ownMember.playerId}
            currentRoomCode={roomCode}
            hintRoomCodes={recentRoomCodes}
            hideWhenOnlyCurrentRoom
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
        )}

        {/* 1. TEAM WÄHLEN */}
        <section
          data-testid="lobby-teams-section"
          className="cmf-module space-y-3.5 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-2.5">
            <div>
              <h2 className="font-industrial text-base font-bold text-[var(--text-main)]">
                1. Team wählen
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Mindestens 1 Verstecker und 1 Sucher-Team nötig.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {isHost && hasCustomTeamNames && (
                <button
                  type="button"
                  data-testid="lobby-reset-team-names-btn"
                  onClick={() => void handleResetAllTeamNames()}
                  className="cmf-btn-secondary font-tech min-h-[32px] px-2.5 py-1 text-[10px] font-bold uppercase"
                >
                  Standardnamen
                </button>
              )}
              {!isOverviewAccount && ownSelection !== 'UNASSIGNED' && (
                <button
                  type="button"
                  data-testid="lobby-leave-team-btn"
                  disabled={changingRoleTo !== null}
                  onClick={() => void handleChooseTeam('UNASSIGNED')}
                  className="cmf-btn-secondary font-tech min-h-[32px] px-2.5 py-1 text-[10px] font-bold text-[var(--cmf-orange)] uppercase disabled:opacity-50"
                >
                  Team verlassen
                </button>
              )}
            </div>
          </div>

          {/* Verstecker-Karte: Die Sardinen */}
          <div
            data-testid="lobby-team-card-hider"
            className={`rounded-2xl border-[1.5px] p-3.5 transition-all space-y-2.5 ${
              ownSelection === 'HIDER'
                ? 'border-[var(--cmf-orange)] bg-[rgba(255,79,0,0.09)] shadow-sm'
                : 'border-[rgba(255,79,0,0.3)] bg-[rgba(255,79,0,0.04)]'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--cmf-orange)] text-white shadow-xs">
                  <EyeOff className="h-4 w-4" />
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-industrial text-sm font-bold text-[var(--text-main)]">
                      Verstecker (Die Sardinen)
                    </h3>
                    {totalRequiredReady > 0 && (
                      <span className="cmf-badge-teal rounded-full px-2 py-0.5 font-tech text-[10px] font-bold uppercase">
                        {readyCount}/{totalRequiredReady} Bereit
                      </span>
                    )}
                  </div>
                  <span className="font-tech text-[10px] font-bold text-[var(--text-muted)] uppercase">
                    {hiderMembers.length} Spieler
                  </span>
                </div>
              </div>

              {!isOverviewAccount && (
                <button
                  type="button"
                  data-testid="lobby-join-hider-btn"
                  disabled={
                    changingRoleTo !== null || ownSelection === 'HIDER'
                  }
                  onClick={() => void handleChooseTeam('HIDER')}
                  className={`font-tech inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold uppercase transition-all ${
                    ownSelection === 'HIDER'
                      ? 'cmf-badge-orange cursor-default'
                      : 'cmf-btn-primary'
                  } disabled:opacity-80`}
                >
                  {ownSelection === 'HIDER' ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Dein Team</span>
                    </>
                  ) : changingRoleTo === 'HIDER' ? (
                    <span>...</span>
                  ) : (
                    <span>Verstecker werden</span>
                  )}
                </button>
              )}
            </div>

            {hiderMembers.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)]">
                Noch frei
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {hiderMembers.map((m) => {
                  const online = isPlayerOnline(
                    m.playerId,
                    members,
                    presence,
                    ownMember.uid
                  );
                  const ready = readySet.has(m.playerId);
                  return (
                    <span
                      key={m.uid}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-semibold ${
                        ready
                          ? 'border-[var(--text-main)] bg-[var(--surface-chip)] text-[var(--text-main)]'
                          : 'border-[var(--shell-border)] bg-[var(--surface-chip)] text-[var(--text-main)]'
                      }`}
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          online ? 'bg-emerald-500' : 'bg-zinc-300'
                        }`}
                      />
                      <PlayerAvatar avatar={m.avatar} playerId={m} size="xs" />
                      <span>{m.name}</span>
                      {ready && (
                        <span className="font-tech text-[10px] font-bold text-[var(--cmf-teal)] uppercase">
                          ✓
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sucher-Teams */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {visibleSeekerTeams.map((team) => {
              const isSelected = ownSelection === team.id;
              const isEditingThisName = editingTeamId === team.id;

              return (
                <div
                  key={team.id}
                  data-testid={`lobby-team-card-${team.id}`}
                  className={`flex flex-col justify-between gap-2 rounded-2xl border p-3 transition-all ${
                    isSelected
                      ? 'border-[var(--text-main)] bg-[var(--surface-chip)]'
                      : 'border-[var(--shell-border)] bg-[var(--surface-inset)]'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <span
                          className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-black/10"
                          style={{ backgroundColor: team.color }}
                        />
                        {isEditingThisName ? (
                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              void handleSaveTeamName(team.id, teamNameDraft);
                            }}
                            className="flex min-w-0 flex-1 items-center gap-1"
                          >
                            <input
                              type="text"
                              autoFocus
                              maxLength={28}
                              data-testid={`lobby-team-name-input-${team.id}`}
                              value={teamNameDraft}
                              onChange={(e) => setTeamNameDraft(e.target.value)}
                              className="cmf-input min-h-[30px] min-w-0 flex-1 px-2 py-0.5 text-xs font-bold"
                            />
                            <button
                              type="submit"
                              disabled={savingTeamName}
                              aria-label="Speichern"
                              data-testid={`lobby-team-name-save-${team.id}`}
                              className="cmf-btn-active flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                            >
                              <Check className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                            </button>
                            <button
                              type="button"
                              aria-label="Abbrechen"
                              onClick={() => setEditingTeamId(null)}
                              className="cmf-btn-secondary flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </form>
                        ) : (
                          <div className="flex min-w-0 items-center gap-1.5">
                            <h3 className="font-industrial truncate text-sm font-bold text-[var(--text-main)]">
                              {team.name}
                            </h3>
                            {isHost && (
                              <button
                                type="button"
                                title="Teamnamen ändern"
                                aria-label={`Teamnamen für ${team.name} bearbeiten`}
                                data-testid={`lobby-edit-team-name-${team.id}`}
                                onClick={() => {
                                  setEditingTeamId(team.id);
                                  setTeamNameDraft(team.name);
                                }}
                                className="rounded-md p-1 text-[var(--text-muted)] hover:bg-black/5 hover:text-[var(--text-main)]"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {!isOverviewAccount && !isEditingThisName && (
                        <button
                          type="button"
                          data-testid={`lobby-join-${team.id}-btn`}
                          disabled={changingRoleTo !== null || isSelected}
                          onClick={() => void handleChooseTeam(team.id)}
                          className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                            isSelected
                              ? 'cmf-badge-teal cursor-default'
                              : 'cmf-btn-secondary'
                          } disabled:opacity-80`}
                        >
                          {isSelected
                            ? '✓ Dein Team'
                            : changingRoleTo === team.id
                              ? '...'
                              : 'Beitreten'}
                        </button>
                      )}
                    </div>

                    {team.members.length === 0 ? (
                      <p className="text-[11px] text-[var(--text-muted)]">
                        Frei
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
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
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shell-border)] bg-white/90 px-2 py-0.5 text-xs font-semibold text-[var(--text-main)]"
                            >
                              <span
                                className={`h-2 w-2 shrink-0 rounded-full ${
                                  online ? 'bg-emerald-500' : 'bg-zinc-300'
                                }`}
                              />
                              <PlayerAvatar avatar={m.avatar} playerId={m} size="xs" />
                              <span>{m.name}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {hiddenSeekerTeamCount > 0 || showAllSeekerTeams ? (
            <button
              type="button"
              onClick={() => setShowAllSeekerTeams((v) => !v)}
              className="cmf-btn-secondary font-tech flex min-h-[36px] w-full items-center justify-center gap-1.5 py-1.5 text-[11px] font-bold uppercase"
            >
              {showAllSeekerTeams ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" />
                  <span>Leere Teams ausblenden</span>
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                  <span>Weitere Sucher-Teams anzeigen ({hiddenSeekerTeamCount})</span>
                </>
              )}
            </button>
          ) : null}

          {unassignedMembers.length > 0 && (
            <div className="cmf-well flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
              <span className="font-tech text-[10px] font-bold text-[var(--text-muted)] uppercase">
                Noch ohne Team ({unassignedMembers.length}):
              </span>
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
                    className="inline-flex items-center gap-1 rounded-lg border border-[var(--shell-border)] bg-white/80 px-2 py-0.5 text-xs font-medium text-[var(--text-main)]"
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        online ? 'bg-emerald-500' : 'bg-zinc-300'
                      }`}
                    />
                    <PlayerAvatar avatar={m.avatar} playerId={m} size="xs" />
                    <span>{m.name}</span>
                  </span>
                );
              })}
            </div>
          )}
        </section>

        {/* 2. SPIELEINSTELLUNGEN (kompakt für Mitspieler, strukturiert für den Host) */}
        <section
          data-testid="lobby-settings-section"
          className="cmf-module space-y-3.5 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-2.5">
            <h2 className="font-industrial text-base font-bold text-[var(--text-main)]">
              {canEditSettings ? '2. Regeln & Gebiet' : '2. Regeln dieser Runde'}
            </h2>

            <button
              type="button"
              data-testid="lobby-preview-map-btn"
              onClick={onViewMap}
              className="cmf-btn-secondary inline-flex min-h-[34px] items-center gap-1.5 px-3 py-1 text-xs font-semibold"
            >
              <Compass className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
              <span>Karte öffnen</span>
            </button>
          </div>

          {!canEditSettings ? (
            /* Kompakte 3-Kachel-Zusammenfassung für Nicht-Hosts */
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="cmf-well p-3">
                <span className="font-tech block text-[9px] font-bold text-[var(--text-muted)] uppercase">
                  MODUS
                </span>
                <span className="font-industrial text-sm font-bold text-[var(--text-main)]">
                  {isManhunt ? 'Manhunt (Bewegung)' : 'Klassisch (Festes Versteck)'}
                </span>
              </div>
              <div data-testid="lobby-zone-summary" className="cmf-well p-3">
                <span className="font-tech block text-[9px] font-bold text-[var(--text-muted)] uppercase">
                  SPIELGEBIET
                </span>
                <span className="font-industrial text-sm font-bold text-[var(--text-main)]">
                  {activeZoneSummaryTitle}
                </span>
              </div>
              <div className="cmf-well p-3">
                <span className="font-tech block text-[9px] font-bold text-[var(--text-muted)] uppercase">
                  ZEITEN
                </span>
                <span className="font-industrial text-sm font-bold text-[var(--text-main)]">
                  {isManhunt
                    ? `${manhuntHeadStartMin} Min. Vorsprung • ${manhuntShrinkMin} Min. Jagd`
                    : `${classicHidingMin} Min. Verstecken • ${formatMinutesHumanDe(classicSearchMin)} Suche`}
                </span>
              </div>
            </div>
          ) : (
            /* Übersichtliche Host-Konfiguration */
            <div className="space-y-4">
              {/* Modus */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  data-testid="lobby-mode-classic-btn"
                  onClick={() => handleSelectGameMode('CLASSIC')}
                  className={`flex flex-col items-start gap-0.5 rounded-xl p-3 text-left transition-colors ${
                    !isManhunt ? 'cmf-btn-active' : 'cmf-well'
                  }`}
                >
                  <span className="text-sm font-bold text-[var(--text-main)]">
                    Klassisch (Sardinen)
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    Festes Versteck (50 m) · Tipps kaufen
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="lobby-mode-manhunt-btn"
                  onClick={() => handleSelectGameMode('MANHUNT')}
                  className={`flex flex-col items-start gap-0.5 rounded-xl p-3 text-left transition-colors ${
                    isManhunt ? 'cmf-btn-active' : 'cmf-well'
                  }`}
                >
                  <span className="text-sm font-bold text-[var(--text-main)]">
                    Manhunt (Bewegung)
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    Frei bewegen · Standort-Ping alle 10/5 Min.
                  </span>
                </button>
              </div>

              {/* Spielgebiet */}
              <div className="space-y-2.5 border-t cmf-divider pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--text-muted)]">
                    Spielgebiet
                  </span>
                  <span
                    data-testid="lobby-zone-summary"
                    className="text-xs font-semibold text-[var(--text-main)]"
                  >
                    {activeZoneSummaryTitle} ({activeZoneSummaryDetail})
                  </span>
                </div>

                <div className="cmf-well space-y-3 p-3">
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      data-testid="lobby-zone-type-plz-btn"
                      onClick={handleSelectPlzZoneTab}
                      className={`min-h-[38px] rounded-xl px-2 py-1.5 text-xs font-semibold transition-all ${
                        !isCirclePlayArea && !isFullMunich
                          ? 'cmf-btn-active'
                          : 'cmf-btn-secondary'
                      }`}
                    >
                      Postleitzahl
                    </button>
                    <button
                      type="button"
                      data-testid="lobby-zone-type-munich-btn"
                      onClick={handleSelectFullMunichZoneTab}
                      className={`min-h-[38px] rounded-xl px-2 py-1.5 text-xs font-semibold transition-all ${
                        !isCirclePlayArea && isFullMunich
                          ? 'cmf-btn-active'
                          : 'cmf-btn-secondary'
                      }`}
                    >
                      Ganz München
                    </button>
                    <button
                      type="button"
                      data-testid="lobby-zone-type-circle-btn"
                      onClick={() =>
                        handleSelectOrResizeCircleZone(circleRadiusMeters)
                      }
                      className={`min-h-[38px] rounded-xl px-2 py-1.5 text-xs font-semibold transition-all ${
                        isCirclePlayArea
                          ? 'cmf-btn-active'
                          : 'cmf-btn-secondary'
                      }`}
                    >
                      Eigener Kreis
                    </button>
                  </div>

                  {!isCirclePlayArea && !isFullMunich && (
                    <div className="space-y-2">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleApplyPlzInput(plzInputText, true);
                        }}
                        className="flex flex-col gap-2 sm:flex-row"
                      >
                        <input
                          id="lobby-plz-input"
                          type="text"
                          data-testid="lobby-plz-input"
                          value={plzInputText}
                          onFocus={() => setIsPlzInputFocused(true)}
                          onBlur={() => {
                            setIsPlzInputFocused(false);
                            handleApplyPlzInput(plzInputText, true);
                          }}
                          onChange={(e) => {
                            const nextText = e.target.value;
                            setPlzInputText(nextText);
                            const { validCodes, notFoundCodes } =
                              parseAndValidateMunichPostalCodes(nextText);
                            const completedUnknowns = notFoundCodes.filter(
                              (tok) =>
                                tok.length >= 5 ||
                                !/^\d+$/.test(tok) ||
                                nextText.trimEnd().length >
                                  nextText.lastIndexOf(tok) + tok.length
                            );
                            if (completedUnknowns.length > 0) {
                              setPlzValidationError(
                                formatNotFoundPlzMessage(completedUnknowns)
                              );
                            } else {
                              setPlzValidationError(null);
                            }
                            if (
                              validCodes.length > 0 &&
                              notFoundCodes.length === 0
                            ) {
                              applyPostalCodesAsZone(validCodes);
                            }
                          }}
                          placeholder="PLZ eingeben, z. B. 81247, 81245"
                          className="cmf-input min-h-[40px] flex-1 px-3 py-1.5 font-tech text-xs font-bold"
                        />
                        <button
                          type="submit"
                          data-testid="lobby-plz-apply-btn"
                          className="cmf-btn-active font-tech min-h-[40px] shrink-0 px-4 py-1.5 text-xs font-bold uppercase"
                        >
                          OK
                        </button>
                      </form>

                      {plzValidationError && (
                        <div
                          data-testid="lobby-plz-error"
                          className="cmf-badge-orange cmf-shake rounded-xl px-3 py-2 font-tech text-xs font-bold"
                        >
                          {plzValidationError}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-1.5">
                        {activePlzEntries.map((entry) => (
                          <span
                            key={entry.postalCode}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shell-border)] bg-[var(--surface-chip)] px-2.5 py-1 text-xs font-semibold text-[var(--text-main)]"
                          >
                            <span>
                              {entry.postalCode} ({entry.district})
                            </span>
                            {activePostalCodes.length > 1 && (
                              <button
                                type="button"
                                aria-label={`PLZ ${entry.postalCode} entfernen`}
                                onClick={() => {
                                  const remaining = activePostalCodes.filter(
                                    (c) => c !== entry.postalCode
                                  );
                                  setPlzValidationError(null);
                                  setPlzInputText(remaining.join(', '));
                                  applyPostalCodesAsZone(remaining);
                                }}
                                className="rounded px-1 text-xs font-bold text-[var(--cmf-orange)] hover:bg-black/10"
                              >
                                ×
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {isCirclePlayArea && (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-tech text-xs font-bold text-[var(--text-main)]">
                          Radius: {circleRadiusMeters} m
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label="Radius verkleinern"
                            disabled={
                              circleRadiusMeters <=
                              PLAY_AREA_CIRCLE_MIN_RADIUS_METERS
                            }
                            onClick={() =>
                              handleSelectOrResizeCircleZone(
                                circleRadiusMeters - PLAY_AREA_CIRCLE_STEP_METERS
                              )
                            }
                            className="cmf-btn-secondary flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-40"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Radius vergrößern"
                            disabled={
                              circleRadiusMeters >=
                              PLAY_AREA_CIRCLE_MAX_RADIUS_METERS
                            }
                            onClick={() =>
                              handleSelectOrResizeCircleZone(
                                circleRadiusMeters + PLAY_AREA_CIRCLE_STEP_METERS
                              )
                            }
                            className="cmf-btn-secondary flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-40"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <input
                        type="range"
                        aria-label="Kreis-Radius in Metern"
                        data-testid="lobby-circle-radius-slider"
                        min={PLAY_AREA_CIRCLE_MIN_RADIUS_METERS}
                        max={PLAY_AREA_CIRCLE_MAX_RADIUS_METERS}
                        step={PLAY_AREA_CIRCLE_STEP_METERS}
                        value={circleRadiusMeters}
                        onChange={(e) =>
                          handleSelectOrResizeCircleZone(Number(e.target.value))
                        }
                        className="w-full accent-[var(--cmf-orange)]"
                      />

                      <button
                        type="button"
                        data-testid="lobby-open-circle-picker-btn"
                        onClick={onOpenCircleMapEditor}
                        className="cmf-btn-primary font-dot inline-flex min-h-[40px] w-full items-center justify-center gap-2 px-4 py-2 text-xs font-bold"
                      >
                        <Crosshair className="h-4 w-4" />
                        <span>Kreis auf Karte verschieben</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Zeiten */}
              <div className="space-y-2.5 border-t cmf-divider pt-3">
                <span className="block text-xs font-semibold text-[var(--text-muted)]">
                  Zeiten
                </span>

                {!isManhunt ? (
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      <div className="cmf-well flex items-center justify-between gap-2 p-3">
                        <div>
                          <span className="font-tech block text-[10px] font-bold text-[var(--text-muted)] uppercase">
                            Versteckzeit
                          </span>
                          <span
                            data-testid="lobby-classic-hiding-value"
                            className="font-dot text-lg font-bold text-[var(--text-main)]"
                          >
                            {classicHidingMin} Min.
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid="lobby-hiding-minus-btn"
                            disabled={classicHidingMin <= 5}
                            onClick={() =>
                              handleChangeClassicHidingMin(classicHidingMin - 5)
                            }
                            className="cmf-btn-secondary flex h-9 w-9 items-center justify-center rounded-xl disabled:opacity-40"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            data-testid="lobby-hiding-plus-btn"
                            disabled={classicHidingMin >= 55}
                            onClick={() =>
                              handleChangeClassicHidingMin(classicHidingMin + 5)
                            }
                            className="cmf-btn-secondary flex h-9 w-9 items-center justify-center rounded-xl disabled:opacity-40"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="cmf-well flex items-center justify-between gap-2 p-3">
                        <div>
                          <span className="font-tech block text-[10px] font-bold text-[var(--text-muted)] uppercase">
                            Suchdauer
                          </span>
                          <span
                            data-testid="lobby-classic-search-value"
                            className="font-dot text-lg font-bold text-[var(--text-main)]"
                          >
                            {formatMinutesHumanDe(classicSearchMin)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid="lobby-search-minus-btn"
                            disabled={
                              classicSearchMin <=
                              CLASSIC_SEARCH_DURATION_MIN_MINUTES
                            }
                            onClick={() =>
                              handleChangeClassicSearchMin(
                                classicSearchMin -
                                  CLASSIC_SEARCH_DURATION_STEP_MINUTES
                              )
                            }
                            className="cmf-btn-secondary flex h-9 w-9 items-center justify-center rounded-xl disabled:opacity-40"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            data-testid="lobby-search-plus-btn"
                            disabled={
                              classicSearchMin >=
                              CLASSIC_SEARCH_DURATION_MAX_MINUTES
                            }
                            onClick={() =>
                              handleChangeClassicSearchMin(
                                classicSearchMin +
                                  CLASSIC_SEARCH_DURATION_STEP_MINUTES
                              )
                            }
                            className="cmf-btn-secondary flex h-9 w-9 items-center justify-center rounded-xl disabled:opacity-40"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Klare 3-Schritte-Zeitleiste statt langem Fließtext */}
                    <div className="cmf-well flex flex-wrap items-center justify-between gap-2 px-3 py-2 font-tech text-[11px] font-bold text-[var(--text-muted)]">
                      <span>1. {classicHidingMin} Min. Verstecken</span>
                      <span>→</span>
                      <span>2. {formatMinutesHumanDe(classicSearchMin)} Suche</span>
                      <span>→</span>
                      <span>
                        3. Radar ab +{formatMinutesHumanDe(radarStartAfterSearchMin)} ({classicRadii[1]}m → 100m)
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    <div className="cmf-well flex items-center justify-between gap-2 p-3">
                      <div>
                        <span className="font-tech block text-[10px] font-bold text-[var(--text-muted)] uppercase">
                          Vorsprung
                        </span>
                        <span
                          data-testid="lobby-manhunt-headstart-value"
                          className="font-dot text-lg font-bold text-[var(--text-main)]"
                        >
                          {manhuntHeadStartMin} Min.
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={manhuntHeadStartMin <= 0}
                          onClick={() =>
                            handleChangeManhuntHeadStartMin(
                              manhuntHeadStartMin - 1
                            )
                          }
                          className="cmf-btn-secondary flex h-9 w-9 items-center justify-center rounded-xl disabled:opacity-40"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={manhuntHeadStartMin >= 30}
                          onClick={() =>
                            handleChangeManhuntHeadStartMin(
                              manhuntHeadStartMin + 1
                            )
                          }
                          className="cmf-btn-secondary flex h-9 w-9 items-center justify-center rounded-xl disabled:opacity-40"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="cmf-well flex items-center justify-between gap-2 p-3">
                      <div>
                        <span className="font-tech block text-[10px] font-bold text-[var(--text-muted)] uppercase">
                          Jagddauer
                        </span>
                        <span
                          data-testid="lobby-manhunt-shrink-value"
                          className="font-dot text-lg font-bold text-[var(--text-main)]"
                        >
                          {manhuntShrinkMin} Min.
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={manhuntShrinkMin <= 10}
                          onClick={() =>
                            handleChangeManhuntShrinkMin(manhuntShrinkMin - 5)
                          }
                          className="cmf-btn-secondary flex h-9 w-9 items-center justify-center rounded-xl disabled:opacity-40"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          disabled={manhuntShrinkMin >= 80}
                          onClick={() =>
                            handleChangeManhuntShrinkMin(manhuntShrinkMin + 5)
                          }
                          className="cmf-btn-secondary flex h-9 w-9 items-center justify-center rounded-xl disabled:opacity-40"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Preise & Distanzen der 4 Frage-Kategorien (ausklappbar für den Host) */}
              {!isManhunt && (
                <div className="border-t cmf-divider pt-3">
                  <div className="cmf-well p-3 space-y-3">
                    <button
                      type="button"
                      data-testid="lobby-toggle-question-rules-btn"
                      aria-expanded={showQuestionRules}
                      onClick={() => setShowQuestionRules((v) => !v)}
                      className="flex w-full items-center justify-between gap-2 text-left"
                    >
                      <div>
                        <span className="font-industrial block text-xs font-bold text-[var(--text-main)]">
                          Frage-Kategorien: Preise &amp; Distanzen
                        </span>
                        <span className="text-[11px] text-[var(--text-muted)]">
                          Strafminuten und Meter-Radien anpassen
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 font-tech text-[10px] font-bold uppercase ${
                            isDefaultQuestionRulesConfig(
                              publicState.questionConfig
                            )
                              ? 'cmf-badge-teal'
                              : 'cmf-badge-orange'
                          }`}
                        >
                          {isDefaultQuestionRulesConfig(
                            publicState.questionConfig
                          )
                            ? 'Standard'
                            : 'Angepasst'}
                        </span>
                        <span className="cmf-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-xl">
                          {showQuestionRules ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </span>
                      </div>
                    </button>

                    {showQuestionRules && (
                      <div className="border-t cmf-divider pt-3">
                        <HostQuestionRulesEditor
                          questionConfig={publicState.questionConfig}
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
                </div>
              )}

              {/* Indoor-Testmodus strikt nur für das Admin-Konto */}
              {isOverviewAccount && (
                <div className="border-t cmf-divider pt-3">
                  <div className="cmf-well flex items-center justify-between gap-3 p-3">
                    <div>
                      <span className="font-industrial block text-xs font-bold text-[var(--text-main)]">
                        Indoor-Testmodus (Standort per Klick)
                      </span>
                      <span className="text-[11px] text-[var(--text-muted)]">
                        Nur für das Admin-Konto zum Testen im Haus
                      </span>
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
                      className={`font-tech min-h-[36px] shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-bold uppercase ${
                        publicState.allowTestClicks
                          ? 'cmf-btn-active'
                          : 'cmf-btn-secondary'
                      }`}
                    >
                      {publicState.allowTestClicks ? 'AN' : 'AUS'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* 3. STARTKLAR */}
        <section
          data-testid="lobby-start-section"
          className="cmf-chassis space-y-3 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-industrial text-base font-bold text-[var(--text-main)]">
              3. Spiel starten
            </h2>

            {totalRequiredReady > 0 && (
              <span className="cmf-oled rounded-lg px-2.5 py-1 font-dot text-xs text-[var(--cmf-teal)]">
                BEREIT: {readyCount} / {totalRequiredReady}
              </span>
            )}
          </div>

          {!canStartOrReady && (
            <div className="cmf-badge-amber rounded-xl p-3 text-xs font-medium space-y-0.5">
              {requiredHiderMembers.length === 0 && (
                <p>• Mindestens 1 Verstecker fehlt noch.</p>
              )}
              {seekerMembers.length === 0 && (
                <p>• Mindestens 1 Sucher-Team fehlt noch.</p>
              )}
            </div>
          )}

          {!isOverviewAccount && isOwnHider && canStartOrReady && (
            <div className="space-y-1.5">
              <button
                type="button"
                data-testid="toggle-ready-btn"
                disabled={togglingReady}
                onClick={async () => {
                  setTogglingReady(true);
                  try {
                    await onToggleOwnReady(!isOwnReady);
                  } finally {
                    setTogglingReady(false);
                  }
                }}
                className={`font-dot flex min-h-[50px] w-full items-center justify-center gap-2 px-4 py-3 text-sm font-bold ${
                  isOwnReady ? 'cmf-btn-active' : 'cmf-btn-primary'
                }`}
              >
                <CheckCircle2
                  className={`h-4 w-4 ${
                    isOwnReady ? 'text-[var(--cmf-teal)]' : 'text-white'
                  }`}
                />
                <span>
                  {isOwnReady
                    ? `✓ Bereit (${readyCount}/${totalRequiredReady})`
                    : `Ich bin bereit! (${readyCount}/${totalRequiredReady})`}
                </span>
              </button>
              {isOwnReady && (
                <p className="text-center text-[11px] text-[var(--text-muted)]">
                  Startet automatisch, sobald alle Verstecker bereit sind.
                </p>
              )}
            </div>
          )}

          {!isOverviewAccount && !isOwnHider && canStartOrReady && (
            <div className="cmf-well flex items-center gap-2.5 p-3 text-xs text-[var(--text-muted)]">
              <Users className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
              <span>
                {ownSelection === 'UNASSIGNED'
                  ? 'Bitte wähle oben zuerst dein Team!'
                  : `Bereit in „${
                      teamsPublic[ownSelection]?.name ?? ownSelection
                    }“ – wartet auf Spielstart (${readyCount}/${totalRequiredReady} Verstecker bereit).`}
              </span>
            </div>
          )}

          {isHost && publicState.status === 'LOBBY' && (
            <button
              type="button"
              data-testid="lobby-host-start-btn"
              disabled={!canStartOrReady || startingRound}
              onClick={() => void handleStartRoundByHost()}
              className="cmf-btn-primary font-dot flex min-h-[50px] w-full items-center justify-center gap-2 px-4 py-3 text-sm font-bold disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              <span>{startingRound ? 'Starte ...' : 'Spiel starten'}</span>
            </button>
          )}

          {isHost && publicState.status === 'FINISHED' && (
            <button
              type="button"
              data-testid="lobby-host-new-round-btn"
              onClick={() => {
                const secrets = generateSessionSecrets();
                const nextTeams = createDefaultTeams();
                for (const [id, team] of Object.entries(nextTeams)) {
                  const customName = teamsPublic[id]?.name?.trim();
                  if (customName) team.name = customName;
                }
                for (const m of allEnabledMembers) {
                  if (
                    m.enabled &&
                    m.side === 'SEEKER' &&
                    m.teamId &&
                    nextTeams[m.teamId]
                  ) {
                    nextTeams[m.teamId].memberPlayerIds.push(m.playerId);
                    nextTeams[m.teamId].beaconPlayerId = m.playerId;
                  }
                }
                void adapter.resetRoundByHost(
                  {
                    ...publicState,
                    sessionId: generateRandomId('sess'),
                    status: 'LOBBY',
                    currentPhase: 'LOBBY',
                    gameStartTimestamp: null,
                    searchStartTimestamp: null,
                    pausedAt: null,
                    totalPausedMs: 0,
                    pausedBeforeSearchMs: 0,
                    anchorLocked: false,
                    radarCircle: null,
                    leashAlertActive: false,
                    activeTeamIds: [],
                  },
                  nextTeams,
                  {
                    anchorPoint: null,
                    radarStages: [],
                    qrSecret: secrets.qrSecret,
                    shortCode: secrets.shortCode,
                    hiderLocations: {},
                  }
                );
              }}
              className="cmf-btn-primary font-dot flex min-h-[48px] w-full items-center justify-center gap-2 px-4 py-3 text-sm font-bold"
            >
              <RotateCcw className="h-4 w-4" />
              <span>Neue Runde vorbereiten</span>
            </button>
          )}
        </section>

        {/* Destruktive Host-Aktion sicher ganz unten platziert */}
        {isHost && (
          <div className="flex justify-center pt-1">
            {confirmDeleteLobby ? (
              <div className="cmf-module flex flex-wrap items-center justify-center gap-2 border-[#DC2626]/40 px-4 py-2.5">
                <span className="font-tech text-xs font-bold text-[#DC2626]">
                  Lobby {roomCode} endgültig löschen?
                </span>
                <button
                  type="button"
                  data-testid="lobby-confirm-delete-room-btn"
                  disabled={deletingLobby}
                  onClick={() => void handleDeleteCurrentLobby()}
                  className="inline-flex min-h-[34px] items-center gap-1 rounded-lg bg-[#DC2626] px-3 py-1 font-tech text-xs font-bold text-white uppercase hover:opacity-90 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{deletingLobby ? 'Lösche ...' : 'Ja, löschen'}</span>
                </button>
                <button
                  type="button"
                  data-testid="lobby-cancel-delete-room-btn"
                  disabled={deletingLobby}
                  onClick={() => setConfirmDeleteLobby(false)}
                  className="cmf-btn-secondary inline-flex min-h-[34px] items-center px-3 py-1 font-tech text-xs font-bold uppercase"
                >
                  Abbrechen
                </button>
              </div>
            ) : (
              <button
                type="button"
                data-testid="lobby-delete-room-btn"
                onClick={() => setConfirmDeleteLobby(true)}
                className="font-tech inline-flex min-h-[36px] items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-[#DC2626]/85 uppercase hover:bg-[#DC2626]/10 hover:text-[#DC2626]"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Diese Lobby löschen</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
