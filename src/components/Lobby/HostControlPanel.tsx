import React, { useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  OctagonAlert,
  UserPlus,
  Radio,
  MousePointerClick,
  Trash2,
  FastForward,
} from 'lucide-react';
import type { Feature, Polygon } from 'geojson';
import {
  createDefaultPublicState,
  createDefaultTeams,
  TEAM_PALETTE,
} from '../../config/gameConfig';
import type { DatabaseAdapter } from '../../services/databaseAdapter';
import { generateRandomId, generateSessionSecrets } from '../../services/qrService';
import type {
  JoinRequest,
  MemberRecord,
  PlayerSide,
  PresenceSession,
  PublicGameState,
  TeamPublic,
} from '../../types/game';
import { PlayAreaEditor } from './PlayAreaEditor';

export interface HostControlPanelProps {
  adapter: DatabaseAdapter;
  ownMember: MemberRecord;
  publicState: PublicGameState;
  members: Record<string, MemberRecord>;
  joinRequests: Record<string, JoinRequest>;
  presence: Record<string, Record<string, PresenceSession>>;
  teamsPublic: Record<string, TeamPublic>;
  polygonEditActive: boolean;
  polygonDeleteVertexMode: boolean;
  onTogglePolygonEdit: (active: boolean) => void;
  onTogglePolygonDeleteMode: (del: boolean) => void;
  onNavigateToMap: () => void;
}

