import React, { useState } from 'react';
import {
  CheckCircle2,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogIn,
  LogOut,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { TEAM_PALETTE } from '../../config/gameConfig';
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
    <div className="flex h-[100dvh] w-full flex-col items-center justify-center overflow-y-auto bg-[#020617] p-4 text-slate-100">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-500/40 bg-cyan-950/60 text-2xl shadow-lg">
            🐟
          </div>
          <h1 className="text-2xl font-black tracking-wider text-white">
            81247 SARDINEN
          </h1>
          <p className="mt-1 text-xs font-medium text-slate-400">
            Taktisches Outdoor-Versteckspiel • Obermenzing / Blutenburg / Pipping
          </p>
        </div>

        {logoutNotice && (
          <div
            role="status"
            className="mt-4 rounded-xl border border-cyan-500/50 bg-cyan-950/50 px-3.5 py-2.5 text-xs font-semibold text-cyan-200"
          >
            {logoutNotice}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="player-name-input"
              className="mb-1.5 block text-xs font-bold text-slate-300"
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
              className="min-h-[50px] w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-base font-bold text-white placeholder:font-normal placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
            />
          </div>

          {pendingHiderPasswordFor && (
            <div className="space-y-1.5 rounded-2xl border border-cyan-500/50 bg-cyan-950/30 p-3.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="hider-login-password-input"
                  className="flex items-center gap-1.5 text-xs font-extrabold text-cyan-300"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Verstecker-Passwort für {pendingHiderPasswordFor}
                </label>
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-200"
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
                className="min-h-[46px] w-full rounded-xl border border-cyan-500/40 bg-slate-950 px-3.5 py-2.5 text-sm font-bold text-white placeholder:font-normal placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>
          )}

          {!firebaseAvailable && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200">
              Hinweis: Firebase-Umgebungsvariablen sind noch nicht hinterlegt.
            </div>
          )}

          {loginError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/50 bg-rose-950/60 px-3.5 py-2.5 text-xs font-semibold text-rose-200"
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
            className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-extrabold text-slate-950 shadow-lg hover:bg-cyan-400 disabled:opacity-40"
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
    <div className="flex h-[100dvh] w-full flex-col items-center justify-center overflow-y-auto bg-[#020617] p-4 text-slate-100">
      <div className="w-full max-w-lg space-y-4 rounded-3xl border border-amber-500/40 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-white">
              Verbinde Spielerkonto ...
            </h1>
            <p className="text-xs text-amber-300">
              Warte auf Freischaltung durch Lasse oder Linus (oder aktualisiere die Firebase-Regeln).
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/25 p-4 space-y-2.5">
          <button
            type="button"
            disabled={claiming}
            onClick={() => void handleClaimHost()}
            className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow hover:bg-emerald-400 disabled:opacity-40"
          >
            <Crown className="h-4 w-4" />
            {claiming ? 'Aktiviere ...' : 'Als Spielleiter aktivieren'}
          </button>
        </div>

        {loginError && (
          <div className="rounded-xl border border-rose-500/50 bg-rose-950/60 p-3 text-xs font-semibold text-rose-200">
            {loginError}
          </div>
        )}

        <button
          type="button"
          onClick={() => void onLogout()}
          className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-700"
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
  onUnlockAdmin?: (code: string) => Promise<{ ok: boolean; error?: string }>;
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
  onUnlockAdmin,
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

  const [adminPromptOpen, setAdminPromptOpen] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

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

  const canShowAdminUnlock =
    !ownMember.isHost &&
    Boolean(onUnlockAdmin) &&
    (ownMember.playerId === 'lasse' || ownMember.playerId === 'linus');

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onUnlockAdmin) return;
    setAdminError(null);
    setUnlocking(true);
    try {
      const res = await onUnlockAdmin(adminCode);
      if (res.ok) {
        setAdminPromptOpen(false);
        setAdminCode('');
      } else {
        setAdminError(res.error ?? 'Falscher Admin-Code.');
      }
    } finally {
      setUnlocking(false);
    }
  };

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
    <div className="pointer-events-auto mx-auto max-h-[calc(100dvh-150px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/94 p-4 text-slate-100 shadow-2xl backdrop-blur-md">
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-[11px] font-extrabold tracking-wider text-cyan-400 uppercase">
            Lobby • 81247 Sardinen
          </span>
          <h2 className="flex items-center gap-2 text-base font-black text-white">
            <span>Hallo {ownMember.name}!</span>
            {ownMember.isHost && (
              <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-300">
                ADMIN
              </span>
            )}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void onLogout()}
          className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-800"
        >
          <LogOut className="h-3.5 w-3.5" />
          Abmelden
        </button>
      </div>

      {/* Eigene Rolle */}
      <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/80 p-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            Deine Rolle:{' '}
            <strong
              className={
                ownMember.side === 'HIDER' ? 'text-cyan-300' : 'text-amber-300'
              }
            >
              {ownMember.side === 'HIDER'
                ? '🐟 Verstecker (Die Sardinen)'
                : ownMember.teamId
                  ? (teamsPublic[ownMember.teamId]?.name ?? ownMember.teamId)
                  : 'Wartet auf Team-Zuteilung durch Lasse / Linus'}
            </strong>
          </span>
          {hasPasswordSet && (
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-[11px] font-bold text-cyan-300">
              <Lock className="h-3 w-3" />
              Verstecker-Passwort aktiv
            </span>
          )}
        </div>
      </div>

      {/* Besetzte Teams Übersicht (nur Teams, in denen jemand ist!) */}
      {occupiedTeams.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] font-extrabold tracking-wider text-slate-400 uppercase">
            Aktive Sucher-Teams ({occupiedTeams.length})
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {occupiedTeams.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5 text-xs"
              >
                <span className="flex items-center gap-1.5 font-bold text-white">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: t.color }}
                  />
                  {t.name.replace(/\s*\(.*\)/, '')}
                </span>
                <span className="truncate text-[11px] text-slate-300">
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
          className="mt-3 space-y-2.5 rounded-xl border border-cyan-400/60 bg-cyan-950/35 p-3.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-extrabold text-cyan-300">
              <Lock className="h-4 w-4" />
              Verstecker-Passwort festlegen
            </span>
            {hasPasswordSet && (
              <button
                type="button"
                onClick={() => setPwFormOpen(false)}
                className="text-[11px] font-semibold text-slate-400 hover:text-slate-200"
              >
                Abbrechen
              </button>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-slate-300">
            Wird euer <strong>QR-Code & Fang-Code</strong> zum Finden sowie das{' '}
            <strong>Login-Passwort für alle Verstecker-Accounts</strong>. Nach dem Speichern werden alle Spieler einmalig ausgeloggt!
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
                className="min-h-[42px] w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 pr-9 text-xs font-bold text-white placeholder:font-normal placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPwDraft((v) => !v)}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-slate-400 hover:text-slate-200"
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
              className="min-h-[42px] shrink-0 rounded-lg bg-cyan-500 px-3.5 py-2 text-xs font-black text-slate-950 hover:bg-cyan-400 disabled:opacity-40"
            >
              {pwSaving ? 'Speichere ...' : 'Festlegen'}
            </button>
          </div>
          {pwError && (
            <p className="text-xs font-semibold text-rose-300">{pwError}</p>
          )}
        </form>
      )}

      {ownMember.side === 'HIDER' && hasPasswordSet && !pwFormOpen && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={() => setPwFormOpen(true)}
            className="text-[11px] font-semibold text-cyan-400 underline hover:text-cyan-300"
          >
            Verstecker-Passwort ändern
          </button>
        </div>
      )}

      {ownMember.side !== 'HIDER' && !hasPasswordSet && hiderMembers.length > 0 && (
        <div className="mt-3 rounded-xl border border-cyan-500/30 bg-cyan-950/25 p-3 text-xs text-cyan-200">
          Die Verstecker legen gerade ihr geheimes Passwort fest. Danach werdet ihr kurz ausgeloggt und könnt auf <strong>„Bereit“</strong> drücken!
        </div>
      )}

      {/* Spielerliste mit Online- & Bereit-Status */}
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-slate-300">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-cyan-400" />
            Spieler ({memberList.length} / 11)
          </span>
          {hasPasswordSet && (
            <span className="font-extrabold text-emerald-300">
              Bereit: {readyCount} / {memberList.length}
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
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${
                  playerReady
                    ? 'border-emerald-500/60 bg-emerald-950/40'
                    : 'border-slate-800 bg-slate-900'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    online ? 'bg-emerald-400' : 'bg-slate-600'
                  }`}
                />
                <span className="font-semibold text-white">{m.name}</span>
                <span className="text-[10px] text-slate-400">
                  {m.side === 'HIDER'
                    ? '🐟'
                    : m.teamId
                      ? m.teamId.replace('team-', 'T')
                      : '–'}
                </span>
                {hasPasswordSet && playerReady && (
                  <span className="text-[11px] font-black text-emerald-400">
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
        <div className="mt-3 space-y-1.5">
          {!canPressReady ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-2.5 text-center text-xs text-amber-200">
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
              className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black shadow-lg transition disabled:opacity-50 ${
                isOwnReady
                  ? 'border-2 border-emerald-400 bg-emerald-600 text-white hover:bg-emerald-500'
                  : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
              }`}
            >
              <CheckCircle2 className="h-5 w-5" />
              {isOwnReady
                ? `Du bist bereit! (${readyCount}/${memberList.length} – startet automatisch)`
                : `Ich bin bereit! (${readyCount}/${memberList.length})`}
            </button>
          )}
        </div>
      )}

      {canShowAdminUnlock && (
        <div className="mt-3">
          {!adminPromptOpen ? (
            <button
              type="button"
              data-testid="open-admin-code-btn"
              onClick={() => {
                setAdminError(null);
                setAdminPromptOpen(true);
              }}
              className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-amber-500/50 bg-amber-950/40 px-4 py-2 text-xs font-extrabold text-amber-300 hover:bg-amber-900/50"
            >
              <KeyRound className="h-4 w-4" />
              Admin-Code eingeben
            </button>
          ) : (
            <form
              onSubmit={(e) => void handleUnlockSubmit(e)}
              className="space-y-2 rounded-xl border border-amber-500/50 bg-slate-900 p-3"
            >
              <div className="flex items-center justify-between">
                <label
                  htmlFor="admin-code-input"
                  className="text-xs font-extrabold text-amber-300"
                >
                  Admin-Code für {ownMember.name}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setAdminPromptOpen(false);
                    setAdminError(null);
                    setAdminCode('');
                  }}
                  className="text-[11px] font-semibold text-slate-400 hover:text-slate-200"
                >
                  Abbrechen
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  id="admin-code-input"
                  data-testid="admin-code-input"
                  type="password"
                  inputMode="numeric"
                  autoFocus
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  placeholder="4-stelliger Code"
                  className="min-h-[42px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold tracking-widest text-white placeholder:tracking-normal placeholder:font-normal placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="submit"
                  data-testid="submit-admin-code-btn"
                  disabled={unlocking || !adminCode.trim()}
                  className="min-h-[42px] rounded-lg bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-40"
                >
                  {unlocking ? '...' : 'Freischalten'}
                </button>
              </div>
              {adminError && (
                <p className="text-xs font-semibold text-rose-300">{adminError}</p>
              )}
            </form>
          )}
        </div>
      )}

      {ownMember.isHost && onOpenHostTab && (
        <button
          type="button"
          data-testid="open-host-panel-btn"
          onClick={onOpenHostTab}
          className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 shadow hover:bg-amber-400"
        >
          Zum Admin-Bereich (Teams einteilen & Spieler verwalten)
        </button>
      )}
    </div>
  );
};
