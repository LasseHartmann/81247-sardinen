import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  LocateFixed,
  LogIn,
  LogOut,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { TEAM_PALETTE } from '../../config/gameConfig';
import { getPlayerGreeting, isOverviewMember } from '../../config/players';
import type { GpsPermissionState } from '../../hooks/useGeolocation';
import {
  deduplicateEnabledMembers,
  filterOnlineEnabledMembers,
  getRequiredReadyHiderMembers,
  isPlayerOnline,
} from '../../services/databaseAdapter';
import type {
  AuthUserSummary,
  GeoFix,
  MemberRecord,
  PresenceSession,
  PublicGameState,
  TeamPublic,
} from '../../types/game';
import { PhysicsBottomSheet } from '../Common/PhysicsBottomSheet';

export interface LoginScreenProps {
  firebaseAvailable: boolean;
  loginError: string | null;
  onClearError: () => void;
  onLogin: (name: string, password: string) => Promise<void>;
  onRegister: (name: string, password: string) => Promise<void>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  firebaseAvailable,
  loginError,
  onClearError,
  onLogin,
  onRegister,
}) => {
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN');
  const [typedName, setTypedName] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === 'REGISTER') {
        await onRegister(typedName, password);
      } else {
        await onLogin(typedName, password);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cmf-drafting-bg cmf-scroll-area flex h-[100dvh] w-full flex-col items-center justify-start sm:justify-center pt-[max(1.25rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] text-[var(--text-main)]">
      <div className="cmf-chassis cmf-sheet-up my-auto w-full max-w-md p-5 sm:p-7">
        {/* Hardware-Kopfzeile mit Serien-Tag & OLED-Emblem */}
        <div className="flex items-center justify-between">
          <span className="cmf-badge-teal inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--cmf-teal)]" />
            MÜNCHEN // SARDINEN
          </span>
          <span className="font-tech text-[10px] font-medium tracking-widest text-[var(--text-muted)] uppercase">
            SYS.V3 // ACCOUNTS
          </span>
        </div>

        <div className="mt-5 flex items-center gap-3.5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#27272A] bg-black p-1 shadow-md">
            <img
              src="/logo.png"
              alt="81247 Sardinen Logo"
              className="h-full w-full bg-black object-contain"
            />
          </div>
          <div>
            <h1 className="font-dot text-2xl leading-tight font-bold text-[var(--text-main)]">
              81247 SARDINEN
            </h1>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Taktisches Outdoor-Versteckspiel • München
            </p>
          </div>
        </div>

        <div className="my-4 border-t cmf-divider" />

        {/* Modus-Umschalter: Anmelden vs. Konto erstellen */}
        <div className="cmf-well mb-4 grid grid-cols-2 gap-1.5 p-1">
          <button
            type="button"
            data-testid="auth-mode-login-btn"
            onClick={() => {
              setMode('LOGIN');
              onClearError();
            }}
            className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 font-tech text-xs font-bold uppercase transition-all ${
              mode === 'LOGIN'
                ? 'cmf-btn-active text-[var(--text-main)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            <LogIn className="h-3.5 w-3.5" />
            <span>Anmelden</span>
          </button>
          <button
            type="button"
            data-testid="auth-mode-register-btn"
            onClick={() => {
              setMode('REGISTER');
              onClearError();
            }}
            className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 font-tech text-xs font-bold uppercase transition-all ${
              mode === 'REGISTER'
                ? 'cmf-btn-active text-[var(--text-main)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span>Konto erstellen</span>
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label
              htmlFor="player-name-input"
              className="mb-1.5 block font-tech text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase"
            >
              Benutzername
            </label>
            <input
              id="player-name-input"
              data-testid="player-name-input"
              type="text"
              enterKeyHint="next"
              autoComplete="username"
              autoFocus
              maxLength={24}
              value={typedName}
              onChange={(e) => {
                if (loginError) onClearError();
                setTypedName(e.target.value);
              }}
              placeholder={
                mode === 'REGISTER'
                  ? 'Deinen Spielernamen wählen ...'
                  : 'Dein Name (oder „admin“) ...'
              }
              className="cmf-input min-h-[50px] w-full px-4 py-3 text-base font-semibold"
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="player-password-input"
                className="font-tech text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase"
              >
                Passwort
              </label>
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="inline-flex items-center gap-1 font-tech text-[10px] font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] uppercase"
              >
                {showPw ? (
                  <>
                    <EyeOff className="h-3.5 w-3.5" /> Verbergen
                  </>
                ) : (
                  <>
                    <Eye className="h-3.5 w-3.5" /> Anzeigen
                  </>
                )}
              </button>
            </div>
            <input
              id="player-password-input"
              data-testid="player-password-input"
              type={showPw ? 'text' : 'password'}
              enterKeyHint="go"
              autoComplete={
                mode === 'REGISTER' ? 'new-password' : 'current-password'
              }
              maxLength={64}
              value={password}
              onChange={(e) => {
                if (loginError) onClearError();
                setPassword(e.target.value);
              }}
              placeholder={
                mode === 'REGISTER'
                  ? 'Passwort wählen (mind. 4 Zeichen) ...'
                  : 'Dein Passwort ...'
              }
              className="cmf-input min-h-[50px] w-full px-4 py-3 text-base font-semibold"
            />
          </div>

          {!firebaseAvailable && (
            <div className="cmf-badge-amber rounded-xl p-3 text-xs font-medium">
              Hinweis: Lokaler Demo-Modus aktiv (keine Firebase-Konfiguration hinterlegt).
            </div>
          )}

          {loginError && (
            <div
              role="alert"
              data-testid="login-error-banner"
              className="cmf-badge-orange cmf-shake rounded-xl px-3.5 py-2.5 text-xs font-semibold"
            >
              {loginError}
            </div>
          )}

          <button
            type="submit"
            data-testid="login-submit-btn"
            disabled={
              submitting || !typedName.trim() || !password.trim()
            }
            className="cmf-btn-primary font-dot flex min-h-[50px] w-full items-center justify-center gap-2 px-4 py-3 text-sm font-bold"
          >
            {mode === 'REGISTER' ? (
              <UserPlus className="h-4 w-4" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            {submitting
              ? 'Prüfe ...'
              : mode === 'REGISTER'
                ? 'Konto erstellen & Beitreten'
                : 'Anmelden'}
          </button>

          <p className="text-center text-[11px] leading-relaxed text-[var(--text-muted)]">
            {mode === 'LOGIN'
              ? 'Noch kein Konto? Wechsle oben auf „Konto erstellen“. Die Spielleiter-Konsole erreichst du über das Konto „admin“.'
              : 'Wähle deinen Namen und ein persönliches Passwort, um dauerhaft mit deinem Account beizutreten.'}
          </p>
        </form>
      </div>
    </div>
  );
};

export interface PendingApprovalScreenProps {
  authUser: AuthUserSummary;
  loginError: string | null;
  onLogout: () => Promise<void>;
}

export const PendingApprovalScreen: React.FC<PendingApprovalScreenProps> = ({
  loginError,
  onLogout,
}) => {
  return (
    <div className="cmf-drafting-bg flex h-[100dvh] w-full flex-col items-center justify-center overflow-y-auto p-4 text-[var(--text-main)]">
      <div className="cmf-chassis w-full max-w-lg space-y-4 p-6">
        <div className="flex items-center gap-3">
          <div className="cmf-oled flex h-12 w-12 shrink-0 items-center justify-center text-[var(--cmf-amber)]">
            <ShieldCheck className="h-6 w-6" />
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
          onClick={() => void onLogout()}
          className="cmf-btn-secondary font-tech inline-flex min-h-[46px] w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold uppercase"
        >
          <LogOut className="h-4 w-4" />
          Zurück zur Anmeldung
        </button>
      </div>
    </div>
  );
};

export interface LobbyStatusCardProps {
  publicState: PublicGameState;
  ownMember: MemberRecord;
  members: Record<string, MemberRecord>;
  presence: Record<string, Record<string, PresenceSession>>;
  teamsPublic: Record<string, TeamPublic>;
  readyPlayerIds: string[];
  ownFix?: GeoFix | null;
  gpsStatus?: GpsPermissionState;
  gpsError?: string | null;
  onRetryGps?: () => Promise<GeoFix | null> | void;
  onToggleOwnReady: (nextReady: boolean) => Promise<void>;
  onOpenHostTab?: () => void;
  onLogout: () => Promise<void>;
}

export const LobbyStatusCard: React.FC<LobbyStatusCardProps> = ({
  publicState,
  ownMember,
  members,
  presence,
  teamsPublic,
  readyPlayerIds,
  ownFix = null,
  gpsStatus = 'IDLE',
  gpsError = null,
  onRetryGps,
  onToggleOwnReady,
  onOpenHostTab,
  onLogout,
}) => {
  const isManhunt = (publicState.gameMode ?? 'CLASSIC') === 'MANHUNT';
  const isOverviewAccount = isOverviewMember(ownMember);
  const isGpsNotWorking = Boolean(
    !isOverviewAccount &&
      (!ownFix || gpsStatus === 'DENIED' || gpsStatus === 'UNSUPPORTED')
  );
  // Bereitmachen müssen ausschließlich ALLE Mitglieder des Verstecker-Teams (auch wenn offline!), niemand sonst.
  const onlineMemberList = filterOnlineEnabledMembers(
    members,
    presence,
    ownMember.uid
  );
  const allEnabledMembers = deduplicateEnabledMembers(members, presence);
  const requiredHiderMembers = getRequiredReadyHiderMembers(members, presence);

  // Für die Spielerliste & Teams in der Lobby: Alle registrierten Spieler (online wie offline)
  const lobbyDisplayMembers = [...allEnabledMembers].sort((a, b) => {
    const aOn = isPlayerOnline(a.playerId, members, presence, ownMember.uid);
    const bOn = isPlayerOnline(b.playerId, members, presence, ownMember.uid);
    if (aOn !== bOn) return aOn ? -1 : 1;
    return a.name.localeCompare(b.name, 'de');
  });

  const readySet = new Set(readyPlayerIds);
  const isOwnReady = readySet.has(ownMember.playerId);

  const seekerMembers = allEnabledMembers.filter(
    (m) => m.side === 'SEEKER' && Boolean(m.teamId)
  );

  // Besetzte Teams anhand der aktuellen Zuweisungen ermitteln (inkl. zugewiesener Offline-Spieler!)
  const occupiedTeams = TEAM_PALETTE.map((palette) => {
    const pub = teamsPublic[palette.id];
    const assignedNames = allEnabledMembers
      .filter((m) => m.side === 'SEEKER' && m.teamId === palette.id)
      .map((m) => m.name);
    return {
      id: palette.id,
      name: pub?.name ?? palette.name,
      color: pub?.color ?? palette.color,
      assignedNames,
    };
  }).filter((t) => t.assignedNames.length > 0);

  const [togglingReady, setTogglingReady] = useState(false);
  const [sheetCollapsed, setSheetCollapsed] = useState(true);

  const isOwnHider = ownMember.side === 'HIDER' && !isOverviewAccount;

  const canPressReady =
    isOwnHider &&
    requiredHiderMembers.length > 0 &&
    seekerMembers.length > 0;

  const totalRequiredReady = requiredHiderMembers.length;
  const readyCount = requiredHiderMembers.filter((m) =>
    readySet.has(m.playerId)
  ).length;
  const readyRatio = totalRequiredReady > 0 ? readyCount / totalRequiredReady : 0;
  // 3-stage hardware color progression: --cmf-teal -> --cmf-amber -> --cmf-orange
  const meterColor =
    readyRatio < 0.5
      ? 'var(--cmf-teal)'
      : readyRatio < 1
        ? 'var(--cmf-amber)'
        : 'var(--cmf-orange)';

  return (
    <PhysicsBottomSheet
      collapsed={sheetCollapsed}
      onCollapsedChange={setSheetCollapsed}
      allowBodyDrag
      scrollableBody
      maxWidthClass="max-w-lg"
      sheetClassName="max-h-[68dvh] sm:max-h-[calc(100dvh-160px)] text-[var(--text-main)]"
      bodyClassName="cmf-scroll-area flex-1 p-3.5 sm:p-5"
      handleTestId="lobby-sheet-handle"
      header={
        <div className="flex w-full items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-industrial truncate text-sm text-[var(--text-main)]">
              {ownMember.name} • {getPlayerGreeting(ownMember)}
            </span>
            {isManhunt && (
              <span className="cmf-badge-orange shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
                Manhunt
              </span>
            )}
            {totalRequiredReady > 0 ? (
              <span className="cmf-badge-teal shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
                HQ Bereit {readyCount}/{totalRequiredReady}
              </span>
            ) : (
              <span className="cmf-badge-amber shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
                Teams offen
              </span>
            )}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
            {sheetCollapsed ? (
              <>
                <span>Aufziehen</span>
                <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                <span>Karte zeigen</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </span>
        </div>
      }
    >
      {/* Kopfzeile */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#27272A] bg-black p-1 shadow-sm">
            <img
              src="/logo.png"
              alt="81247 Sardinen Logo"
              className="h-full w-full bg-black object-contain"
            />
          </div>
          <div>
            <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              LOBBY // {ownMember.name} // {isManhunt ? 'MANHUNT' : 'KLASSISCH'}
            </span>
            <h2 className="font-industrial flex flex-wrap items-center gap-2 text-base sm:text-lg text-[var(--text-main)]">
              <span>{getPlayerGreeting(ownMember)}</span>
              {ownMember.isHost && (
                <span className="cmf-badge-teal rounded px-2 py-0.5 text-[10px] font-bold uppercase">
                  ADMIN
                </span>
              )}
            </h2>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void onLogout()}
          className="cmf-btn-secondary font-tech inline-flex min-h-[40px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase"
        >
          <LogOut className="h-3.5 w-3.5" />
          Abmelden
        </button>
      </div>

      {/* Eingebettete schwarze OLED-Insel: Rollen-Status & Bereitschafts-Telemetrie */}
      <div className="cmf-oled mt-3 p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs">
            <span className="font-tech text-[10px] tracking-wider text-[#9AA4AE] uppercase block">
              ZUGEWIESENE ROLLE
            </span>
            <strong
              className={`font-industrial text-sm ${
                isOverviewAccount
                  ? 'text-[var(--cmf-teal)]'
                  : ownMember.side === 'HIDER'
                    ? 'text-[var(--cmf-orange)]'
                    : 'text-[#F8FAFC]'
              }`}
            >
              {isOverviewAccount
                ? 'ADMIN // KONSOLE & LIVE-ÜBERSICHT'
                : ownMember.side === 'HIDER'
                  ? 'VERSTECKER // DIE SARDINEN'
                  : ownMember.teamId
                    ? (teamsPublic[ownMember.teamId]?.name ?? ownMember.teamId)
                    : 'Wartet auf Zuteilung durch Admin'}
            </strong>
          </div>

          <span className="cmf-badge-teal inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
            ZUFALLS-QR AKTIV
          </span>
        </div>

        {totalRequiredReady > 0 && (
          <div className="border-t border-dashed border-[#27272A] pt-2">
            <div className="mb-1 flex items-center justify-between font-tech text-[10px] uppercase">
              <span className="text-[#9AA4AE]">VERSTECKER-BEREITSCHAFT</span>
              <span className="font-dot text-xs text-[#F8FAFC]">
                BEREIT {readyCount} / {totalRequiredReady}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#181B20] p-[1px]">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.round(readyRatio * 100)}%`,
                  backgroundColor: meterColor,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Besetzte Teams Übersicht (nur Teams, in denen jemand ist!) */}
      {occupiedTeams.length > 0 && (
        <div className="mt-3.5 space-y-1.5">
          <div className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
            Aktive Sucher-Teams ({occupiedTeams.length})
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {occupiedTeams.map((t) => (
              <div
                key={t.id}
                className="cmf-well flex items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <span className="font-tech flex items-center gap-1.5 text-[11px] font-bold text-[var(--text-main)] uppercase">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full border border-white/60"
                    style={{ backgroundColor: t.color }}
                  />
                  {t.name.replace(/\s*\(.*\)/, '')}
                </span>
                <span className="truncate text-[11px] font-medium text-[var(--text-muted)]">
                  {t.assignedNames.join(', ')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Spielerliste mit Online- & Verstecker-Bereit-Status (inkl. Offline-Spieler) */}
      <div className="mt-3.5 border-t cmf-divider pt-3">
        <div className="mb-2 flex items-center justify-between font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
            Online ({onlineMemberList.length} / {lobbyDisplayMembers.length})
          </span>
          {totalRequiredReady > 0 && (
            <span className="text-[var(--cmf-teal)]">
              VERSTECKER BEREIT: {readyCount}/{totalRequiredReady}
            </span>
          )}
        </div>
        <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
          {lobbyDisplayMembers.map((m) => {
            const isHider = m.side === 'HIDER';
            const playerOnline = isPlayerOnline(
              m.playerId,
              members,
              presence,
              ownMember.uid
            );
            const playerReady = isHider && readySet.has(m.playerId);
            return (
              <span
                key={m.uid}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${
                  playerReady
                    ? 'cmf-badge-teal font-semibold'
                    : 'cmf-well text-[var(--text-main)]'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    playerOnline
                      ? 'bg-[var(--cmf-teal)]'
                      : 'bg-[var(--cmf-amber)] opacity-75'
                  }`}
                />
                <span className="font-semibold text-[var(--text-main)]">
                  {m.name}
                </span>
                <span className="font-tech text-[10px] text-[var(--text-muted)] uppercase">
                  {isHider
                    ? playerOnline
                      ? 'HQ'
                      : 'HQ•OFF'
                    : m.teamId
                      ? m.teamId.replace('team-', 'T')
                      : '–'}
                </span>
                {playerReady && (
                  <span className="cmf-pop-in font-tech text-[11px] font-bold text-[var(--cmf-teal)]">
                    ✓
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* GPS-Warnung bei der Bereitmachung zum Start, falls das eigene GPS nicht funktioniert */}
      {isGpsNotWorking && (
        <div
          role="alert"
          data-testid="lobby-gps-warning"
          className="cmf-badge-orange mt-3.5 rounded-xl p-3 text-xs shadow-sm space-y-2"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-0.5">
              <p className="font-tech text-[11px] font-bold tracking-wider uppercase">
                WARNUNG // DEIN GPS FUNKTIONIERT AKTUELL NICHT!
              </p>
              <p className="text-[11px] leading-relaxed opacity-95">
                {gpsStatus === 'DENIED'
                  ? 'Die Standortfreigabe wurde im Browser verweigert. Bitte erlaube den Standortzugriff vor dem Start, damit deine Position im Spiel übertragen wird.'
                  : gpsStatus === 'UNSUPPORTED'
                    ? 'Dein Browser unterstützt kein GPS-Tracking.'
                    : (gpsError ??
                      'Noch kein GPS-Signal empfangen. Bitte prüfe deine Standortfreigabe vor dem Start.')}
              </p>
            </div>
          </div>
          {onRetryGps && (
            <button
              type="button"
              data-testid="lobby-retry-gps-btn"
              onClick={() => void onRetryGps()}
              className="cmf-btn-secondary font-tech inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 bg-white/90 px-3 py-1.5 text-[11px] font-bold text-[var(--text-main)] uppercase"
            >
              <LocateFixed className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
              <span>GPS jetzt aktivieren / erneut prüfen</span>
            </button>
          )}
        </div>
      )}

      {/* BEREIT-Button NUR für das Verstecker-Team -> startet automatisch sobald alle Verstecker bereit sind! */}
      {!isOverviewAccount && (
        <div className="mt-3.5 space-y-1.5">
          {isOwnHider ? (
            !canPressReady ? (
              <div className="cmf-badge-amber rounded-xl p-2.5 text-center text-xs font-medium">
                {requiredHiderMembers.length === 0
                  ? 'Es muss mindestens ein Verstecker eingeteilt sein.'
                  : 'Es muss mindestens ein Sucher-Team besetzt sein.'}
              </div>
            ) : (
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
                className={`font-dot flex min-h-[48px] w-full items-center justify-center gap-2 px-4 py-3 text-sm font-bold ${
                  isOwnReady ? 'cmf-btn-active' : 'cmf-btn-primary'
                }`}
              >
                <CheckCircle2
                  className={`h-4 w-4 ${
                    isOwnReady ? 'text-[var(--cmf-teal)]' : 'text-white'
                  }`}
                />
                {isOwnReady
                  ? `Bereit bestätigt (${readyCount}/${totalRequiredReady})`
                  : `Ich bin bereit! (${readyCount}/${totalRequiredReady})`}
              </button>
            )
          ) : requiredHiderMembers.length > 0 ? (
            <div
              data-testid="seeker-waiting-for-hiders-ready"
              className="cmf-badge-teal rounded-xl p-2.5 text-center text-xs font-medium"
            >
              Nur das Verstecker-Team muss sich bereitmachen ({readyCount}/
              {totalRequiredReady} bereit). Die Runde startet automatisch, sobald alle Verstecker bereit sind!
            </div>
          ) : (
            <div className="cmf-well p-2.5 text-center text-xs text-[var(--text-muted)]">
              Wartet darauf, dass der Admin die Verstecker und Sucher-Teams einteilt.
            </div>
          )}
        </div>
      )}

      {isOverviewAccount && (
        <div className="cmf-badge-teal mt-3.5 rounded-xl p-2.5 text-center text-xs font-medium">
          Admin-Konto aktiv: Du verwaltest die Spielleiter-Konsole, beobachtest alle Teams & Verstecker live und blockierst nicht den „Bereit“-Start der Spieler.
        </div>
      )}

      {ownMember.isHost && onOpenHostTab && (
        <button
          type="button"
          data-testid="open-host-panel-btn"
          onClick={onOpenHostTab}
          className="cmf-btn-active font-tech mt-3 flex min-h-[46px] w-full items-center justify-center px-4 py-2.5 text-xs font-bold tracking-wider uppercase"
        >
          Admin-Konsole öffnen (Teams & Steuerung)
        </button>
      )}
    </PhysicsBottomSheet>
  );
};
