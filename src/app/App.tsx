import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Anchor,
  CheckCircle2,
  Crosshair,
  EyeOff,
  AlertTriangle,
  Sparkles,
  QrCode,
  Layers,
  LogOut,
  RotateCcw,
  Eye,
  X,
  ArrowLeft,
  KeyRound,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  ANCHOR_ACCURACY_WARNING_METERS,
  ANCHOR_MANUAL_ADJUST_MAX_METERS,
  TEAM_PALETTE,
} from '../config/gameConfig';
import { computeHiderPasswordHash, findPresetPlayerById } from '../config/players';
import {
  isPointInPlayArea,
  validateManualAnchorSelection,
} from '../geo/boundary';
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
  filterOnlineEnabledMembers,
} from '../services/databaseAdapter';
import type {
  BottomNavTab,
  ClueRecord,
  ClueRequest,
  LatLng,
  QuestionType,
  RadiusOptionMeters,
} from '../types/game';
import { formatDurationClock, getQuestionLabelDe } from '../utils/formatting';
import { EmergencyMessageBanner } from '../components/Common/EmergencyMessageBanner';
import { PhysicsBottomSheet } from '../components/Common/PhysicsBottomSheet';
import { StatusBanners } from '../components/Common/StatusBanners';
import { LeashWarningBanner } from '../components/HUD/LeashWarningBanner';
import { TopHud } from '../components/HUD/TopHud';
import { LeaderboardView } from '../components/Leaderboard/LeaderboardView';
import { HostControlPanel } from '../components/Lobby/HostControlPanel';
import {
  LobbyStatusCard,
  LoginScreen,
  PendingApprovalScreen,
} from '../components/Lobby/LobbyView';
import { GameMap, type MapClickInteractionMode } from '../components/Map/GameMap';
import { BottomNav } from '../components/Navigation/BottomNav';
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
    ownMember,
    memberLoading,
    seatConflictError,
    loginError,
    logoutNotice,
    pendingHiderPasswordFor,
    clearPendingHiderPrompt,
    loginByTypedName,
    syncWithActiveHiderLock,
    unlockAdminWithCode,
    lockAdminConsole,
    claimInitialHost,
    exitOrLogout,
  } = useAuth();

  const gameState = useGameState(adapter, ownMember);
  const { publicState, hiderPrivate } = gameState;

  useEffect(() => {
    syncWithActiveHiderLock(gameState.activeHiderLock);
  }, [gameState.activeHiderLock, syncWithActiveHiderLock]);

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
  const [activeTab, setActiveTab] = useState<BottomNavTab>('MAP');
  const [hiddenClueIds, setHiddenClueIds] = useState<Set<string>>(new Set());
  const [thermoPointA, setThermoPointA] = useState<LatLng | null>(null);
  const [thermoPointB, setThermoPointB] = useState<LatLng | null>(null);
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
  const [seekerHidingMinimized, setSeekerHidingMinimized] = useState(true);
  const [hiderAnchorCollapsed, setHiderAnchorCollapsed] = useState(true);
  const [hiderFilterTeamId, setHiderFilterTeamId] = useState<string>('NONE');

  useEffect(() => {
    setHiderFilterTeamId('NONE');
    setHiddenClueIds(new Set());
  }, [publicState?.sessionId]);

  const [bootAdminModalOpen, setBootAdminModalOpen] = useState(false);
  const [bootAdminCode, setBootAdminCode] = useState('');
  const [bootAdminErr, setBootAdminErr] = useState<string | null>(null);
  const [emergencyFocusTarget, setEmergencyFocusTarget] = useState<{
    lat: number;
    lng: number;
    seq: number;
  } | null>(null);

  const handleUnlockAndEnterConsole = useCallback(
    async (code: string) => {
      const res = await unlockAdminWithCode(code);
      if (res.ok) {
        setActiveTab('HOST');
      }
      return res;
    },
    [unlockAdminWithCode]
  );

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

  // 1. Lade- & Authentifizierungs-Weichen
  if (authLoading || (isSessionUnlocked && memberLoading)) {
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

  if (!authUser || !isSessionUnlocked) {
    return (
      <LoginScreen
        firebaseAvailable={firebaseAvailable}
        loginError={loginError}
        logoutNotice={logoutNotice}
        pendingHiderPasswordFor={pendingHiderPasswordFor}
        onClearPendingHiderPrompt={clearPendingHiderPrompt}
        onLoginByName={loginByTypedName}
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
            Spielername bereits aktiv
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
            Abmelden / Anderen Namen wählen
          </button>
        </div>
      </div>
    );
  }

  if (!ownMember || !ownMember.enabled) {
    return (
      <PendingApprovalScreen
        authUser={authUser}
        loginError={loginError}
        onClaimInitialHost={claimInitialHost}
        onLogout={exitOrLogout}
      />
    );
  }

  if (!publicState) {
    const canInitAsAdmin = Boolean(
      findPresetPlayerById(ownMember.playerId)?.canUnlockAdmin
    );

    return (
      <div className="cmf-drafting-bg flex h-[100dvh] flex-col overflow-hidden text-sm text-[var(--text-main)]">
        {/* Obere Leiste mit Admin-Einstellungscode (Safe-Area-optimiert für Smartphones) */}
        <header className="border-b-[1.5px] border-[var(--shell-border)] bg-[var(--shell-bg)] pt-[max(0.45rem,env(safe-area-inset-top))] pr-[max(0.75rem,env(safe-area-inset-right))] pb-2 pl-[max(0.75rem,env(safe-area-inset-left))] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-[18px]">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
            <div className="cmf-oled flex items-center gap-2 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--cmf-amber)]" />
              <span className="font-dot text-xs text-[#F8FAFC]">
                81247 SARDINEN // INITIALISIERUNG
              </span>
            </div>
            {canInitAsAdmin && !ownMember.isHost && (
              <button
                type="button"
                data-testid="open-admin-code-btn"
                onClick={() => {
                  setBootAdminErr(null);
                  setBootAdminModalOpen((v) => !v);
                }}
                className={`inline-flex min-h-[36px] items-center gap-1 px-2.5 py-1.5 font-tech text-[11px] font-bold tracking-wider uppercase ${
                  bootAdminModalOpen ? 'cmf-btn-active' : 'cmf-btn-secondary'
                }`}
              >
                <KeyRound className="h-3.5 w-3.5 text-[var(--cmf-amber)]" />
                <span>Admin</span>
              </button>
            )}
          </div>

          {bootAdminModalOpen && canInitAsAdmin && !ownMember.isHost && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBootAdminErr(null);
                const res = await handleUnlockAndEnterConsole(bootAdminCode);
                if (res.ok) {
                  setBootAdminModalOpen(false);
                  setBootAdminCode('');
                } else {
                  setBootAdminErr(res.error ?? 'Falscher Admin-Code.');
                }
              }}
              className="cmf-module mx-auto mt-2 flex max-w-md flex-wrap items-center gap-2 p-2.5"
            >
              <input
                type="password"
                data-testid="admin-code-input"
                inputMode="numeric"
                autoFocus
                value={bootAdminCode}
                onChange={(e) => setBootAdminCode(e.target.value)}
                placeholder="Admin-Code eingeben"
                className="cmf-input font-tech min-h-[38px] flex-1 px-3 py-1.5 text-xs font-bold tracking-widest"
              />
              <button
                type="submit"
                data-testid="submit-admin-code-btn"
                disabled={!bootAdminCode.trim()}
                className="cmf-btn-primary font-dot min-h-[38px] px-4 py-1.5 text-xs"
              >
                OK
              </button>
              {bootAdminErr && (
                <span className="w-full font-tech text-[11px] font-bold text-[var(--cmf-orange)]">
                  {bootAdminErr}
                </span>
              )}
            </form>
          )}
        </header>

        <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
          <div className="cmf-chassis w-full max-w-md space-y-4 p-6">
            <p className="font-industrial text-base text-[var(--text-main)]">
              Hallo {ownMember.name}! Die Lobby wurde noch nicht initialisiert.
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              {canInitAsAdmin
                ? 'Nutze den „Admin“-Button in der oberen Leiste, um den Spielraum per Admin-Code zu starten.'
                : 'Bitte warte kurz, bis Lasse oder Linus den Spielraum über die obere Leiste gestartet haben ...'}
            </p>
            <button
              type="button"
              onClick={() => void exitOrLogout()}
              className="cmf-btn-secondary font-tech mt-2 w-full py-2.5 text-xs font-bold uppercase"
            >
              Namen wechseln
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isJoinedSardines = ownTeam?.status === 'JOINED_SARDINES';
  const isSardineDashboardView =
    ownMember.side === 'HIDER' || isJoinedSardines;
  const isActiveSeeker = Boolean(
    ownMember.side === 'SEEKER' && ownTeam && !isJoinedSardines
  );
  const canUseMapClicks = Boolean(publicState.allowTestClicks);
  const showHostTab = Boolean(ownMember.isHost);

  const activeRoundTeamIds =
    publicState.status === 'LOBBY' ? undefined : publicState.activeTeamIds;

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

  const openHiderMediaRequests: ClueRequest[] =
    isSardineDashboardView || (!isActiveSeeker && ownMember.isHost)
      ? Object.values(gameState.requestsByTeam)
          .flatMap((m) => Object.values(m))
          .filter(
            (r) =>
              r.sessionId === publicState.sessionId &&
              r.status === 'AWAITING_HIDER_MEDIA'
          )
      : [];

  const handleMapCoordinateClick = (pt: LatLng) => {
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
      geo.setManualTestLocation(pt);
      setMapClickMode({ kind: 'NONE' });
      return;
    }
    if (mapClickMode.kind === 'PICK_THERMO_A') {
      setThermoPointA(pt);
      setMapClickMode({ kind: 'NONE' });
      setActiveTab('QUESTIONS');
      return;
    }
    if (mapClickMode.kind === 'PICK_THERMO_B') {
      setThermoPointB(pt);
      setMapClickMode({ kind: 'NONE' });
      setActiveTab('QUESTIONS');
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

  const handleSetHiderPassword = async (rawPassword: string) => {
    const cleanPassword = rawPassword.trim();
    const passwordHash = computeHiderPasswordHash(cleanPassword);
    const onlineHiders = filterOnlineEnabledMembers(
      gameState.members,
      gameState.presence,
      ownMember.uid
    )
      .filter((m) => m.side === 'HIDER')
      .map((m) => m.playerId);
    const allAssignedHiders = deduplicateEnabledMembers(
      gameState.members,
      gameState.presence
    )
      .filter((m) => m.side === 'HIDER')
      .map((m) => m.playerId);
    const hiderPlayerIds =
      publicState.status === 'LOBBY' && onlineHiders.length > 0
        ? onlineHiders
        : allAssignedHiders.length > 0
          ? allAssignedHiders
          : onlineHiders;

    const newLock = await adapter.setHiderPasswordAndTriggerLogout({
      uid: ownMember.uid,
      sessionId: publicState.sessionId,
      cleanPassword,
      passwordHash,
      hiderPlayerIds,
      nowMs: adapter.getServerNow(),
    });
    syncWithActiveHiderLock(newLock);
  };

  const handleToggleOwnReady = async (nextReady: boolean) => {
    if (nextReady && gameState.activeHiderLock) {
      const token = buildReadyToken(
        publicState.sessionId,
        gameState.activeHiderLock.logoutGen
      );
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

  const effectivePhase =
    publicState.status === 'LOBBY' ? 'LOBBY' : timer.computedPhase;

  const canRehideWhileTimerActive =
    publicState.status !== 'LOBBY' &&
    ownMember.side === 'HIDER' &&
    effectivePhase === 'HIDING' &&
    timer.hidingRemainingMs > 0;

  const showHiderAnchorPanel =
    publicState.status !== 'LOBBY' &&
    ownMember.side === 'HIDER' &&
    (!hiderPrivate?.anchorPoint || (isRehidingAnchor && canRehideWhileTimerActive));

  const showSeekerHidingCard =
    publicState.status !== 'LOBBY' &&
    effectivePhase === 'HIDING' &&
    ownMember.side === 'SEEKER' &&
    !isJoinedSardines;

  const showQuickSardineFab =
    publicState.status !== 'LOBBY' &&
    isSardineDashboardView &&
    Boolean(hiderPrivate?.anchorPoint) &&
    !showHiderAnchorPanel;

  const hasMapBottomDock = Boolean(
    publicState.status === 'LOBBY' ||
      activePreviewQuestion ||
      showSeekerHidingCard ||
      showHiderAnchorPanel ||
      showQuickSardineFab
  );

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
        onUnlockAdmin={handleUnlockAndEnterConsole}
      />

      {/* 50-Meter-Versteck-Leash & Gebiets-Warnbanner */}
      <LeashWarningBanner
        isOwnSideHider={ownMember.side === 'HIDER'}
        leashState={geo.leashState}
        publicLeashAlertActive={publicState.leashAlertActive}
        isOutsidePlayArea={isOutsidePlayArea}
      />

      {/* Hauptbereich */}
      <main className="relative flex-1 min-h-0 w-full overflow-hidden">
        <div
          className={`h-full w-full ${
            activeTab === 'MAP' ? 'block' : 'hidden'
          }`}
        >
          <GameMap
            playArea={publicState.playArea.polygon}
            playAreaConfirmed={publicState.playArea.confirmed}
            ownFix={
              fineAdjustAnchorPt
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
            anchorPoint={hiderPrivate?.anchorPoint ?? null}
            showAnchorAndLeash={Boolean(
              isSardineDashboardView || (!isActiveSeeker && ownMember.isHost)
            )}
            publishedRadar={publicState.radarCircle}
            visibleTeamLocations={visibleMapTeamLocations}
            teamsPublic={gameState.teamsPublic}
            activeTeamIds={activeRoundTeamIds}
            clues={visibleMapClues}
            hiddenClueIds={hiddenClueIds}
            activePreviewQuestion={activePreviewQuestion}
            coneBearingDeg={coneBearingDeg}
            selectedRadius={selectedRadius}
            thermoPointA={thermoPointA}
            thermoPointB={thermoPointB}
            clickMode={mapClickMode}
            onMapCoordinateClick={handleMapCoordinateClick}
            onRequestGpsPermission={geo.retryGpsPermission}
            layoutInvalidationKey={`${activeTab}_${publicState.status}`}
            hasBottomDock={hasMapBottomDock}
            emergencyMessages={gameState.emergencyMessages}
            emergencyFocusTarget={emergencyFocusTarget}
          />

          {/* Obere schlanke Status-Pills & Verstecker-Teamfilter auf der Karte */}
          {(canUseMapClicks ||
            isJoinedSardines ||
            (isSardineDashboardView &&
              publicState.status !== 'LOBBY' &&
              roundSeekerTeamsForFilter.length > 0)) && (
            <div className="pointer-events-none absolute top-2.5 right-2.5 left-2.5 z-[400] flex flex-col gap-1.5">
              {(canUseMapClicks || isJoinedSardines) && (
                <div className="flex flex-wrap items-center justify-between gap-2">
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
                                  'Tippe auf einen Ort in 81247 München, um deine Test-Position zu setzen',
                              }
                        )
                      }
                      className={`pointer-events-auto inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 font-tech text-[11px] font-bold tracking-wider uppercase shadow-lg ${
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
                      {mapClickMode.kind === 'TEST_LOCATION'
                        ? 'Klick abbrechen'
                        : 'Test-Standort'}
                    </button>
                  )}

                  {isJoinedSardines && (
                    <div className="cmf-oled pointer-events-auto inline-flex items-center gap-2 px-3 py-1.5 font-tech text-[10px] font-bold tracking-wider text-[#F8FAFC] uppercase shadow-lg sm:text-[11px]">
                      <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-teal)]" />
                      <span>Verstecker-Team // HQ & QR aktiv</span>
                    </div>
                  )}
                </div>
              )}

              {isSardineDashboardView &&
                publicState.status !== 'LOBBY' &&
                roundSeekerTeamsForFilter.length > 0 && (
                  <div
                    data-testid="map-hider-team-filter"
                    className="cmf-no-scrollbar pointer-events-auto flex items-center gap-1 overflow-x-auto rounded-2xl border border-[var(--shell-border)] bg-[var(--shell-bg)] p-1 shadow-lg"
                  >
                    <button
                      type="button"
                      onClick={() => setHiderFilterTeamId('NONE')}
                      className={`shrink-0 rounded-xl px-2.5 py-1.5 font-tech text-[10px] font-bold uppercase transition-colors ${
                        hiderFilterTeamId === 'NONE'
                          ? 'bg-[#14171A] text-white'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                      }`}
                    >
                      Hinweise: Aus
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
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 font-tech text-[10px] font-bold uppercase transition-colors ${
                            active
                              ? 'bg-[#14171A] text-white'
                              : 'bg-white/70 text-[var(--text-main)]'
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
                )}
            </div>
          )}

          {/* Einheitliches Daumenzonen-Bottom-Dock am unteren Kartenrand (Smartphone-optimiert) */}
          <div className="pointer-events-none absolute right-2.5 bottom-2.5 left-2.5 z-[420] flex flex-col gap-2">
            {/* 1. Aktive Live-Hinweisvorschau mit direkten Einhand-Steuerelementen auf der Karte */}
            {activePreviewQuestion && (
              <div
                data-testid="map-active-preview-bar"
                className="cmf-oled cmf-sheet-up pointer-events-auto mx-auto w-full max-w-lg space-y-2.5 p-3 shadow-2xl"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Eye className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
                    <span className="truncate font-tech text-xs font-bold tracking-wider text-[#F8FAFC] uppercase">
                      VORSCHAU: {getQuestionLabelDe(activePreviewQuestion)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setActiveTab('QUESTIONS')}
                      className="cmf-btn-secondary font-tech inline-flex min-h-[38px] items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold uppercase"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      <span>Hinweise</span>
                    </button>
                    <button
                      type="button"
                      data-testid="end-map-preview-btn"
                      onClick={() => setActivePreviewQuestion(null)}
                      className="cmf-btn-primary font-dot inline-flex min-h-[38px] items-center gap-1 px-3 py-1.5 text-[11px] font-bold"
                    >
                      <X className="h-3.5 w-3.5" />
                      <span>Beenden</span>
                    </button>
                  </div>
                </div>

                {/* Direkte Einhand-Steuerung auf der Karte ohne Tab-Wechsel! */}
                {activePreviewQuestion === 'CONE_45' && (
                  <div className="space-y-1.5 border-t border-dashed border-[#27272A] pt-2">
                    <div className="flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setConeBearingDeg((d) => (d - 15 + 360) % 360)
                        }
                        className="cmf-btn-secondary min-h-[38px] flex-1 px-2 font-tech text-[11px] font-bold uppercase"
                      >
                        -15°
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConeBearingDeg((d) => (d - 5 + 360) % 360)
                        }
                        className="cmf-btn-secondary min-h-[38px] flex-1 px-2 font-tech text-[11px] font-bold uppercase"
                      >
                        -5°
                      </button>
                      <span className="min-w-[64px] text-center font-dot text-sm text-[var(--cmf-amber)]">
                        {coneBearingDeg}°
                      </span>
                      <button
                        type="button"
                        onClick={() => setConeBearingDeg((d) => (d + 5) % 360)}
                        className="cmf-btn-secondary min-h-[38px] flex-1 px-2 font-tech text-[11px] font-bold uppercase"
                      >
                        +5°
                      </button>
                      <button
                        type="button"
                        onClick={() => setConeBearingDeg((d) => (d + 15) % 360)}
                        className="cmf-btn-secondary min-h-[38px] flex-1 px-2 font-tech text-[11px] font-bold uppercase"
                      >
                        +15°
                      </button>
                    </div>
                  </div>
                )}

                {activePreviewQuestion === 'RADIUS_RADAR' && (
                  <div className="grid grid-cols-5 gap-1 border-t border-dashed border-[#27272A] pt-2">
                    {([50, 100, 250, 500, 1000] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setSelectedRadius(r)}
                        className={`min-h-[38px] rounded-lg px-1 font-tech text-[10px] font-bold uppercase ${
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

                {(activePreviewQuestion === 'SPLIT_NS' ||
                  activePreviewQuestion === 'SPLIT_EW') && (
                  <div className="grid grid-cols-2 gap-1.5 border-t border-dashed border-[#27272A] pt-2">
                    <button
                      type="button"
                      onClick={() => setActivePreviewQuestion('SPLIT_NS')}
                      className={`min-h-[38px] rounded-lg px-2 font-tech text-[11px] font-bold uppercase ${
                        activePreviewQuestion === 'SPLIT_NS'
                          ? 'bg-[var(--cmf-orange)] text-white'
                          : 'bg-[#181B20] text-[#CBD2D9]'
                      }`}
                    >
                      Nord / Süd
                    </button>
                    <button
                      type="button"
                      onClick={() => setActivePreviewQuestion('SPLIT_EW')}
                      className={`min-h-[38px] rounded-lg px-2 font-tech text-[11px] font-bold uppercase ${
                        activePreviewQuestion === 'SPLIT_EW'
                          ? 'bg-[var(--cmf-orange)] text-white'
                          : 'bg-[#181B20] text-[#CBD2D9]'
                      }`}
                    >
                      Ost / West
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 2. Einklappbares Lobby-Bottom-Sheet in der Daumenzone */}
            {publicState.status === 'LOBBY' && (
              <LobbyStatusCard
                publicState={publicState}
                ownMember={ownMember}
                members={gameState.members}
                presence={gameState.presence}
                teamsPublic={gameState.teamsPublic}
                activeHiderLock={gameState.activeHiderLock}
                readyPlayerIds={gameState.readyPlayerIds}
                onSetHiderPassword={handleSetHiderPassword}
                onToggleOwnReady={handleToggleOwnReady}
                onOpenHostTab={
                  showHostTab ? () => setActiveTab('HOST') : undefined
                }
                onLogout={exitOrLogout}
              />
            )}

            {/* 3. Einklappbares Sucher-Bottom-Sheet während der Versteckphase (mit Zieh-Physik!) */}
            {showSeekerHidingCard && !activePreviewQuestion && (
              <PhysicsBottomSheet
                collapsed={seekerHidingMinimized}
                onCollapsedChange={setSeekerHidingMinimized}
                allowBodyDrag
                maxWidthClass="max-w-md"
                bodyClassName="px-4 pt-2.5 pb-3.5 text-center"
                header={
                  <div className="flex w-full items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="cmf-oled flex h-9 w-9 shrink-0 items-center justify-center text-[var(--cmf-amber)]">
                        <EyeOff className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 text-left">
                        <span className="block truncate font-industrial text-sm text-[var(--text-main)]">
                          Sardinen verstecken sich ...
                        </span>
                        <span className="font-tech text-[10px] text-[var(--text-muted)] uppercase">
                          Verteilt euch in 81247!
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="cmf-oled px-2.5 py-1 font-dot text-base text-[var(--cmf-amber)]">
                        {formatDurationClock(timer.hidingRemainingMs)}
                      </span>
                      {seekerHidingMinimized ? (
                        <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
                      )}
                    </div>
                  </div>
                }
              >
                <p className="text-xs text-[var(--text-muted)]">
                  Keine Verstecker-Bewegungen sichtbar. Ziehe diese Karte nach unten, um das 81247-Gebiet frei zu erkunden!
                </p>
                <p className="mt-2 font-tech text-[10px] tracking-wider text-[var(--text-muted)] uppercase">
                  OFFENE SUCHE & HINWEISE STARTEN BEI{' '}
                  {formatDurationClock(publicState.radarSchedule.hidingDurationMs)}
                </p>
              </PhysicsBottomSheet>
            )}

            {/* 4. Verstecker-Panel zum Fixieren / Neu-Wählen des Anchor Points (mit Zieh-Physik!) */}
            {showHiderAnchorPanel && (
              mapClickMode.kind === 'PICK_ANCHOR_POINT' ? (
                <div className="cmf-chassis cmf-sheet-up pointer-events-auto mx-auto w-full max-w-lg space-y-2 p-3.5 sm:p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-tech text-xs font-bold text-[var(--text-main)] uppercase">
                      Tippe jetzt auf euer Versteck (max. {ANCHOR_MANUAL_ADJUST_MAX_METERS} m um dein GPS) ...
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setAnchorFeedbackError(null);
                        setMapClickMode({ kind: 'NONE' });
                      }}
                      className="cmf-btn-active font-tech min-h-[40px] shrink-0 px-3 py-1.5 text-[11px] font-bold uppercase"
                    >
                      Abbrechen
                    </button>
                  </div>
                  {anchorFeedbackError && (
                    <div className="cmf-badge-orange cmf-shake rounded-xl p-2.5 text-xs font-semibold">
                      {anchorFeedbackError}
                    </div>
                  )}
                </div>
              ) : (
                <PhysicsBottomSheet
                  collapsed={hiderAnchorCollapsed}
                  onCollapsedChange={setHiderAnchorCollapsed}
                  allowBodyDrag
                  maxWidthClass="max-w-lg"
                  bodyClassName="p-3.5 pt-2.5 sm:p-4 sm:pt-3"
                  header={
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Anchor className="h-4 w-4 shrink-0 text-[var(--cmf-orange)]" />
                        <h3 className="truncate font-industrial text-sm text-[var(--text-main)]">
                          {hiderPrivate?.anchorPoint
                            ? 'Versteck neu wählen'
                            : 'Sardinen-Versteck wählen'}
                        </h3>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="cmf-oled px-2.5 py-1 font-tech text-[10px] font-bold text-[var(--cmf-teal)] sm:text-[11px]">
                          {fineAdjustAnchorPt
                            ? 'PIN: MANUELL'
                            : `GPS: ${geo.currentFix ? `±${Math.round(geo.currentFix.accuracy)}M` : '...'}`}
                        </span>
                        {hiderPrivate?.anchorPoint && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsRehidingAnchor(false);
                              setFineAdjustAnchorPt(null);
                              setMapClickMode({ kind: 'NONE' });
                            }}
                            className="min-h-[32px] px-1 font-tech text-[10px] font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] uppercase"
                          >
                            [Abbrechen]
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
                  <div className="cmf-well space-y-2 p-2.5 sm:p-3 text-xs text-[var(--text-main)]">
                    <span className="block font-medium text-[var(--text-muted)]">
                      {fineAdjustAnchorPt
                        ? `Exakte Position gewählt: [${fineAdjustAnchorPt.lat.toFixed(5)}, ${fineAdjustAnchorPt.lng.toFixed(5)}]`
                        : `Weicht das GPS ab? Tippe eure exakte Versteck-Position innerhalb von ${ANCHOR_MANUAL_ADJUST_MAX_METERS} m um dein GPS auf der Karte an:`}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid="pinpoint-anchor-on-map-btn"
                        disabled={!geo.currentFix}
                        onClick={() => {
                          setAnchorFeedbackError(null);
                          setMapClickMode({
                            kind: 'PICK_ANCHOR_POINT',
                            label:
                              `Tippe innerhalb des ${ANCHOR_MANUAL_ADJUST_MAX_METERS}m-Kreises um deine GPS-Position`,
                          });
                        }}
                        className="cmf-btn-secondary font-tech inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 bg-white/75 px-3 py-2 text-[11px] font-bold text-[var(--text-main)] uppercase"
                      >
                        <Crosshair className="h-4 w-4 shrink-0 text-[var(--cmf-orange)]" />
                        <span>
                          {geo.currentFix
                            ? `Position auf Karte antippen (max. ${ANCHOR_MANUAL_ADJUST_MAX_METERS} m)`
                            : 'Warte auf GPS-Signal ...'}
                        </span>
                      </button>

                      {fineAdjustAnchorPt && (
                        <button
                          type="button"
                          onClick={() => {
                            setFineAdjustAnchorPt(null);
                            setMapClickMode({ kind: 'NONE' });
                          }}
                          className="cmf-btn-secondary font-tech min-h-[42px] px-3 py-2 text-[11px] font-bold uppercase"
                        >
                          GPS nutzen
                        </button>
                      )}

                      {geo.currentFix &&
                        geo.currentFix.accuracy >
                          ANCHOR_ACCURACY_WARNING_METERS && (
                          <button
                            type="button"
                            onClick={geo.retryGpsPermission}
                            className="cmf-btn-secondary font-tech inline-flex min-h-[42px] items-center gap-1 px-2.5 py-2 text-[11px] font-bold text-[var(--text-main)] uppercase"
                          >
                            <AlertTriangle className="h-3.5 w-3.5 text-[var(--cmf-amber)]" />
                            GPS neu (±{Math.round(geo.currentFix.accuracy)}m)
                          </button>
                        )}
                    </div>
                  </div>

                  {anchorFeedbackError && (
                    <div className="cmf-badge-orange cmf-shake mt-2.5 rounded-xl p-2.5 text-xs font-semibold">
                      {anchorFeedbackError}
                    </div>
                  )}

                  <button
                    type="button"
                    data-testid="lock-anchor-btn"
                    onClick={() => void handleLockAnchorByHider()}
                    className="cmf-btn-primary font-dot mt-2.5 flex min-h-[48px] w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {hiderPrivate?.anchorPoint
                      ? 'Neues Versteck jetzt hier fixieren'
                      : 'Versteck jetzt hier fixieren'}
                  </button>
                </PhysicsBottomSheet>
              )
            )}

            {/* 5. Schnellzugriff „Versteck neu wählen“ & „Sardinen-QR-Code zeigen“ */}
            {showQuickSardineFab && (
              <div className="cmf-sheet-up pointer-events-auto mx-auto flex w-full max-w-lg items-center justify-end gap-2">
                {canRehideWhileTimerActive && (
                  <button
                    type="button"
                    data-testid="rehide-anchor-btn"
                    onClick={() => {
                      setAnchorFeedbackError(null);
                      setIsRehidingAnchor(true);
                      setHiderAnchorCollapsed(false);
                    }}
                    className="cmf-btn-active font-tech inline-flex min-h-[48px] flex-1 sm:flex-initial items-center justify-center gap-1.5 px-3.5 py-2.5 text-xs font-bold uppercase shadow-lg"
                  >
                    <RotateCcw className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
                    <span>Neu verstecken</span>
                  </button>
                )}

                <button
                  type="button"
                  data-testid="quick-show-sardinen-qr-btn"
                  onClick={() => setActiveTab('QR')}
                  className="cmf-btn-primary font-dot inline-flex min-h-[48px] flex-1 sm:flex-initial items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold shadow-lg"
                >
                  <QrCode className="h-4 w-4 shrink-0" />
                  <span>QR-Code zeigen</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* TAB 2: HINWEIS-MENÜ & VERLAUF */}
        {activeTab === 'QUESTIONS' && (
          <QuestionMenu
            adapter={adapter}
            publicState={publicState}
            netElapsedMs={timer.netElapsedMs}
            ownMember={ownMember}
            ownTeam={ownTeam}
            ownFix={geo.currentFix}
            canUseMapClicks={canUseMapClicks}
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
            thermoPointB={thermoPointB}
            onSetThermoPointB={setThermoPointB}
            coneBearingDeg={coneBearingDeg}
            onChangeConeBearingDeg={setConeBearingDeg}
            selectedRadius={selectedRadius}
            onChangeSelectedRadius={setSelectedRadius}
            activePreviewQuestion={activePreviewQuestion}
            onChangePreviewQuestion={setActivePreviewQuestion}
            onRequestMapPointPick={setMapClickMode}
            onNavigateToMap={() => setActiveTab('MAP')}
          />
        )}

        {/* TAB 3: QR-CODE (VERSTECKER & GEFANGENE TEAMS) ODER SCANNER (AKTIVE SUCHER) */}
        {activeTab === 'QR' &&
          (isSardineDashboardView ? (
            <HiderQrView
              sessionId={publicState.sessionId}
              hiderPrivate={hiderPrivate}
              teamsPublic={gameState.teamsPublic}
              activeTeamIds={activeRoundTeamIds}
              sardineGroupMemberNames={sardineGroupMemberNames}
              canChangeHiderPassword={ownMember.side === 'HIDER'}
              onSetHiderPassword={handleSetHiderPassword}
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
          />
        )}

        {/* TAB 5: SPIELLEITER (HOST) */}
        {activeTab === 'HOST' && showHostTab && (
          <HostControlPanel
            adapter={adapter}
            ownMember={ownMember}
            publicState={publicState}
            hiderPrivate={hiderPrivate}
            activeHiderLock={gameState.activeHiderLock}
            readyPlayerIds={gameState.readyPlayerIds}
            members={gameState.members}
            joinRequests={gameState.joinRequests}
            presence={gameState.presence}
            teamsPublic={gameState.teamsPublic}
            onNavigateToMap={() => setActiveTab('MAP')}
            onLeaveAndLockConsole={() => {
              setActiveTab('MAP');
              void lockAdminConsole();
            }}
          />
        )}
      </main>

      {/* Schwebendes Antwortfenster für offene Kategorie-4-Fotoanfragen (für alle Mitglieder der Verstecker-Gruppe) */}
      {isSardineDashboardView && (
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
        showHostTab={showHostTab}
        hasActiveEmergency={hasActiveEmergency}
        pendingQuestionsBadgeCount={openHiderMediaRequests.length}
        joinRequestsBadgeCount={Object.keys(gameState.joinRequests).length}
      />
    </div>
  );
};
