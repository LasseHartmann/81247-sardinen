import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
} from 'lucide-react';
import { ANCHOR_ACCURACY_WARNING_METERS } from '../config/gameConfig';
import { computeHiderPasswordHash } from '../config/players';
import { isPointInPlayArea } from '../geo/boundary';
import { buildQuestionPreviewGeoJson } from '../geo/clueGeometry';
import { computePossibleHidingArea } from '../geo/hidingArea';
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

  const [bootAdminModalOpen, setBootAdminModalOpen] = useState(false);
  const [bootAdminCode, setBootAdminCode] = useState('');
  const [bootAdminErr, setBootAdminErr] = useState<string | null>(null);

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

  // Sobald der Admin die Spielleiter-Konsole verlässt (Tabwechsel oder App in Hintergrund),
  // werden die Admin-Rechte automatisch wieder gesperrt -> beim nächsten Öffnen muss der Code erneut eingegeben werden.
  const prevTabRef = useRef<BottomNavTab>(activeTab);
  useEffect(() => {
    const prevTab = prevTabRef.current;
    prevTabRef.current = activeTab;
    if (ownMember?.isHost && prevTab === 'HOST' && activeTab !== 'HOST') {
      void lockAdminConsole();
    }
  }, [activeTab, lockAdminConsole, ownMember?.isHost]);

  useEffect(() => {
    if (!ownMember?.isHost) return;
    const handleVisibilityOrHide = () => {
      if (document.visibilityState === 'hidden') {
        setActiveTab('MAP');
        void lockAdminConsole();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityOrHide);
    window.addEventListener('pagehide', handleVisibilityOrHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityOrHide);
      window.removeEventListener('pagehide', handleVisibilityOrHide);
    };
  }, [lockAdminConsole, ownMember?.isHost]);

  // 1. Lade- & Authentifizierungs-Weichen
  if (authLoading || (isSessionUnlocked && memberLoading)) {
    return (
      <div className="cmf-drafting-bg flex h-[100dvh] items-center justify-center p-4">
        <div className="cmf-oled flex items-center gap-3 px-5 py-3 shadow-xl">
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
    const canInitAsAdmin =
      ownMember.playerId === 'lasse' || ownMember.playerId === 'linus';

    return (
      <div className="cmf-drafting-bg flex h-[100dvh] flex-col overflow-hidden text-sm text-[var(--text-main)]">
        {/* Obere Leiste mit Admin-Einstellungscode */}
        <header className="border-b-[1.5px] border-[var(--shell-border)] bg-[var(--shell-bg)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-[18px]">
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
  const canUseMapClicks = Boolean(publicState.allowTestClicks);
  const showHostTab = Boolean(ownMember.isHost);

  const activeRoundTeamIds =
    publicState.status === 'LOBBY' ? undefined : publicState.activeTeamIds;

  // Aggregiere sichtbare Hinweise & Requests für den aktuellen Spieler
  const visibleClues: ClueRecord[] =
    ownMember.side === 'SEEKER' && ownTeam
      ? Object.values(gameState.cluesByTeam[ownTeam.id] ?? {})
      : Object.values(gameState.cluesByTeam).flatMap((m) => Object.values(m));

  const visibleRequestsMap: Record<string, ClueRequest> =
    ownMember.side === 'SEEKER' && ownTeam
      ? (gameState.requestsByTeam[ownTeam.id] ?? {})
      : Object.assign({}, ...Object.values(gameState.requestsByTeam));

  const openHiderMediaRequests: ClueRequest[] =
    ownMember.side === 'HIDER' || ownMember.isHost
      ? Object.values(gameState.requestsByTeam)
          .flatMap((m) => Object.values(m))
          .filter(
            (r) =>
              r.sessionId === publicState.sessionId &&
              r.status === 'AWAITING_HIDER_MEDIA'
          )
      : [];

  const livePreviewGeo = activePreviewQuestion
    ? buildQuestionPreviewGeoJson(
        activePreviewQuestion,
        {
          bearingDeg: coneBearingDeg,
          radiusMeters: selectedRadius,
          pointA: thermoPointA ?? undefined,
          pointB: (thermoPointB ?? geo.currentFix) ?? undefined,
        },
        geo.currentFix,
        computePossibleHidingArea({
          playArea: publicState.playArea.polygon,
          clues: visibleClues,
          hiddenClueIds,
          publishedRadar: publicState.radarCircle,
        }) ?? publicState.playArea.polygon
      )
    : null;

  const handleMapCoordinateClick = (pt: LatLng) => {
    if (mapClickMode.kind === 'PICK_ANCHOR_POINT') {
      if (!isPointInPlayArea(pt, publicState.playArea.polygon)) {
        setAnchorFeedbackError(
          'Bitte tippe auf einen Punkt innerhalb der markierten 81247-Zone!'
        );
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
        'Noch kein GPS-Standort verfügbar. Nutze „Position auf Karte exakt antippen“ oder warte auf ein GPS-Signal.'
      );
      return;
    }
    if (!isPointInPlayArea(target, publicState.playArea.polygon)) {
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

  const ownEmergencyMessage =
    gameState.emergencyMessages.find((m) => m.uid === ownMember.uid) ?? null;

  const handleSendEmergencyMessage = async (text: string) => {
    await adapter.sendEmergencyMessage({
      uid: ownMember.uid,
      playerId: ownMember.playerId,
      senderName: ownMember.name,
      text,
      createdAt: adapter.getServerNow(),
    });
  };

  const handleClearOwnEmergencyMessage = async () => {
    await adapter.clearOwnEmergencyMessage(ownMember.uid);
  };

  const handleSetHiderPassword = async (rawPassword: string) => {
    const cleanPassword = rawPassword.trim();
    const passwordHash = computeHiderPasswordHash(cleanPassword);
    const hiderPlayerIds = deduplicateEnabledMembers(
      gameState.members,
      gameState.presence
    )
      .filter((m) => m.side === 'HIDER')
      .map((m) => m.playerId);

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

  return (
    <div className="cmf-drafting-bg flex h-[100dvh] w-full flex-col overflow-hidden text-[var(--text-main)]">
      {/* Offline-Banner, Pausen-Banner & Controller-Warteschlangen-Banner */}
      <StatusBanners
        connected={gameState.connected}
        isControllerDisconnected={controllerStatus.isControllerDisconnected}
        gameStatus={publicState.status}
      />

      {/* Dauerhaft für alle sichtbare Notfallnachrichten */}
      <EmergencyMessageBanner
        messages={gameState.emergencyMessages}
        ownUid={ownMember.uid}
        onClearOwnMessage={handleClearOwnEmergencyMessage}
      />

      {/* Kompaktes Top-HUD im Raw-Light-Hardware-Design (einziger Ort für Admin-Code!) */}
      <TopHud
        publicState={publicState}
        timer={timer}
        ownMember={ownMember}
        ownTeam={ownTeam}
        connected={gameState.connected}
        ownFix={geo.currentFix}
        gpsStatus={geo.gpsStatus}
        ownEmergencyMessage={ownEmergencyMessage}
        onSendEmergencyMessage={handleSendEmergencyMessage}
        onClearOwnEmergencyMessage={handleClearOwnEmergencyMessage}
        onUnlockAdmin={handleUnlockAndEnterConsole}
      />

      {/* 20-Meter-Versteck-Leash Warnbanner */}
      <LeashWarningBanner
        isOwnSideHider={ownMember.side === 'HIDER'}
        leashState={geo.leashState}
        publicLeashAlertActive={publicState.leashAlertActive}
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
                    timestamp: Date.now(),
                  }
                : geo.currentFix
            }
            isOwnSideHider={isSardineDashboardView}
            anchorPoint={hiderPrivate?.anchorPoint ?? null}
            showAnchorAndLeash={Boolean(
              isSardineDashboardView || ownMember.isHost
            )}
            publishedRadar={publicState.radarCircle}
            visibleTeamLocations={gameState.teamLocations}
            teamsPublic={gameState.teamsPublic}
            activeTeamIds={activeRoundTeamIds}
            clues={visibleClues}
            hiddenClueIds={hiddenClueIds}
            liveConePreview={livePreviewGeo}
            thermoPointA={thermoPointA}
            thermoPointB={thermoPointB}
            clickMode={mapClickMode}
            onMapCoordinateClick={handleMapCoordinateClick}
            layoutInvalidationKey={`${activeTab}_${publicState.status}`}
          />

          {/* Schwebende OLED-/Hardware-Aktions-Pills auf der Karte */}
          <div className="pointer-events-none absolute top-3 right-3 left-3 z-[400] flex flex-col gap-2">
            <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2">
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
                    ? 'Kartenklick abbrechen'
                    : 'Test-Standort per Klick'}
                </button>
              )}

              {isJoinedSardines && (
                <div className="cmf-oled pointer-events-auto inline-flex items-center gap-2 px-3.5 py-1.5 font-tech text-[11px] font-bold tracking-wider text-[#F8FAFC] uppercase shadow-lg">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                  Bei den Sardinen // HQ & QR freigeschaltet
                </div>
              )}
            </div>

            {/* Schwebende Steuerleiste für aktive Hinweis-Vorschau auf der Karte (jederzeit beendbar!) */}
            {activePreviewQuestion && (
              <div
                data-testid="map-active-preview-bar"
                className="cmf-oled pointer-events-auto mx-auto flex w-full max-w-lg flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 shadow-xl"
              >
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
                  <span className="font-tech text-xs font-bold tracking-wider text-[#F8FAFC] uppercase">
                    VORSCHAU: {getQuestionLabelDe(activePreviewQuestion)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('QUESTIONS')}
                    className="cmf-btn-secondary font-tech inline-flex min-h-[34px] items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Zu Hinweise
                  </button>
                  <button
                    type="button"
                    data-testid="end-map-preview-btn"
                    onClick={() => setActivePreviewQuestion(null)}
                    className="cmf-btn-primary font-dot inline-flex min-h-[34px] items-center gap-1 px-3 py-1 text-[11px] font-bold"
                  >
                    <X className="h-3.5 w-3.5" />
                    Vorschau beenden
                  </button>
                </div>
              </div>
            )}

            {/* LOBBY-Statuskarte auf der Karte */}
            {publicState.status === 'LOBBY' && (
              <div className="mt-1">
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
              </div>
            )}

            {/* SUCHER-ANSICHT WÄHREND DER VERSTECKPHASE */}
            {publicState.status !== 'LOBBY' &&
              effectivePhase === 'HIDING' &&
              ownMember.side === 'SEEKER' &&
              !isJoinedSardines && (
                <div className="cmf-chassis pointer-events-auto mx-auto mt-2 w-full max-w-md p-5 text-center">
                  <div className="cmf-oled mx-auto mb-3 flex h-12 w-12 items-center justify-center text-[var(--cmf-amber)]">
                    <EyeOff className="h-5 w-5" />
                  </div>
                  <h2 className="font-dot text-lg text-[var(--text-main)]">
                    Die Sardinen verstecken sich ...
                  </h2>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Keine Verstecker-Bewegungen sichtbar. Nutzt die Zeit, euch innerhalb der markierten 81247-Zone strategisch zu verteilen!
                  </p>
                  <div className="cmf-oled mt-3.5 py-3 font-dot text-2xl text-[var(--cmf-amber)]">
                    {formatDurationClock(timer.hidingRemainingMs)}
                  </div>
                  <p className="mt-2 font-tech text-[10px] tracking-wider text-[var(--text-muted)] uppercase">
                    OFFENE SUCHE & HINWEISE STARTEN AUTOMATISCH BEI{' '}
                    {formatDurationClock(publicState.radarSchedule.hidingDurationMs)}
                  </p>
                </div>
              )}
          </div>

          {/* VERSTECKER-PANEL ZUM FIXIEREN ODER NEU-WÄHLEN DES ANCHOR POINTS */}
          {showHiderAnchorPanel && (
            <div className="cmf-chassis pointer-events-auto absolute inset-x-3 bottom-3 z-[420] mx-auto max-w-lg p-4">
              <div className="flex items-center justify-between gap-2 border-b cmf-divider pb-2.5">
                <div className="flex items-center gap-2">
                  <Anchor className="h-4 w-4 text-[var(--cmf-orange)]" />
                  <h3 className="font-industrial text-sm text-[var(--text-main)]">
                    {hiderPrivate?.anchorPoint
                      ? 'Versteck neu wählen (solange Timer läuft)'
                      : 'Sardinen-Versteck (Anchor Point) wählen'}
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="cmf-oled px-2.5 py-1 font-tech text-[11px] font-bold text-[var(--cmf-teal)]">
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
                      className="font-tech text-[10px] font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] uppercase"
                    >
                      [Abbrechen]
                    </button>
                  )}
                </div>
              </div>

              {/* Immer verfügbare Option zum exakten Antippen auf der Karte, falls GPS abweicht */}
              <div className="cmf-well mt-2.5 space-y-2 p-3 text-xs text-[var(--text-main)]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-[var(--text-muted)]">
                    {fineAdjustAnchorPt
                      ? `Exakte Position gewählt: [${fineAdjustAnchorPt.lat.toFixed(5)}, ${fineAdjustAnchorPt.lng.toFixed(5)}]`
                      : 'Weicht das GPS ab? Tippe eure exakte Versteck-Position direkt auf der Karte an:'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="pinpoint-anchor-on-map-btn"
                    onClick={() =>
                      setMapClickMode((prev) =>
                        prev.kind === 'PICK_ANCHOR_POINT'
                          ? { kind: 'NONE' }
                          : {
                              kind: 'PICK_ANCHOR_POINT',
                              label:
                                'Tippe auf eure exakte Versteck-Position innerhalb des 81247-Polygons',
                            }
                      )
                    }
                    className={`font-tech inline-flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase ${
                      mapClickMode.kind === 'PICK_ANCHOR_POINT'
                        ? 'cmf-btn-active'
                        : 'cmf-btn-secondary bg-white/70 text-[var(--text-main)]'
                    }`}
                  >
                    <Crosshair className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                    {mapClickMode.kind === 'PICK_ANCHOR_POINT'
                      ? 'Kartenauswahl aktiv (Antippen ...)'
                      : 'Position auf Karte exakt antippen'}
                  </button>

                  {fineAdjustAnchorPt && (
                    <button
                      type="button"
                      onClick={() => {
                        setFineAdjustAnchorPt(null);
                        setMapClickMode({ kind: 'NONE' });
                      }}
                      className="cmf-btn-secondary font-tech min-h-[38px] px-2.5 py-1.5 text-[11px] font-bold uppercase"
                    >
                      Auf GPS zurücksetzen
                    </button>
                  )}

                  {geo.currentFix &&
                    geo.currentFix.accuracy > ANCHOR_ACCURACY_WARNING_METERS && (
                      <button
                        type="button"
                        onClick={geo.retryGpsPermission}
                        className="cmf-btn-secondary font-tech inline-flex min-h-[38px] items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-[var(--text-main)] uppercase"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 text-[var(--cmf-amber)]" />
                        GPS neu messen (±{Math.round(geo.currentFix.accuracy)}m)
                      </button>
                    )}
                </div>
              </div>

              {anchorFeedbackError && (
                <div className="cmf-badge-orange mt-2.5 rounded-xl p-2.5 text-xs font-semibold">
                  {anchorFeedbackError}
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  data-testid="lock-anchor-btn"
                  onClick={() => void handleLockAnchorByHider()}
                  className="cmf-btn-primary font-dot flex min-h-[46px] w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {hiderPrivate?.anchorPoint
                    ? 'Neues Versteck jetzt hier fixieren'
                    : 'Versteck jetzt hier fixieren'}
                </button>
              </div>
            </div>
          )}

          {/* Schnellzugriff „Versteck neu wählen“ (solange Timer läuft) & „Sardinen-QR-Code zeigen“ */}
          {publicState.status !== 'LOBBY' &&
            isSardineDashboardView &&
            hiderPrivate?.anchorPoint &&
            !showHiderAnchorPanel && (
              <div className="pointer-events-auto absolute right-3 bottom-3 left-3 z-[410] flex flex-wrap items-center justify-end gap-2">
                {canRehideWhileTimerActive && (
                  <button
                    type="button"
                    data-testid="rehide-anchor-btn"
                    onClick={() => {
                      setAnchorFeedbackError(null);
                      setIsRehidingAnchor(true);
                    }}
                    className="cmf-btn-active font-tech inline-flex min-h-[46px] items-center gap-1.5 px-3.5 py-2.5 text-xs font-bold uppercase shadow-lg"
                  >
                    <RotateCcw className="h-4 w-4 text-[var(--cmf-teal)]" />
                    Versteck neu wählen
                  </button>
                )}

                <button
                  type="button"
                  data-testid="quick-show-sardinen-qr-btn"
                  onClick={() => setActiveTab('QR')}
                  className="cmf-btn-primary font-dot inline-flex min-h-[46px] items-center gap-2 px-4 py-2.5 text-xs font-bold shadow-lg"
                >
                  <QrCode className="h-4 w-4" />
                  Sardinen-QR-Code zeigen
                </button>
              </div>
            )}
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
            teamClues={
              ownMember.side === 'SEEKER' && ownTeam
                ? (gameState.cluesByTeam[ownTeam.id] ?? {})
                : Object.fromEntries(visibleClues.map((c) => [c.id, c]))
            }
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

      {/* Schwebendes Hider-Antwortfenster für offene Kategorie-4-Medienanfragen */}
      {ownMember.side === 'HIDER' && (
        <HiderMediaResponseModal
          adapter={adapter}
          openRequests={openHiderMediaRequests}
          teamsPublic={gameState.teamsPublic}
          teamLocations={gameState.teamLocations}
          anchorPoint={hiderPrivate?.anchorPoint ?? null}
          publicState={publicState}
          netElapsedMs={timer.netElapsedMs}
        />
      )}

      {/* Daumenfreundliche Bottom-Navigation */}
      <BottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        showHostTab={showHostTab}
        pendingQuestionsBadgeCount={openHiderMediaRequests.length}
        joinRequestsBadgeCount={Object.keys(gameState.joinRequests).length}
      />
    </div>
  );
};
