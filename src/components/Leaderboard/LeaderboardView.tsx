import React, { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type {
  GameMode,
  GameStatus,
  LeaderboardEntry,
  TeamPublic,
} from '../../types/game';
import {
  formatDurationClock,
  formatPenaltyMinutes,
  sortLeaderboardEntries,
} from '../../utils/formatting';

export interface LeaderboardViewProps {
  leaderboard: Record<string, LeaderboardEntry>;
  teamsPublic: Record<string, TeamPublic>;
  activeTeamIds?: string[];
  gameMode?: GameMode;
  gameStatus?: GameStatus;
  onReturnToLobbyByHost?: () => Promise<void>;
}

export const LeaderboardView: React.FC<LeaderboardViewProps> = ({
  leaderboard,
  teamsPublic,
  activeTeamIds,
  gameMode = 'CLASSIC',
  gameStatus,
  onReturnToLobbyByHost,
}) => {
  const [returningToLobby, setReturningToLobby] = useState(false);
  const isManhunt = gameMode === 'MANHUNT';
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
      <div className="mx-auto max-w-2xl space-y-4 pb-10">
        <div className="cmf-chassis cmf-card-enter flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <h2 className="font-dot text-lg text-[var(--text-main)] sm:text-xl">
              Rangliste
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {isManhunt
                ? 'Schnellste Fangzeit gewinnt'
                : 'Kürzeste Gesamtzeit (Suchzeit + Tipp-Strafe) gewinnt'}
            </p>
          </div>

          {onReturnToLobbyByHost && gameStatus === 'FINISHED' && (
            <button
              type="button"
              data-testid="leaderboard-host-new-round-btn"
              disabled={returningToLobby}
              onClick={async () => {
                setReturningToLobby(true);
                try {
                  await onReturnToLobbyByHost();
                } finally {
                  setReturningToLobby(false);
                }
              }}
              className="cmf-btn-primary font-dot inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              <span>
                {returningToLobby ? 'Öffne Lobby ...' : 'Neue Runde starten'}
              </span>
            </button>
          )}
        </div>

        {ranked.length === 0 ? (
          <div className="cmf-module p-6 text-center">
            <p className="font-industrial text-sm text-[var(--text-main)]">
              Noch kein Team am Ziel!
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Sobald ein Team den QR-Code der Verstecker scannt, erscheint es hier.
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
                        <span className="text-[11px] font-medium text-[var(--cmf-teal)]">
                          {isManhunt
                            ? 'Gefunden'
                            : `Gefunden · ${entry.clueCount} Tipps`}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="block text-[10px] font-medium text-[var(--text-muted)]">
                        {isManhunt ? 'Fangzeit' : 'Gesamtzeit'}
                      </span>
                      <span className="font-mono-code text-lg font-bold text-[var(--text-main)]">
                        {formatDurationClock(entry.totalTimeMs)}
                      </span>
                    </div>
                  </div>

                  {!isManhunt && (
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t cmf-divider pt-3 text-xs">
                      <div className="cmf-well flex items-center justify-between px-3 py-1.5">
                        <span className="text-[var(--text-muted)]">
                          Suchzeit
                        </span>
                        <strong className="font-mono-code text-[var(--text-main)]">
                          {formatDurationClock(entry.searchTimeMs)}
                        </strong>
                      </div>
                      <div className="cmf-well flex items-center justify-between px-3 py-1.5">
                        <span className="text-[var(--text-muted)]">
                          {entry.penaltyMs < 0 ? 'Zeitgutschrift' : 'Tipp-Strafe'}
                        </span>
                        <strong
                          className={`font-mono-code ${
                            entry.penaltyMs < 0
                              ? 'text-[var(--cmf-teal)]'
                              : 'text-[var(--cmf-orange)]'
                          }`}
                        >
                          {formatPenaltyMinutes(entry.penaltyMs)}
                        </strong>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {stillSearching.length > 0 && (
          <div className="space-y-2">
            <h3 className="px-1 text-xs font-semibold text-[var(--text-muted)]">
              Noch auf der Suche ({stillSearching.length})
            </h3>
            {stillSearching.map((team) => (
              <div
                key={team.id}
                className="cmf-module flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-white/60"
                    style={{ backgroundColor: team.color }}
                  />
                  <span className="font-industrial text-sm text-[var(--text-main)]">
                    {team.name}
                  </span>
                  <span className="text-[11px] text-[var(--text-muted)]">
                    ({team.memberPlayerIds.length})
                  </span>
                </div>
                {!isManhunt && (
                  <div className="flex items-center gap-2">
                    <span className="font-tech text-[11px] text-[var(--text-muted)]">
                      {team.clueCount} Tipps
                    </span>
                    {team.penaltyMs !== 0 && (
                      <span
                        className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${
                          team.penaltyMs > 0 ? 'cmf-badge-orange' : 'cmf-badge-teal'
                        }`}
                      >
                        {formatPenaltyMinutes(team.penaltyMs)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
