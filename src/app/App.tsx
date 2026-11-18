import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Anchor,
  CheckCircle2,
  Crosshair,
  Sparkles,
  Layers,
  LocateFixed,
  LogOut,
  Maximize2,
  RotateCcw,
  Eye,
  X,
  ChevronDown,
  ChevronUp,
  Users,
  HelpCircle,
} from 'lucide-react';
import {
  ANCHOR_ACCURACY_WARNING_METERS,
  ANCHOR_MANUAL_ADJUST_MAX_METERS,
  buildCustomCirclePlayAreaState,
  buildMunichMultiPlzPolygon,
  clampPlayAreaCircleRadius,
  createDefaultTeams,
  DEFAULT_PLAY_AREA_CIRCLE_CENTER,
  DEFAULT_PLAY_AREA_CIRCLE_RADIUS_METERS,
  formatPostalCodesLabel,
  getActivePostalCodes,
  getMunichPlzEntry,
  getQuestionPenaltyMs,
  getRadiusRadarOptions,
  parseAndValidateMunichPostalCodes,
  PLAY_AREA_CIRCLE_MAX_RADIUS_METERS,
  PLAY_AREA_CIRCLE_MIN_RADIUS_METERS,
  PLAY_AREA_CIRCLE_STEP_METERS,
  QUESTION_CATEGORY_MAP,
  resolveQuestionRulesConfig,
  TEAM_PALETTE,
} from '../config/gameConfig';
import { preloadGreenPolygonsForPostalCode } from '../config/fallbackOsm81247';
import {
  getPlayerGreeting,
  isAdminAccountId,
  isOverviewMember,
} from '../config/players';
import {
  findMunichPlzAtPoint,
  isPointInMunichPlz,
  isPointInPlayArea,
  snapPointIntoMunichPlz,
  validateManualAnchorSelection,
} from '../geo/boundary';
import { distanceMeters } from '../geo/distance';
import { useAuth } from '../hooks/useAuth';
import {
  lockHiderAnchorAndGenerateRadar,
  useControllerEngine,
} from '../hooks/useControllerEngine';
import { useGameState } from '../hooks/useGameState';
import { useGameTimer } from '../hooks/useGameTimer';
import { useGeolocation } from '../hooks/useGeolocation';
import { useWakeLock } from '../hooks/useWakeLock';
import {
  buildReadyToken,
  deduplicateEnabledMembers,
  resolveVisibleTeamMemberMarkers,
} from '../services/databaseAdapter';
import {
  generateRandomId,
  generateSessionSecrets,
} from '../services/qrService';
import {
  applyPowerSaveAttributeToDom,
  createEmptyPlayerStats,
  dispatchSystemNotification,
  loadDevicePreferences,
  loadLocalPlayerStats,
  mergePlayerStats,
  playFeedbackSound,
  saveDevicePreferences,
  saveLocalPlayerStats,
  triggerFeedbackVibration,
  type PlayerDevicePreferences,
} from '../services/playerPreferencesService';
import type {
  BottomNavTab,
  ClueRecord,
  ClueRequest,
  LatLng,
  MemberRecord,
  PlayerAllTimeStats,
  PlayerSide,
  QuestionParams,
  QuestionType,
  RadiusOptionMeters,
} from '../types/game';
import {
  formatCompassDirectionDe,
  getQuestionLabelDe,
} from '../utils/formatting';
import { EmergencyMessageBanner } from '../components/Common/EmergencyMessageBanner';
import { HardwareKnob } from '../components/Common/HardwareKnob';
import { PhysicsBottomSheet } from '../components/Common/PhysicsBottomSheet';
import { StatusBanners } from '../components/Common/StatusBanners';
import { LeashWarningBanner } from '../components/HUD/LeashWarningBanner';
import { TopHud } from '../components/HUD/TopHud';
import { LeaderboardView } from '../components/Leaderboard/LeaderboardView';
import { HostControlPanel } from '../components/Lobby/HostControlPanel';
import { GameHubScreen } from '../components/Lobby/GameHubScreen';
import { LateJoinTeamPicker } from '../components/Lobby/LateJoinTeamPicker';
import { LobbyScreen } from '../components/Lobby/LobbyScreen';
import { LoginScreen } from '../components/Lobby/LobbyView';
import {
  GameMap,
  type GameMapActions,
  type MapClickInteractionMode,
} from '../components/Map/GameMap';
import { resolveActiveMapBottomSlotKind } from '../components/Map/mapHudMutex';
import { BottomNav } from '../components/Navigation/BottomNav';
import { ProfileView } from '../components/Profile/ProfileView';
import { HiderQrView } from '../components/QR/HiderQrModal';
import { SeekerScannerView } from '../components/QR/SeekerScannerModal';
import { HiderMediaResponseModal } from '../components/Questions/HiderMediaResponseModal';
import { QuestionMenu } from '../components/Questions/QuestionMenu';

