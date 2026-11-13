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
    <div className="cmf-drafting-bg cmf-scroll-area cmf-view-enter h-full px-3 py-3.5 sm:p-4 text-[var(--text-main)]">
      <div className="mx-auto max-w-2xl space-y-4 sm:space-y-5 pb-10">
        <div className="cmf-chassis cmf-card-enter flex items-center gap-3 p-4 sm:p-5">
          <div className="cmf-oled flex h-12 w-12 shrink-0 items-center justify-center text-[var(--cmf-amber)]">
            <Trophy className="h-6 w-6" />
          </div>
          <div>
            <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              TELEMETRIE // WERTUNG
            </span>
            <h2 className="font-dot text-lg text-[var(--text-main)] sm:text-xl">
              Offizielle Rangliste — 81247
            </h2>
            <p className="text-xs text-[var(--text-muted)]">
              Gesamtzeit = Netto-Suchzeit (ab 10:00) + gültige Hinweis-Strafzeiten
            </p>
          </div>
        </div>

        {ranked.length === 0 ? (
          <div className="cmf-module p-6 text-center">
            <p className="font-industrial text-sm text-[var(--text-main)]">
              Noch kein Sucher-Team bei den Sardinen eingetroffen!
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Sobald ein Team den QR-Code der Verstecker scannt oder das Verstecker-Passwort eingibt, erscheint hier die offizielle Wertung.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {ranked.map((entry, idx) => {
              const rank = idx + 1;
              return (
                <div
                  key={entry.teamId}
                  data-testid={`leaderboard-row-${entry.teamId}`}
                  style={{ animationDelay: `${Math.min(idx * 50, 250)}ms` }}
                  className={`cmf-module p-4 ${
                    rank === 1
                      ? 'cmf-winner-card border-[1.5px] !border-[var(--cmf-orange)]'
                      : 'cmf-card-enter'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-dot text-sm ${
                          rank === 1
                            ? 'bg-[var(--cmf-orange)] text-white shadow'
                            : 'cmf-well text-[var(--text-main)]'
                        }`}
                      >
                        #{rank}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-3 w-3 rounded-full border border-white/60"
                            style={{ backgroundColor: entry.color }}
                          />
                          <span className="font-industrial text-base text-[var(--text-main)]">
                            {entry.teamName}
                          </span>
                        </div>
                        <span className="font-tech text-[11px] font-medium text-[var(--cmf-teal)] uppercase">
                          BEI DEN SARDINEN // {entry.clueCount} HINWEISE
                        </span>
                      </div>
                    </div>

                    <div className="cmf-oled px-3.5 py-2 text-right">
                      <span className="font-tech block text-[9px] font-bold tracking-wider text-[#9AA4AE] uppercase">
                        GESAMTZEIT
                      </span>
                      <span className="font-dot text-lg text-[#F8FAFC]">
                        {formatDurationClock(entry.totalTimeMs)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 border-t cmf-divider pt-3 text-xs">
                    <div className="cmf-well flex items-center justify-between px-3 py-1.5">
                      <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                        <Clock className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                        Netto:
                      </span>
                      <strong className="font-tech text-[var(--text-main)]">
                        {formatDurationClock(entry.searchTimeMs)}
                      </strong>
                    </div>
                    <div className="cmf-well flex items-center justify-between px-3 py-1.5">
                      <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                        <AlertCircle
                          className={`h-3.5 w-3.5 ${
                            entry.penaltyMs < 0
                              ? 'text-[var(--cmf-teal)]'
                              : 'text-[var(--cmf-orange)]'
                          }`}
                        />
                        {entry.penaltyMs < 0 ? 'Zeitbonus:' : 'Strafzeit:'}
                      </span>
                      <strong
                        className={`font-tech ${
                          entry.penaltyMs < 0
                            ? 'text-[var(--cmf-teal)]'
                            : 'text-[var(--cmf-orange)]'
                        }`}
                      >
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
            <h3 className="flex items-center gap-2 px-1 font-tech text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              <span className="nothing-red-dot" />
              <Users className="h-3.5 w-3.5" />
              Aktuell noch auf der Suche ({stillSearching.length})
            </h3>
            {stillSearching.map((team) => (
              <div
                key={team.id}
                className="cmf-module flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-white/60"
                    style={{ backgroundColor: team.color }}
                  />
                  <span className="font-industrial text-sm text-[var(--text-main)]">
                    {team.name}
                  </span>
                  <span className="font-tech text-[11px] text-[var(--text-muted)]">
                    [{team.memberPlayerIds.length} SPIELER]
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="font-tech text-[11px] text-[var(--text-muted)] uppercase">
                    HINWEISE: <strong className="text-[var(--text-main)]">{team.clueCount}</strong>
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${
                      team.penaltyMs > 0 ? 'cmf-badge-orange' : 'cmf-badge-teal'
                    }`}
                  >
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
