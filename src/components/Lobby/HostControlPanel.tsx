import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  UserPlus,
  UserX,
  Radio,
  MousePointerClick,
  Trash2,
  FastForward,
  Lock,
  CheckCircle2,
} from 'lucide-react';
import {
  buildRadarScheduleForHidingMinutes,
  createDefaultPublicState,
  createDefaultTeams,
  TEAM_PALETTE,
} from '../../config/gameConfig';
import { HardwareKnob } from '../Common/HardwareKnob';
import {
  deduplicateEnabledMembers,
  filterOnlineEnabledMembers,
  isPlayerOnline,
  type DatabaseAdapter,
} from '../../services/databaseAdapter';
import { generateRandomId, generateSessionSecrets } from '../../services/qrService';
import type {
  HiderLoginLock,
  HiderPrivateState,
  JoinRequest,
  MemberRecord,
  PlayerSide,
  PresenceSession,
  PublicGameState,
  TeamPublic,
} from '../../types/game';

export interface HostControlPanelProps {
  adapter: DatabaseAdapter;
  ownMember: MemberRecord;
  publicState: PublicGameState;
  hiderPrivate: HiderPrivateState | null;
  activeHiderLock: HiderLoginLock | null;
  readyPlayerIds: string[];
  members: Record<string, MemberRecord>;
  joinRequests: Record<string, JoinRequest>;
  presence: Record<string, Record<string, PresenceSession>>;
  teamsPublic: Record<string, TeamPublic>;
  onNavigateToMap: () => void;
  onLeaveAndLockConsole?: () => void;
}

