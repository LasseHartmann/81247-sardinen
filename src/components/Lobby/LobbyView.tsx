import React, { useState } from 'react';
import {
  CheckCircle2,
  Crown,
  Eye,
  EyeOff,
  Lock,
  LogIn,
  LogOut,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { TEAM_PALETTE } from '../../config/gameConfig';
import { PRESET_PLAYERS } from '../../config/players';
import {
  deduplicateEnabledMembers,
  isMemberTabOnline,
} from '../../services/databaseAdapter';
import type {
  AuthUserSummary,
  HiderLoginLock,
  MemberRecord,
  PresenceSession,
  PublicGameState,
  TeamPublic,
} from '../../types/game';

export interface LoginScreenProps {
  firebaseAvailable: boolean;
  loginError: string | null;
  logoutNotice: string | null;
  pendingHiderPasswordFor: string | null;
  onClearPendingHiderPrompt: () => void;
  onLoginByName: (typedName: string, hiderPassword?: string) => Promise<void>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  firebaseAvailable,
  loginError,
  logoutNotice,
  pendingHiderPasswordFor,
  onClearPendingHiderPrompt,
  onLoginByName,
}) => {
  const [typedName, setTypedName] = useState('');
  const [hiderPassword, setHiderPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const effectiveName = pendingHiderPasswordFor ?? typedName;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onLoginByName(
        effectiveName,
        pendingHiderPasswordFor ? hiderPassword : undefined
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="cmf-drafting-bg flex h-[100dvh] w-full flex-col items-center justify-center overflow-y-auto p-4 text-[var(--text-main)]">
      <div className="cmf-chassis w-full max-w-md p-6 sm:p-7">
        {/* Hardware-Kopfzeile mit Serien-Tag & OLED-Emblem */}
        <div className="flex items-center justify-between">
          <span className="cmf-badge-teal inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--cmf-teal)]" />
            SEKTOR 81247 // MUC
          </span>
          <span className="font-tech text-[10px] font-medium tracking-widest text-[var(--text-muted)] uppercase">
            SYS.V2 // LIVE
          </span>
        </div>

        <div className="mt-5 flex items-center gap-3.5">
          <div className="cmf-oled flex h-14 w-14 shrink-0 items-center justify-center">
            <span className="font-dot text-lg text-[var(--cmf-orange)]">81</span>
          </div>
          <div>
            <h1 className="font-dot text-2xl leading-tight font-bold text-[var(--text-main)]">
              81247 SARDINEN
            </h1>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Taktisches Outdoor-Versteckspiel • Obermenzing / Blutenburg / Pipping
            </p>
          </div>
        </div>

        <div className="my-5 border-t cmf-divider" />

        {logoutNotice && (
          <div
            role="status"
            className="cmf-badge-teal mb-4 rounded-xl px-3.5 py-2.5 text-xs font-medium leading-relaxed"
          >
            {logoutNotice}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label
              htmlFor="player-name-input"
              className="mb-1.5 block font-tech text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase"
            >
              Dein Vorname
            </label>
            <input
              id="player-name-input"
              data-testid="player-name-input"
              type="text"
              autoComplete="off"
              autoFocus={!pendingHiderPasswordFor}
              value={effectiveName}
              onChange={(e) => {
                if (pendingHiderPasswordFor) {
                  onClearPendingHiderPrompt();
                  setHiderPassword('');
                }
                setTypedName(e.target.value);
              }}
              placeholder="Namen eingeben ..."
              className="cmf-input min-h-[50px] w-full px-4 py-3 text-base font-semibold"
            />
          </div>

          {pendingHiderPasswordFor && (
            <div className="cmf-module space-y-2 p-3.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="hider-login-password-input"
                  className="flex items-center gap-1.5 font-tech text-[11px] font-bold tracking-wider text-[var(--cmf-orange)] uppercase"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Verstecker-Passwort // {pendingHiderPasswordFor}
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
                id="hider-login-password-input"
                data-testid="hider-login-password-input"
                type={showPw ? 'text' : 'password'}
                autoComplete="off"
                autoFocus
                value={hiderPassword}
                onChange={(e) => setHiderPassword(e.target.value)}
                placeholder="Geheimes Verstecker-Passwort ..."
                className="cmf-input cmf-input-orange font-tech min-h-[46px] w-full px-3.5 py-2.5 text-sm font-bold"
              />
            </div>
          )}

          {!firebaseAvailable && (
            <div className="cmf-badge-amber rounded-xl p-3 text-xs font-medium">
              Hinweis: Firebase-Umgebungsvariablen sind noch nicht hinterlegt.
            </div>
          )}

          {loginError && (
            <div
              role="alert"
              className="cmf-badge-orange rounded-xl px-3.5 py-2.5 text-xs font-semibold"
            >
              {loginError}
            </div>
          )}

          <button
            type="submit"
            data-testid="login-submit-btn"
            disabled={
              submitting ||
              !firebaseAvailable ||
              !effectiveName.trim() ||
              Boolean(pendingHiderPasswordFor && !hiderPassword.trim())
            }
            className="cmf-btn-primary font-dot flex min-h-[50px] w-full items-center justify-center gap-2 px-4 py-3 text-sm font-bold"
          >
            <LogIn className="h-4 w-4" />
            {submitting
              ? 'Prüfe ...'
              : pendingHiderPasswordFor
                ? 'Mit Verstecker-Passwort einloggen'
                : 'Einloggen'}
          </button>
        </form>
      </div>
    </div>
  );
};

export interface PendingApprovalScreenProps {
  authUser: AuthUserSummary;
  loginError: string | null;
  onClaimInitialHost: () => Promise<void>;
  onLogout: () => Promise<void>;
}

export const PendingApprovalScreen: React.FC<PendingApprovalScreenProps> = ({
  loginError,
  onClaimInitialHost,
  onLogout,
}) => {
  const [claiming, setClaiming] = useState(false);

  const handleClaimHost = async () => {
    setClaiming(true);
    try {
      await onClaimInitialHost();
    } finally {
      setClaiming(false);
    }
  };

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
              Warte auf Freischaltung durch Lasse oder Linus (oder aktualisiere die Firebase-Regeln).
            </p>
          </div>
        </div>

        <div className="cmf-well p-4">
          <button
            type="button"
            disabled={claiming}
            onClick={() => void handleClaimHost()}
            className="cmf-btn-primary font-dot flex min-h-[46px] w-full items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold"
          >
            <Crown className="h-4 w-4" />
            {claiming ? 'Aktiviere ...' : 'Als Spielleiter aktivieren'}
          </button>
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
          Anderen Namen eingeben
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
  activeHiderLock: HiderLoginLock | null;
  readyPlayerIds: string[];
  onSetHiderPassword: (rawPassword: string) => Promise<void>;
  onToggleOwnReady: (nextReady: boolean) => Promise<void>;
  onOpenHostTab?: () => void;
  onLogout: () => Promise<void>;
}

export const LobbyStatusCard: React.FC<LobbyStatusCardProps> = ({
  ownMember,
  members,
  presence,
  teamsPublic,
  activeHiderLock,
  readyPlayerIds,
  onSetHiderPassword,
  onToggleOwnReady,
  onOpenHostTab,
  onLogout,
}) => {
  const memberList = deduplicateEnabledMembers(members, presence);
  const readySet = new Set(readyPlayerIds);
  const isOwnReady = readySet.has(ownMember.playerId);

  const hiderMembers = memberList.filter((m) => m.side === 'HIDER');
  const seekerMembers = memberList.filter(
    (m) => m.side === 'SEEKER' && Boolean(m.teamId)
  );
  const unassignedMembers = memberList.filter(
    (m) => m.side === 'UNASSIGNED' || (m.side === 'SEEKER' && !m.teamId)
  );

  // Besetzte Teams anhand der aktuellen Zuweisungen ermitteln (nur Teams mit mindestens 1 Person!)
  const occupiedTeams = TEAM_PALETTE.map((palette) => {
    const pub = teamsPublic[palette.id];
    const assignedNames = memberList
      .filter((m) => m.side === 'SEEKER' && m.teamId === palette.id)
      .map((m) => m.name);
    return {
      id: palette.id,
      name: pub?.name ?? palette.name,
      color: pub?.color ?? palette.color,
      assignedNames,
    };
  }).filter((t) => t.assignedNames.length > 0);

  const [pwDraft, setPwDraft] = useState('');
  const [showPwDraft, setShowPwDraft] = useState(false);
  const [pwFormOpen, setPwFormOpen] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [togglingReady, setTogglingReady] = useState(false);

  const hasPasswordSet = Boolean(activeHiderLock?.passwordHash);
  const ownRoleAssigned =
    ownMember.side === 'HIDER' ||
    (ownMember.side === 'SEEKER' && Boolean(ownMember.teamId));

  const canPressReady =
    hasPasswordSet &&
    ownRoleAssigned &&
    hiderMembers.length > 0 &&
    seekerMembers.length > 0 &&
    unassignedMembers.length === 0;

  const readyCount = memberList.filter((m) => readySet.has(m.playerId)).length;
  const readyRatio = memberList.length > 0 ? readyCount / memberList.length : 0;
  // 3-stage hardware color progression: --cmf-teal -> --cmf-amber -> --cmf-orange
  const meterColor =
    readyRatio < 0.5
      ? 'var(--cmf-teal)'
      : readyRatio < 1
        ? 'var(--cmf-amber)'
        : 'var(--cmf-orange)';

  const handleSaveHiderPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    const cleaned = pwDraft.trim();
    if (cleaned.length < 3) {
      setPwError('Das Passwort muss mindestens 3 Zeichen lang sein.');
      return;
    }
    setPwSaving(true);
    try {
      await onSetHiderPassword(cleaned);
      setPwDraft('');
      setPwFormOpen(false);
    } catch {
      setPwError('Passwort konnte nicht gespeichert werden.');
    } finally {
      setPwSaving(false);
    }
  };

  return (
    <div className="cmf-chassis pointer-events-auto mx-auto max-h-[calc(100dvh-146px)] w-full max-w-lg overflow-y-auto p-4 sm:p-5 text-[var(--text-main)]">
      {/* Kopfzeile */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
            LOBBY // SEKTOR 81247
          </span>
          <h2 className="font-industrial flex items-center gap-2 text-lg text-[var(--text-main)]">
            <span>Hallo {ownMember.name}!</span>
            {ownMember.isHost && (
              <span className="cmf-badge-teal rounded px-2 py-0.5 text-[10px] font-bold uppercase">
                ADMIN
              </span>
            )}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void onLogout()}
          className="cmf-btn-secondary font-tech inline-flex min-h-[36px] items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold uppercase"
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
                ownMember.side === 'HIDER'
                  ? 'text-[var(--cmf-orange)]'
                  : 'text-[#F8FAFC]'
              }`}
            >
              {ownMember.side === 'HIDER'
                ? 'VERSTECKER // DIE SARDINEN'
                : ownMember.teamId
                  ? (teamsPublic[ownMember.teamId]?.name ?? ownMember.teamId)
                  : 'Wartet auf Zuteilung durch Lasse / Linus'}
            </strong>
          </div>

          {hasPasswordSet ? (
            <span className="cmf-badge-teal inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
              <Lock className="h-3 w-3" />
              PW GESICHERT
            </span>
          ) : (
            <span className="cmf-badge-amber-oled inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
              PW AUSSTEHEND
            </span>
          )}
        </div>

        {hasPasswordSet && (
          <div className="border-t border-dashed border-[#27272A] pt-2">
            <div className="mb-1 flex items-center justify-between font-tech text-[10px] uppercase">
              <span className="text-[#9AA4AE]">BEREITSCHAFTS-STATUS</span>
              <span className="font-dot text-xs text-[#F8FAFC]">
                BEREIT {readyCount} / {memberList.length}
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

      {/* Verstecker-Passwort festlegen (für Hider) */}
      {ownMember.side === 'HIDER' && (!hasPasswordSet || pwFormOpen) && (
        <form
          onSubmit={(e) => void handleSaveHiderPassword(e)}
          className="cmf-module mt-3.5 space-y-2.5 p-3.5"
        >
          <div className="flex items-center justify-between gap-2 border-b cmf-divider pb-2">
            <span className="flex items-center gap-1.5 font-tech text-[11px] font-bold tracking-wider text-[var(--cmf-orange)] uppercase">
              <Lock className="h-3.5 w-3.5" />
              Verstecker-Passwort festlegen
            </span>
            {hasPasswordSet && (
              <button
                type="button"
                onClick={() => setPwFormOpen(false)}
                className="font-tech text-[10px] font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] uppercase"
              >
                [Abbrechen]
              </button>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
            Wird euer <strong className="text-[var(--text-main)]">QR-Code & Fang-Code</strong> zum Finden sowie das{' '}
            <strong className="text-[var(--text-main)]">Login-Passwort für alle Verstecker-Accounts</strong>. Nach dem Speichern werden alle Spieler einmalig ausgeloggt!
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showPwDraft ? 'text' : 'password'}
                data-testid="set-hider-password-input"
                maxLength={32}
                value={pwDraft}
                onChange={(e) => setPwDraft(e.target.value)}
                placeholder="Geheimes Passwort (mind. 3 Zeichen)"
                className="cmf-input cmf-input-orange font-tech min-h-[42px] w-full px-3 py-2 pr-9 text-xs font-bold"
              />
              <button
                type="button"
                onClick={() => setShowPwDraft((v) => !v)}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                title={showPwDraft ? 'Verbergen' : 'Anzeigen'}
              >
                {showPwDraft ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <button
              type="submit"
              data-testid="save-hider-password-btn"
              disabled={pwSaving || pwDraft.trim().length < 3}
              className="cmf-btn-primary font-dot min-h-[42px] shrink-0 px-3.5 py-2 text-xs font-bold"
            >
              {pwSaving ? 'Speichere ...' : 'Festlegen'}
            </button>
          </div>
          {pwError && (
            <p className="font-tech text-[11px] font-bold text-[var(--cmf-orange)]">
              {pwError}
            </p>
          )}
        </form>
      )}

      {ownMember.side === 'HIDER' && hasPasswordSet && !pwFormOpen && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => setPwFormOpen(true)}
            className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] underline hover:text-[var(--cmf-orange)] uppercase"
          >
            Verstecker-Passwort ändern
          </button>
        </div>
      )}

      {ownMember.side !== 'HIDER' && !hasPasswordSet && hiderMembers.length > 0 && (
        <div className="cmf-well mt-3.5 p-3 text-xs text-[var(--text-muted)]">
          Die Verstecker legen gerade ihr geheimes Passwort fest. Danach werdet ihr kurz ausgeloggt und könnt auf <strong className="text-[var(--text-main)]">„Bereit“</strong> drücken!
        </div>
      )}

      {/* Spielerliste mit Online- & Bereit-Status */}
      <div className="mt-3.5 border-t cmf-divider pt-3">
        <div className="mb-2 flex items-center justify-between font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
            Spieler ({memberList.length} / {PRESET_PLAYERS.length})
          </span>
          {hasPasswordSet && (
            <span className="text-[var(--cmf-teal)]">
              BEREIT: {readyCount}/{memberList.length}
            </span>
          )}
        </div>
        <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
          {memberList.map((m) => {
            const online = isMemberTabOnline(presence[m.uid]);
            const playerReady = readySet.has(m.playerId);
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
                    online ? 'bg-[var(--cmf-teal)]' : 'bg-[#9AA4AE]'
                  }`}
                />
                <span className="font-semibold text-[var(--text-main)]">{m.name}</span>
                <span className="font-tech text-[10px] text-[var(--text-muted)] uppercase">
                  {m.side === 'HIDER'
                    ? 'HQ'
                    : m.teamId
                      ? m.teamId.replace('team-', 'T')
                      : '–'}
                </span>
                {hasPasswordSet && playerReady && (
                  <span className="font-tech text-[11px] font-bold text-[var(--cmf-teal)]">
                    ✓
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* BEREIT-Button für alle Spieler -> startet automatisch sobald alle bereit sind! */}
      {hasPasswordSet && (
        <div className="mt-3.5 space-y-1.5">
          {!canPressReady ? (
            <div className="cmf-badge-amber rounded-xl p-2.5 text-center text-xs font-medium">
              {unassignedMembers.length > 0
                ? `Noch nicht alle Spieler eingeteilt (${unassignedMembers.map((u) => u.name).join(', ')}).`
                : hiderMembers.length === 0
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
                ? `Bereit bestätigt (${readyCount}/${memberList.length})`
                : `Ich bin bereit! (${readyCount}/${memberList.length})`}
            </button>
          )}
        </div>
      )}

      {ownMember.isHost && onOpenHostTab && (
        <button
          type="button"
          data-testid="open-host-panel-btn"
          onClick={onOpenHostTab}
          className="cmf-btn-active font-tech mt-3 flex min-h-[44px] w-full items-center justify-center px-4 py-2 text-xs font-bold tracking-wider uppercase"
        >
          Admin-Konsole öffnen (Teams & Steuerung)
        </button>
      )}
    </div>
  );
};
