import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  Copy,
  Crosshair,
  EyeOff,
  Link2,
  LocateFixed,
  MapPin,
  Minus,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Shield,
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
  CLASSIC_SEARCH_DURATION_STEPS_MINUTES,
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
  getQuestionPenaltyMs,
  isAllMunichPostalCodes,
  parseAndValidateMunichPostalCodes,
  PLAY_AREA_CIRCLE_MAX_RADIUS_METERS,
  PLAY_AREA_CIRCLE_MIN_RADIUS_METERS,
  PLAY_AREA_CIRCLE_STEP_METERS,
  TEAM_PALETTE,
} from '../../config/gameConfig';
import { preloadGreenPolygonsForPostalCode } from '../../config/fallbackOsm81247';
import { getPlayerGreeting, isOverviewMember } from '../../config/players';
import {
  isPointInMunichPlz,
  snapPointIntoMunichPlz,
} from '../../geo/boundary';
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
import { formatDurationClock } from '../../utils/formatting';
import { PlayerAvatar } from '../Common/PlayerAvatar';

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
  onLeaveRoom?: () => Promise<void>;
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
  onLeaveRoom,
}) => {
  const isOverviewAccount = isOverviewMember(ownMember);
  const isHost = Boolean(
    ownMember.isHost ||
      (publicState.hostPlayerId &&
        publicState.hostPlayerId === ownMember.playerId)
  );
  const canEditSettings = isHost && publicState.status === 'LOBBY';

  const roomCode = publicState.roomCode ?? adapter.getRoomCode() ?? GAME_ID;
  const [copiedKind, setCopiedKind] = useState<'CODE' | 'LINK' | null>(null);
  const [changingRoleTo, setChangingRoleTo] = useState<string | null>(null);
  const [togglingReady, setTogglingReady] = useState(false);
  const [startingRound, setStartingRound] = useState(false);

  // Teamnamen-Bearbeitung durch den Host
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [teamNameDraft, setTeamNameDraft] = useState('');
  const [savingTeamName, setSavingTeamName] = useState(false);

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
    90,
    Math.max(
      30,
      Math.round(
        (publicState.classicSearchDurationMs ??
          DEFAULT_CLASSIC_SEARCH_MINUTES * 60_000) /
          60_000 /
          15
      ) * 15
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
      90,
      Math.max(30, Math.round(nextSearchMin / 15) * 15)
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
  const classicSearchDurationMs = classicSearchMin * 60_000;
  const radarStartAfterSearchMin = Math.round(
    (publicState.radarSchedule.stage1Ms -
      publicState.radarSchedule.hidingDurationMs) /
      60_000
  );
  const splitPenaltyMin = Math.round(
    getQuestionPenaltyMs('SPLIT_NS', classicSearchDurationMs) / 60_000
  );
  const photoPenaltyMin = Math.round(
    getQuestionPenaltyMs('MEDIA_SKY', classicSearchDurationMs) / 60_000
  );

  const activeZoneSummaryTitle = isCirclePlayArea
    ? `Kreis-Zone (Radius ${circleRadiusMeters} m)`
    : isFullMunich
      ? 'Ganz München (Alle 75 PLZ)'
      : `PLZ ${activePostalCodesLabel}`;

  const activeZoneSummaryDetail = isCirclePlayArea
    ? `Durchmesser ${circleRadiusMeters * 2} m in ${activePostalCodesLabel} (${activeDistrictsSummary})`
    : activeDistrictsSummary;

  return (
    <div
      data-testid="lobby-screen"
      className="cmf-drafting-bg cmf-scroll-area cmf-view-enter h-full px-3 py-3.5 sm:p-4 text-[var(--text-main)]"
    >
      <div className="mx-auto max-w-3xl space-y-4 pb-12">
        {/* KOPFBEREICH: SPIELRAUM-CODE, HOST & EINLADUNG */}
        <section
          data-testid="lobby-room-header"
          className="cmf-chassis cmf-card-enter space-y-3 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <PlayerAvatar avatar={ownMember.avatar} size="md" />
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="cmf-badge-teal rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold tracking-wider uppercase">
                    SPIEL-LOBBY
                  </span>
                  {isHost && !isOverviewAccount && (
                    <span className="cmf-badge-orange rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold tracking-wider uppercase">
                      DU BIST HOST
                    </span>
                  )}
                </div>
                <h1 className="font-industrial mt-0.5 text-base font-bold text-[var(--text-main)] sm:text-lg">
                  {ownMember.name} • {getPlayerGreeting(ownMember)}
                </h1>
              </div>
            </div>

            {onLeaveRoom && (
              <button
                type="button"
                data-testid="lobby-leave-room-btn"
                onClick={() => void onLeaveRoom()}
                className="cmf-btn-secondary font-tech inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Raum wechseln</span>
              </button>
            )}
          </div>

          <div className="cmf-oled flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <span className="font-tech block text-[10px] font-bold tracking-wider text-[#9AA4AE] uppercase">
                SPIEL-CODE ZUM MITSPIELEN
              </span>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-2.5">
                <span
                  data-testid="lobby-room-code"
                  className="font-dot text-2xl font-bold tracking-[0.2em] text-[#F8FAFC] sm:text-3xl"
                >
                  {roomCode}
                </span>
                <span className="font-tech text-[11px] text-[#9AA4AE]">
                  {publicState.hostName
                    ? `Host: ${publicState.hostName}`
                    : 'Klassischer Raum'}{' '}
                  • {onlineMemberList.length} Online
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="lobby-copy-code-btn"
                onClick={() => void handleCopyCode()}
                className="cmf-btn-primary font-tech inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase"
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
                data-testid="lobby-copy-link-btn"
                onClick={() => void handleCopyLink()}
                className="cmf-btn-secondary font-tech inline-flex min-h-[38px] items-center gap-1.5 bg-white/95 px-3 py-1.5 text-[11px] font-bold text-[var(--text-main)] uppercase"
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

          {isGpsNotWorking && (
            <div
              role="alert"
              data-testid="lobby-gps-warning"
              className="cmf-badge-orange flex flex-col gap-2 rounded-xl p-3 text-xs sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-tech text-[11px] font-bold uppercase">
                    GPS noch nicht aktiv
                  </p>
                  <p className="text-[11px] opacity-95">
                    {gpsStatus === 'DENIED'
                      ? 'Bitte erlaube den Standortzugriff im Browser vor dem Spielstart.'
                      : (gpsError ??
                        'Bitte aktiviere kurz dein GPS, damit deine Position im Spiel funktioniert.')}
                  </p>
                </div>
              </div>
              {onRetryGps && (
                <button
                  type="button"
                  data-testid="lobby-retry-gps-btn"
                  onClick={() => void onRetryGps()}
                  className="cmf-btn-secondary font-tech inline-flex min-h-[36px] shrink-0 items-center justify-center gap-1.5 bg-white/95 px-3 py-1.5 text-[11px] font-bold text-[var(--text-main)] uppercase"
                >
                  <LocateFixed className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                  <span>GPS prüfen</span>
                </button>
              )}
            </div>
          )}
        </section>

        {/* SCHRITT 1: TEAM WÄHLEN & MITSPIELER */}
        <section
          data-testid="lobby-teams-section"
          className="cmf-module space-y-3.5 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-3">
            <div>
              <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--cmf-teal)] uppercase">
                SCHRITT 1 // TEAMS &amp; MITSPIELER
              </span>
              <h2 className="font-industrial text-base font-bold text-[var(--text-main)]">
                Wähle dein Team
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Tippe auf ein Team, um beizutreten. Mindestens ein Spieler muss{' '}
                <strong>Die Sardinen</strong> wählen und mindestens ein Sucher-Team besetzt sein.
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
                  Standard-Teamnamen
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
                  Kein Team
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
                      Die Sardinen (Verstecker)
                    </h3>
                    {totalRequiredReady > 0 && (
                      <span className="cmf-badge-teal rounded-full px-2 py-0.5 font-tech text-[10px] font-bold uppercase">
                        {readyCount}/{totalRequiredReady} Bereit
                      </span>
                    )}
                  </div>
                  <span className="font-tech text-[10px] font-bold text-[var(--text-muted)] uppercase">
                    {hiderMembers.length}{' '}
                    {hiderMembers.length === 1 ? 'Spieler' : 'Spieler'} • Verstecken sich gemeinsam
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
                    <span>Wechsle ...</span>
                  ) : (
                    <span>Als Sardine spielen</span>
                  )}
                </button>
              )}
            </div>

            {hiderMembers.length === 0 ? (
              <p className="text-xs italic text-[var(--text-muted)]">
                Noch niemand als Verstecker eingetragen.
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
                          ? 'border-[var(--cmf-teal)] bg-white text-[var(--text-main)]'
                          : 'border-[var(--shell-border)] bg-white/85 text-[var(--text-main)]'
                      }`}
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          online ? 'bg-emerald-500' : 'bg-zinc-300'
                        }`}
                      />
                      <PlayerAvatar avatar={m.avatar} size="xs" />
                      <span>{m.name}</span>
                      {ready && (
                        <span className="font-tech text-[10px] font-bold text-[var(--cmf-teal)] uppercase">
                          ✓ Bereit
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* 6 Sucher-Teams als übersichtliches Grid */}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {seekerTeams.map((team) => {
              const isSelected = ownSelection === team.id;
              const isEditingThisName = editingTeamId === team.id;

              return (
                <div
                  key={team.id}
                  data-testid={`lobby-team-card-${team.id}`}
                  className={`flex flex-col justify-between gap-2.5 rounded-2xl border-[1.5px] p-3 transition-all ${
                    isSelected
                      ? 'border-[var(--cmf-teal)] bg-white shadow-sm ring-1 ring-[var(--cmf-teal)]/30'
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
                              aria-label="Teamname speichern"
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
                          className={`font-tech shrink-0 rounded-xl px-2.5 py-1.5 text-[11px] font-bold uppercase transition-all ${
                            isSelected
                              ? 'cmf-badge-teal cursor-default'
                              : 'cmf-btn-secondary bg-white hover:bg-zinc-50'
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
                        Frei (0 Spieler)
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
                              <PlayerAvatar avatar={m.avatar} size="xs" />
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

          {/* Noch unentschiedene Spieler */}
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
                    <PlayerAvatar avatar={m.avatar} size="xs" />
                    <span>{m.name}</span>
                  </span>
                );
              })}
            </div>
          )}
        </section>

        {/* SCHRITT 2: SPIELEINSTELLUNGEN (HOST BEARBEITET • SPIELER SEHEN ALLES KLAR GEGLIEDERT) */}
        <section
          data-testid="lobby-settings-section"
          className="cmf-module space-y-4 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-3">
            <div>
              <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--cmf-orange)] uppercase">
                SCHRITT 2 // SPIELEINSTELLUNGEN
              </span>
              <h2 className="font-industrial flex items-center gap-2 text-base font-bold text-[var(--text-main)]">
                <Settings2 className="h-4 w-4 text-[var(--cmf-orange)]" />
                {canEditSettings
                  ? 'Runde konfigurieren (Modus, Gebiet & Zeiten)'
                  : 'Aktuelle Regeln & Einstellungen dieser Runde'}
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                {canEditSettings
                  ? 'Alle Änderungen sind sofort live für alle Mitspieler in der Lobby sichtbar.'
                  : `Eingestellt vom Host${
                      publicState.hostName ? ` (${publicState.hostName})` : ''
                    } – wird automatisch live aktualisiert.`}
              </p>
            </div>

            <span className="cmf-well rounded-full px-2.5 py-1 font-tech text-[10px] font-bold text-[var(--text-muted)] uppercase">
              {canEditSettings ? 'HOST-STEUERUNG' : 'LIVE-VORSCHAU'}
            </span>
          </div>

          {/* 2A. SPIELMODUS */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 font-tech text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              <Shield className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
              <span>1. Spielmodus</span>
            </div>

            {canEditSettings ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  data-testid="lobby-mode-classic-btn"
                  onClick={() => handleSelectGameMode('CLASSIC')}
                  className={`flex flex-col items-start gap-1 rounded-2xl p-3.5 text-left transition-all ${
                    !isManhunt
                      ? 'cmf-btn-active ring-2 ring-[var(--cmf-teal)]'
                      : 'cmf-well opacity-80 hover:opacity-100'
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-dot text-xs font-bold uppercase">
                      Klassisch (Sardinen)
                    </span>
                    {!isManhunt && (
                      <span className="cmf-badge-teal rounded-full px-2 py-0.5 text-[9px] font-bold uppercase">
                        Aktiv
                      </span>
                    )}
                  </div>
                  <span className="text-xs leading-relaxed text-[var(--text-muted)]">
                    Verstecker bleiben an einem festen Versteck (50 m Radius). Sucher kaufen Hinweis-Fragen gegen Zeitstrafe.
                  </span>
                </button>

                <button
                  type="button"
                  data-testid="lobby-mode-manhunt-btn"
                  onClick={() => handleSelectGameMode('MANHUNT')}
                  className={`flex flex-col items-start gap-1 rounded-2xl p-3.5 text-left transition-all ${
                    isManhunt
                      ? 'cmf-btn-active ring-2 ring-[var(--cmf-orange)]'
                      : 'cmf-well opacity-80 hover:opacity-100'
                  }`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-dot text-xs font-bold uppercase">
                      Manhunt (Bewegungsjagd)
                    </span>
                    {isManhunt && (
                      <span className="cmf-badge-orange rounded-full px-2 py-0.5 text-[9px] font-bold uppercase">
                        Aktiv
                      </span>
                    )}
                  </div>
                  <span className="text-xs leading-relaxed text-[var(--text-muted)]">
                    Kein festes Versteck – die Sardinen bleiben in Bewegung! Alle 10 Min. (am Ende 5 Min.) erscheint ein Ping.
                  </span>
                </button>
              </div>
            ) : (
              <div className="cmf-well flex flex-col gap-1 p-3.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold uppercase ${
                      isManhunt ? 'cmf-badge-orange' : 'cmf-badge-teal'
                    }`}
                  >
                    {isManhunt ? 'MANHUNT' : 'KLASSISCH (SARDINEN)'}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                  {isManhunt
                    ? 'Verstecker dürfen sich im gesamten Gebiet frei bewegen. Alle 10 Min. (im letzten Viertel alle 5 Min.) erhalten die Sucher einen Standort-Ping und eine schrumpfende Zone.'
                    : 'Verstecker wählen in der Versteckzeit einen festen Ort (50 m Radius). Sucher können auf der Suche Hinweis-Fragen (Richtung, Radar, Thermometer, Fotos) gegen Strafminuten kaufen.'}
                </p>
              </div>
            )}
          </div>

          {/* 2B. SPIELGEBIET / GRENZEN */}
          <div className="space-y-2.5 border-t cmf-divider pt-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 font-tech text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                <MapPin className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                <span>2. Spielgebiet / Grenzen</span>
              </div>
              <button
                type="button"
                data-testid="lobby-preview-map-btn"
                onClick={onViewMap}
                className="cmf-btn-secondary font-tech inline-flex min-h-[32px] items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase"
              >
                <Compass className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                <span>Gebiet auf Karte ansehen</span>
              </button>
            </div>

            {/* Aktuelle Gebiets-Zusammenfassung (für Host & Spieler sichtbar) */}
            <div
              data-testid="lobby-zone-summary"
              className="cmf-oled flex flex-wrap items-center justify-between gap-2 p-3"
            >
              <div>
                <span className="font-tech block text-[9px] font-bold tracking-wider text-[#9AA4AE] uppercase">
                  AKTIVE VERSTECK-ZONE
                </span>
                <span className="font-industrial text-sm font-bold text-[#F8FAFC]">
                  {activeZoneSummaryTitle}
                </span>
                <span className="block text-[11px] text-[#9AA4AE]">
                  {activeZoneSummaryDetail}
                </span>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold uppercase ${
                  isCirclePlayArea ? 'cmf-badge-orange' : 'cmf-badge-teal'
                }`}
              >
                {isCirclePlayArea
                  ? `R = ${circleRadiusMeters} m`
                  : isFullMunich
                    ? '75 PLZ'
                    : `${activePostalCodes.length} PLZ`}
              </span>
            </div>

            {canEditSettings && (
              <div className="cmf-well space-y-3 p-3.5">
                {/* 3 klare Zonen-Typ-Reiter */}
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    data-testid="lobby-zone-type-plz-btn"
                    onClick={handleSelectPlzZoneTab}
                    className={`min-h-[38px] rounded-xl px-2 py-1.5 font-tech text-[11px] font-bold uppercase transition-all ${
                      !isCirclePlayArea && !isFullMunich
                        ? 'cmf-btn-active ring-1 ring-[var(--cmf-teal)]'
                        : 'cmf-btn-secondary'
                    }`}
                  >
                    PLZ wählen
                  </button>
                  <button
                    type="button"
                    data-testid="lobby-zone-type-munich-btn"
                    onClick={handleSelectFullMunichZoneTab}
                    className={`min-h-[38px] rounded-xl px-2 py-1.5 font-tech text-[11px] font-bold uppercase transition-all ${
                      !isCirclePlayArea && isFullMunich
                        ? 'cmf-btn-active ring-1 ring-[var(--cmf-teal)]'
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
                    className={`min-h-[38px] rounded-xl px-2 py-1.5 font-tech text-[11px] font-bold uppercase transition-all ${
                      isCirclePlayArea
                        ? 'cmf-btn-active ring-1 ring-[var(--cmf-orange)]'
                        : 'cmf-btn-secondary'
                    }`}
                  >
                    Eigener Kreis
                  </button>
                </div>

                {/* Details je nach gewähltem Zonen-Typ */}
                {!isCirclePlayArea && !isFullMunich && (
                  <div className="space-y-2">
                    <label
                      htmlFor="lobby-plz-input"
                      className="block font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase"
                    >
                      Münchner Postleitzahl(en) eingeben (mehrere mit Komma trennen)
                    </label>
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
                        placeholder="z. B. 81247 oder 81247, 81245"
                        className="cmf-input min-h-[40px] flex-1 px-3 py-1.5 font-tech text-xs font-bold"
                      />
                      <button
                        type="submit"
                        data-testid="lobby-plz-apply-btn"
                        className="cmf-btn-active font-tech min-h-[40px] shrink-0 px-4 py-1.5 text-xs font-bold uppercase"
                      >
                        Übernehmen
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
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shell-border)] bg-white px-2.5 py-1 font-tech text-[11px] font-bold text-[var(--text-main)]"
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

                {!isCirclePlayArea && isFullMunich && (
                  <p className="text-xs text-[var(--text-muted)]">
                    Das gesamte Stadtgebiet München (alle 75 Postleitzahlen ohne innere Teilgrenzen) ist als Versteck-Zone freigegeben.
                  </p>
                )}

                {isCirclePlayArea && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-tech text-[11px] font-bold text-[var(--text-main)] uppercase">
                        Kreis-Radius: {circleRadiusMeters} m (Ø{' '}
                        {circleRadiusMeters * 2} m)
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
                      className="cmf-btn-primary font-dot inline-flex min-h-[42px] w-full items-center justify-center gap-2 px-4 py-2 text-xs font-bold"
                    >
                      <Crosshair className="h-4 w-4" />
                      <span>Mittelpunkt auf der Karte wählen / verschieben</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2C. ZEITEN (VERSTECKZEIT & SUCHDAUER) */}
          <div className="space-y-2.5 border-t cmf-divider pt-3.5">
            <div className="flex items-center gap-1.5 font-tech text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              <Clock className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
              <span>3. Zeiten</span>
            </div>

            {!isManhunt ? (
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {/* Klassisch: Versteckzeit */}
                  <div className="cmf-well flex flex-col justify-between gap-2 p-3.5">
                    <div>
                      <span className="font-tech block text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                        VERSTECKZEIT AM ANFANG
                      </span>
                      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        Zeit für die Sardinen, um ein Versteck zu finden.
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span
                        data-testid="lobby-classic-hiding-value"
                        className="font-dot text-xl font-bold text-[var(--text-main)]"
                      >
                        {classicHidingMin} Min.
                      </span>
                      {canEditSettings && (
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
                      )}
                    </div>
                  </div>

                  {/* Klassisch: Suchdauer */}
                  <div className="cmf-well flex flex-col justify-between gap-2 p-3.5">
                    <div>
                      <span className="font-tech block text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                        SUCHDAUER (BIS 25M-RADAR)
                      </span>
                      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        Reguläre Suchzeit bis zur kleinsten Radar-Stufe.
                      </p>
                    </div>

                    {canEditSettings ? (
                      <div className="grid grid-cols-5 gap-1 pt-1">
                        {CLASSIC_SEARCH_DURATION_STEPS_MINUTES.map((stepMin) => (
                          <button
                            key={stepMin}
                            type="button"
                            data-testid={`lobby-search-step-${stepMin}`}
                            onClick={() => handleChangeClassicSearchMin(stepMin)}
                            className={`min-h-[36px] rounded-xl font-tech text-xs font-bold transition-all ${
                              classicSearchMin === stepMin
                                ? 'cmf-btn-active ring-1 ring-[var(--cmf-teal)]'
                                : 'cmf-btn-secondary bg-white/80'
                            }`}
                          >
                            {stepMin}m
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span
                        data-testid="lobby-classic-search-value"
                        className="font-dot pt-1 text-xl font-bold text-[var(--text-main)]"
                      >
                        {classicSearchMin} Min.
                      </span>
                    )}
                  </div>
                </div>

                <div className="cmf-well px-3.5 py-2.5 text-xs text-[var(--text-muted)]">
                  <strong>Ablauf:</strong> Nach{' '}
                  <strong>{classicHidingMin} Min.</strong> Versteckzeit beginnt
                  die Suche. Ab Minute <strong>+{radarStartAfterSearchMin}</strong>{' '}
                  der Suche schrumpft das Radar schrittweise (800 m → 400 m →
                  200 m → 100 m → 25 m). Tipp-Preise: Richtung/Radar +{splitPenaltyMin}{' '}
                  Min., Foto +{photoPenaltyMin} Min.
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {/* Manhunt: Vorsprung */}
                  <div className="cmf-well flex flex-col justify-between gap-2 p-3.5">
                    <div>
                      <span className="font-tech block text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                        VORSPRUNG DER VERSTECKER
                      </span>
                      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        Freilaufzeit, bevor die Jagd beginnt.
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span
                        data-testid="lobby-manhunt-headstart-value"
                        className="font-dot text-xl font-bold text-[var(--text-main)]"
                      >
                        {manhuntHeadStartMin} Min.
                      </span>
                      {canEditSettings && (
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
                      )}
                    </div>
                  </div>

                  {/* Manhunt: Jagd-/Schrumpfdauer */}
                  <div className="cmf-well flex flex-col justify-between gap-2 p-3.5">
                    <div>
                      <span className="font-tech block text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                        JAGDDAUER (BIS 150M-ZONE)
                      </span>
                      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        Zeit bis die Zone auf 150 m geschrumpft ist.
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span
                        data-testid="lobby-manhunt-shrink-value"
                        className="font-dot text-xl font-bold text-[var(--text-main)]"
                      >
                        {manhuntShrinkMin} Min.
                      </span>
                      {canEditSettings && (
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
                      )}
                    </div>
                  </div>
                </div>

                <div className="cmf-well px-3.5 py-2.5 text-xs text-[var(--text-muted)]">
                  <strong>Ablauf:</strong> Nach{' '}
                  <strong>{manhuntHeadStartMin} Min.</strong> Vorsprung startet
                  die Jagd. In den ersten 3/4 (bis{' '}
                  {formatDurationClock(
                    Math.round(manhuntShrinkMin * 60_000 * 0.75)
                  )}
                  ) erscheint alle <strong>10 Min.</strong> ein Verstecker-Ping,
                  im letzten Viertel alle <strong>5 Min.</strong> (Zone: 1200 m →
                  150 m).
                </div>
              </div>
            )}
          </div>

          {/* Optionaler Testmodus-Schalter nur für den Host */}
          {canEditSettings && (
            <div className="flex items-center justify-between gap-3 border-t cmf-divider pt-3">
              <div>
                <span className="font-industrial block text-xs font-bold text-[var(--text-main)]">
                  Indoor-Testmodus (Standort per Kartenklick setzen)
                </span>
                <span className="text-[11px] text-[var(--text-muted)]">
                  Nur zum Testen im Haus aktivieren – draußen beim echten Spiel auslassen!
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
          )}
        </section>

        {/* SCHRITT 3: BEREITMACHEN & SPIELSTART */}
        <section
          data-testid="lobby-start-section"
          className="cmf-chassis space-y-3.5 p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--cmf-teal)] uppercase">
                SCHRITT 3 // STARTKLAR
              </span>
              <h2 className="font-industrial text-base font-bold text-[var(--text-main)]">
                Bereitmachen &amp; Runde starten
              </h2>
            </div>

            {totalRequiredReady > 0 && (
              <span className="cmf-oled rounded-lg px-2.5 py-1 font-dot text-xs text-[var(--cmf-teal)]">
                SARDINEN BEREIT: {readyCount} / {totalRequiredReady}
              </span>
            )}
          </div>

          {/* Checkliste für den Start */}
          {!canStartOrReady && (
            <div className="cmf-badge-amber rounded-xl p-3 text-xs font-medium space-y-1">
              {requiredHiderMembers.length === 0 && (
                <p>• Mindestens ein Spieler muss „Die Sardinen (Verstecker)“ wählen.</p>
              )}
              {seekerMembers.length === 0 && (
                <p>• Mindestens ein Spieler muss einem Sucher-Team beitreten.</p>
              )}
            </div>
          )}

          {/* Bereit-Button für Verstecker */}
          {!isOverviewAccount && isOwnHider && canStartOrReady && (
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
                  ? `Bereit bestätigt (${readyCount}/${totalRequiredReady}) – Startet automatisch bei Alle-Bereit`
                  : `Ich bin bereit! (${readyCount}/${totalRequiredReady})`}
              </span>
            </button>
          )}

          {/* Status-Info für Sucher / unentschiedene Spieler */}
          {!isOverviewAccount && !isOwnHider && canStartOrReady && (
            <div className="cmf-well flex items-center gap-2.5 p-3 text-xs text-[var(--text-muted)]">
              <Users className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
              <span>
                {ownSelection === 'UNASSIGNED'
                  ? 'Bitte wähle oben zuerst dein Team für diese Runde!'
                  : `Du spielst in „${
                      teamsPublic[ownSelection]?.name ?? ownSelection
                    }“. Das Spiel startet automatisch, sobald alle Sardinen bereit sind (${readyCount}/${totalRequiredReady}) oder der Host startet.`}
              </span>
            </div>
          )}

          {/* Host-Direktstart-Button */}
          {isHost && publicState.status === 'LOBBY' && (
            <button
              type="button"
              data-testid="lobby-host-start-btn"
              disabled={!canStartOrReady || startingRound}
              onClick={() => void handleStartRoundByHost()}
              className="cmf-btn-primary font-dot flex min-h-[50px] w-full items-center justify-center gap-2 px-4 py-3 text-sm font-bold disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              <span>
                {startingRound
                  ? 'Starte Spiel ...'
                  : 'Als Host Spiel jetzt starten'}
              </span>
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
              <span>Neue Runde in der Lobby freigeben</span>
            </button>
          )}
        </section>
      </div>
    </div>
  );
};
