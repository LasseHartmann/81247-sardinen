import React from 'react';
import { Trophy, Clock, AlertCircle, Users } from 'lucide-react';
import type { LeaderboardEntry, TeamPublic } from '../../types/game';
import {
  formatDurationClock,
  formatPenaltyMinutes,
  sortLeaderboardEntries,
} from '../../utils/formatting';

export interface LeaderboardViewProps {
  leaderboard: Record<string, LeaderboardEntry>;
  teamsPublic: Record<string, TeamPublic>;
  activeTeamIds?: string[];
}

export const LeaderboardView: React.FC<LeaderboardViewProps> = ({
  leaderboard,
  teamsPublic,
  activeTeamIds,
}) => {
  const activeSet = activeTeamIds ? new Set(activeTeamIds) : null;
  const ranked = sortLeaderboardEntries(
    Object.values(leaderboard).filter((e) => {
      if (activeSet && !activeSet.has(e.teamId)) return false;
      const teamPub = teamsPublic[e.teamId];
      if (teamPub && teamPub.memberPlayerIds.length === 0) return false;
      return true;
    })
  );
  const rankedIds = new Set(ranked.map((r) => r.teamId));
  const stillSearching = Object.values(teamsPublic).filter(
    (t) =>
      !rankedIds.has(t.id) &&
      t.memberPlayerIds.length > 0 &&
      (!activeSet || activeSet.has(t.id))
  );

  return (
    <div className="h-full overflow-y-auto bg-slate-950/95 p-4 text-slate-100">
      <div className="mx-auto max-w-2xl space-y-5 pb-8">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400">
            <Trophy className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-black tracking-tight">
              Offizielle Rangliste — 81247 Sardinen
            </h2>
            <p className="text-xs text-slate-400">
              Gesamtzeit = Netto-Suchzeit (ab 10:00) + gültige Hinweis-Strafzeiten
            </p>
          </div>
        </div>

        {ranked.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 text-center">
            <p className="text-sm font-bold text-slate-200">
              Noch kein Sucher-Team bei den Sardinen eingetroffen!
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Sobald ein Team den QR-Code der Verstecker scannt oder das Verstecker-Passwort eingibt, erscheint hier die offizielle Wertung.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {ranked.map((entry, idx) => {
              const rank = idx + 1;
              const medal =
                rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
              return (
                <div
                  key={entry.teamId}
                  data-testid={`leaderboard-row-${entry.teamId}`}
                  className={`rounded-2xl border p-4 shadow-lg ${
                    rank === 1
                      ? 'border-amber-400/60 bg-gradient-to-r from-amber-950/40 to-slate-900'
                      : 'border-slate-800 bg-slate-900/90'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-black">{medal}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="text-base font-extrabold text-white">
                            {entry.teamName}
                          </span>
                        </div>
                        <span className="text-[11px] font-semibold text-cyan-300">
                          Bei den Sardinen • {entry.clueCount} Hinweise genutzt
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="block text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                        Gesamtzeit
                      </span>
                      <span className="font-mono text-xl font-black text-emerald-400">
                        {formatDurationClock(entry.totalTimeMs)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-800/80 pt-2.5 text-xs">
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <Clock className="h-3.5 w-3.5 text-cyan-400" />
                      <span>Netto-Suchzeit:</span>
                      <strong className="font-mono text-white">
                        {formatDurationClock(entry.searchTimeMs)}
                      </strong>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-300">
                      <AlertCircle className="h-3.5 w-3.5 text-rose-400" />
                      <span>Strafzeit:</span>
                      <strong className="font-mono text-rose-300">
                        {formatPenaltyMinutes(entry.penaltyMs)}
                      </strong>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {stillSearching.length > 0 && (
          <div className="space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-xs font-bold tracking-wider text-slate-400 uppercase">
              <Users className="h-4 w-4" /> Aktuell noch auf der Suche
            </h3>
            {stillSearching.map((team) => (
              <div
                key={team.id}
                className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: team.color }}
                  />
                  <span className="font-bold text-slate-200">{team.name}</span>
                  <span className="text-slate-400">
                    ({team.memberPlayerIds.length} Spieler)
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-400">
                    Hinweise: <strong className="text-white">{team.clueCount}</strong>
                  </span>
                  <span className="rounded-md bg-rose-950/60 px-2 py-0.5 font-bold text-rose-300">
                    {formatPenaltyMinutes(team.penaltyMs)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
