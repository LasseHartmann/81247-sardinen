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
} from 'lucide-react';
import {
  ANCHOR_ACCURACY_WARNING_METERS,
  ANCHOR_MANUAL_ADJUST_MAX_METERS,
} from '../config/gameConfig';
import { computeHiderPasswordHash } from '../config/players';
import { isPointInPlayArea } from '../geo/boundary';
import { buildCone45Polygon } from '../geo/clueGeometry';
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
} from '../services/databaseAdapter';
import type { BottomNavTab, ClueRecord, ClueRequest, LatLng } from '../types/game';
import { formatDurationClock } from '../utils/formatting';
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
  const [selectedSplitPoint, setSelectedSplitPoint] = useState<LatLng | null>(
    null
  );
  const [thermoPointA, setThermoPointA] = useState<LatLng | null>(null);
  const [thermoPointB, setThermoPointB] = useState<LatLng | null>(null);
  const [coneBearingDeg, setConeBearingDeg] = useState<number>(0);
  const [conePreviewEnabled, setConePreviewEnabled] = useState<boolean>(false);
  const [mapClickMode, setMapClickMode] = useState<MapClickInteractionMode>({
    kind: 'NONE',
  });
  const [fineAdjustAnchorPt, setFineAdjustAnchorPt] = useState<LatLng | null>(
    null
  );
  const [anchorFeedbackError, setAnchorFeedbackError] = useState<string | null>(
    null
  );

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
      <div className="flex h-[100dvh] items-center justify-center bg-[#020617] text-sm font-bold text-cyan-300">
        81247 Sardinen wird geladen ...
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
      <div className="flex h-[100dvh] flex-col items-center justify-center bg-[#020617] p-6 text-center text-slate-100">
        <div className="w-full max-w-md space-y-4 rounded-3xl border border-amber-500/50 bg-slate-900 p-6 shadow-2xl">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-300">
            <Layers className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-black text-white">
            Spielername bereits aktiv
          </h1>
          <p className="text-xs leading-relaxed text-slate-300">
            {seatConflictError}
          </p>
          <button
            type="button"
            onClick={() => void exitOrLogout()}
            className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-700"
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
      <div className="flex h-[100dvh] flex-col items-center justify-center bg-[#020617] p-6 text-center text-sm text-slate-300">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <p className="font-bold text-white">
            Hallo {ownMember.name}! Die Lobby wurde noch nicht initialisiert.
          </p>
          {canInitAsAdmin && !ownMember.isHost ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBootAdminErr(null);
                const res = await handleUnlockAndEnterConsole(bootAdminCode);
                if (!res.ok) {
                  setBootAdminErr(res.error ?? 'Falscher Admin-Code.');
                }
              }}
              className="space-y-3 text-left"
            >
              <label
                htmlFor="boot-admin-code"
                className="block text-xs font-bold text-amber-300"
              >
                Admin-Code eingeben, um die Lobby zu starten:
              </label>
              <div className="flex gap-2">
                <input
                  id="boot-admin-code"
                  type="password"
                  inputMode="numeric"
                  autoFocus
                  value={bootAdminCode}
                  onChange={(e) => setBootAdminCode(e.target.value)}
                  placeholder="Admin-Code"
                  className="min-h-[44px] flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!bootAdminCode.trim()}
                  className="min-h-[44px] rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-40"
                >
                  Admin freischalten
                </button>
              </div>
              {bootAdminErr && (
                <p className="text-xs font-semibold text-rose-300">
                  {bootAdminErr}
                </p>
              )}
            </form>
          ) : (
            <p className="text-xs text-slate-400">
              Bitte warte kurz, bis Lasse oder Linus den Spielraum per Admin-Code gestartet haben ...
            </p>
          )}
          <button
            type="button"
            onClick={() => void exitOrLogout()}
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-800 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-700"
          >
            Namen wechseln
          </button>
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

  const liveConeGeo =
    conePreviewEnabled && geo.currentFix
      ? buildCone45Polygon(
          geo.currentFix,
          coneBearingDeg,
          publicState.playArea.polygon
        )
      : null;

  const handleMapCoordinateClick = (pt: LatLng) => {
    if (mapClickMode.kind === 'TEST_LOCATION') {
      if (fineAdjustAnchorPt !== null && geo.currentFix) {
        if (distanceMeters(geo.currentFix, pt) <= ANCHOR_MANUAL_ADJUST_MAX_METERS) {
          setFineAdjustAnchorPt(pt);
          setMapClickMode({ kind: 'NONE' });
          return;
        }
      }
      geo.setManualTestLocation(pt);
      setMapClickMode({ kind: 'NONE' });
      return;
    }
    if (mapClickMode.kind === 'PICK_SPLIT_POINT') {
      setSelectedSplitPoint(pt);
      setMapClickMode({ kind: 'NONE' });
      setActiveTab('QUESTIONS');
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

  const handleLockAnchorByHider = async (startOpenSearchNow: boolean) => {
    setAnchorFeedbackError(null);
    const target = fineAdjustAnchorPt ?? geo.currentFix;
    if (!target) {
      setAnchorFeedbackError(
        'Noch kein GPS-Standort verfügbar. Bitte warte kurz im Freien auf ein GPS-Signal.'
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
      accuracy: fineAdjustAnchorPt ? 10 : (geo.currentFix?.accuracy ?? 12),
      serverNowMs: adapter.getServerNow(),
      publicState,
      currentHiderPrivate: hiderPrivate,
      startSearchImmediately: startOpenSearchNow,
    });
    setFineAdjustAnchorPt(null);
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

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-[#020617] text-slate-100">
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

      {/* Kompaktes schwebendes Top-HUD */}
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
                    accuracy: 8,
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
            liveConePreview={liveConeGeo}
            selectedSplitPoint={selectedSplitPoint}
            thermoPointA={thermoPointA}
            thermoPointB={thermoPointB}
            clickMode={mapClickMode}
            onMapCoordinateClick={handleMapCoordinateClick}
            layoutInvalidationKey={`${activeTab}_${publicState.status}`}
          />

          {/* Schwebende Aktions-Buttons auf der Karte */}
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
                  className={`pointer-events-auto inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold shadow-lg backdrop-blur ${
                    mapClickMode.kind === 'TEST_LOCATION'
                      ? 'border-amber-400 bg-amber-500 text-slate-950'
                      : 'border-slate-700 bg-slate-950/90 text-cyan-300 hover:bg-slate-900'
                  }`}
                >
                  <Crosshair className="h-4 w-4" />
                  {mapClickMode.kind === 'TEST_LOCATION'
                    ? 'Kartenklick abbrechen'
                    : 'Test-Standort per Klick'}
                </button>
              )}

              {isJoinedSardines && (
                <div className="pointer-events-auto inline-flex items-center gap-1.5 rounded-xl border border-cyan-400/60 bg-cyan-950/90 px-3 py-1.5 text-xs font-extrabold text-cyan-200 shadow-lg">
                  <Sparkles className="h-4 w-4 text-cyan-400" />
                  Bei den Sardinen! Versteck & QR-Code freigeschaltet
                </div>
              )}
            </div>

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
                  onUnlockAdmin={handleUnlockAndEnterConsole}
                  onLogout={exitOrLogout}
                />
              </div>
            )}

            {/* SUCHER-ANSICHT WÄHREND DER VERSTECKPHASE (00:00 – 10:00) */}
            {publicState.status !== 'LOBBY' &&
              effectivePhase === 'HIDING' &&
              ownMember.side === 'SEEKER' &&
              !isJoinedSardines && (
                <div className="pointer-events-auto mx-auto mt-2 w-full max-w-md rounded-2xl border border-cyan-500/50 bg-slate-950/92 p-5 text-center shadow-2xl backdrop-blur-md">
                  <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-500/20 text-cyan-300">
                    <EyeOff className="h-6 w-6" />
                  </div>
                  <h2 className="text-lg font-black text-white">
                    Die Sardinen verstecken sich ...
                  </h2>
                  <p className="mt-1 text-xs text-slate-300">
                    Keine Verstecker-Bewegungen sichtbar. Nutzt die Zeit, euch innerhalb des grünen 81247-Polygons strategisch zu verteilen!
                  </p>
                  <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 py-2.5 font-mono text-2xl font-black text-cyan-300">
                    {formatDurationClock(timer.hidingRemainingMs)}
                  </div>
                  <p className="mt-2 text-[11px] text-slate-400">
                    Offene Suche & Hinweis-Shop starten automatisch bei 10:00.
                  </p>
                </div>
              )}
          </div>

          {/* VERSTECKER-PANEL ZUM FIXIEREN DES ANCHOR POINTS */}
          {publicState.status !== 'LOBBY' &&
            ownMember.side === 'HIDER' &&
            !hiderPrivate?.anchorPoint && (
              <div className="pointer-events-auto absolute inset-x-3 bottom-3 z-[420] mx-auto max-w-lg rounded-2xl border border-cyan-400/60 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-md">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Anchor className="h-5 w-5 text-cyan-400" />
                    <h3 className="text-sm font-extrabold text-white">
                      Sardinen-Versteck (Anchor Point) wählen
                    </h3>
                  </div>
                  <span className="rounded-lg bg-slate-900 px-2 py-0.5 font-mono text-xs text-cyan-300">
                    GPS: {geo.currentFix ? `±${Math.round(geo.currentFix.accuracy)} m` : '...'}
                  </span>
                </div>

                {geo.currentFix &&
                  geo.currentFix.accuracy > ANCHOR_ACCURACY_WARNING_METERS && (
                    <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/50 bg-amber-950/50 p-2.5 text-xs text-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                      <div>
                        <p className="font-bold">
                          Ungenaues GPS-Signal (±{Math.round(geo.currentFix.accuracy)} m, z. B. unter Bäumen an der Würm).
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={geo.retryGpsPermission}
                            className="rounded-lg bg-slate-800 px-2.5 py-1 font-bold text-white"
                          >
                            Erneut messen
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setFineAdjustAnchorPt({
                                lat: geo.currentFix!.lat,
                                lng: geo.currentFix!.lng,
                              });
                              setMapClickMode({
                                kind: 'TEST_LOCATION',
                                label:
                                  'Tippe im 35m-Umkreis auf eure exakte Position im Polygon',
                              });
                            }}
                            className="rounded-lg bg-amber-500 px-2.5 py-1 font-bold text-slate-950"
                          >
                            Präzise auf Karte feinjustieren
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                {anchorFeedbackError && (
                  <div className="mt-2 rounded-xl border border-rose-500/50 bg-rose-950/60 p-2.5 text-xs font-semibold text-rose-200">
                    {anchorFeedbackError}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="lock-anchor-btn"
                    onClick={() => void handleLockAnchorByHider(false)}
                    className="flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow hover:bg-cyan-400"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Versteck jetzt hier fixieren
                  </button>
                  <button
                    type="button"
                    data-testid="lock-anchor-and-start-search-btn"
                    onClick={() => void handleLockAnchorByHider(true)}
                    className="flex min-h-[46px] items-center justify-center gap-1.5 rounded-xl border border-emerald-400/60 bg-emerald-950/60 px-3.5 py-2.5 text-xs font-extrabold text-emerald-200 hover:bg-emerald-900/60"
                  >
                    Fixieren & Suche sofort starten
                  </button>
                </div>
              </div>
            )}

          {/* Schnellzugriff „Sardinen-QR-Code zeigen" auf dem Hider-Dashboard */}
          {publicState.status !== 'LOBBY' &&
            isSardineDashboardView &&
            hiderPrivate?.anchorPoint && (
              <div className="pointer-events-auto absolute right-3 bottom-3 z-[410]">
                <button
                  type="button"
                  data-testid="quick-show-sardinen-qr-btn"
                  onClick={() => setActiveTab('QR')}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-2xl border-2 border-cyan-400 bg-slate-950/95 px-4 py-2.5 text-xs font-black text-cyan-300 shadow-2xl hover:bg-slate-900"
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
            selectedSplitPoint={selectedSplitPoint}
            onSelectSplitPoint={setSelectedSplitPoint}
            thermoPointA={thermoPointA}
            onSetThermoPointA={setThermoPointA}
            thermoPointB={thermoPointB}
            onSetThermoPointB={setThermoPointB}
            coneBearingDeg={coneBearingDeg}
            onChangeConeBearingDeg={setConeBearingDeg}
            conePreviewEnabled={conePreviewEnabled}
            onToggleConePreview={setConePreviewEnabled}
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
