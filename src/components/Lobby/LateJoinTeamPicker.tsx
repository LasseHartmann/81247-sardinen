import React, { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  EyeOff,
  LogOut,
  Radio,
  Users,
} from 'lucide-react';
import { GAME_ID, TEAM_PALETTE } from '../../config/gameConfig';
import {
  deduplicateEnabledMembers,
  isPlayerOnline,
} from '../../services/databaseAdapter';
import type {
  MemberRecord,
  PresenceSession,
  PublicGameState,
  TeamPublic,
} from '../../types/game';
import { PlayerAvatar } from '../Common/PlayerAvatar';

export interface LateJoinTeamPickerProps {
  publicState: PublicGameState;
  ownMember: MemberRecord;
  members: Record<string, MemberRecord>;
  presence: Record<string, Record<string, PresenceSession>>;
  teamsPublic: Record<string, TeamPublic>;
  onSelectOwnRole: (nextSelection: string) => Promise<void>;
  onLeaveRoom: () => Promise<void>;
  onLogout: () => Promise<void>;
}

export const LateJoinTeamPicker: React.FC<LateJoinTeamPickerProps> = ({
  publicState,
  ownMember,
  members,
  presence,
  teamsPublic,
  onSelectOwnRole,
  onLeaveRoom,
  onLogout,
}) => {
  const [submittingChoice, setSubmittingChoice] = useState<string | null>(null);

  const roomCode = publicState.roomCode ?? GAME_ID;
  const isManhunt = (publicState.gameMode ?? 'CLASSIC') === 'MANHUNT';
  const isPaused = publicState.status === 'PAUSED';

  const allEnabledMembers = deduplicateEnabledMembers(members, presence).filter(
    (m) => m.playerId !== 'admin'
  );
  const memberByPlayerId = new Map<string, MemberRecord>();
  for (const m of allEnabledMembers) {
    memberByPlayerId.set(m.playerId, m);
  }

  // Alle Verstecker (originale Hider)
  const hiderMembers = allEnabledMembers
    .filter((m) => m.side === 'HIDER')
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  // Alle 6 Sucher-Teams inklusive ihrer aktuellen Mitglieder
  const allSeekerTeams = TEAM_PALETTE.map((palette) => {
    const pub = teamsPublic[palette.id];
    const assignedMembers = allEnabledMembers.filter(
      (m) => m.side === 'SEEKER' && m.teamId === palette.id
    );
    const assignedIds = new Set(assignedMembers.map((m) => m.playerId));
    const extraIdsFromTeam = (pub?.memberPlayerIds ?? []).filter(
      (pid) => !assignedIds.has(pid) && pid !== 'admin'
    );
    const extraMembers: Array<{
      playerId: string;
      name: string;
      avatar?: string;
    }> = extraIdsFromTeam.map((pid) => {
      const known = memberByPlayerId.get(pid);
      return {
        playerId: pid,
        name: known?.name ?? pid,
        avatar: known?.avatar,
      };
    });

    const combinedMembers = [
      ...assignedMembers.map((m) => ({
        playerId: m.playerId,
        name: m.name,
        avatar: m.avatar,
      })),
      ...extraMembers,
    ].sort((a, b) => a.name.localeCompare(b.name, 'de'));

    return {
      id: palette.id,
      name: pub?.name ?? palette.name,
      color: pub?.color ?? palette.color,
      status: pub?.status ?? 'ACTIVE',
      members: combinedMembers,
    };
  });

  const handleChoose = async (selection: string) => {
    if (submittingChoice) return;
    setSubmittingChoice(selection);
    try {
      await onSelectOwnRole(selection);
    } finally {
      setSubmittingChoice(null);
    }
  };

  return (
    <div
      data-testid="late-join-team-picker"
      className="cmf-drafting-bg cmf-scroll-area flex h-[100dvh] w-full flex-col items-center justify-start pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] text-[var(--text-main)]"
    >
      <div className="cmf-chassis w-full max-w-2xl space-y-4 p-4 sm:p-6">
        {/* Top-Status & Raum-Code */}
        <div className="cmf-oled space-y-2.5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="cmf-badge-orange inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
                <Radio className="h-3 w-3" />
                {isPaused ? 'SPIEL PAUSIERT' : 'SPIEL LÄUFT BEREITS'}
              </span>
              <span className="cmf-badge-teal rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
                {isManhunt ? 'MANHUNT' : 'KLASSISCH'}
              </span>
            </div>
            <span className="font-dot rounded-lg border border-[#27272A] bg-[#14171C] px-2.5 py-1 text-xs font-bold tracking-widest text-[#F8FAFC]">
              CODE: {roomCode}
            </span>
          </div>

          <div>
            <h1 className="font-industrial text-lg font-bold text-[#F8FAFC]">
              Wähle dein Team, {ownMember.name}
            </h1>
            <p className="mt-0.5 text-xs text-[#9AA4AE]">
              Das Spiel läuft bereits – wähle ein Team, um direkt mitzuspielen.
            </p>
          </div>
        </div>

        {/* Team 0: Die Sardinen (Verstecker) */}
        <section
          data-testid="late-join-card-hider"
          className="rounded-2xl border-[1.5px] border-[rgba(255,79,0,0.4)] bg-[rgba(255,79,0,0.06)] p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--cmf-orange)] text-white shadow-sm">
                <EyeOff className="h-4 w-4" />
              </span>
              <div>
                <h2 className="font-industrial text-sm font-bold text-[var(--text-main)]">
                  Verstecker (Die Sardinen)
                </h2>
                <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                  {hiderMembers.length} Spieler
                </span>
              </div>
            </div>

            <button
              type="button"
              data-testid="late-join-select-hider"
              disabled={submittingChoice !== null}
              onClick={() => void handleChoose('HIDER')}
              className="cmf-btn-primary font-dot inline-flex min-h-[40px] items-center gap-1.5 px-3.5 py-2 text-xs font-bold disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>
                {submittingChoice === 'HIDER'
                  ? 'Trete bei ...'
                  : 'Verstecker werden'}
              </span>
            </button>
          </div>

          {hiderMembers.length === 0 ? (
            <p className="text-xs italic text-[var(--text-muted)]">
              Aktuell keine Spieler direkt als Verstecker gelistet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {hiderMembers.map((m) => {
                const online = isPlayerOnline(
                  m.playerId,
                  members,
                  presence,
                  ownMember.uid
                );
                return (
                  <span
                    key={m.playerId}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--shell-border)] bg-white/90 px-2.5 py-1 text-xs font-semibold text-[var(--text-main)] shadow-xs"
                  >
                    <PlayerAvatar avatar={m.avatar} playerId={m} size="xs" />
                    <span>{m.name}</span>
                    <span
                      title={online ? 'Online' : 'Offline'}
                      className={`h-2 w-2 rounded-full ${
                        online ? 'bg-emerald-500' : 'bg-zinc-300'
                      }`}
                    />
                  </span>
                );
              })}
            </div>
          )}
        </section>

        {/* Alle 6 Sucher-Teams */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="font-tech inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              <Users className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
              Sucher-Teams (Alle Teams & Mitglieder)
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {allSeekerTeams.map((team) => {
              const joinedSardines = team.status === 'JOINED_SARDINES';
              const isPickingThis = submittingChoice === team.id;
              return (
                <div
                  key={team.id}
                  data-testid={`late-join-card-${team.id}`}
                  className="cmf-well flex flex-col justify-between gap-3 p-3.5"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-black/10"
                          style={{ backgroundColor: team.color }}
                        />
                        <div className="min-w-0">
                          <h3 className="font-industrial truncate text-sm font-bold text-[var(--text-main)]">
                            {team.name}
                          </h3>
                          <span className="font-tech text-[10px] font-bold text-[var(--text-muted)] uppercase">
                            {team.members.length}{' '}
                            {team.members.length === 1
                              ? 'Mitglied'
                              : 'Mitglieder'}
                          </span>
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                          joinedSardines
                            ? 'cmf-badge-teal'
                            : team.members.length > 0
                              ? 'cmf-badge-amber'
                              : 'border border-[var(--shell-border)] bg-white/70 text-[var(--text-muted)]'
                        }`}
                      >
                        {joinedSardines
                          ? 'Bei Sardinen'
                          : team.members.length > 0
                            ? 'Auf Suche'
                            : 'Frei'}
                      </span>
                    </div>

                    {team.members.length === 0 ? (
                      <p className="text-[11px] italic text-[var(--text-muted)]">
                        Noch keine Mitglieder – du kannst dieses Team neu
                        eröffnen.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {team.members.map((m) => {
                          const online = isPlayerOnline(
                            m.playerId,
                            members,
                            presence,
                            ownMember.uid
                          );
                          return (
                            <span
                              key={m.playerId}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--shell-border)] bg-white/90 px-2 py-1 text-[11px] font-semibold text-[var(--text-main)]"
                            >
                              <PlayerAvatar
                                avatar={m.avatar}
                                playerId={m}
                                size="xs"
                              />
                              <span>{m.name}</span>
                              <span
                                title={online ? 'Online' : 'Offline'}
                                className={`h-1.5 w-1.5 rounded-full ${
                                  online ? 'bg-emerald-500' : 'bg-zinc-300'
                                }`}
                              />
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    data-testid={`late-join-select-${team.id}`}
                    disabled={submittingChoice !== null}
                    onClick={() => void handleChoose(team.id)}
                    className="cmf-btn-secondary flex min-h-[40px] w-full items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                  >
                    <CheckCircle2
                      className="h-3.5 w-3.5"
                      style={{ color: team.color }}
                    />
                    <span>
                      {isPickingThis
                        ? 'Trete bei ...'
                        : `${team.name.split(' (')[0]} beitreten`}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Fußzeile: Raum wechseln oder Konto abmelden */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t cmf-divider pt-3">
          <button
            type="button"
            data-testid="late-join-leave-room-btn"
            disabled={submittingChoice !== null}
            onClick={() => void onLeaveRoom()}
            className="cmf-btn-secondary font-tech inline-flex min-h-[40px] items-center gap-1.5 px-3.5 py-2 text-xs font-bold uppercase"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Lobby wechseln</span>
          </button>

          <button
            type="button"
            disabled={submittingChoice !== null}
            onClick={() => void onLogout()}
            className="font-tech inline-flex min-h-[40px] items-center gap-1.5 px-3 py-2 text-[11px] font-bold text-[var(--text-muted)] uppercase hover:text-[var(--text-main)]"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Konto abmelden</span>
          </button>
        </div>
      </div>
    </div>
  );
};