export const HostControlPanel: React.FC<HostControlPanelProps> = ({
  adapter,
  ownMember,
  publicState,
  members,
  joinRequests,
  presence,
  teamsPublic,
  polygonEditActive,
  polygonDeleteVertexMode,
  onTogglePolygonEdit,
  onTogglePolygonDeleteMode,
  onNavigateToMap,
}) => {
  const [emergencyReasonInput, setEmergencyReasonInput] = useState(
    'Wetterwarnung / Spielleiter-Rückruf zum Sammelpunkt Schloss Blutenburg'
  );
  const [hidingMinInput, setHidingMinInput] = useState(
    Math.round(publicState.radarSchedule.hidingDurationMs / 60_000)
  );

  const openRequests = Object.values(joinRequests).sort(
    (a, b) => a.requestedAt - b.requestedAt
  );
  const enabledMembers = Object.values(members);
  const hiderCount = enabledMembers.filter(
    (m) => m.enabled && m.side === 'HIDER'
  ).length;

  const handleUpdatePolygon = async (
    nextPolygon: Feature<Polygon>,
    confirmed: boolean
  ) => {
    const now = adapter.getServerNow();
    await adapter.savePublicStateByHost({
      ...publicState,
      playArea: {
        ...publicState.playArea,
        polygon: nextPolygon,
        confirmed,
        confirmedAt: confirmed ? now : null,
        confirmedByUid: confirmed ? ownMember.uid : null,
      },
    });
  };

  const handleStartRound = async () => {
    if (!publicState.playArea.confirmed) return;
    const now = adapter.getServerNow();
    const sessionId = generateRandomId('session');
    const secrets = generateSessionSecrets();

    // Baue frische Team-Einträge anhand der aktuellen Spielerzuweisungen
    const nextTeams = createDefaultTeams();
    for (const m of enabledMembers) {
      if (m.enabled && m.side === 'SEEKER' && m.teamId && nextTeams[m.teamId]) {
        nextTeams[m.teamId].memberPlayerIds.push(m.playerId);
        const prevBeacon = teamsPublic[m.teamId]?.beaconPlayerId;
        if (prevBeacon && nextTeams[m.teamId].memberPlayerIds.includes(prevBeacon)) {
          nextTeams[m.teamId].beaconPlayerId = prevBeacon;
        } else if (!nextTeams[m.teamId].beaconPlayerId) {
          nextTeams[m.teamId].beaconPlayerId = m.playerId;
        }
      }
    }

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
        sessionId,
        anchorLocked: false,
        radarCircle: null,
        emergencyStopReason: null,
        leashAlertActive: false,
        radarSchedule: {
          ...publicState.radarSchedule,
          hidingDurationMs: Math.max(1, hidingMinInput) * 60_000,
        },
      },
      nextTeams,
      {
        anchorPoint: null,
        radarStages: [],
        qrSecret: secrets.qrSecret,
        shortCode: secrets.shortCode,
      }
    );
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
    // Bestätigtes 81247-Spielgebiet bleibt beim normalen Runden-Reset erhalten!
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

  const handleTriggerEmergencyStop = async () => {
    await adapter.savePublicStateByHost({
      ...publicState,
      status: 'EMERGENCY_STOP',
      emergencyStopReason:
        emergencyReasonInput.trim() ||
        'Sofortiger Rückruf zum Sammelpunkt durch den Spielleiter',
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

    const updatedMember: MemberRecord = {
      ...member,
      side,
      teamId,
    };
    await adapter.updateMember(member.uid, updatedMember);

    // Synchronisiere Team-Mitgliederlisten in Firebase / Demo
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

  const handleSetBeacon = async (team: TeamPublic, beaconPlayerId: string) => {
    await adapter.saveTeamPublic(team.id, {
      ...team,
      beaconPlayerId,
    });
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-950/95 p-4 text-slate-100">
      <div className="mx-auto max-w-3xl space-y-5 pb-10">
        <div>
          <span className="text-xs font-black tracking-wider text-emerald-400 uppercase">
            Spielleiter-Zentrale (Host)
          </span>
          <h2 className="text-xl font-black text-white">
            Rundensteuerung, Teams & 81247-Polygon
          </h2>
        </div>

        {/* 1. Offene Beitrittswünsche (1-Klick-Freischaltung) */}
        {openRequests.length > 0 && (
          <section className="rounded-2xl border border-amber-400/50 bg-amber-950/30 p-4">
            <h3 className="flex items-center gap-2 text-sm font-extrabold text-amber-300">
              <UserPlus className="h-4 w-4" />
              Offene Beitrittswünsche ({openRequests.length})
            </h3>
            <div className="mt-3 space-y-2">
              {openRequests.map((req) => (
                <div
                  key={req.uid}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3"
                >
                  <div>
                    <p className="text-sm font-bold text-white">{req.name}</p>
                    <p className="font-mono text-[11px] text-slate-400">
                      UID: {req.uid}
                    </p>
                  </div>
                  <button
                    type="button"
                    data-testid={`approve-player-${req.playerId}`}
                    onClick={() => void adapter.approveJoinRequest(req)}
                    className="min-h-[42px] rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-extrabold text-slate-950 hover:bg-emerald-400"
                  >
                    Spieler freischalten
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 2. Rundenstart, Pause, Phasensteuerung & Reset */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-white">
              Spielstatus: {publicState.status} ({publicState.currentPhase})
            </h3>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <span>Versteckzeit (Min.):</span>
              <input
                type="number"
                min={1}
                max={30}
                value={hidingMinInput}
                onChange={(e) =>
                  setHidingMinInput(Math.max(1, Number(e.target.value) || 10))
                }
                className="w-16 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-center font-bold text-white"
              />
            </label>
          </div>

          {!publicState.playArea.confirmed && (
            <div className="rounded-xl border border-amber-500/50 bg-amber-950/50 p-3 text-xs font-semibold text-amber-200">
              Rundenstart gesperrt: Bitte prüfe und bestätige zuerst unten das 81247-Spielgebiet!
            </div>
          )}

          {hiderCount === 0 && (
            <div className="rounded-xl border border-rose-500/50 bg-rose-950/50 p-3 text-xs font-semibold text-rose-200">
              Hinweis: Mindestens ein Spieler sollte als Verstecker („Die Sardinen“) eingeteilt sein.
            </div>
          )}

          <div className="flex flex-wrap gap-2.5">
            {publicState.status === 'LOBBY' ||
            publicState.status === 'FINISHED' ? (
              <button
                type="button"
                data-testid="host-start-round-btn"
                disabled={!publicState.playArea.confirmed || hiderCount === 0}
                onClick={() => void handleStartRound()}
                className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-black text-slate-950 shadow-lg hover:bg-emerald-400 disabled:opacity-40"
              >
                <Play className="h-4 w-4" />
                Runde jetzt in 81247 starten
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => void handleTogglePause()}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-amber-400"
                >
                  {publicState.status === 'PAUSED' ? (
                    <>
                      <Play className="h-4 w-4" /> Spiel fortsetzen
                    </>
                  ) : (
                    <>
                      <Pause className="h-4 w-4" /> Spiel pausieren
                    </>
                  )}
                </button>

                {publicState.currentPhase === 'HIDING' && (
                  <button
                    type="button"
                    onClick={() => void handleForceStartOpenSearch()}
                    className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-cyan-500/50 bg-cyan-950/60 px-4 py-2.5 text-xs font-bold text-cyan-200 hover:bg-cyan-900/60"
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
              className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-700"
            >
              <RotateCcw className="h-4 w-4" />
              Runde zurücksetzen (Polygon behalten)
            </button>
          </div>
        </section>

        {/* 3. Indoor-Testmodus Schalter */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <MousePointerClick className="mt-0.5 h-5 w-5 shrink-0 text-cyan-400" />
              <div>
                <h3 className="text-sm font-bold text-white">
                  Testmodus: Standort per Kartenklick setzen erlauben
                </h3>
                <p className="text-xs text-slate-400">
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
              className={`min-h-[42px] shrink-0 rounded-xl px-4 py-2 text-xs font-extrabold transition ${
                publicState.allowTestClicks
                  ? 'bg-cyan-500 text-slate-950'
                  : 'bg-slate-800 text-slate-300'
              }`}
            >
              {publicState.allowTestClicks ? 'AKTIV' : 'AUS'}
            </button>
          </div>
        </section>

        {/* 4. Spielgebiet-Polygon-Editor */}
        <PlayAreaEditor
          playArea={publicState.playArea}
          editActive={polygonEditActive}
          deleteVertexMode={polygonDeleteVertexMode}
          onToggleEdit={(active) => {
            onTogglePolygonEdit(active);
            if (active) onNavigateToMap();
          }}
          onToggleDeleteVertexMode={onTogglePolygonDeleteMode}
          onUpdatePolygon={handleUpdatePolygon}
        />

        {/* 5. Team- & GPS-Beacon-Zuweisung + Präsenz-Bereinigung */}
        <section className="rounded-2xl border border-slate-800 bg-slate-900/90 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-extrabold text-white">
                Spieler-, Team- & GPS-Beacon-Zuweisung
              </h3>
              <p className="text-xs text-slate-400">
                Genau ein Verstecker-Team („Die Sardinen“) und beliebig viele Sucher-Teams mit je einem Beacon-Gerät.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void adapter.cleanupOrphanedPresence()}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-slate-300 hover:text-white"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Verwaiste Sitzungen bereinigen ({Object.keys(presence).length})
            </button>
          </div>

          <div className="space-y-2">
            {enabledMembers.map((m) => {
              const currentValue =
                m.side === 'HIDER'
                  ? 'HIDER'
                  : m.side === 'SEEKER' && m.teamId
                    ? m.teamId
                    : 'UNASSIGNED';

              return (
                <div
                  key={m.uid}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2.5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        presence[m.uid] ? 'bg-emerald-400' : 'bg-slate-600'
                      }`}
                    />
                    <span className="font-bold text-white">{m.name}</span>
                    {m.isHost && (
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                        Host
                      </span>
                    )}
                  </div>

                  <select
                    aria-label={`Rolle für ${m.name}`}
                    value={currentValue}
                    onChange={(e) => void handleAssignMember(m, e.target.value)}
                    className="min-h-[40px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white"
                  >
                    <option value="HIDER">🐟 Verstecker (Die Sardinen)</option>
                    {TEAM_PALETTE.map((t) => (
                      <option key={t.id} value={t.id}>
                        Sucher: {t.name}
                      </option>
                    ))}
                    <option value="UNASSIGNED">Nicht zugewiesen</option>
                  </select>
                </div>
              );
            })}
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2">
            {TEAM_PALETTE.map((palette) => {
              const team = teamsPublic[palette.id];
              if (!team) return null;
              return (
                <div
                  key={team.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 font-bold text-white">
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: team.color }}
                      />
                      {team.name}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {team.memberPlayerIds.length} Mitgl.
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Radio className="h-3.5 w-3.5 shrink-0 text-cyan-400" />
                    <span className="text-slate-400">Beacon:</span>
                    <select
                      aria-label={`Beacon für ${team.name}`}
                      value={team.beaconPlayerId ?? ''}
                      disabled={team.memberPlayerIds.length === 0}
                      onChange={(e) =>
                        void handleSetBeacon(team, e.target.value)
                      }
                      className="min-h-[36px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white disabled:opacity-40"
                    >
                      {team.memberPlayerIds.length === 0 ? (
                        <option value="">Kein Mitglied</option>
                      ) : (
                        team.memberPlayerIds.map((pid) => (
                          <option key={pid} value={pid}>
                            {pid.toUpperCase()}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 6. Prominenter Notfall-Abbruch / Sammelpunkt-Ruf */}
        <section className="rounded-2xl border border-rose-500/50 bg-rose-950/25 p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-extrabold text-rose-300">
            <OctagonAlert className="h-5 w-5" />
            Notfall-Stopp / Alle zum Sammelpunkt rufen
          </div>
          <input
            type="text"
            value={emergencyReasonInput}
            onChange={(e) => setEmergencyReasonInput(e.target.value)}
            className="min-h-[44px] w-full rounded-xl border border-rose-500/40 bg-slate-950 px-3 py-2 text-xs text-white"
            placeholder="Grund für den Abbruch eingeben ..."
          />
          <button
            type="button"
            onClick={() => void handleTriggerEmergencyStop()}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-black text-white shadow-lg hover:bg-rose-500"
          >
            <OctagonAlert className="h-5 w-5" />
            Runde sofort abbrechen / Alle zum Sammelpunkt rufen
          </button>
        </section>
      </div>
    </div>
  );
};