export const App: React.FC = () => {
  const {
    adapter,
    firebaseAvailable,
    authUser,
    authLoading,
    isSessionUnlocked,
    accountSession,
    activeRoomCode,
    recentRooms,
    roomBusy,
    roomError,
    clearRoomError,
    hostNewGame,
    joinGameByCode,
    leaveCurrentRoom,
    ownMember,
    memberLoading,
    seatConflictError,
    loginError,
    clearLoginError,
    loginWithCredentials,
    registerWithCredentials,
    applyOptimisticMemberPatch,
    exitOrLogout,
  } = useAuth();

  const [devicePrefs, setDevicePrefs] = useState<PlayerDevicePreferences>(() =>
    loadDevicePreferences()
  );

  useEffect(() => {
    applyPowerSaveAttributeToDom(devicePrefs.powerSaveMode);
  }, [devicePrefs.powerSaveMode]);

  const handleChangeDevicePrefs = (next: PlayerDevicePreferences) => {
    setDevicePrefs(next);
    saveDevicePreferences(next);
  };

  const gameState = useGameState(adapter, ownMember, activeRoomCode);
  const { publicState, hiderPrivate } = gameState;

  const timer = useGameTimer(adapter, publicState);

  const ownTeam = useMemo(() => {
    if (!ownMember?.teamId) return null;
    return gameState.teamsPublic[ownMember.teamId] ?? null;
  }, [ownMember?.teamId, gameState.teamsPublic]);

  const ownTeamStoredLoc = useMemo(() => {
    if (!ownMember?.teamId) return null;
    return gameState.teamLocations[ownMember.teamId] ?? null;
  }, [ownMember?.teamId, gameState.teamLocations]);

  const geo = useGeolocation({
    adapter,
    ownMember,
    ownTeam,
    ownTeamStoredLocation: ownTeamStoredLoc,
    publicState,
    anchorPoint: hiderPrivate?.anchorPoint ?? null,
    powerSaveMode: devicePrefs.powerSaveMode,
  });

  const controllerStatus = useControllerEngine({
    adapter,
    ownMember,
    publicState,
    controllerLease: gameState.controllerLease,
    hiderPrivate,
    teamsPublic: gameState.teamsPublic,
    teamLocations: gameState.teamLocations,
    requestsByTeam: gameState.requestsByTeam,
    catchRequests: gameState.catchRequests,
    ownGeoFix: geo.currentFix,
  });

  // Hält das Display während Lobby & laufendem Spiel zuverlässig an!
  const shouldKeepScreenAwake = Boolean(
    authUser && isSessionUnlocked && ownMember?.enabled
  );
  useWakeLock(shouldKeepScreenAwake);

  // UI-Navigation & lokale Karten-Interaktionszustände
  const [activeTab, setActiveTab] = useState<BottomNavTab>('LOBBY');
  const [hiddenClueIds, setHiddenClueIds] = useState<Set<string>>(new Set());
  const [thermoPointA, setThermoPointA] = useState<LatLng | null>(null);
  const [coneBearingDeg, setConeBearingDeg] = useState<number>(0);
  const [selectedRadius, setSelectedRadius] = useState<RadiusOptionMeters>(250);
  const [activePreviewQuestion, setActivePreviewQuestion] =
    useState<QuestionType | null>(null);
  const [mapClickMode, setMapClickMode] = useState<MapClickInteractionMode>({
    kind: 'NONE',
  });
  const [fineAdjustAnchorPt, setFineAdjustAnchorPt] = useState<LatLng | null>(
    null
  );
  const [isRehidingAnchor, setIsRehidingAnchor] = useState<boolean>(false);
  const [anchorFeedbackError, setAnchorFeedbackError] = useState<string | null>(
    null
  );
  const [hiderAnchorCollapsed, setHiderAnchorCollapsed] = useState(false);
  const [hiderFilterTeamId, setHiderFilterTeamId] = useState<string>('NONE');
  const [circlePickError, setCirclePickError] = useState<string | null>(null);
  const [circleEditorCollapsed, setCircleEditorCollapsed] = useState(false);
  const [showMapLegend, setShowMapLegend] = useState(false);
  const [buyingPreviewClue, setBuyingPreviewClue] = useState(false);
  const mapActionsRef = useRef<GameMapActions | null>(null);
  const [memberMarkerClockMs, setMemberMarkerClockMs] = useState<number>(() =>
    adapter.getServerNow()
  );
  const autoSubmittingThermoRef = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setMemberMarkerClockMs(adapter.getServerNow());
    }, 15_000);
    return () => window.clearInterval(id);
  }, [adapter]);

  const latestPublicStateRef = useRef(publicState);
  latestPublicStateRef.current = publicState;

  useEffect(() => {
    if (activeTab !== 'MAP' && mapClickMode.kind === 'PICK_PLAY_AREA_CIRCLE') {
      setMapClickMode({ kind: 'NONE' });
      setCirclePickError(null);
    }
  }, [activeTab, mapClickMode.kind]);

  useEffect(() => {
    setHiderFilterTeamId('NONE');
    setHiddenClueIds(new Set());
    setThermoPointA(null);
  }, [publicState?.sessionId]);

  const hostRadiusDefault = resolveQuestionRulesConfig(
    publicState?.questionConfig
  ).radiusRadarDistanceMeters;
  useEffect(() => {
    setSelectedRadius(hostRadiusDefault);
  }, [hostRadiusDefault]);

  // Thermometer stoppt automatisch, sobald die Mindestdistanz ab Startpunkt A zurückgelegt wurde
  useEffect(() => {
    if (
      !thermoPointA ||
      !geo.currentFix ||
      !publicState ||
      publicState.status !== 'RUNNING' ||
      publicState.currentPhase === 'HIDING' ||
      !ownMember ||
      ownMember.side !== 'SEEKER' ||
      !ownTeam ||
      ownTeam.status !== 'ACTIVE' ||
      autoSubmittingThermoRef.current
    ) {
      return;
    }

    const qConfig = resolveQuestionRulesConfig(publicState.questionConfig);
    const targetThermoMeters = qConfig.thermometerDistanceMeters;
    const endPt: LatLng = {
      lat: geo.currentFix.lat,
      lng: geo.currentFix.lng,
    };
    const walkedMeters = distanceMeters(thermoPointA, endPt);
    if (walkedMeters < targetThermoMeters) {
      return;
    }

    const startPt = thermoPointA;
    autoSubmittingThermoRef.current = true;
    setThermoPointA(null);
    if (activePreviewQuestion === 'THERMOMETER') {
      setActivePreviewQuestion(null);
    }

    const penaltyMs = getQuestionPenaltyMs(
      'THERMOMETER',
      publicState.classicSearchDurationMs,
      publicState.questionConfig
    );
    const req: ClueRequest = {
      id: generateRandomId('req'),
      teamId: ownTeam.id,
      requestedByUid: ownMember.uid,
      sessionId: publicState.sessionId,
      questionType: 'THERMOMETER',
      category: QUESTION_CATEGORY_MAP.THERMOMETER,
      params: {
        pointA: startPt,
        pointB: endPt,
        thermometerDistanceMeters: targetThermoMeters,
      },
      status: 'PENDING',
      penaltyMs,
      penaltyApplied: false,
      refundedMs: 0,
      createdAt: adapter.getServerNow(),
      requesterSnapshotLocation: {
        lat: geo.currentFix.lat,
        lng: geo.currentFix.lng,
        accuracy: Math.round(geo.currentFix.accuracy),
      },
    };

    void adapter.createClueRequest(req).finally(() => {
      autoSubmittingThermoRef.current = false;
    });
  }, [
    adapter,
    activePreviewQuestion,
    geo.currentFix,
    ownMember,
    ownTeam,
    publicState,
    thermoPointA,
  ]);

  useEffect(() => {
    if (publicState?.gameMode === 'MANHUNT') {
      if (activeTab === 'QUESTIONS') {
        setActiveTab('MAP');
      }
      if (activePreviewQuestion !== null) {
        setActivePreviewQuestion(null);
      }
    }
  }, [publicState?.gameMode, activeTab, activePreviewQuestion]);

  const prevStatusAndRoomRef = useRef<{
    roomCode: string | null;
    status: string | null;
  }>({
    roomCode: null,
    status: null,
  });

  useEffect(() => {
    if (!activeRoomCode) {
      prevStatusAndRoomRef.current = {
        roomCode: null,
        status: null,
      };
      return;
    }
    if (!publicState) {
      return;
    }
    const prev = prevStatusAndRoomRef.current;
    const roomChanged = prev.roomCode !== activeRoomCode;
    const statusChanged = prev.status !== publicState.status;
    prevStatusAndRoomRef.current = {
      roomCode: activeRoomCode,
      status: publicState.status,
    };

    const isOverview = Boolean(ownMember && isOverviewMember(ownMember));

    if (roomChanged) {
      if (isOverview) {
        setActiveTab('HOST');
      } else {
        setActiveTab(publicState.status === 'LOBBY' ? 'LOBBY' : 'MAP');
      }
      return;
    }

    if (statusChanged) {
      if (publicState.status === 'LOBBY') {
        if (!(isOverview && activeTab === 'HOST')) {
          setActiveTab('LOBBY');
        }
        return;
      }
      if (
        publicState.status === 'RUNNING' &&
        (prev.status === 'LOBBY' || prev.status === 'FINISHED')
      ) {
        if (!(isOverview && activeTab === 'HOST')) {
          setActiveTab('MAP');
        }
        return;
      }
    }

    if (
      activeTab === 'LOBBY' &&
      publicState.status !== 'LOBBY' &&
      publicState.status !== 'FINISHED'
    ) {
      setActiveTab('MAP');
    }
  }, [activeRoomCode, publicState?.status, activeTab, publicState, ownMember]);

  useEffect(() => {
    if (activeTab === 'HOST' && ownMember && !isOverviewMember(ownMember)) {
      setActiveTab(publicState?.status === 'LOBBY' ? 'LOBBY' : 'MAP');
    }
  }, [activeTab, ownMember, publicState?.status]);

  // Registriert den aktuell aktiven Spielraum automatisch im zentralen Raumverzeichnis (für die Admin-Gesamtübersicht & 24h-Aktivitätszeitstempel)
  useEffect(() => {
    if (!publicState || !ownMember?.enabled) return;
    void adapter.syncRoomDirectoryEntry(publicState);
    const id = window.setInterval(() => {
      const latest = latestPublicStateRef.current;
      if (latest) {
        void adapter.syncRoomDirectoryEntry(latest);
      }
    }, 120_000);
    return () => window.clearInterval(id);
  }, [
    adapter,
    ownMember?.enabled,
    publicState?.roomCode,
    publicState?.status,
    publicState?.currentPhase,
    publicState?.gameMode,
    publicState?.playArea?.name,
    publicState?.hostPlayerId,
    publicState?.hostName,
    publicState,
  ]);

  const activePostalCodes = getActivePostalCodes(publicState?.playArea);
  const activePostalCode = activePostalCodes[0];
  const activePostalCodesLabel = formatPostalCodesLabel(activePostalCodes);
  const activePlzEntry = getMunichPlzEntry(activePostalCode);
  const activePlzBoundary = useMemo(
    () => buildMunichMultiPlzPolygon(activePostalCodes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePostalCodesLabel]
  );

  const [mapCirclePlzInput, setMapCirclePlzInput] = useState(
    activePostalCodesLabel
  );
  useEffect(() => {
    setMapCirclePlzInput(activePostalCodesLabel);
  }, [activePostalCodesLabel]);

  useEffect(() => {
    if (activePostalCodes.length <= 8) {
      for (const code of activePostalCodes) {
        void preloadGreenPolygonsForPostalCode(code);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePostalCodesLabel]);

  const [emergencyFocusTarget, setEmergencyFocusTarget] = useState<{
    lat: number;
    lng: number;
    seq: number;
  } | null>(null);

  const ownEmergencyMessage = useMemo(
    () =>
      ownMember
        ? (gameState.emergencyMessages.find((m) => m.uid === ownMember.uid) ??
          null)
        : null,
    [gameState.emergencyMessages, ownMember]
  );

  // Aktualisiert automatisch den Standort einer eigenen aktiven Notfallnachricht, sobald ein GPS-Fix vorliegt oder sich bewegt
  useEffect(() => {
    if (!ownMember || !ownEmergencyMessage || !geo.currentFix) return;
    const prevLat = ownEmergencyMessage.lat;
    const prevLng = ownEmergencyMessage.lng;
    const nextLat = geo.currentFix.lat;
    const nextLng = geo.currentFix.lng;
    const needsCoordUpdate =
      typeof prevLat !== 'number' ||
      typeof prevLng !== 'number' ||
      Math.abs(prevLat - nextLat) > 0.00008 ||
      Math.abs(prevLng - nextLng) > 0.00008;

    if (!needsCoordUpdate) return;

    void adapter
      .sendEmergencyMessage({
        uid: ownMember.uid,
        playerId: ownMember.playerId,
        senderName: ownMember.name,
        text: ownEmergencyMessage.text,
        createdAt: ownEmergencyMessage.createdAt || adapter.getServerNow(),
        lat: nextLat,
        lng: nextLng,
        accuracy: geo.currentFix.accuracy,
      })
      .catch(() => {});
  }, [adapter, geo.currentFix, ownEmergencyMessage, ownMember]);

  // All-Time Stats laden, mit Server synchronisieren & live fortschreiben
  const [playerStats, setPlayerStats] = useState<PlayerAllTimeStats>(() =>
    createEmptyPlayerStats()
  );
  const lastWalkedFixRef = useRef<LatLng | null>(null);
  const lastClueCountTrackedRef = useRef<{ sessionId: string; count: number }>({
    sessionId: '',
    count: 0,
  });

  useEffect(() => {
    if (!ownMember?.playerId) {
      setPlayerStats(createEmptyPlayerStats());
      lastWalkedFixRef.current = null;
      return;
    }
    const pid = ownMember.playerId;
    const local = loadLocalPlayerStats(pid);
    setPlayerStats(local);
    let cancelled = false;
    void adapter.fetchAccountProfile(pid).then((acct) => {
      if (cancelled || !acct) return;
      if (acct.avatar && !ownMember.avatar) {
        applyOptimisticMemberPatch({ avatar: acct.avatar });
        void adapter
          .updateMember(ownMember.uid, {
            ...ownMember,
            avatar: acct.avatar,
          })
          .catch(() => {});
      }
      if (acct.stats) {
        setPlayerStats((prev) => {
          const merged = mergePlayerStats(prev, acct.stats);
          saveLocalPlayerStats(pid, merged);
          return merged;
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, ownMember?.playerId]);

  // Runden-Teilnahme, Fänge, Bestzeit, Überlebenszeit & Hinweise fortschreiben
  useEffect(() => {
    if (!ownMember?.playerId || !publicState) return;
    if (isOverviewMember(ownMember)) return;
    const pid = ownMember.playerId;
    const sessionId = publicState.sessionId;
    const isRunningOrFinished =
      publicState.status === 'RUNNING' ||
      publicState.status === 'PAUSED' ||
      publicState.status === 'FINISHED';
    if (!isRunningOrFinished) return;

    setPlayerStats((prev) => {
      let changed = false;
      const next: PlayerAllTimeStats = {
        ...prev,
        participatedSessionIds: [...(prev.participatedSessionIds ?? [])],
        caughtSessionIds: [...(prev.caughtSessionIds ?? [])],
      };

      if (
        ownMember.side !== 'UNASSIGNED' &&
        !next.participatedSessionIds!.includes(sessionId)
      ) {
        next.participatedSessionIds!.push(sessionId);
        next.roundsPlayed += 1;
        if (ownMember.side === 'HIDER') {
          next.roundsAsHider += 1;
        }
        changed = true;
      }

      if (
        ownMember.side === 'HIDER' &&
        timer.netElapsedMs > next.longestHiderTimeMs + 15_000
      ) {
        next.longestHiderTimeMs = Math.round(timer.netElapsedMs);
        changed = true;
      }

      if (
        ownMember.side === 'SEEKER' &&
        ownTeam &&
        ownTeam.status === 'JOINED_SARDINES' &&
        !next.caughtSessionIds!.includes(sessionId)
      ) {
        next.caughtSessionIds!.push(sessionId);
        next.catchesAsSeeker += 1;
        const lbEntry = gameState.leaderboard[ownTeam.id];
        if (lbEntry && lbEntry.totalTimeMs > 0) {
          next.bestSearchTimeMs =
            next.bestSearchTimeMs === null
              ? lbEntry.totalTimeMs
              : Math.min(next.bestSearchTimeMs, lbEntry.totalTimeMs);
        }
        changed = true;
      }

      if (ownMember.side === 'SEEKER' && ownTeam) {
        if (lastClueCountTrackedRef.current.sessionId !== sessionId) {
          lastClueCountTrackedRef.current = {
            sessionId,
            count: ownTeam.clueCount,
          };
        } else if (ownTeam.clueCount > lastClueCountTrackedRef.current.count) {
          const diff =
            ownTeam.clueCount - lastClueCountTrackedRef.current.count;
          lastClueCountTrackedRef.current.count = ownTeam.clueCount;
          next.cluesBought += diff;
          changed = true;
        }
      }

      if (!changed) return prev;
      saveLocalPlayerStats(pid, next);
      void adapter.updateAccountProfile(pid, { stats: next });
      return next;
    });
  }, [
    adapter,
    gameState.leaderboard,
    ownMember,
    ownTeam,
    publicState,
    timer.netElapsedMs,
  ]);

  // Gelaufene GPS-Strecke während aktiver Runden aufzeichnen
  useEffect(() => {
    if (
      !ownMember?.playerId ||
      isOverviewMember(ownMember) ||
      !publicState ||
      publicState.status !== 'RUNNING' ||
      !geo.currentFix
    ) {
      lastWalkedFixRef.current = null;
      return;
    }
    const curPt: LatLng = {
      lat: geo.currentFix.lat,
      lng: geo.currentFix.lng,
    };
    const prevPt = lastWalkedFixRef.current;
    if (!prevPt) {
      lastWalkedFixRef.current = curPt;
      return;
    }
    const stepMeters = distanceMeters(prevPt, curPt);
    // Ignoriere GPS-Grundrauschen (< 6 m) und unplausible Sprünge (> 250 m)
    if (stepMeters >= 6 && stepMeters <= 250) {
      lastWalkedFixRef.current = curPt;
      const pid = ownMember.playerId;
      setPlayerStats((prev) => {
        const next: PlayerAllTimeStats = {
          ...prev,
          totalDistanceMeters: Math.round(
            prev.totalDistanceMeters + stepMeters
          ),
        };
        saveLocalPlayerStats(pid, next);
        return next;
      });
    }
  }, [geo.currentFix, ownMember, publicState]);

  // Ton-, Vibrations- & System-Benachrichtigungen bei wichtigen Spiel-Ereignissen
  const prevFeedbackSnapshotRef = useRef<{
    status: string | null;
    phase: string | null;
    radarKey: string | null;
    emergencyCount: number;
    leashWarn: boolean;
  }>({
    status: null,
    phase: null,
    radarKey: null,
    emergencyCount: 0,
    leashWarn: false,
  });

  useEffect(() => {
    if (!ownMember?.enabled || !publicState) return;
    const prev = prevFeedbackSnapshotRef.current;
    const curStatus = publicState.status;
    const curPhase = timer.computedPhase;
    const curRadarKey = publicState.radarCircle
      ? `${publicState.radarCircle.stage}_${publicState.radarCircle.radiusMeters}_${publicState.radarCircle.lastPing?.pingNumber ?? 0}`
      : null;
    const curEmergencyCount = gameState.emergencyMessages.length;
    const curLeashWarn = Boolean(geo.leashState.warningActive);

    if (prev.status !== null) {
      if (prev.status === 'LOBBY' && curStatus === 'RUNNING') {
        playFeedbackSound('START', devicePrefs);
        triggerFeedbackVibration('DOUBLE', devicePrefs);
        dispatchSystemNotification(
          '81247 Sardinen gestartet!',
          'Die Runde läuft jetzt. Viel Erfolg!',
          devicePrefs
        );
      } else if (prev.phase === 'HIDING' && curPhase === 'OPEN_SEARCH') {
        playFeedbackSound('START', devicePrefs);
        triggerFeedbackVibration('DOUBLE', devicePrefs);
        dispatchSystemNotification(
          'Offene Suche gestartet!',
          'Die Versteckzeit ist vorbei – die Suche beginnt!',
          devicePrefs
        );
      }

      if (curRadarKey && curRadarKey !== prev.radarKey) {
        playFeedbackSound('RADAR', devicePrefs);
        triggerFeedbackVibration('DOUBLE', devicePrefs);
        dispatchSystemNotification(
          'Neues Radar-Update!',
          `Aktiver Suchkreis: ${publicState.radarCircle?.radiusMeters ?? ''} m`,
          devicePrefs
        );
      }

      if (curEmergencyCount > prev.emergencyCount) {
        playFeedbackSound('ALERT', devicePrefs);
        triggerFeedbackVibration('ALARM', devicePrefs);
        const newest =
          gameState.emergencyMessages[gameState.emergencyMessages.length - 1];
        if (newest) {
          dispatchSystemNotification(
            `Notfall-Meldung von ${newest.senderName}`,
            newest.text,
            devicePrefs
          );
        }
      } else if (curLeashWarn && !prev.leashWarn) {
        playFeedbackSound('ALERT', devicePrefs);
        triggerFeedbackVibration('ALARM', devicePrefs);
      }
    }

    prevFeedbackSnapshotRef.current = {
      status: curStatus,
      phase: curPhase,
      radarKey: curRadarKey,
      emergencyCount: curEmergencyCount,
      leashWarn: curLeashWarn,
    };
  }, [
    devicePrefs,
    gameState.emergencyMessages,
    geo.leashState.warningActive,
    ownMember?.enabled,
    publicState,
    timer.computedPhase,
  ]);

  // 1. Lade- & Authentifizierungs-Weichen
  if (
    authLoading ||
    (isSessionUnlocked && Boolean(activeRoomCode) && memberLoading)
  ) {
    return (
      <div className="cmf-drafting-bg flex h-[100dvh] items-center justify-center p-4">
        <div className="cmf-oled flex items-center gap-3 px-4 py-3 shadow-xl">
          <img
            src="/logo.png"
            alt="81247 Sardinen Logo"
            className="h-10 w-10 shrink-0 rounded-lg bg-black object-contain"
          />
          <span className="nothing-red-dot" />
          <span className="font-dot text-sm text-[#F8FAFC]">
            81247 SARDINEN WIRD GELADEN ...
          </span>
        </div>
      </div>
    );
  }

  if (!authUser || !isSessionUnlocked || !accountSession) {
    return (
      <LoginScreen
        firebaseAvailable={firebaseAvailable}
        loginError={loginError}
        onClearError={clearLoginError}
        onLogin={loginWithCredentials}
        onRegister={registerWithCredentials}
      />
    );
  }

  const handleLeaveRoom = async () => {
    setActiveTab('LOBBY');
    setMapClickMode({ kind: 'NONE' });
    setActivePreviewQuestion(null);
    await leaveCurrentRoom();
  };

  if (!activeRoomCode) {
    return (
      <GameHubScreen
        adapter={adapter}
        account={accountSession}
        firebaseAvailable={firebaseAvailable}
        recentRooms={recentRooms}
        busy={roomBusy}
        roomError={roomError}
        onClearError={clearRoomError}
        onHostNewGame={async () => {
          const createdCode = await hostNewGame();
          if (createdCode) {
            setActiveTab(
              isAdminAccountId(accountSession.playerId) ? 'HOST' : 'LOBBY'
            );
          }
        }}
        onJoinByCode={async (code) => {
          const ok = await joinGameByCode(code);
          if (ok) {
            setActiveTab(
              isAdminAccountId(accountSession.playerId) ? 'HOST' : 'LOBBY'
            );
          }
        }}
        onLogout={exitOrLogout}
      />
    );
  }

  // Schutz gegen doppelte Nutzung desselben Namens auf einem anderen Gerät
  if (seatConflictError) {
    return (
      <div className="cmf-drafting-bg flex h-[100dvh] flex-col items-center justify-center p-6 text-center text-[var(--text-main)]">
        <div className="cmf-chassis w-full max-w-md space-y-4 p-6">
          <div className="cmf-oled mx-auto flex h-12 w-12 items-center justify-center text-[var(--cmf-amber)]">
            <Layers className="h-6 w-6" />
          </div>
          <h1 className="font-dot text-lg text-[var(--text-main)]">
            Konto bereits aktiv
          </h1>
          <p className="text-xs leading-relaxed text-[var(--text-muted)]">
            {seatConflictError}
          </p>
          <button
            type="button"
            onClick={() => void exitOrLogout()}
            className="cmf-btn-secondary font-tech inline-flex min-h-[46px] w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold uppercase"
          >
            <LogOut className="h-4 w-4" />
            Abmelden / Konto wechseln
          </button>
        </div>
      </div>
    );
  }

  if (!ownMember || !ownMember.enabled) {
    return (
      <div className="cmf-drafting-bg flex h-[100dvh] w-full flex-col items-center justify-center overflow-y-auto p-4 text-[var(--text-main)]">
        <div className="cmf-chassis w-full max-w-lg space-y-4 p-6">
          <div className="flex items-center gap-3">
            <div className="cmf-oled flex h-12 w-12 shrink-0 items-center justify-center text-[var(--cmf-amber)]">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <h1 className="font-industrial text-lg text-[var(--text-main)]">
                Verbinde Spielerkonto ...
              </h1>
              <p className="text-xs text-[var(--text-muted)]">
                Bitte melde dich erneut mit deinem Kontonamen und Passwort an.
              </p>
            </div>
          </div>

          {loginError && (
            <div className="cmf-badge-orange rounded-xl p-3 text-xs font-semibold">
              {loginError}
            </div>
          )}

          <button
            type="button"
            onClick={() => void exitOrLogout()}
            className="cmf-btn-secondary font-tech inline-flex min-h-[46px] w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold uppercase"
          >
            <LogOut className="h-4 w-4" />
            Zurück zur Anmeldung
          </button>
        </div>
      </div>
    );
  }

  if (!publicState) {
    return (
      <div className="cmf-drafting-bg flex h-[100dvh] flex-col overflow-hidden text-sm text-[var(--text-main)]">
        <header className="border-b-[1.5px] border-[var(--shell-border)] bg-[var(--shell-bg)] pt-[max(0.45rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-2 pl-[max(0.75rem,env(safe-area-inset-left))] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-[18px]">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
            <div className="cmf-oled flex items-center gap-2 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--cmf-amber)]" />
              <span className="font-dot text-xs text-[#F8FAFC]">
                81247 SARDINEN // INITIALISIERUNG
              </span>
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="cmf-chassis w-full max-w-md space-y-4 p-6">
            <p className="font-industrial text-base text-[var(--text-main)]">
              {getPlayerGreeting(ownMember)} Die Lobby wurde noch nicht initialisiert.
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {ownMember.isHost
                ? 'Der Spielraum wird automatisch vorbereitet ...'
                : 'Bitte melde dich einmal mit dem Konto „admin“ an, um den Spielraum initial zu starten.'}
            </p>
            <div className="mt-2 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void handleLeaveRoom()}
                className="cmf-btn-primary font-dot w-full py-2.5 text-xs font-bold uppercase"
              >
                Anderen Spielraum wählen
              </button>
              <button
                type="button"
                onClick={() => void exitOrLogout()}
                className="cmf-btn-secondary font-tech w-full py-2.5 text-xs font-bold uppercase"
              >
                Abmelden / Konto wechseln
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isJoinedSardines = ownTeam?.status === 'JOINED_SARDINES';
  const isOverviewAccount = isOverviewMember(ownMember);
  const isRoomHost = Boolean(
    ownMember.isHost ||
      isOverviewAccount ||
      (publicState.hostPlayerId &&
        publicState.hostPlayerId === ownMember.playerId)
  );
  const isSardineDashboardView =
    ownMember.side === 'HIDER' || isJoinedSardines;
  const isOverviewOrSardineDashboard =
    isSardineDashboardView || isOverviewAccount;
  const isActiveSeeker = Boolean(
    ownMember.side === 'SEEKER' && ownTeam && !isJoinedSardines
  );
  const canUseMapClicks = Boolean(isOverviewAccount);
  const showHostTab = isOverviewAccount;

  const activeRoundTeamIds =
    publicState.status === 'LOBBY'
      ? undefined
      : Array.from(
          new Set([
            ...(publicState.activeTeamIds ?? []),
            ...Object.values(gameState.teamsPublic)
              .filter((t) => t.memberPlayerIds.length > 0)
              .map((t) => t.id),
          ])
        );

  // Alle aktuellen Mitglieder der Verstecker-Gruppe (originale Hider + komplette Teams, die den Code gescannt haben)
  const sardineGroupMemberNames = deduplicateEnabledMembers(
    gameState.members,
    gameState.presence
  )
    .filter(
      (m) =>
        m.side === 'HIDER' ||
        (m.side === 'SEEKER' &&
          Boolean(m.teamId) &&
          gameState.teamsPublic[m.teamId!]?.status === 'JOINED_SARDINES')
    )
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b, 'de'));

  const activeRoundSet = activeRoundTeamIds
    ? new Set(activeRoundTeamIds)
    : null;
  const roundSeekerTeamsForFilter = TEAM_PALETTE.map((p) => {
    const pub = gameState.teamsPublic[p.id];
    const teamCluesList = Object.values(gameState.cluesByTeam[p.id] ?? {}).filter(
      (c) => c.sessionId === publicState.sessionId
    );
    return {
      id: p.id,
      name: pub?.name ?? p.name,
      color: pub?.color ?? p.color,
      status: pub?.status ?? 'ACTIVE',
      memberCount: pub?.memberPlayerIds.length ?? 0,
      clues: teamCluesList,
    };
  }).filter(
    (t) =>
      t.memberCount > 0 ||
      t.clues.length > 0 ||
      (activeRoundSet ? activeRoundSet.has(t.id) : false)
  );

  // Strikt gruppen-individuelle Hinweise für aktive Sucher-Teams;
  // Verstecker & gefundene Sardinen-Teams können gezielt nach einzelnen Teams filtern!
  const visibleMapClues: ClueRecord[] =
    isActiveSeeker && ownTeam
      ? Object.values(gameState.cluesByTeam[ownTeam.id] ?? {}).filter(
          (c) => c.sessionId === publicState.sessionId
        )
      : hiderFilterTeamId === 'NONE'
        ? []
        : hiderFilterTeamId === 'ALL'
          ? roundSeekerTeamsForFilter.flatMap((t) => t.clues)
          : (roundSeekerTeamsForFilter.find((t) => t.id === hiderFilterTeamId)
              ?.clues ?? []);

  const seekerOwnTeamCluesMap: Record<string, ClueRecord> =
    isActiveSeeker && ownTeam
      ? Object.fromEntries(
          Object.entries(gameState.cluesByTeam[ownTeam.id] ?? {}).filter(
            ([, c]) => c.sessionId === publicState.sessionId
          )
        )
      : {};

  const visibleRequestsMap: Record<string, ClueRequest> =
    isActiveSeeker && ownTeam
      ? (gameState.requestsByTeam[ownTeam.id] ?? {})
      : Object.assign({}, ...Object.values(gameState.requestsByTeam));

  const visibleMapTeamLocations =
    isActiveSeeker && ownTeam
      ? { [ownTeam.id]: gameState.teamLocations[ownTeam.id] ?? null }
      : gameState.teamLocations;

  const visibleTeamMemberMarkers =
    publicState.status === 'LOBBY'
      ? []
      : resolveVisibleTeamMemberMarkers({
          visibleTeamLocations: visibleMapTeamLocations,
          teamsPublic: gameState.teamsPublic,
          members: gameState.members,
          presence: gameState.presence,
          activeTeamIds: activeRoundTeamIds,
          ownMember,
          ownFix: geo.currentFix,
          nowMs: Math.max(memberMarkerClockMs, adapter.getServerNow()),
        });

  const exposedHiderLocation =
    gameState.activeLeashViolation &&
    typeof gameState.activeLeashViolation.exposedLat === 'number' &&
    typeof gameState.activeLeashViolation.exposedLng === 'number'
      ? {
          lat: gameState.activeLeashViolation.exposedLat,
          lng: gameState.activeLeashViolation.exposedLng,
          accuracy: gameState.activeLeashViolation.exposedAccuracy,
        }
      : null;

  const liveHiderLocations =
    isOverviewAccount && hiderPrivate?.hiderLocations
      ? Object.fromEntries(
          Object.entries(hiderPrivate.hiderLocations)
            .filter(
              ([uidKey, fix]) =>
                Boolean(fix) &&
                uidKey !== ownMember.uid &&
                Number.isFinite(fix.lat) &&
                Number.isFinite(fix.lng)
            )
            .map(([uidKey, fix]) => [
              uidKey,
              {
                lat: fix.lat,
                lng: fix.lng,
                accuracy: fix.accuracy,
                label: gameState.members[uidKey]?.name ?? 'Verstecker',
              },
            ])
        )
      : undefined;

  const openHiderMediaRequests: ClueRequest[] =
    isSardineDashboardView || isOverviewAccount
      ? Object.values(gameState.requestsByTeam)
          .flatMap((m) => Object.values(m))
          .filter(
            (r) =>
              r.sessionId === publicState.sessionId &&
              r.status === 'AWAITING_HIDER_MEDIA'
          )
      : [];

  const currentCircleCenter =
    publicState.playArea.circle?.center ??
    activePlzEntry.center ??
    DEFAULT_PLAY_AREA_CIRCLE_CENTER;
  const currentCircleRadius = clampPlayAreaCircleRadius(
    publicState.playArea.circle?.radiusMeters ??
      DEFAULT_PLAY_AREA_CIRCLE_RADIUS_METERS
  );

  const updateCirclePlayArea = async (
    nextCenter: LatLng,
    nextRadiusMeters: number,
    explicitPostalCodes?: string | readonly string[]
  ) => {
    const latestPublic = latestPublicStateRef.current;
    if (!isRoomHost || !latestPublic) return;
    const basePlzList = explicitPostalCodes
      ? parseAndValidateMunichPostalCodes(explicitPostalCodes).validCodes
      : getActivePostalCodes(latestPublic.playArea);
    const activeCodes =
      basePlzList.length > 0
        ? basePlzList
        : getActivePostalCodes(latestPublic.playArea);
    const inCurrent = isPointInMunichPlz(nextCenter, activeCodes);
    const detectedSingle = inCurrent
      ? null
      : findMunichPlzAtPoint(nextCenter);
    const targetCodes =
      inCurrent || !detectedSingle ? activeCodes : [detectedSingle];
    const snappedCenter = snapPointIntoMunichPlz(nextCenter, targetCodes);
    if (targetCodes.length <= 8) {
      for (const code of targetCodes) {
        void preloadGreenPolygonsForPostalCode(code);
      }
    }
    await adapter
      .savePublicStateByHost({
        ...latestPublic,
        playArea: buildCustomCirclePlayAreaState({
          center: snappedCenter,
          radiusMeters: nextRadiusMeters,
          confirmedByUid: ownMember.uid,
          nowMs: adapter.getServerNow(),
          postalCode: targetCodes[0],
          postalCodes: targetCodes,
        }),
      })
      .catch(() => {});
  };

  const handleMapCoordinateClick = (pt: LatLng) => {
    if (mapClickMode.kind === 'PICK_PLAY_AREA_CIRCLE') {
      if (!isRoomHost) return;
      const inCurrentPlz = isPointInMunichPlz(pt, activePostalCodes);
      const detectedPlz = inCurrentPlz
        ? activePostalCodes
        : findMunichPlzAtPoint(pt);
      if (!detectedPlz) {
        setCirclePickError(
          `Der Kreismittelpunkt muss innerhalb von ${activePostalCodesLabel} (bzw. München) liegen!`
        );
        return;
      }
      setCirclePickError(null);
      const latestRadius = clampPlayAreaCircleRadius(
        latestPublicStateRef.current?.playArea.circle?.radiusMeters ??
          DEFAULT_PLAY_AREA_CIRCLE_RADIUS_METERS
      );
      void updateCirclePlayArea(pt, latestRadius, detectedPlz);
      return;
    }
    if (mapClickMode.kind === 'PICK_ANCHOR_POINT') {
      const check = validateManualAnchorSelection({
        candidate: pt,
        gpsPosition: geo.currentFix,
        playArea: publicState.playArea.polygon,
        maxDistanceMeters: ANCHOR_MANUAL_ADJUST_MAX_METERS,
      });
      if (!check.valid) {
        setAnchorFeedbackError(check.reason);
        return;
      }
      setAnchorFeedbackError(null);
      setFineAdjustAnchorPt(pt);
      setMapClickMode({ kind: 'NONE' });
      return;
    }
    if (mapClickMode.kind === 'TEST_LOCATION') {
      geo.setManualTestLocation(pt, true);
      if (
        ownMember.side === 'HIDER' ||
        ((publicState.gameMode ?? 'CLASSIC') === 'MANHUNT' &&
          ownTeam?.status === 'JOINED_SARDINES')
      ) {
        void adapter
          .writeHiderLocationPrivate(ownMember.uid, {
            lat: pt.lat,
            lng: pt.lng,
            accuracy: 8,
            timestamp: adapter.getServerNow(),
          })
          .catch(() => {});
      }
      setMapClickMode({ kind: 'NONE' });
      return;
    }
  };

  const handleLockAnchorByHider = async () => {
    setAnchorFeedbackError(null);
    const target = fineAdjustAnchorPt ?? geo.currentFix;
    if (!target) {
      setAnchorFeedbackError(
        'Noch kein GPS-Standort verfügbar. Bitte warte kurz auf ein GPS-Signal.'
      );
      return;
    }
    if (fineAdjustAnchorPt) {
      const check = validateManualAnchorSelection({
        candidate: fineAdjustAnchorPt,
        gpsPosition: geo.currentFix,
        playArea: publicState.playArea.polygon,
        maxDistanceMeters: ANCHOR_MANUAL_ADJUST_MAX_METERS,
      });
      if (!check.valid) {
        setAnchorFeedbackError(check.reason);
        return;
      }
    } else if (!isPointInPlayArea(target, publicState.playArea.polygon)) {
      setAnchorFeedbackError(
        'Ungültige Position: Das Versteck muss vollständig innerhalb des 81247-Spielgebiets liegen!'
      );
      return;
    }
    if (!hiderPrivate) return;

    await lockHiderAnchorAndGenerateRadar({
      adapter,
      uid: ownMember.uid,
      targetLocation: target,
      accuracy: fineAdjustAnchorPt ? 5 : (geo.currentFix?.accuracy ?? 12),
      serverNowMs: adapter.getServerNow(),
      publicState,
      currentHiderPrivate: hiderPrivate,
      startSearchImmediately: false,
    });
    setFineAdjustAnchorPt(null);
    setIsRehidingAnchor(false);
    setMapClickMode({ kind: 'NONE' });
  };

  const handleToggleClueOverlay = (clueId: string) => {
    setHiddenClueIds((prev) => {
      const next = new Set(prev);
      if (next.has(clueId)) next.delete(clueId);
      else next.add(clueId);
      return next;
    });
  };

  const handleSendEmergencyMessage = async (text: string) => {
    const currentCoord = fineAdjustAnchorPt ?? geo.currentFix;
    await adapter.sendEmergencyMessage({
      uid: ownMember.uid,
      playerId: ownMember.playerId,
      senderName: ownMember.name,
      text,
      createdAt: adapter.getServerNow(),
      lat: currentCoord?.lat,
      lng: currentCoord?.lng,
      accuracy: geo.currentFix?.accuracy,
    });
  };

  const handleClearOwnEmergencyMessage = async () => {
    await adapter.clearOwnEmergencyMessage(ownMember.uid);
  };

  const handleRerollHiderSecrets = async () => {
    await adapter.rerollHiderSecrets();
  };

  const handleSelectOwnRole = async (nextSelection: string) => {
    if (isOverviewAccount) return;
    let side: PlayerSide = 'UNASSIGNED';
    let teamId: string | null = null;
    if (nextSelection === 'HIDER') {
      side = 'HIDER';
    } else if (nextSelection.startsWith('team-')) {
      side = 'SEEKER';
      teamId = nextSelection;
    }

    const nowMs = adapter.getServerNow();

    // Sofortiges optimistisches UI-Update (damit "Kein Team" ohne Verzögerung im Dropdown sichtbar ist)
    applyOptimisticMemberPatch({
      side,
      teamId,
      updatedAt: nowMs,
    });

    const targetRecords = new Map<string, MemberRecord>();
    targetRecords.set(ownMember.uid, {
      ...ownMember,
      side,
      teamId,
      updatedAt: nowMs,
    });
    for (const m of Object.values(gameState.members)) {
      if (m.playerId === ownMember.playerId) {
        targetRecords.set(m.uid, {
          ...m,
          side,
          teamId,
          updatedAt: nowMs,
        });
      }
    }

    await adapter.savePlayerAssignment(ownMember.playerId, side, teamId);
    await Promise.all(
      Array.from(targetRecords.values()).map((rec) =>
        adapter.updateMember(rec.uid, rec).catch(() => {})
      )
    );

    if (side !== 'HIDER') {
      await adapter
        .setPlayerReadyState(
          ownMember.uid,
          ownMember.playerId,
          null,
          nowMs
        )
        .catch(() => {});
    }

    for (const palette of TEAM_PALETTE) {
      const curTeam = gameState.teamsPublic[palette.id];
      if (!curTeam) continue;
      const existingIds = Array.isArray(curTeam.memberPlayerIds)
        ? curTeam.memberPlayerIds
        : [];
      const filtered = existingIds.filter((pid) => pid !== ownMember.playerId);
      if (teamId === palette.id && !filtered.includes(ownMember.playerId)) {
        filtered.push(ownMember.playerId);
      }
      const nextBeacon =
        filtered.length === 0
          ? null
          : curTeam.beaconPlayerId && filtered.includes(curTeam.beaconPlayerId)
            ? curTeam.beaconPlayerId
            : filtered[0];

      const membersChanged =
        filtered.length !== existingIds.length ||
        filtered.some((pid, idx) => pid !== existingIds[idx]);
      if (membersChanged || nextBeacon !== curTeam.beaconPlayerId) {
        await adapter
          .saveTeamPublic(palette.id, {
            ...curTeam,
            memberPlayerIds: filtered,
            beaconPlayerId: nextBeacon,
          })
          .catch(() => {});
      }
    }

    if (publicState.status !== 'LOBBY' && side === 'SEEKER' && teamId) {
      await adapter.addActiveTeamIdIfRunning(teamId);
    }
  };

  // Pflicht-Teamauswahl für Nachzügler, die einem bereits laufenden Spiel beitreten
  const mustPickTeamForRunningGame = Boolean(
    (publicState.status === 'RUNNING' || publicState.status === 'PAUSED') &&
      !isOverviewAccount &&
      ownMember.side === 'UNASSIGNED'
  );

  if (mustPickTeamForRunningGame) {
    return (
      <LateJoinTeamPicker
        publicState={publicState}
        ownMember={ownMember}
        members={gameState.members}
        presence={gameState.presence}
        teamsPublic={gameState.teamsPublic}
        onSelectOwnRole={handleSelectOwnRole}
        onLeaveRoom={handleLeaveRoom}
        onLogout={exitOrLogout}
      />
    );
  }

  const handleSelectAvatar = async (nextAvatar: string) => {
    const clean = nextAvatar.trim();
    const nowMs = adapter.getServerNow();
    applyOptimisticMemberPatch({
      avatar: clean || undefined,
      updatedAt: nowMs,
    });

    const targetRecords = new Map<string, MemberRecord>();
    targetRecords.set(ownMember.uid, {
      ...ownMember,
      avatar: clean || undefined,
      updatedAt: nowMs,
    });
    for (const m of Object.values(gameState.members)) {
      if (m.playerId === ownMember.playerId) {
        targetRecords.set(m.uid, {
          ...m,
          avatar: clean || undefined,
          updatedAt: nowMs,
        });
      }
    }

    await Promise.all([
      adapter.updateAccountProfile(ownMember.playerId, { avatar: clean }),
      ...Array.from(targetRecords.values()).map((rec) => {
        const copy = { ...rec };
        if (!clean) {
          delete copy.avatar;
        }
        return adapter.updateMember(copy.uid, copy).catch(() => {});
      }),
    ]);
  };

  const handleToggleOwnReady = async (nextReady: boolean) => {
    if (ownMember.side !== 'HIDER' || isOverviewAccount) return;
    if (nextReady) {
      const token = buildReadyToken(publicState.sessionId);
      await adapter.setPlayerReadyState(
        ownMember.uid,
        ownMember.playerId,
        token,
        adapter.getServerNow()
      );
    } else {
      await adapter.setPlayerReadyState(
        ownMember.uid,
        ownMember.playerId,
        null,
        adapter.getServerNow()
      );
    }
  };

  const isManhunt = (publicState.gameMode ?? 'CLASSIC') === 'MANHUNT';

  const effectivePhase =
    publicState.status === 'LOBBY' ? 'LOBBY' : timer.computedPhase;

  const canRehideWhileTimerActive =
    !isManhunt &&
    publicState.status !== 'LOBBY' &&
    ownMember.side === 'HIDER' &&
    effectivePhase === 'HIDING' &&
    timer.hidingRemainingMs > 0;

  const isEditingCircleOnMap =
    mapClickMode.kind === 'PICK_PLAY_AREA_CIRCLE' && isRoomHost;

  const handleOpenCircleMapEditor = () => {
    if (publicState.playArea.shapeType !== 'CUSTOM_CIRCLE') {
      void updateCirclePlayArea(
        currentCircleCenter,
        currentCircleRadius,
        activePostalCodes
      );
    }
    setCirclePickError(null);
    setCircleEditorCollapsed(false);
    setActivePreviewQuestion(null);
    setMapClickMode({
      kind: 'PICK_PLAY_AREA_CIRCLE',
      label: `Tippe innerhalb von ${activePostalCodesLabel} oder ziehe Pin M, um den Kreis zu platzieren`,
    });
    setActiveTab('MAP');
  };

  const handleReturnToLobbyByHost = async () => {
    if (!isRoomHost) return;
    const secrets = generateSessionSecrets();
    const enabledMembers = deduplicateEnabledMembers(
      gameState.members,
      gameState.presence
    );
    const resetTeams = createDefaultTeams();
    for (const [id, team] of Object.entries(resetTeams)) {
      const customName = gameState.teamsPublic[id]?.name?.trim();
      if (customName) {
        team.name = customName;
      }
    }
    for (const m of enabledMembers) {
      if (
        m.enabled &&
        m.side === 'SEEKER' &&
        m.teamId &&
        resetTeams[m.teamId]
      ) {
        resetTeams[m.teamId].memberPlayerIds.push(m.playerId);
        resetTeams[m.teamId].beaconPlayerId = m.playerId;
      }
    }
    await adapter.resetRoundByHost(
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
      resetTeams,
      {
        anchorPoint: null,
        radarStages: [],
        qrSecret: secrets.qrSecret,
        shortCode: secrets.shortCode,
        hiderLocations: {},
      }
    );
    setActiveTab('LOBBY');
  };

  const handleBuyActivePreviewClue = async () => {
    if (
      !activePreviewQuestion ||
      !isActiveSeeker ||
      !ownTeam ||
      !geo.currentFix ||
      publicState.status !== 'RUNNING' ||
      effectivePhase === 'HIDING' ||
      buyingPreviewClue
    ) {
      return;
    }

    if (activePreviewQuestion === 'THERMOMETER') {
      setThermoPointA({ lat: geo.currentFix.lat, lng: geo.currentFix.lng });
      return;
    }

    const qConfig = resolveQuestionRulesConfig(publicState.questionConfig);
    let params: QuestionParams = {
      thermometerDistanceMeters: qConfig.thermometerDistanceMeters,
      donutStepMeters: qConfig.donutRingStepMeters,
      environmentDistanceMeters: qConfig.environmentDistanceMeters,
    };
    if (
      activePreviewQuestion === 'SPLIT_NS' ||
      activePreviewQuestion === 'SPLIT_EW'
    ) {
      params = {
        ...params,
        splitPoint: { lat: geo.currentFix.lat, lng: geo.currentFix.lng },
      };
    } else if (activePreviewQuestion === 'CONE_45') {
      params = { ...params, bearingDeg: coneBearingDeg };
    } else if (activePreviewQuestion === 'RADIUS_RADAR') {
      params = { ...params, radiusMeters: selectedRadius };
    }

    setBuyingPreviewClue(true);
    try {
      const category = QUESTION_CATEGORY_MAP[activePreviewQuestion];
      const penaltyMs = getQuestionPenaltyMs(
        activePreviewQuestion,
        publicState.classicSearchDurationMs,
        publicState.questionConfig
      );
      const req: ClueRequest = {
        id: generateRandomId('req'),
        teamId: ownTeam.id,
        requestedByUid: ownMember.uid,
        sessionId: publicState.sessionId,
        questionType: activePreviewQuestion,
        category,
        params,
        status: 'PENDING',
        penaltyMs,
        penaltyApplied: false,
        refundedMs: 0,
        createdAt: adapter.getServerNow(),
        requesterSnapshotLocation: {
          lat: geo.currentFix.lat,
          lng: geo.currentFix.lng,
          accuracy: Math.round(geo.currentFix.accuracy),
        },
      };
      await adapter.createClueRequest(req);
      setMapClickMode({ kind: 'NONE' });
      setActivePreviewQuestion(null);
    } finally {
      setBuyingPreviewClue(false);
    }
  };

  const showHiderAnchorPanel =
    !isEditingCircleOnMap &&
    !isManhunt &&
    publicState.status !== 'LOBBY' &&
    ownMember.side === 'HIDER' &&
    (!hiderPrivate?.anchorPoint || (isRehidingAnchor && canRehideWhileTimerActive));

  const hasOpenHiderPhotoModal = Boolean(
    !isManhunt &&
      isSardineDashboardView &&
      openHiderMediaRequests.length > 0 &&
      hiderPrivate?.anchorPoint
  );

  const showHiderRehidePill = Boolean(
    !isManhunt &&
      publicState.status !== 'LOBBY' &&
      isSardineDashboardView &&
      hiderPrivate?.anchorPoint &&
      canRehideWhileTimerActive &&
      !showHiderAnchorPanel
  );

  const showManhuntGpsFallback = Boolean(
    isManhunt &&
      publicState.status !== 'LOBBY' &&
      isSardineDashboardView &&
      (!geo.currentFix ||
        geo.gpsStatus === 'DENIED' ||
        geo.gpsStatus === 'MANUAL_TEST')
  );

  const activeMapBottomSlot = resolveActiveMapBottomSlotKind({
    hasOpenHiderPhotoModal,
    isEditingCircleOnMap,
    clickModeKind: mapClickMode.kind,
    hasCluePreviewOrThermo: Boolean(
      !isManhunt && (activePreviewQuestion || thermoPointA)
    ),
    showHiderAnchorPanel,
    isLobbyStatus: publicState.status === 'LOBBY',
    showHiderRehidePill,
    showManhuntGpsFallback,
  });

  const hasActiveEmergency = gameState.emergencyMessages.length > 0;
  const isOutsidePlayArea = Boolean(
    geo.currentFix &&
      (publicState.status === 'RUNNING' || publicState.status === 'PAUSED') &&
      !isPointInPlayArea(geo.currentFix, publicState.playArea.polygon)
  );

  return (
    <div
      data-emergency-hud={hasActiveEmergency ? 'true' : 'false'}
      className={`cmf-drafting-bg flex h-[100dvh] w-full flex-col overflow-hidden text-[var(--text-main)] transition-shadow duration-300 ${
        hasActiveEmergency
          ? 'cmf-emergency-frame ring-4 ring-inset ring-[#EF4444]'
          : ''
      }`}
    >
      {/* Offline-Banner, Pausen-Banner & Controller-Warteschlangen-Banner */}
      <StatusBanners
        connected={gameState.connected}
        isControllerDisconnected={controllerStatus.isControllerDisconnected}
        gameStatus={publicState.status}
      />

      {/* Dauerhaft für alle sichtbare Notfallnachrichten (inkl. Standort-Anzeige & Sprung auf Karte) */}
      <EmergencyMessageBanner
        messages={gameState.emergencyMessages}
        ownUid={ownMember.uid}
        onClearOwnMessage={handleClearOwnEmergencyMessage}
        onLocateMessage={(lat, lng) => {
          setActiveTab('MAP');
          setEmergencyFocusTarget({ lat, lng, seq: Date.now() });
        }}
      />

      {/* Kompaktes Top-HUD im Raw-Light-Hardware-Design (färbt sich bei Notfall komplett rot) */}
      <TopHud
        publicState={publicState}
        timer={timer}
        ownMember={ownMember}
        ownTeam={ownTeam}
        connected={gameState.connected}
        ownFix={geo.currentFix}
        gpsStatus={geo.gpsStatus}
        hasActiveEmergency={hasActiveEmergency}
        ownEmergencyMessage={ownEmergencyMessage}
        onSendEmergencyMessage={handleSendEmergencyMessage}
        onClearOwnEmergencyMessage={handleClearOwnEmergencyMessage}
      />

      {/* 50-Meter-Versteck-Leash / Aktive-Zone & Gebiets-Warnbanner */}
      <LeashWarningBanner
        isOwnSideHider={ownMember.side === 'HIDER'}
        leashState={geo.leashState}
        publicLeashAlertActive={publicState.leashAlertActive}
        activeLeashViolation={gameState.activeLeashViolation}
        isOutsidePlayArea={isOutsidePlayArea}
        gameMode={publicState.gameMode ?? 'CLASSIC'}
      />

      {/* Hauptbereich */}
      <main className="relative flex-1 min-h-0 w-full overflow-hidden">
        {/* TAB 0: ÜBERSICHTLICHE VORBEREITUNGS-LOBBY (TEAMS & SPIEL-EINSTELLUNGEN) */}
        {activeTab === 'LOBBY' &&
          (publicState.status === 'LOBBY' ||
            publicState.status === 'FINISHED') && (
            <LobbyScreen
              adapter={adapter}
              publicState={publicState}
              hiderPrivate={hiderPrivate}
              ownMember={ownMember}
              members={gameState.members}
              presence={gameState.presence}
              teamsPublic={gameState.teamsPublic}
              readyPlayerIds={gameState.readyPlayerIds}
              ownFix={geo.currentFix}
              gpsStatus={geo.gpsStatus}
              gpsError={geo.gpsError}
              onRetryGps={geo.retryGpsPermission}
              onSelectOwnRole={handleSelectOwnRole}
              onToggleOwnReady={handleToggleOwnReady}
              onViewMap={() => setActiveTab('MAP')}
              onOpenCircleMapEditor={handleOpenCircleMapEditor}
              onOpenHostConsole={
                isOverviewAccount ? () => setActiveTab('HOST') : undefined
              }
              onLeaveRoom={handleLeaveRoom}
              recentRoomCodes={recentRooms.map((r) => r.roomCode)}
              onSwitchRoom={async (targetCode) => {
                await joinGameByCode(targetCode);
              }}
            />
          )}

        <div
          className={`relative h-full w-full ${
            activeTab === 'MAP' ? 'block' : 'hidden'
          }`}
        >
          <GameMap
            playArea={publicState.playArea.polygon}
            playAreaConfirmed={publicState.playArea.confirmed}
            official81247Boundary={activePlzBoundary}
            circlePlayAreaCenter={currentCircleCenter}
            onChangeCirclePlayAreaCenter={(pt) => {
              if (!isRoomHost) return;
              const inCurrentPlz = isPointInMunichPlz(pt, activePostalCodes);
              const detectedPlz = inCurrentPlz
                ? activePostalCodes
                : findMunichPlzAtPoint(pt);
              setCirclePickError(
                detectedPlz
                  ? null
                  : `An die ${activePostalCodesLabel}-Grenze angepasst (Mittelpunkt bleibt in ${activePostalCodesLabel}).`
              );
              const latestRadius = clampPlayAreaCircleRadius(
                latestPublicStateRef.current?.playArea.circle?.radiusMeters ??
                  DEFAULT_PLAY_AREA_CIRCLE_RADIUS_METERS
              );
              void updateCirclePlayArea(
                detectedPlz
                  ? pt
                  : snapPointIntoMunichPlz(pt, activePostalCodes),
                latestRadius,
                detectedPlz ?? activePostalCodes
              );
            }}
            ownFix={
              isOverviewAccount && !canUseMapClicks
                ? null
                : fineAdjustAnchorPt
                  ? {
                      lat: fineAdjustAnchorPt.lat,
                      lng: fineAdjustAnchorPt.lng,
                      accuracy: 5,
                      timestamp: 0,
                    }
                  : geo.currentFix
            }
            anchorGpsOrigin={geo.currentFix}
            isOwnSideHider={isSardineDashboardView}
            anchorPoint={isManhunt ? null : (hiderPrivate?.anchorPoint ?? null)}
            showAnchorAndLeash={
              !isManhunt &&
              Boolean(isSardineDashboardView || isOverviewAccount)
            }
            publishedRadar={publicState.radarCircle}
            exposedHiderLocation={exposedHiderLocation}
            liveHiderLocations={liveHiderLocations}
            teamMemberMarkers={visibleTeamMemberMarkers}
            clues={isManhunt ? [] : visibleMapClues}
            hiddenClueIds={hiddenClueIds}
            activePreviewQuestion={isManhunt ? null : activePreviewQuestion}
            coneBearingDeg={coneBearingDeg}
            selectedRadius={selectedRadius}
            thermoPointA={thermoPointA}
            questionConfig={publicState.questionConfig}
            clickMode={mapClickMode}
            onMapCoordinateClick={handleMapCoordinateClick}
            onRequestGpsPermission={geo.retryGpsPermission}
            actionsRef={mapActionsRef}
            layoutInvalidationKey={`${activeTab}_${publicState.status}`}
            emergencyMessages={gameState.emergencyMessages}
            emergencyFocusTarget={emergencyFocusTarget}
          />

          {/* EINZIGES UNIFIZIERTES ZERO-OVERLAP MAP-HUD-GRID (Top-Zeile + Freie Mitte + Exklusiver Bottom-Slot) */}
          <div
            data-testid="map-hud-layout"
            className="pointer-events-none absolute inset-0 z-[400] flex flex-col justify-between gap-2 p-2 sm:p-3"
          >
            {/* OBERER HUD-SLOT: Links Steuerung/Status, Rechts dauerhaft Zentrieren & Gebiets-Übersicht */}
            <div className="flex shrink-0 flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="map-legend-toggle-btn"
                    onClick={() => setShowMapLegend((v) => !v)}
                    className={`pointer-events-auto inline-flex min-h-[38px] items-center gap-1 rounded-xl border px-2.5 py-1 font-tech text-[11px] font-bold shadow-md backdrop-blur-xs ${
                      showMapLegend
                        ? 'border-[var(--cmf-teal)] bg-[#14171A] text-white'
                        : 'border-[var(--shell-border)] bg-white/94 text-[var(--text-main)]'
                    }`}
                  >
                    <HelpCircle className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                    <span>Legende</span>
                  </button>

                  {canUseMapClicks && (
                    <button
                      type="button"
                      data-testid="map-set-test-pos-btn"
                      onClick={() =>
                        setMapClickMode((prev) =>
                          prev.kind === 'TEST_LOCATION'
                            ? { kind: 'NONE' }
                            : {
                                kind: 'TEST_LOCATION',
                                label:
                                  'Tippe auf die Karte, um deine Test-Position zu setzen',
                              }
                        )
                      }
                      className={`pointer-events-auto inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-2.5 py-1 font-tech text-[11px] font-bold uppercase shadow-md ${
                        mapClickMode.kind === 'TEST_LOCATION'
                          ? 'cmf-btn-primary font-dot'
                          : 'cmf-oled text-[#F8FAFC]'
                      }`}
                    >
                      <Crosshair
                        className={`h-3.5 w-3.5 ${
                          mapClickMode.kind === 'TEST_LOCATION'
                            ? 'text-white'
                            : 'text-[var(--cmf-orange)]'
                        }`}
                      />
                      <span>
                        {mapClickMode.kind === 'TEST_LOCATION'
                          ? 'Aktiv'
                          : 'Test-Pin'}
                      </span>
                    </button>
                  )}

                  {isOverviewAccount && (
                    <div className="cmf-oled pointer-events-auto inline-flex min-h-[34px] items-center gap-1.5 px-2.5 py-1 font-tech text-[10px] font-bold text-[#F8FAFC] uppercase shadow-md">
                      <Eye className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-teal)]" />
                      <span>Admin</span>
                    </div>
                  )}

                  {isJoinedSardines && (
                    <div className="cmf-oled pointer-events-auto inline-flex min-h-[34px] items-center gap-1.5 px-2.5 py-1 font-tech text-[10px] font-bold text-[#F8FAFC] uppercase shadow-md">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-teal)]" />
                      <span>Verstecker</span>
                    </div>
                  )}

                  {isManhunt &&
                    isSardineDashboardView &&
                    publicState.status !== 'LOBBY' && (
                      <div className="cmf-oled pointer-events-auto inline-flex min-h-[34px] items-center gap-1.5 px-2.5 py-1 font-tech text-[10px] font-bold text-[#F8FAFC] uppercase shadow-md">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--cmf-orange)]" />
                        <span>
                          {publicState.radarCircle
                            ? `Zone ${publicState.radarCircle.radiusMeters}m${
                                publicState.radarCircle.lastPing
                                  ? ` · Ping #${publicState.radarCircle.lastPing.pingNumber}`
                                  : ''
                              }`
                            : 'Manhunt aktiv'}
                        </span>
                      </div>
                    )}
                </div>

                {/* Konfliktfrei oben rechts angedockte Karten-Aktionen */}
                <div className="pointer-events-auto flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="map-locate-me-btn"
                    onClick={() => mapActionsRef.current?.centerOnOwnFix()}
                    aria-label="Auf eigenen Standort zentrieren"
                    title="Auf eigenen Standort zentrieren"
                    className="cmf-chassis flex h-[38px] w-[38px] items-center justify-center rounded-xl text-[var(--text-main)] shadow-md active:scale-95"
                  >
                    <LocateFixed
                      className={`h-4 w-4 ${
                        geo.currentFix
                          ? 'text-[var(--cmf-teal)]'
                          : 'text-[var(--text-muted)]'
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    data-testid="map-fit-zone-btn"
                    onClick={() => mapActionsRef.current?.fitPlayArea()}
                    aria-label="Gesamtes Spielgebiet anzeigen"
                    title="Gesamtes Spielgebiet anzeigen"
                    className="cmf-chassis flex h-[38px] w-[38px] items-center justify-center rounded-xl text-[var(--text-main)] shadow-md active:scale-95"
                  >
                    <Maximize2 className="h-4 w-4 text-[var(--cmf-orange)]" />
                  </button>
                </div>
              </div>

              {/* Exklusive Sub-Zeile: Entweder geöffnete Legende ODER einzeilige Team-Tipp-Filterleiste */}
              {showMapLegend ? (
                <div
                  data-testid="map-legend-card"
                  className="cmf-module pointer-events-auto max-w-xs space-y-1.5 p-3 text-xs shadow-lg"
                >
                  <div className="flex items-center justify-between border-b cmf-divider pb-1.5">
                    <span className="font-industrial font-bold text-[var(--text-main)]">
                      Karten-Legende
                    </span>
                    <button
                      type="button"
                      aria-label="Legende schließen"
                      onClick={() => setShowMapLegend(false)}
                      className="rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex items-center gap-2">
                      <span className="h-0.5 w-4 shrink-0 bg-[#DC2626]" />
                      <span>Rote Linie = Spielgrenze</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-4 shrink-0 rounded-xs bg-[#FF4D00]/45" />
                      <span>Orange Fläche = Ausgeschlossen</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-full border-2 border-[#0D9488]" />
                      <span>Türkiser Kreis = Versteck-Radius / Radar</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-4 shrink-0 rounded-full border border-amber-500 bg-amber-400/80" />
                      <span>Fisch + Team = Letzte Position der Sucher</span>
                    </div>
                  </div>
                  <div className="border-t cmf-divider pt-1 text-[10px] text-[var(--text-muted)]">
                    Kartendaten ©{' '}
                    <a
                      href="https://www.openstreetmap.org/copyright"
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-[var(--text-main)]"
                    >
                      OpenStreetMap
                    </a>
                  </div>
                </div>
              ) : (
                !isManhunt &&
                isOverviewOrSardineDashboard &&
                publicState.status !== 'LOBBY' &&
                roundSeekerTeamsForFilter.length > 0 && (
                  <div
                    data-testid="map-hider-team-filter"
                    className="cmf-no-scrollbar pointer-events-auto flex items-center gap-1 overflow-x-auto rounded-2xl border border-[var(--shell-border)] bg-[var(--shell-bg)]/95 p-1 shadow-md backdrop-blur-xs"
                  >
                    <button
                      type="button"
                      onClick={() => setHiderFilterTeamId('NONE')}
                      className={`shrink-0 rounded-xl px-2.5 py-1 font-tech text-[10px] font-bold uppercase transition-colors ${
                        hiderFilterTeamId === 'NONE'
                          ? 'bg-[#14171A] text-white'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      Tipps: Aus
                    </button>
                    {roundSeekerTeamsForFilter.map((t) => {
                      const active = hiderFilterTeamId === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() =>
                            setHiderFilterTeamId((prev) =>
                              prev === t.id ? 'NONE' : t.id
                            )
                          }
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1 font-tech text-[10px] font-bold uppercase transition-colors ${
                            active
                              ? 'bg-[#14171A] text-white'
                              : 'bg-white/75 text-[var(--text-main)]'
                          }`}
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: t.color }}
                          />
                          <span>{t.name}</span>
                          <span className="opacity-75">({t.clues.length})</span>
                        </button>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            {/* GARANTIERT FREIE KARTENMITTE (flex-1 min-h-0) */}
            <div className="min-h-0 flex-1" />

            {/* EXKLUSIVER BOTTOM-SLOT (STRIKTER SINGLE-OWNER-MUTEX: MAXIMAL 1 ELEMENT AKTIV) */}
            {activeMapBottomSlot !== 'NONE' &&
              activeMapBottomSlot !== 'PHOTO_REQUEST_MODAL' && (
                <div
                  data-testid="map-bottom-slot"
                  data-slot-kind={activeMapBottomSlot}
                  className="flex shrink-0 flex-col justify-end"
                >
                  {activeMapBottomSlot === 'CIRCLE_EDITOR' && (
                    <PhysicsBottomSheet
                      collapsed={circleEditorCollapsed}
                      onCollapsedChange={setCircleEditorCollapsed}
                      allowBodyDrag={false}
                      scrollableBody
                      maxWidthClass="max-w-lg"
                      bodyClassName="max-h-[36dvh] overflow-y-auto p-3.5 pt-2.5 sm:p-4 sm:pt-3 space-y-2.5"
                      header={
                        <div
                          data-testid="map-circle-playarea-editor"
                          className="flex w-full items-center justify-between gap-2"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Crosshair className="h-4 w-4 shrink-0 text-[var(--cmf-orange)]" />
                            <div className="min-w-0 text-left">
                              <span className="block truncate font-industrial text-sm text-[var(--text-main)]">
                                Kreis-Spielfeld in {activePostalCodesLabel}
                              </span>
                              <span className="font-tech text-[10px] text-[var(--text-muted)] uppercase">
                                Tippe in {activePostalCodesLabel} oder ziehe Pin M
                              </span>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="cmf-oled px-2.5 py-1 font-dot text-xs text-[var(--cmf-amber)]">
                              {currentCircleRadius} M
                            </span>
                            <button
                              type="button"
                              data-testid="finish-circle-map-picker-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCirclePickError(null);
                                setMapClickMode({ kind: 'NONE' });
                              }}
                              className="cmf-btn-primary font-dot min-h-[34px] px-3 py-1 text-[11px] font-bold"
                            >
                              Fertig
                            </button>
                            {circleEditorCollapsed ? (
                              <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                            )}
                          </div>
                        </div>
                      }
                    >
                      {circlePickError && (
                        <div className="cmf-badge-orange cmf-shake rounded-xl p-2 text-xs font-semibold">
                          {circlePickError}
                        </div>
                      )}

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const { validCodes, notFoundCodes } =
                            parseAndValidateMunichPostalCodes(mapCirclePlzInput);
                          if (notFoundCodes.length > 0) {
                            setCirclePickError(
                              notFoundCodes.length === 1
                                ? `PLZ nicht in München gefunden: "${notFoundCodes[0]}".`
                                : `Folgende PLZ wurden nicht in München gefunden: ${notFoundCodes
                                    .map((c) => `"${c}"`)
                                    .join(', ')}.`
                            );
                          } else if (validCodes.length === 0) {
                            setCirclePickError(
                              'Bitte mindestens eine gültige Münchner PLZ eingeben (z. B. 81247).'
                            );
                          } else {
                            setCirclePickError(null);
                          }
                          if (validCodes.length > 0) {
                            const nextEntry = getMunichPlzEntry(validCodes[0]);
                            const nextCenter = isPointInMunichPlz(
                              currentCircleCenter,
                              validCodes
                            )
                              ? currentCircleCenter
                              : nextEntry.center;
                            void updateCirclePlayArea(
                              nextCenter,
                              currentCircleRadius,
                              validCodes
                            );
                          }
                        }}
                        className="flex items-center gap-2"
                      >
                        <span className="shrink-0 font-tech text-[10px] font-bold text-[var(--text-muted)] uppercase">
                          PLZ:
                        </span>
                        <input
                          type="text"
                          data-testid="map-circle-plz-input"
                          value={mapCirclePlzInput}
                          onChange={(e) => setMapCirclePlzInput(e.target.value)}
                          placeholder="z. B. 81247, 81245"
                          className="cmf-input min-h-[36px] flex-1 px-2.5 py-1 font-tech text-xs font-bold"
                        />
                        <button
                          type="submit"
                          data-testid="map-circle-plz-apply-btn"
                          className="cmf-btn-active font-tech min-h-[36px] shrink-0 px-3 py-1 text-[11px] font-bold uppercase"
                        >
                          OK
                        </button>
                      </form>

                      <HardwareKnob
                        label="KREIS-RADIUS (100M SCHRITTE)"
                        ariaLabel="Kreis-Radius auf der Karte in 100m Schritten"
                        dataTestId="map-circle-radius-knob"
                        value={currentCircleRadius}
                        min={PLAY_AREA_CIRCLE_MIN_RADIUS_METERS}
                        max={PLAY_AREA_CIRCLE_MAX_RADIUS_METERS}
                        step={PLAY_AREA_CIRCLE_STEP_METERS}
                        unit=" m"
                        onChange={(nextRadius) => {
                          const latestCenter =
                            latestPublicStateRef.current?.playArea.circle?.center ??
                            currentCircleCenter;
                          void updateCirclePlayArea(
                            latestCenter,
                            nextRadius,
                            activePostalCodes
                          );
                        }}
                      />

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={
                            !geo.currentFix ||
                            (!isPointInMunichPlz(
                              geo.currentFix,
                              activePostalCodes
                            ) &&
                              !findMunichPlzAtPoint(geo.currentFix))
                          }
                          onClick={() => {
                            if (!geo.currentFix) return;
                            const gpsPlz = isPointInMunichPlz(
                              geo.currentFix,
                              activePostalCodes
                            )
                              ? activePostalCodes
                              : findMunichPlzAtPoint(geo.currentFix);
                            if (!gpsPlz) {
                              setCirclePickError(
                                `Dein GPS liegt aktuell außerhalb von ${activePostalCodesLabel} (München).`
                              );
                              return;
                            }
                            setCirclePickError(null);
                            void updateCirclePlayArea(
                              {
                                lat: geo.currentFix.lat,
                                lng: geo.currentFix.lng,
                              },
                              currentCircleRadius,
                              gpsPlz
                            );
                          }}
                          className="cmf-btn-secondary font-tech min-h-[38px] px-3 py-1.5 text-[11px] font-bold uppercase disabled:opacity-40"
                        >
                          Mitte = Mein GPS
                        </button>

                        <button
                          type="button"
                          data-testid="circle-editor-return-btn"
                          onClick={() => {
                            setCirclePickError(null);
                            setMapClickMode({ kind: 'NONE' });
                            setActiveTab(isOverviewAccount ? 'HOST' : 'LOBBY');
                          }}
                          className="cmf-btn-secondary font-tech min-h-[38px] px-3 py-1.5 text-[11px] font-bold uppercase"
                        >
                          {isOverviewAccount
                            ? 'Zurück zur Konsole'
                            : 'Zurück zur Lobby'}
                        </button>
                      </div>
                    </PhysicsBottomSheet>
                  )}

                  {activeMapBottomSlot === 'CLICK_PROMPT' && (
                    <div
                      data-testid="map-click-mode-bar"
                      className="cmf-oled cmf-sheet-up pointer-events-auto mx-auto w-full max-w-lg space-y-2 px-3.5 py-2.5 shadow-xl"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--cmf-amber)]" />
                          <span className="truncate font-tech text-xs font-bold text-[#F8FAFC]">
                            {mapClickMode.kind === 'PICK_ANCHOR_POINT'
                              ? `Tippe euer Versteck an (max. ${ANCHOR_MANUAL_ADJUST_MAX_METERS} m um dein GPS)`
                              : (mapClickMode.label ??
                                'Tippe auf die Karte, um den Punkt zu setzen')}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setAnchorFeedbackError(null);
                            setMapClickMode({ kind: 'NONE' });
                          }}
                          className="cmf-btn-active font-tech min-h-[34px] shrink-0 px-3 py-1 text-[11px] font-bold uppercase"
                        >
                          Abbrechen
                        </button>
                      </div>
                      {mapClickMode.kind === 'PICK_ANCHOR_POINT' &&
                        anchorFeedbackError && (
                          <div className="cmf-badge-orange cmf-shake rounded-xl p-2 text-xs font-semibold">
                            {anchorFeedbackError}
                          </div>
                        )}
                    </div>
                  )}

                  {activeMapBottomSlot === 'CLUE_PREVIEW' &&
                    (() => {
                      const effectiveQuestion =
                        activePreviewQuestion ?? 'THERMOMETER';
                      const qConfig = resolveQuestionRulesConfig(
                        publicState.questionConfig
                      );
                      const targetThermoMeters =
                        qConfig.thermometerDistanceMeters;
                      const radiusOptions = getRadiusRadarOptions(
                        publicState.questionConfig
                      );
                      const previewPenaltyMin = Math.round(
                        getQuestionPenaltyMs(
                          effectiveQuestion,
                          publicState.classicSearchDurationMs,
                          publicState.questionConfig
                        ) / 60_000
                      );
                      const distAB =
                        thermoPointA && geo.currentFix
                          ? Math.round(
                              distanceMeters(thermoPointA, geo.currentFix)
                            )
                          : 0;
                      const canBuyHere = Boolean(
                        isActiveSeeker &&
                          ownTeam &&
                          geo.currentFix &&
                          publicState.status === 'RUNNING' &&
                          effectivePhase !== 'HIDING' &&
                          !buyingPreviewClue
                      );

                      return (
                        <div
                          data-testid="map-active-preview-bar"
                          className="cmf-oled cmf-sheet-up pointer-events-auto mx-auto w-full max-w-lg space-y-2 p-3 shadow-2xl"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <Eye className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
                              <span className="truncate font-tech text-xs font-bold text-[#F8FAFC] uppercase">
                                {getQuestionLabelDe(effectiveQuestion)}
                              </span>
                            </div>
                            <button
                              type="button"
                              data-testid="end-map-preview-btn"
                              onClick={() => {
                                setMapClickMode({ kind: 'NONE' });
                                setActivePreviewQuestion(null);
                              }}
                              className="cmf-btn-secondary font-tech inline-flex min-h-[32px] items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase"
                            >
                              <X className="h-3.5 w-3.5" />
                              <span>Schließen</span>
                            </button>
                          </div>

                          {effectiveQuestion === 'CONE_45' && (
                            <div className="flex items-center justify-between gap-1.5 border-t border-dashed border-[#27272A] pt-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setConeBearingDeg((d) => (d - 15 + 360) % 360)
                                }
                                className="cmf-btn-secondary min-h-[34px] flex-1 px-2 font-tech text-[11px] font-bold"
                              >
                                -15°
                              </button>
                              <span className="min-w-[84px] text-center font-dot text-xs text-[var(--cmf-amber)]">
                                {formatCompassDirectionDe(coneBearingDeg)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setConeBearingDeg((d) => (d + 15) % 360)
                                }
                                className="cmf-btn-secondary min-h-[34px] flex-1 px-2 font-tech text-[11px] font-bold"
                              >
                                +15°
                              </button>
                            </div>
                          )}

                          {effectiveQuestion === 'RADIUS_RADAR' && (
                            <div className="flex flex-wrap gap-1 border-t border-dashed border-[#27272A] pt-2">
                              {radiusOptions.map((r) => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => setSelectedRadius(r)}
                                  className={`min-h-[34px] flex-1 rounded-lg px-1.5 font-tech text-[10px] font-bold uppercase ${
                                    selectedRadius === r
                                      ? 'bg-[var(--cmf-orange)] text-white'
                                      : 'bg-[#181B20] text-[#CBD2D9]'
                                  }`}
                                >
                                  {r}m
                                </button>
                              ))}
                            </div>
                          )}

                          {(effectiveQuestion === 'SPLIT_NS' ||
                            effectiveQuestion === 'SPLIT_EW') && (
                            <div className="grid grid-cols-2 gap-1.5 border-t border-dashed border-[#27272A] pt-2">
                              <button
                                type="button"
                                onClick={() =>
                                  setActivePreviewQuestion('SPLIT_NS')
                                }
                                className={`min-h-[34px] rounded-lg px-2 font-tech text-[11px] font-bold uppercase ${
                                  effectiveQuestion === 'SPLIT_NS'
                                    ? 'bg-[var(--cmf-orange)] text-white'
                                    : 'bg-[#181B20] text-[#CBD2D9]'
                                }`}
                              >
                                Nord / Süd
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setActivePreviewQuestion('SPLIT_EW')
                                }
                                className={`min-h-[34px] rounded-lg px-2 font-tech text-[11px] font-bold uppercase ${
                                  effectiveQuestion === 'SPLIT_EW'
                                    ? 'bg-[var(--cmf-orange)] text-white'
                                    : 'bg-[#181B20] text-[#CBD2D9]'
                                }`}
                              >
                                Ost / West
                              </button>
                            </div>
                          )}

                          {effectiveQuestion === 'THERMOMETER' && (
                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[#27272A] pt-2 text-[11px]">
                              <span className="font-tech text-[#CBD2D9]">
                                {thermoPointA
                                  ? `Bewege dich ${targetThermoMeters} m vom Startpunkt A (stoppt automatisch)`
                                  : `Startet am GPS und stoppt automatisch nach ${targetThermoMeters} m`}
                              </span>
                              {thermoPointA && (
                                <span className="rounded-full bg-[#F59E0B]/25 px-2.5 py-0.5 font-tech text-[10px] font-bold text-[#FBBF24] uppercase">
                                  {distAB} / {targetThermoMeters} m
                                </span>
                              )}
                            </div>
                          )}

                          {isActiveSeeker &&
                            (effectiveQuestion === 'THERMOMETER' &&
                            thermoPointA ? (
                              <button
                                type="button"
                                onClick={() => setThermoPointA(null)}
                                className="cmf-btn-secondary font-tech flex min-h-[38px] w-full items-center justify-center gap-1.5 px-4 py-1.5 text-xs font-bold text-[var(--cmf-orange)] uppercase"
                              >
                                <X className="h-3.5 w-3.5" />
                                <span>
                                  Thermometer abbrechen ({distAB} /{' '}
                                  {targetThermoMeters} m)
                                </span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                data-testid="map-preview-buy-btn"
                                disabled={!canBuyHere}
                                onClick={() => void handleBuyActivePreviewClue()}
                                className="cmf-btn-primary font-dot flex min-h-[40px] w-full items-center justify-center gap-2 px-4 py-2 text-xs font-bold disabled:opacity-45"
                              >
                                <span>
                                  {buyingPreviewClue
                                    ? 'Kaufe Tipp ...'
                                    : effectiveQuestion === 'THERMOMETER'
                                      ? `Thermometer starten (+${previewPenaltyMin} Min.)`
                                      : `Jetzt kaufen (+${previewPenaltyMin} Min.)`}
                                </span>
                              </button>
                            ))}
                        </div>
                      );
                    })()}

                  {activeMapBottomSlot === 'HIDER_LOCK_ANCHOR' && (
                    <PhysicsBottomSheet
                      collapsed={hiderAnchorCollapsed}
                      onCollapsedChange={setHiderAnchorCollapsed}
                      allowBodyDrag
                      scrollableBody
                      maxWidthClass="max-w-lg"
                      bodyClassName="max-h-[34dvh] overflow-y-auto p-3.5 pt-2 sm:p-4 sm:pt-2.5 space-y-2.5"
                      header={
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <Anchor className="h-4 w-4 shrink-0 text-[var(--cmf-orange)]" />
                            <h3 className="truncate font-industrial text-sm text-[var(--text-main)]">
                              {hiderPrivate?.anchorPoint
                                ? 'Neues Versteck wählen'
                                : 'Versteck festlegen'}
                            </h3>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {hiderPrivate?.anchorPoint && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setIsRehidingAnchor(false);
                                  setFineAdjustAnchorPt(null);
                                  setMapClickMode({ kind: 'NONE' });
                                }}
                                className="cmf-btn-secondary min-h-[30px] px-2.5 py-1 font-tech text-[10px] font-bold uppercase"
                              >
                                Abbrechen
                              </button>
                            )}
                            {hiderAnchorCollapsed ? (
                              <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                            )}
                          </div>
                        </div>
                      }
                    >
                      {anchorFeedbackError && (
                        <div className="cmf-badge-orange cmf-shake rounded-xl p-2 text-xs font-semibold">
                          {anchorFeedbackError}
                        </div>
                      )}

                      {geo.currentFix &&
                        geo.currentFix.accuracy >
                          ANCHOR_ACCURACY_WARNING_METERS &&
                        !fineAdjustAnchorPt && (
                          <div className="cmf-badge-amber flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-xs">
                            <span>
                              GPS noch ungenau (±
                              {Math.round(geo.currentFix.accuracy)} m)
                            </span>
                            <button
                              type="button"
                              onClick={geo.retryGpsPermission}
                              className="cmf-btn-secondary font-tech px-2.5 py-1 text-[10px] font-bold uppercase"
                            >
                              Neu messen
                            </button>
                          </div>
                        )}

                      <button
                        type="button"
                        data-testid="lock-anchor-btn"
                        onClick={() => void handleLockAnchorByHider()}
                        className="cmf-btn-primary font-dot flex min-h-[44px] w-full items-center justify-center gap-2 px-4 py-2 text-xs font-bold"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {fineAdjustAnchorPt
                          ? 'Gewählten Punkt als Versteck speichern'
                          : 'Hier verstecken (GPS nutzen)'}
                      </button>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          data-testid="pinpoint-anchor-on-map-btn"
                          disabled={!geo.currentFix}
                          onClick={() => {
                            setAnchorFeedbackError(null);
                            setMapClickMode({
                              kind: 'PICK_ANCHOR_POINT',
                              label: `Tippe innerhalb des ${ANCHOR_MANUAL_ADJUST_MAX_METERS}m-Kreises um dein GPS`,
                            });
                          }}
                          className="cmf-btn-secondary font-tech inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 bg-white/80 px-3 py-1.5 text-[11px] font-bold text-[var(--text-main)] uppercase disabled:opacity-45"
                        >
                          <Crosshair className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-orange)]" />
                          <span>
                            {geo.currentFix
                              ? `Punkt auf Karte korrigieren (max. ${ANCHOR_MANUAL_ADJUST_MAX_METERS} m)`
                              : 'Warte auf GPS ...'}
                          </span>
                        </button>

                        {fineAdjustAnchorPt && (
                          <button
                            type="button"
                            onClick={() => {
                              setFineAdjustAnchorPt(null);
                              setMapClickMode({ kind: 'NONE' });
                            }}
                            className="cmf-btn-secondary font-tech min-h-[38px] px-3 py-1.5 text-[11px] font-bold uppercase"
                          >
                            GPS nutzen
                          </button>
                        )}
                      </div>
                    </PhysicsBottomSheet>
                  )}

                  {activeMapBottomSlot === 'LOBBY_RETURN' && (
                    <div className="cmf-chassis cmf-sheet-up pointer-events-auto mx-auto flex w-full max-w-lg items-center justify-between gap-2 px-3 py-2 shadow-xl">
                      <span className="min-w-0 flex-1 truncate font-industrial text-xs font-bold text-[var(--text-main)]">
                        {publicState.playArea.name}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {isRoomHost &&
                          publicState.playArea.shapeType === 'CUSTOM_CIRCLE' && (
                            <button
                              type="button"
                              onClick={handleOpenCircleMapEditor}
                              className="cmf-btn-secondary font-tech inline-flex min-h-[36px] items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase"
                            >
                              <Crosshair className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                              <span>Kreis</span>
                            </button>
                          )}
                        <button
                          type="button"
                          data-testid="map-return-to-lobby-btn"
                          onClick={() => setActiveTab('LOBBY')}
                          className="cmf-btn-primary font-dot inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1 text-xs font-bold"
                        >
                          <Users className="h-3.5 w-3.5" />
                          <span>Zurück zur Lobby</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {activeMapBottomSlot === 'HIDER_REHIDE' && (
                    <div className="pointer-events-none flex justify-center">
                      <button
                        type="button"
                        data-testid="rehide-anchor-btn"
                        onClick={() => {
                          setAnchorFeedbackError(null);
                          setIsRehidingAnchor(true);
                          setHiderAnchorCollapsed(false);
                        }}
                        className="cmf-btn-active pointer-events-auto inline-flex min-h-[40px] items-center gap-1.5 rounded-2xl px-4 py-2 font-tech text-xs font-bold uppercase shadow-lg"
                      >
                        <RotateCcw className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-teal)]" />
                        <span>Neu verstecken</span>
                      </button>
                    </div>
                  )}

                  {activeMapBottomSlot === 'MANHUNT_GPS_FALLBACK' && (
                    <div className="cmf-chassis cmf-sheet-up pointer-events-auto mx-auto flex w-full max-w-lg items-center justify-between gap-2 px-3 py-2 text-xs shadow-lg">
                      <span className="truncate font-tech text-[11px] font-bold text-[var(--cmf-orange)] uppercase">
                        {geo.gpsStatus === 'MANUAL_TEST'
                          ? 'Manueller GPS-Fallback aktiv'
                          : 'Kein GPS-Signal? Standort antippen:'}
                      </span>
                      <button
                        type="button"
                        data-testid="manhunt-manual-location-fallback-btn"
                        onClick={() =>
                          setMapClickMode({
                            kind: 'TEST_LOCATION',
                            label:
                              'Tippe euren aktuellen Standort auf der Karte an (GPS-Fallback)',
                          })
                        }
                        className="cmf-btn-secondary font-tech inline-flex min-h-[34px] shrink-0 items-center gap-1.5 px-3 py-1 text-[11px] font-bold text-[var(--text-main)] uppercase"
                      >
                        <Crosshair className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                        <span>Standort antippen</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
          </div>
        </div>

        {/* TAB 2: HINWEIS-MENÜ & VERLAUF */}
        {!isManhunt && activeTab === 'QUESTIONS' && (
          <QuestionMenu
            adapter={adapter}
            publicState={publicState}
            netElapsedMs={timer.netElapsedMs}
            ownMember={ownMember}
            ownTeam={ownTeam}
            ownFix={geo.currentFix}
            teamRequests={visibleRequestsMap}
            teamClues={seekerOwnTeamCluesMap}
            cluesByTeam={gameState.cluesByTeam}
            requestsByTeam={gameState.requestsByTeam}
            teamsPublic={gameState.teamsPublic}
            activeTeamIds={activeRoundTeamIds}
            hiderFilterTeamId={hiderFilterTeamId}
            onChangeHiderFilterTeamId={setHiderFilterTeamId}
            hiddenClueIds={hiddenClueIds}
            onToggleClueOverlay={handleToggleClueOverlay}
            thermoPointA={thermoPointA}
            onSetThermoPointA={setThermoPointA}
            coneBearingDeg={coneBearingDeg}
            onChangeConeBearingDeg={setConeBearingDeg}
            selectedRadius={selectedRadius}
            onChangeSelectedRadius={setSelectedRadius}
            activePreviewQuestion={activePreviewQuestion}
            onChangePreviewQuestion={setActivePreviewQuestion}
            onNavigateToMap={() => setActiveTab('MAP')}
          />
        )}

        {/* TAB 3: QR-CODE (VERSTECKER, ADMIN & GEFANGENE TEAMS) ODER SCANNER (AKTIVE SUCHER) */}
        {activeTab === 'QR' &&
          (isOverviewOrSardineDashboard ? (
            <HiderQrView
              sessionId={publicState.sessionId}
              hiderPrivate={hiderPrivate}
              teamsPublic={gameState.teamsPublic}
              activeTeamIds={activeRoundTeamIds}
              sardineGroupMemberNames={sardineGroupMemberNames}
              canRerollSecrets={
                ownMember.side === 'HIDER' || isOverviewAccount
              }
              onRerollSecrets={handleRerollHiderSecrets}
            />
          ) : (
            <SeekerScannerView
              adapter={adapter}
              sessionId={publicState.sessionId}
              ownMember={ownMember}
              ownTeam={ownTeam}
              gameRunning={
                publicState.status === 'RUNNING' &&
                effectivePhase !== 'HIDING'
              }
            />
          ))}

        {/* TAB 4: RANGLISTE */}
        {activeTab === 'LEADERBOARD' && (
          <LeaderboardView
            leaderboard={gameState.leaderboard}
            teamsPublic={gameState.teamsPublic}
            activeTeamIds={activeRoundTeamIds}
            gameMode={publicState.gameMode ?? 'CLASSIC'}
            gameStatus={publicState.status}
            onReturnToLobbyByHost={
              isRoomHost && publicState.status !== 'LOBBY'
                ? handleReturnToLobbyByHost
                : undefined
            }
          />
        )}

        {/* TAB 5: SPIELER-PROFIL (PASSWORT ÄNDERN, STATS, AVATAR, EINSTELLUNGEN & SPICKZETTEL) */}
        {activeTab === 'PROFILE' && (
          <ProfileView
            adapter={adapter}
            ownMember={ownMember}
            ownTeam={ownTeam}
            publicState={publicState}
            members={gameState.members}
            presence={gameState.presence}
            connected={gameState.connected}
            ownFix={geo.currentFix}
            gpsStatus={geo.gpsStatus}
            gpsError={geo.gpsError}
            playerStats={playerStats}
            devicePrefs={devicePrefs}
            onChangeDevicePrefs={handleChangeDevicePrefs}
            onSelectAvatar={handleSelectAvatar}
            onRetryGps={geo.retryGpsPermission}
            onReturnToLobbyByHost={
              isRoomHost && publicState.status !== 'LOBBY'
                ? handleReturnToLobbyByHost
                : undefined
            }
            onLeaveRoom={handleLeaveRoom}
            onLogout={async () => {
              setActiveTab('LOBBY');
              await exitOrLogout();
            }}
          />
        )}

        {/* TAB 6: ADMIN-KONSOLE (STRIKT NUR FÜR DAS ADMIN-KONTO) */}
        {activeTab === 'HOST' && showHostTab && (
          <HostControlPanel
            adapter={adapter}
            ownMember={ownMember}
            publicState={publicState}
            hiderPrivate={hiderPrivate}
            readyPlayerIds={gameState.readyPlayerIds}
            members={gameState.members}
            presence={gameState.presence}
            teamsPublic={gameState.teamsPublic}
            cluesByTeam={gameState.cluesByTeam}
            requestsByTeam={gameState.requestsByTeam}
            onNavigateToMap={() => setActiveTab('MAP')}
            onOpenLobbySettings={() => setActiveTab('LOBBY')}
            recentRoomCodes={recentRooms.map((r) => r.roomCode)}
            onSwitchRoom={async (targetCode) => {
              const ok = await joinGameByCode(targetCode);
              if (ok) {
                setActiveTab('HOST');
              }
            }}
            onLeaveRoom={handleLeaveRoom}
            onLogoutAdmin={() => {
              setActiveTab('LOBBY');
              void exitOrLogout();
            }}
          />
        )}
      </main>

      {/* Schwebendes Antwortfenster für offene Kategorie-4-Fotoanfragen (nur im klassischen Modus) */}
      {!isManhunt && isSardineDashboardView && (
        <HiderMediaResponseModal
          adapter={adapter}
          openRequests={openHiderMediaRequests}
          teamsPublic={gameState.teamsPublic}
          teamLocations={gameState.teamLocations}
          anchorPoint={hiderPrivate?.anchorPoint ?? null}
          publicState={publicState}
          netElapsedMs={timer.netElapsedMs}
          sardineGroupMemberNames={sardineGroupMemberNames}
        />
      )}

      {/* Daumenfreundliche Bottom-Navigation (färbt sich bei Notfall ebenfalls rot) */}
      <BottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        showLobbyTab={
          publicState.status === 'LOBBY' || publicState.status === 'FINISHED'
        }
        inLobbyMode={publicState.status === 'LOBBY'}
        showHostTab={showHostTab}
        hostTabLabel="Admin"
        qrTabLabel={isOverviewOrSardineDashboard ? 'QR-Code' : 'Gefunden!'}
        hideQuestionsTab={isManhunt}
        hasActiveEmergency={hasActiveEmergency}
        pendingQuestionsBadgeCount={isManhunt ? 0 : openHiderMediaRequests.length}
      />
    </div>
  );
};
