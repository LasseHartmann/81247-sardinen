import React, { useState } from 'react';
import {
  KeyRound,
  LogIn,
  LogOut,
  ShieldCheck,
  Users,
  Crown,
} from 'lucide-react';
import type {
  AuthUserSummary,
  MemberRecord,
  PresenceSession,
  PublicGameState,
  TeamPublic,
} from '../../types/game';

export interface LoginScreenProps {
  firebaseAvailable: boolean;
  loginError: string | null;
  onLoginByName: (typedName: string) => Promise<void>;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  firebaseAvailable,
  loginError,
  onLoginByName,
}) => {
  const [typedName, setTypedName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onLoginByName(typedName);
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

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-6 space-y-4">
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
              autoFocus
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Namen eingeben ..."
              className="min-h-[50px] w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-base font-bold text-white placeholder:font-normal placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
            />
          </div>

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
            disabled={submitting || !firebaseAvailable || !typedName.trim()}
            className="flex min-h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-cyan-500 px-4 py-3 text-sm font-extrabold text-slate-950 shadow-lg hover:bg-cyan-400 disabled:opacity-40"
          >
            <LogIn className="h-4 w-4" />
            {submitting ? 'Logge ein ...' : 'Einloggen'}
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
  onOpenHostTab?: () => void;
  onUnlockAdmin?: (code: string) => Promise<{ ok: boolean; error?: string }>;
  onLogout: () => Promise<void>;
}

export const LobbyStatusCard: React.FC<LobbyStatusCardProps> = ({
  publicState,
  ownMember,
  members,
  presence,
  teamsPublic,
  onOpenHostTab,
  onUnlockAdmin,
  onLogout,
}) => {
  // Dedupliziere nach playerId, damit jeder Spieler in der Lobby nur einmal angezeigt wird
  const dedupedMap = new Map<string, MemberRecord>();
  for (const m of Object.values(members)) {
    if (!m.enabled) continue;
    const prev = dedupedMap.get(m.playerId);
    if (!prev || (presence[m.uid] && !presence[prev.uid])) {
      dedupedMap.set(m.playerId, m);
    }
  }
  const memberList = Array.from(dedupedMap.values());
  const [adminPromptOpen, setAdminPromptOpen] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [adminError, setAdminError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);

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

  const isPlayerOnline = (uid: string): boolean => {
    const sessions = presence[uid];
    if (!sessions) return false;
    return Object.values(sessions).some((s) => s.online);
  };

  return (
    <div className="pointer-events-auto mx-auto w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/92 p-4 text-slate-100 shadow-2xl backdrop-blur-md">
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
          Namen wechseln
        </button>
      </div>

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
                ? 'Verstecker (Die Sardinen)'
                : ownMember.teamId
                  ? (teamsPublic[ownMember.teamId]?.name ?? ownMember.teamId)
                  : 'Wartet auf Team-Zuteilung durch Lasse / Linus'}
            </strong>
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
              publicState.playArea.confirmed
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-amber-500/20 text-amber-300'
            }`}
          >
            {publicState.playArea.confirmed
              ? '81247-Polygon bestätigt'
              : 'Wartet auf Polygon-Bestätigung'}
          </span>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-300">
          <Users className="h-3.5 w-3.5 text-cyan-400" />
          Eingeloggte Spieler ({memberList.length} / 11)
        </div>
        <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
          {memberList.map((m) => {
            const online = isPlayerOnline(m.uid);
            return (
              <span
                key={m.uid}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs"
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    online ? 'bg-emerald-400' : 'bg-slate-600'
                  }`}
                />
                <span className="font-semibold text-white">{m.name}</span>
                {m.isHost && (
                  <span className="text-[10px] font-bold text-emerald-400">
                    ★
                  </span>
                )}
                <span className="text-[10px] text-slate-400">
                  {m.side === 'HIDER'
                    ? '🐟'
                    : m.teamId
                      ? m.teamId.replace('team-', 'T')
                      : '–'}
                </span>
              </span>
            );
          })}
        </div>
      </div>

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
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-amber-500/50 bg-amber-950/40 px-4 py-2.5 text-xs font-extrabold text-amber-300 hover:bg-amber-900/50"
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
          className="mt-3 flex min-h-[46px] w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-extrabold text-slate-950 shadow hover:bg-emerald-400"
        >
          Zum Admin-Bereich (Teams einteilen & Runde starten)
        </button>
      )}
    </div>
  );
};
