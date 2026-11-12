import React, { useState } from 'react';
import {
  Clock,
  Crosshair,
  KeyRound,
  Radar,
  Wifi,
  WifiOff,
  AlertTriangle,
} from 'lucide-react';
import type { GameTimerSnapshot } from '../../hooks/useGameTimer';
import type { GpsPermissionState } from '../../hooks/useGeolocation';
import type { GeoFix, MemberRecord, PublicGameState, TeamPublic } from '../../types/game';
import {
  formatDurationClock,
  formatPenaltyMinutes,
  getPhaseLabelDe,
} from '../../utils/formatting';

export interface TopHudProps {
  publicState: PublicGameState;
  timer: GameTimerSnapshot;
  ownMember: MemberRecord;
  ownTeam: TeamPublic | null;
  connected: boolean;
  ownFix: GeoFix | null;
  gpsStatus: GpsPermissionState;
  onUnlockAdmin?: (code: string) => Promise<{ ok: boolean; error?: string }>;
}

export const TopHud: React.FC<TopHudProps> = ({
  publicState,
  timer,
  ownMember,
  ownTeam,
  connected,
  ownFix,
  gpsStatus,
  onUnlockAdmin,
}) => {
  const activePhase =
    publicState.status === 'LOBBY' ? 'LOBBY' : timer.computedPhase;
  const isSardineSide =
    ownMember.side === 'HIDER' || ownTeam?.status === 'JOINED_SARDINES';
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [adminErr, setAdminErr] = useState<string | null>(null);

  const canUnlockAdmin =
    !ownMember.isHost &&
    Boolean(onUnlockAdmin) &&
    (ownMember.playerId === 'lasse' || ownMember.playerId === 'linus');

  return (
    <header className="pointer-events-auto z-20 border-b border-slate-800/90 bg-slate-950/92 px-3 py-2 backdrop-blur-md">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
        {/* Spielzeit & Aktuelle Phase */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-1.5">
            <Clock className="h-4 w-4 text-cyan-400" />
            <span
              data-testid="hud-net-clock"
              className="font-mono text-base font-black tracking-tight text-white"
            >
              {formatDurationClock(timer.netElapsedMs)}
            </span>
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  isSardineSide ? 'bg-cyan-400' : 'bg-amber-400'
                }`}
              />
              <span className="text-xs font-extrabold text-slate-100">
                {getPhaseLabelDe(activePhase)}
              </span>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-slate-400">
              <Radar className="h-3 w-3 text-rose-400" />
              <span>
                {timer.nextStageRemainingMs !== null
                  ? `${timer.nextStageLabel} (${formatDurationClock(timer.nextStageRemainingMs)})`
                  : timer.nextStageLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Rechte Status-Leiste: Strafzeit, GPS, Netz & Sammelpunkt */}
        <div className="flex items-center gap-1.5">
          {ownTeam && (
            <div
              title="Aufgelaufene Hinweis-Strafzeit deines Teams"
              className={`rounded-lg border px-2 py-1 text-xs font-extrabold ${
                ownTeam.penaltyMs > 0
                  ? 'border-rose-500/50 bg-rose-950/60 text-rose-300'
                  : 'border-slate-800 bg-slate-900 text-slate-300'
              }`}
            >
              {formatPenaltyMinutes(ownTeam.penaltyMs)}
            </div>
          )}

          <div
            title="GPS-Status & Genauigkeit"
            className="hidden sm:inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] font-semibold text-slate-300"
          >
            {gpsStatus === 'DENIED' ? (
              <>
                <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                <span className="text-rose-300">Kein GPS</span>
              </>
            ) : (
              <>
                <Crosshair className="h-3.5 w-3.5 text-emerald-400" />
                <span>
                  {gpsStatus === 'MANUAL_TEST'
                    ? 'Testpin'
                    : ownFix
                      ? `±${Math.round(ownFix.accuracy)}m`
                      : 'GPS...'}
                </span>
              </>
            )}
          </div>

          <div
            title={connected ? 'Live verbunden' : 'Offline'}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-800 bg-slate-900"
          >
            {connected ? (
              <Wifi className="h-4 w-4 text-emerald-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-rose-400" />
            )}
          </div>

          {canUnlockAdmin && (
            <button
              type="button"
              onClick={() => {
                setAdminErr(null);
                setAdminModalOpen((v) => !v);
              }}
              title="Admin-Code eingeben"
              className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-amber-500/40 bg-amber-950/50 px-2.5 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-900/60"
            >
              <KeyRound className="h-4 w-4" />
              <span className="hidden xs:inline">Admin</span>
            </button>
          )}
        </div>
      </div>

      {adminModalOpen && canUnlockAdmin && onUnlockAdmin && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setAdminErr(null);
            const res = await onUnlockAdmin(adminCode);
            if (res.ok) {
              setAdminModalOpen(false);
              setAdminCode('');
            } else {
              setAdminErr(res.error ?? 'Falscher Admin-Code.');
            }
          }}
          className="mx-auto mt-2 flex max-w-md items-center gap-2 rounded-xl border border-amber-500/50 bg-slate-900 p-2"
        >
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={adminCode}
            onChange={(e) => setAdminCode(e.target.value)}
            placeholder="Admin-Code eingeben"
            className="min-h-[38px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-bold text-white focus:border-amber-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!adminCode.trim()}
            className="min-h-[38px] rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-black text-slate-950 disabled:opacity-40"
          >
            OK
          </button>
          {adminErr && (
            <span className="text-[11px] font-bold text-rose-300">{adminErr}</span>
          )}
        </form>
      )}
    </header>
  );
};