export const HostControlPanel: React.FC<HostControlPanelProps> = ({
  adapter,
  ownMember,
  publicState,
  hiderPrivate,
  activeHiderLock,
  readyPlayerIds,
  members,
  joinRequests,
  presence,
  teamsPublic,
  onNavigateToMap,
  onLeaveAndLockConsole,
}) => {
  const [hidingMinInput, setHidingMinInput] = useState(
    Math.round(publicState.radarSchedule.hidingDurationMs / 60_000)
  );

  const openRequests = Object.values(joinRequests).sort(
    (a, b) => a.requestedAt - b.requestedAt
  );

  const enabledMembers = deduplicateEnabledMembers(members, presence);
  const onlineMembers = filterOnlineEnabledMembers(
    members,
    presence,
    ownMember.uid
  );
  const activeGroupMembers =
    publicState.status === 'LOBBY' ? onlineMembers : enabledMembers;
  const offlineLobbyMembers =
    publicState.status === 'LOBBY'
      ? enabledMembers.filter(
          (m) => !isPlayerOnline(m.playerId, members, presence, ownMember.uid)
        )
      : [];

  const readySet = new Set(readyPlayerIds);
  const readyCount = onlineMembers.filter((m) => readySet.has(m.playerId)).length;
  const hiderCount = activeGroupMembers.filter(
    (m) => m.enabled && m.side === 'HIDER'
  ).length;

  const handleStartRound = async () => {
    const now = adapter.getServerNow();
    const fallbackSecrets = generateSessionSecrets();
    const preservedQrSecret =
      hiderPrivate?.qrSecret?.trim() || fallbackSecrets.qrSecret;
    const preservedShortCode =
      hiderPrivate?.shortCode?.trim() || fallbackSecrets.shortCode;

    const nextTeams = createDefaultTeams();
    for (const m of onlineMembers) {
      if (m.enabled && m.side === 'SEEKER' && m.teamId && nextTeams[m.teamId]) {
        if (!nextTeams[m.teamId].memberPlayerIds.includes(m.playerId)) {
          nextTeams[m.teamId].memberPlayerIds.push(m.playerId);
        }
        nextTeams[m.teamId].beaconPlayerId =
          nextTeams[m.teamId].memberPlayerIds[0] ?? null;
      }
    }

    const occupiedTeamIds = Object.values(nextTeams)
      .filter((t) => t.memberPlayerIds.length > 0)
      .map((t) => t.id);

    await adapter.resetRoundByHost(
      {
        ...publicState,
        status: 'RUNNING',
        currentPhase: 'HIDING',
        gameStartTimestamp: now,
        searchStartTimestamp: null,
        pausedAt: null,
        totalPausedMs: 0,
        pausedBeforeSearchMs: 0,
        anchorLocked: false,
        radarCircle: null,
        emergencyStopReason: null,
        leashAlertActive: false,
        activeTeamIds: occupiedTeamIds,
        hiderLock: activeHiderLock,
        radarSchedule: buildRadarScheduleForHidingMinutes(hidingMinInput),
      },
      nextTeams,
      {
        anchorPoint: null,
        radarStages: [],
        qrSecret: preservedQrSecret,
        shortCode: preservedShortCode,
      }
    );
    if (activeHiderLock) {
      await adapter
        .savePublicStateByHost({
          ...publicState,
          status: 'RUNNING',
          currentPhase: 'HIDING',
          gameStartTimestamp: now,
          searchStartTimestamp: null,
          pausedAt: null,
          totalPausedMs: 0,
          pausedBeforeSearchMs: 0,
          anchorLocked: false,
          radarCircle: null,
          emergencyStopReason: null,
          leashAlertActive: false,
          activeTeamIds: occupiedTeamIds,
          hiderLock: activeHiderLock,
          radarSchedule: buildRadarScheduleForHidingMinutes(hidingMinInput),
        })
        .catch(() => {});
    }
    onNavigateToMap();
  };

  const handleTogglePause = async () => {
    const now = adapter.getServerNow();
    if (publicState.status === 'RUNNING') {
      await adapter.savePublicStateByHost({
        ...publicState,
        status: 'PAUSED',
        pausedAt: now,
      });
    } else if (publicState.status === 'PAUSED' && publicState.pausedAt !== null) {
      const addedPause = Math.max(0, now - publicState.pausedAt);
      await adapter.savePublicStateByHost({
        ...publicState,
        status: 'RUNNING',
        pausedAt: null,
        totalPausedMs: publicState.totalPausedMs + addedPause,
      });
    }
  };

  const handleForceStartOpenSearch = async () => {
    const now = adapter.getServerNow();
    await adapter.savePublicStateByHost({
      ...publicState,
      currentPhase: 'OPEN_SEARCH',
      searchStartTimestamp: publicState.searchStartTimestamp ?? now,
      pausedBeforeSearchMs: publicState.totalPausedMs,
      anchorLocked: true,
    });
  };

  const handleResetRound = async () => {
    const sessionId = generateRandomId('session');
    const secrets = generateSessionSecrets();
    const resetPublic = createDefaultPublicState(
      sessionId,
      publicState.playArea
    );
    resetPublic.allowTestClicks = publicState.allowTestClicks;

    const resetTeams = createDefaultTeams();
    for (const m of enabledMembers) {
      if (m.enabled && m.side === 'SEEKER' && m.teamId && resetTeams[m.teamId]) {
        resetTeams[m.teamId].memberPlayerIds.push(m.playerId);
        resetTeams[m.teamId].beaconPlayerId =
          teamsPublic[m.teamId]?.beaconPlayerId ?? m.playerId;
      }
    }

    await adapter.resetRoundByHost(resetPublic, resetTeams, {
      anchorPoint: null,
      radarStages: [],
      qrSecret: secrets.qrSecret,
      shortCode: secrets.shortCode,
    });
  };

  const handleAssignMember = async (
    member: MemberRecord,
    nextSelection: string
  ) => {
    let side: PlayerSide = 'UNASSIGNED';
    let teamId: string | null = null;
    if (nextSelection === 'HIDER') {
      side = 'HIDER';
    } else if (nextSelection.startsWith('team-')) {
      side = 'SEEKER';
      teamId = nextSelection;
    }

    for (const m of Object.values(members)) {
      if (m.playerId === member.playerId) {
        await adapter.updateMember(m.uid, {
          ...m,
          side,
          teamId,
        });
      }
    }
    await adapter.savePlayerAssignment(member.playerId, side, teamId);

    for (const palette of TEAM_PALETTE) {
      const curTeam = teamsPublic[palette.id];
      if (!curTeam) continue;
      const filtered = curTeam.memberPlayerIds.filter(
        (pid) => pid !== member.playerId
      );
      if (teamId === palette.id && !filtered.includes(member.playerId)) {
        filtered.push(member.playerId);
      }
      const nextBeacon =
        filtered.length === 0
          ? null
          : curTeam.beaconPlayerId && filtered.includes(curTeam.beaconPlayerId)
            ? curTeam.beaconPlayerId
            : filtered[0];

      await adapter.saveTeamPublic(palette.id, {
        ...curTeam,
        memberPlayerIds: filtered,
        beaconPlayerId: nextBeacon,
      });
    }
  };

  const handleKickMember = async (member: MemberRecord) => {
    const matchingUids = Object.values(members)
      .filter((m) => m.playerId === member.playerId)
      .map((m) => m.uid);
    if (!matchingUids.includes(member.uid)) {
      matchingUids.push(member.uid);
    }
    await adapter.kickPlayerByHost(member.playerId, matchingUids);
  };

  // NUR besetzte Teams anzeigen (vor Start ausschließlich mit aktuell online verbundenen Spielern!)
  const occupiedTeams = TEAM_PALETTE.map((palette) => {
    const team = teamsPublic[palette.id];
    const assignedMembers = activeGroupMembers.filter(
      (m) => m.side === 'SEEKER' && m.teamId === palette.id
    );
    return {
      id: palette.id,
      name: team?.name ?? palette.name,
      color: team?.color ?? palette.color,
      memberNames: assignedMembers.map((m) => m.name),
    };
  }).filter((t) => t.memberNames.length > 0);

  return (
    <div className="cmf-drafting-bg cmf-scroll-area cmf-view-enter h-full px-3 py-3.5 sm:p-4 text-[var(--text-main)]">
      <div className="mx-auto max-w-3xl space-y-4 sm:space-y-5 pb-12">
        {/* Kopfzeile (Admin-Zugriff bleibt beim Tab-Wechsel & Neuladen erhalten) */}
        <div className="cmf-chassis cmf-card-enter flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <span className="cmf-badge-teal inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider uppercase">
              SPIELLEITER // KONSOLE
            </span>
            <h2 className="font-dot mt-1 text-lg sm:text-xl text-[var(--text-main)]">
              Rundensteuerung & Teams
            </h2>
          </div>
          <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
            ADMIN-MODUS DAUERHAFT AKTIV
          </span>
        </div>

        {/* 1. Offene Beitrittswünsche */}
        {openRequests.length > 0 && (
          <section className="cmf-module p-4 sm:p-5 space-y-3">
            <h3 className="font-industrial flex items-center gap-2 text-sm text-[var(--text-main)]">
              <UserPlus className="h-4 w-4 text-[var(--cmf-orange)]" />
              Offene Beitrittswünsche ({openRequests.length})
            </h3>
            <div className="space-y-2">
              {openRequests.map((req) => (
                <div
                  key={req.uid}
                  className="cmf-well flex flex-wrap items-center justify-between gap-2 p-3"
                >
                  <div>
                    <p className="text-sm font-bold text-[var(--text-main)]">{req.name}</p>
                    <p className="font-tech text-[10px] text-[var(--text-muted)]">
                      UID // {req.uid}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid={`approve-player-${req.playerId}`}
                    onClick={() => void adapter.approveJoinRequest(req)}
                    className="cmf-btn-primary font-dot min-h-[40px] px-3.5 py-2 text-xs font-bold"
                  >
                    Spieler freischalten
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 2. Rundenstart, Bereitschafts-Status, Pause & Reset */}
        <section className="cmf-module p-4 sm:p-5 space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-3">
            <h3 className="font-industrial text-base text-[var(--text-main)]">
              Systemsteuerung
            </h3>
          </div>

          <HardwareKnob
            label="VERSTECKZEIT (STANDARD 20 MIN)"
            ariaLabel="Versteckzeit in Minuten"
            dataTestId="hiding-time-knob"
            value={hidingMinInput}
            min={5}
            max={60}
            step={5}
            unit=" Min."
            onChange={(nextMin) => {
              setHidingMinInput(nextMin);
              void adapter
                .savePublicStateByHost({
                  ...publicState,
                  radarSchedule: buildRadarScheduleForHidingMinutes(nextMin),
                })
                .catch(() => {});
            }}
          />

          {/* OLED Status- & Bereitschafts-Anzeige */}
          <div className="cmf-oled flex flex-wrap items-center justify-between gap-3 p-3.5">
            <div className="flex items-center gap-2.5">
              {publicState.status === 'RUNNING' ? (
                <span className="nothing-red-dot" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-[var(--cmf-teal)]" />
              )}
              <span className="font-tech text-xs font-bold tracking-wider text-[#F8FAFC] uppercase">
                STATUS: {publicState.status} // {publicState.currentPhase}
              </span>
            </div>

            {publicState.status === 'LOBBY' && (
              <span className="font-dot text-sm text-[var(--cmf-teal)]">
                BEREIT (ONLINE): {readyCount} / {onlineMembers.length}
              </span>
            )}
          </div>

          {publicState.status === 'LOBBY' && (
            <div className="cmf-well flex items-center gap-2 px-3.5 py-2.5 text-xs text-[var(--text-muted)]">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--cmf-teal)]" />
              <span>
                {activeHiderLock?.passwordHash
                  ? 'Runde startet automatisch, sobald alle Spieler in der Lobby auf „Bereit“ gedrückt haben!'
                  : 'Wartet darauf, dass die Verstecker in der Lobby ihr Passwort festlegen.'}
              </span>
            </div>
          )}

          {hiderCount === 0 && (
            <div className="cmf-badge-orange rounded-xl p-3 text-xs font-semibold">
              Hinweis: Mindestens ein Spieler sollte als Verstecker („Die Sardinen“) eingeteilt sein.
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2.5 pt-1">
            {publicState.status === 'LOBBY' ||
            publicState.status === 'FINISHED' ? (
              <button
                type="button"
                data-testid="host-start-round-btn"
                disabled={hiderCount === 0 || occupiedTeams.length === 0}
                onClick={() => void handleStartRound()}
                className="cmf-btn-primary font-dot inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold"
              >
                <Play className="h-4 w-4" />
                Runde manuell sofort starten
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleTogglePause()}
                  className="cmf-btn-active font-dot inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold"
                >
                  {publicState.status === 'PAUSED' ? (
                    <>
                      <Play className="h-4 w-4 text-[var(--cmf-teal)]" /> Spiel fortsetzen
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4 text-[var(--cmf-amber)]" /> Spiel pausieren
                    </>
                  )}
                </button>

                {publicState.currentPhase === 'HIDING' && (
                  <button
                    type="button"
                    onClick={() => void handleForceStartOpenSearch()}
                    className="cmf-btn-primary font-dot inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold"
                  >
                    <FastForward className="h-4 w-4" />
                    Offene Suche sofort freigeben
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={() => void handleResetRound()}
              className="cmf-btn-secondary font-tech inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold uppercase"
            >
              <RotateCcw className="h-4 w-4" />
              Runde zurücksetzen
            </button>
          </div>
        </section>

        {/* 3. Indoor-Testmodus Schalter */}
        <section className="cmf-module p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <MousePointerClick className="mt-0.5 h-5 w-5 shrink-0 text-[var(--cmf-teal)]" />
              <div>
                <h3 className="font-industrial text-sm text-[var(--text-main)]">
                  Testmodus: Standort per Kartenklick setzen erlauben
                </h3>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Ideal für Indoor-Generalproben vor dem Spieltag. Im echten Outdoor-Spiel in 81247 bitte deaktivieren!
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={publicState.allowTestClicks}
              onClick={() =>
                void adapter.savePublicStateByHost({
                  ...publicState,
                  allowTestClicks: !publicState.allowTestClicks,
                })
              }
              className={`font-tech min-h-[40px] shrink-0 px-4 py-2 text-xs font-bold tracking-wider uppercase ${
                publicState.allowTestClicks
                  ? 'cmf-btn-active'
                  : 'cmf-btn-secondary'
              }`}
            >
              {publicState.allowTestClicks ? 'AKTIV' : 'AUS'}
            </button>
          </div>
        </section>

        {/* 4. Spieler- & Team-Zuweisung + Nur besetzte Teams anzeigen */}
        <section className="cmf-module p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-3">
            <div>
              <h3 className="font-industrial text-base text-[var(--text-main)]">
                Spieler- & Team-Zuweisung
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                Unten werden automatisch nur die Teams angezeigt, in denen mindestens ein Spieler eingeteilt ist.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void adapter.cleanupOrphanedPresence()}
              className="cmf-btn-secondary font-tech inline-flex min-h-[36px] items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Sitzungen bereinigen
            </button>
          </div>

          <div className="space-y-2">
            {activeGroupMembers.map((m) => {
              const currentValue =
                m.side === 'HIDER'
                  ? 'HIDER'
                  : m.side === 'SEEKER' && m.teamId
                    ? m.teamId
                    : 'UNASSIGNED';
              const online = isPlayerOnline(
                m.playerId,
                members,
                presence,
                ownMember.uid
              );
              const isReady = readySet.has(m.playerId);

              return (
                <div
                  key={m.uid}
                  className="cmf-well flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 p-3 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                        online ? 'bg-[var(--cmf-teal)]' : 'bg-[#9AA4AE]'
                      }`}
                    />
                    <span className="text-sm font-bold text-[var(--text-main)]">{m.name}</span>
                    {m.isHost && (
                      <span className="cmf-badge-teal rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                        Host
                      </span>
                    )}
                    {isReady && (
                      <span className="cmf-badge-teal rounded px-1.5 py-0.5 text-[10px] font-bold uppercase">
                        ✓ Bereit
                      </span>
                    )}
                  </div>

                  <div className="flex w-full min-w-0 sm:w-auto items-center gap-2">
                    <select
                      aria-label={`Rolle für ${m.name}`}
                      value={currentValue}
                      onChange={(e) => void handleAssignMember(m, e.target.value)}
                      className="cmf-input min-h-[44px] min-w-0 flex-1 sm:flex-initial sm:max-w-[220px] px-3 py-2 text-base sm:text-xs font-semibold"
                    >
                      <option value="HIDER">Verstecker (Die Sardinen)</option>
                      {TEAM_PALETTE.map((t) => (
                        <option key={t.id} value={t.id}>
                          Sucher: {t.name}
                        </option>
                      ))}
                      <option value="UNASSIGNED">Nicht zugewiesen</option>
                    </select>

                    {m.uid !== ownMember.uid && (
                      <button
                        type="button"
                        data-testid={`kick-player-${m.playerId}`}
                        onClick={() => void handleKickMember(m)}
                        title={`${m.name} aus der Runde kicken`}
                        className="cmf-btn-secondary font-tech inline-flex min-h-[44px] shrink-0 items-center gap-1 px-3 py-2 text-[11px] font-bold text-[var(--cmf-orange)] uppercase"
                      >
                        <UserX className="h-4 w-4" />
                        <span>Kicken</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {offlineLobbyMembers.length > 0 && (
              <div className="cmf-well space-y-1.5 p-2.5 text-xs text-[var(--text-muted)]">
                <span className="font-tech text-[10px] font-bold tracking-wider uppercase block">
                  Aktuell offline (vor Start nicht in Gruppen & ohne Bereit-Pflicht):
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {offlineLobbyMembers.map((m) => (
                    <span
                      key={m.uid}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/60 px-2.5 py-1 text-[11px] text-[var(--text-muted)]"
                    >
                      <span className="h-2 w-2 rounded-full bg-[#9AA4AE]" />
                      <span>{m.name}</span>
                      <button
                        type="button"
                        data-testid={`kick-player-${m.playerId}`}
                        onClick={() => void handleKickMember(m)}
                        title={`${m.name} entfernen`}
                        className="ml-1 font-tech text-[10px] font-bold text-[var(--cmf-orange)] uppercase hover:underline"
                      >
                        [X]
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Teams-Anzeige: zeigt ausschließlich Teams an, in denen jemand drinnen ist! */}
          <div className="space-y-2 border-t cmf-divider pt-3">
            <h4 className="font-tech text-[11px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              Besetzte Sucher-Teams ({occupiedTeams.length})
            </h4>
            {occupiedTeams.length === 0 ? (
              <p className="cmf-well p-3 text-xs text-[var(--text-muted)]">
                Aktuell ist noch kein Sucher-Team besetzt.
              </p>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {occupiedTeams.map((team) => (
                  <div key={team.id} className="cmf-well p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-industrial flex items-center gap-2 text-sm text-[var(--text-main)]">
                        <span
                          className="h-3 w-3 rounded-full border border-white/60"
                          style={{ backgroundColor: team.color }}
                        />
                        {team.name}
                      </span>
                      <span className="cmf-badge-teal rounded px-2 py-0.5 text-[10px] font-bold uppercase">
                        {team.memberNames.length} Spieler
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 font-tech text-[11px] text-[var(--text-muted)]">
                      <Radio className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-teal)]" />
                      <span>
                        GPS-AVG:{' '}
                        <strong className="text-[var(--text-main)]">
                          {team.memberNames.join(', ')}
                        </strong>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 5. Admin-Bereich explizit sperren (ganz unten im Admin-Bereich) */}
        {onLeaveAndLockConsole && (
          <section className="cmf-module p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="font-industrial text-sm text-[var(--text-main)]">
                  Admin-Zugriff beenden
                </h3>
                <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                  Dein Admin-Zugriff bleibt auch beim Wechseln des Tabs oder Neuladen aktiv, bis du ihn hier unten ausdrücklich sperrst.
                </p>
              </div>
              <button
                type="button"
                data-testid="lock-admin-console-btn"
                onClick={onLeaveAndLockConsole}
                className="cmf-btn-secondary font-tech inline-flex min-h-[48px] w-full sm:w-auto shrink-0 items-center justify-center gap-2 border-[var(--cmf-orange)]/40 px-4 py-2.5 text-xs font-bold text-[var(--cmf-orange)] uppercase"
              >
                <Lock className="h-4 w-4 shrink-0 text-[var(--cmf-orange)]" />
                Admin-Bereich sperren & verlassen
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
