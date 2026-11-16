import React, { useState } from 'react';
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Footprints,
  Navigation,
  Palette,
  Play,
  Plus,
  QrCode,
  Shuffle,
  Sparkles,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { TEAM_PALETTE } from '../../config/gameConfig';
import {
  createRandomSardineAvatar,
  parseSardineAvatar,
  SARDINE_COLOR_OPTIONS,
  SARDINE_EXTRA_OPTIONS,
  SARDINE_GLASSES_OPTIONS,
  SARDINE_HAT_OPTIONS,
  type SardineAvatarConfig,
  type SardineColorId,
  type SardineExtraId,
  type SardineGlassesId,
  type SardineHatId,
} from '../../config/sardineAvatar';
import { lockHiderAnchorAndGenerateRadar } from '../../hooks/useControllerEngine';
import {
  isMemberTabOnline,
  type DatabaseAdapter,
} from '../../services/databaseAdapter';
import {
  clearAllSandboxCharacters,
  isSimulatedMember,
  pickPointInsidePlayArea,
  removeSandboxCharacter,
  spawnDefaultSandboxPreset,
  spawnSandboxCharacter,
  triggerSandboxTeamCatch,
  triggerSandboxTeamClue,
  updateSandboxCharacter,
  type SandboxPuppetTarget,
} from '../../services/sandboxService';
import type {
  HiderPrivateState,
  MemberRecord,
  PresenceSession,
  PublicGameState,
  QuestionType,
  TeamLocation,
  TeamPublic,
} from '../../types/game';
import { PlayerAvatar } from '../Common/PlayerAvatar';

export interface AdminSandboxConsolePanelProps {
  adapter: DatabaseAdapter;
  publicState: PublicGameState;
  members: Record<string, MemberRecord>;
  presence: Record<string, Record<string, PresenceSession>>;
  readyPlayerIds: string[];
  teamsPublic: Record<string, TeamPublic>;
  teamLocations: Record<string, TeamLocation | null>;
  onSelectPuppetOnMap?: (target: SandboxPuppetTarget) => void;
}

export const AdminSandboxConsolePanel: React.FC<
  AdminSandboxConsolePanelProps
> = ({
  adapter,
  publicState,
  members,
  presence,
  readyPlayerIds,
  teamsPublic,
  teamLocations,
  onSelectPuppetOnMap,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSelection, setNewSelection] = useState<string>('team-1');
  const [newAvatarCfg, setNewAvatarCfg] = useState<SardineAvatarConfig>(() =>
    createRandomSardineAvatar('sim_preview')
  );
  const [editingBotUid, setEditingBotUid] = useState<string | null>(null);

  const simulatedMembers = Object.values(members)
    .filter((m) => m.enabled && isSimulatedMember(m))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const readySet = new Set(readyPlayerIds);

  const handleSpawnPreset = async () => {
    setBusy(true);
    try {
      if (!publicState.allowTestClicks) {
        await adapter.savePublicStateByHost({
          ...publicState,
          allowTestClicks: true,
        });
      }
      await spawnDefaultSandboxPreset({
        adapter,
        publicState: { ...publicState, allowTestClicks: true },
        teamsPublic,
        teamLocations,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSpawnSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const defaultLabel =
        newName.trim() || `Bot ${simulatedMembers.length + 1}`;
      await spawnSandboxCharacter({
        adapter,
        publicState,
        teamsPublic,
        teamLocations,
        name: defaultLabel,
        selection: newSelection,
        avatarConfig: newAvatarCfg,
        online: true,
        ready: false,
      });
      setNewName('');
      setNewAvatarCfg(createRandomSardineAvatar('sim_preview'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-testid="admin-sandbox-console"
      className="cmf-module space-y-3.5 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-emerald-500/40 bg-[#020804] text-[#00FF41]">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-emerald-500/40 bg-[#020804] px-2 py-0.5 font-tech text-[9px] font-bold tracking-wider text-[#00FF41] uppercase">
                ADMIN // SANDBOX &amp; TEST-BOTS
              </span>
              <span className="cmf-well rounded-full px-2 py-0.5 font-tech text-[9px] font-bold text-[var(--text-muted)] uppercase">
                {simulatedMembers.length} Bots aktiv
              </span>
            </div>
            <h3 className="font-industrial mt-0.5 text-sm font-bold text-[var(--text-main)] sm:text-base">
              Bewegbare &amp; anpassbare Test-Charaktere steuern
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="sandbox-spawn-preset-btn"
            disabled={busy}
            onClick={() => void handleSpawnPreset()}
            className="cmf-btn-primary font-tech inline-flex min-h-[34px] items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase disabled:opacity-50"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>Testgruppe spawnen</span>
          </button>

          {simulatedMembers.length > 0 && (
            <button
              type="button"
              data-testid="sandbox-clear-bots-btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await clearAllSandboxCharacters({ adapter, members });
                } finally {
                  setBusy(false);
                }
              }}
              className="cmf-btn-secondary font-tech inline-flex min-h-[34px] items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-[#DC2626] uppercase disabled:opacity-50"
            >
              <Trash2 className="h-3 w-3" />
              <span>Alle löschen</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="cmf-btn-secondary font-tech inline-flex min-h-[34px] items-center px-2 py-1 text-[10px] font-bold uppercase"
          >
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="space-y-3.5">
          {/* Formular: Neuen anpassbaren Test-Charakter erstellen */}
          <form
            onSubmit={handleSpawnSingle}
            className="cmf-well space-y-2.5 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                NEUEN TEST-CHARAKTER ERSTELLEN
              </span>
              <button
                type="button"
                onClick={() =>
                  setNewAvatarCfg(createRandomSardineAvatar('sim_preview'))
                }
                className="cmf-btn-secondary font-tech inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase"
              >
                <Shuffle className="h-2.5 w-2.5" />
                <span>Zufalls-Look</span>
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="cmf-oled flex h-11 w-11 shrink-0 items-center justify-center rounded-xl p-1">
                <PlayerAvatar config={newAvatarCfg} size="md" />
              </div>

              <input
                type="text"
                data-testid="sandbox-new-bot-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name (z. B. Bot Echo)"
                maxLength={22}
                className="cmf-input min-h-[38px] flex-1 px-3 py-1.5 text-xs font-semibold"
              />

              <select
                data-testid="sandbox-new-bot-role"
                value={newSelection}
                onChange={(e) => setNewSelection(e.target.value)}
                className="cmf-input min-h-[38px] px-2.5 py-1.5 text-xs font-bold"
              >
                <option value="HIDER">Die Sardinen (Verstecker)</option>
                {TEAM_PALETTE.map((t) => (
                  <option key={t.id} value={t.id}>
                    {teamsPublic[t.id]?.name ?? t.name}
                  </option>
                ))}
                <option value="UNASSIGNED">Ohne Team</option>
              </select>

              <button
                type="submit"
                data-testid="sandbox-spawn-bot-btn"
                disabled={busy}
                className="cmf-btn-primary font-tech inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 px-3.5 py-1.5 text-[10px] font-bold uppercase disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Spawnen</span>
              </button>
            </div>

            {/* Schnelle Sardinen-Look-Auswahl für neuen Bot */}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              <select
                aria-label="Bot-Farbe"
                value={newAvatarCfg.color}
                onChange={(e) =>
                  setNewAvatarCfg((prev) => ({
                    ...prev,
                    color: e.target.value as SardineColorId,
                  }))
                }
                className="cmf-input min-h-[32px] px-2 py-1 text-[11px]"
              >
                {SARDINE_COLOR_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    Farbe: {c.label}
                  </option>
                ))}
              </select>

              <select
                aria-label="Bot-Hut"
                value={newAvatarCfg.hat}
                onChange={(e) =>
                  setNewAvatarCfg((prev) => ({
                    ...prev,
                    hat: e.target.value as SardineHatId,
                  }))
                }
                className="cmf-input min-h-[32px] px-2 py-1 text-[11px]"
              >
                {SARDINE_HAT_OPTIONS.map((h) => (
                  <option key={h.id} value={h.id}>
                    Kopf: {h.label}
                  </option>
                ))}
              </select>

              <select
                aria-label="Bot-Brille"
                value={newAvatarCfg.glasses}
                onChange={(e) =>
                  setNewAvatarCfg((prev) => ({
                    ...prev,
                    glasses: e.target.value as SardineGlassesId,
                  }))
                }
                className="cmf-input min-h-[32px] px-2 py-1 text-[11px]"
              >
                {SARDINE_GLASSES_OPTIONS.map((g) => (
                  <option key={g.id} value={g.id}>
                    Brille: {g.label}
                  </option>
                ))}
              </select>

              <select
                aria-label="Bot-Extra"
                value={newAvatarCfg.extra}
                onChange={(e) =>
                  setNewAvatarCfg((prev) => ({
                    ...prev,
                    extra: e.target.value as SardineExtraId,
                  }))
                }
                className="cmf-input min-h-[32px] px-2 py-1 text-[11px]"
              >
                {SARDINE_EXTRA_OPTIONS.map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    Extra: {ex.label}
                  </option>
                ))}
              </select>
            </div>
          </form>

          {/* Liste der gespawnten Test-Charaktere */}
          {simulatedMembers.length === 0 ? (
            <div className="cmf-well p-3.5 text-center text-xs text-[var(--text-muted)]">
              Noch keine Test-Charaktere im Raum. Klicke auf{' '}
              <strong>„Testgruppe spawnen“</strong>, um sofort ein komplettes
              Test-Setup mit Verstecker und Sucher-Teams (inkl. Sardinenbüchsen
              auf der Karte) anzulegen.
            </div>
          ) : (
            <div className="space-y-2">
              {simulatedMembers.map((bot) => {
                const online = isMemberTabOnline(presence[bot.uid]);
                const ready = readySet.has(bot.playerId);
                const selectionVal =
                  bot.side === 'HIDER'
                    ? 'HIDER'
                    : bot.side === 'SEEKER' && bot.teamId
                      ? bot.teamId
                      : 'UNASSIGNED';
                const botCfg = parseSardineAvatar(bot.avatar);
                const isEditingLook = editingBotUid === bot.uid;

                return (
                  <div
                    key={bot.uid}
                    data-testid={`sandbox-bot-card-${bot.playerId}`}
                    className="cmf-well space-y-2 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <div className="cmf-oled flex h-10 w-10 shrink-0 items-center justify-center rounded-xl p-1">
                          <PlayerAvatar config={botCfg} size="sm" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-industrial truncate text-xs font-bold text-[var(--text-main)] sm:text-sm">
                              {bot.name}
                            </span>
                            <span
                              className={`h-2 w-2 rounded-full ${
                                online ? 'bg-emerald-500' : 'bg-zinc-400'
                              }`}
                            />
                          </div>
                          <span className="font-tech block text-[10px] text-[var(--text-muted)] uppercase">
                            {bot.side === 'HIDER'
                              ? 'Verstecker (Sardine)'
                              : bot.side === 'SEEKER' && bot.teamId
                                ? (teamsPublic[bot.teamId]?.name ?? bot.teamId)
                                : 'Ohne Team'}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <select
                          aria-label={`Team für ${bot.name}`}
                          value={selectionVal}
                          disabled={busy}
                          onChange={(e) =>
                            void updateSandboxCharacter({
                              adapter,
                              member: bot,
                              publicState,
                              teamsPublic,
                              teamLocations,
                              patch: { selection: e.target.value },
                            })
                          }
                          className="cmf-input min-h-[32px] px-2 py-1 text-[11px] font-bold"
                        >
                          <option value="HIDER">Verstecker</option>
                          {TEAM_PALETTE.map((t) => (
                            <option key={t.id} value={t.id}>
                              {teamsPublic[t.id]?.name ?? t.name}
                            </option>
                          ))}
                          <option value="UNASSIGNED">Ohne Team</option>
                        </select>

                        <button
                          type="button"
                          data-testid={`sandbox-bot-online-btn-${bot.playerId}`}
                          disabled={busy}
                          onClick={() =>
                            void updateSandboxCharacter({
                              adapter,
                              member: bot,
                              publicState,
                              teamsPublic,
                              teamLocations,
                              patch: { online: !online },
                            })
                          }
                          className={`cmf-btn-secondary font-tech inline-flex min-h-[32px] items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase ${
                            online
                              ? 'text-emerald-700'
                              : 'text-[var(--text-muted)]'
                          }`}
                          title="Online/Offline umschalten (aktualisiert sofort die Sardinenbüchse)"
                        >
                          {online ? (
                            <>
                              <Wifi className="h-3 w-3" />
                              <span>Online</span>
                            </>
                          ) : (
                            <>
                              <WifiOff className="h-3 w-3" />
                              <span>Offline</span>
                            </>
                          )}
                        </button>

                        {bot.side === 'HIDER' &&
                          publicState.status === 'LOBBY' && (
                            <button
                              type="button"
                              data-testid={`sandbox-bot-ready-btn-${bot.playerId}`}
                              disabled={busy}
                              onClick={() =>
                                void updateSandboxCharacter({
                                  adapter,
                                  member: bot,
                                  publicState,
                                  teamsPublic,
                                  teamLocations,
                                  patch: { ready: !ready },
                                })
                              }
                              className={`font-tech inline-flex min-h-[32px] items-center gap-1 rounded-xl px-2.5 py-1 text-[10px] font-bold uppercase ${
                                ready ? 'cmf-badge-teal' : 'cmf-btn-secondary'
                              }`}
                            >
                              <span>{ready ? '✓ Bereit' : 'Bereit?'}</span>
                            </button>
                          )}

                        <button
                          type="button"
                          onClick={() =>
                            setEditingBotUid(isEditingLook ? null : bot.uid)
                          }
                          className="cmf-btn-secondary font-tech inline-flex min-h-[32px] items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase"
                          title="Sardinen-Look & Namen anpassen"
                        >
                          <Palette className="h-3 w-3" />
                          <span>Look</span>
                        </button>

                        {onSelectPuppetOnMap && (
                          <button
                            type="button"
                            onClick={() =>
                              onSelectPuppetOnMap({
                                kind: 'MEMBER',
                                uid: bot.uid,
                              })
                            }
                            className="cmf-btn-primary font-tech inline-flex min-h-[32px] items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase"
                            title="Auf der Karte per Klick bewegen"
                          >
                            <Navigation className="h-3 w-3" />
                            <span>Bewegen</span>
                          </button>
                        )}

                        <button
                          type="button"
                          data-testid={`sandbox-bot-delete-btn-${bot.playerId}`}
                          disabled={busy}
                          onClick={() =>
                            void removeSandboxCharacter({
                              adapter,
                              member: bot,
                            })
                          }
                          className="cmf-btn-secondary inline-flex min-h-[32px] items-center px-2 py-1 text-[#DC2626]"
                          title="Test-Charakter entfernen"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {isEditingLook && (
                      <div className="grid grid-cols-2 gap-1.5 border-t cmf-divider pt-2 sm:grid-cols-4">
                        <select
                          value={botCfg.color}
                          onChange={(e) =>
                            void updateSandboxCharacter({
                              adapter,
                              member: bot,
                              publicState,
                              teamsPublic,
                              teamLocations,
                              patch: {
                                avatarConfig: {
                                  ...botCfg,
                                  color: e.target.value as SardineColorId,
                                },
                              },
                            })
                          }
                          className="cmf-input min-h-[30px] px-2 py-1 text-[11px]"
                        >
                          {SARDINE_COLOR_OPTIONS.map((c) => (
                            <option key={c.id} value={c.id}>
                              Farbe: {c.label}
                            </option>
                          ))}
                        </select>

                        <select
                          value={botCfg.hat}
                          onChange={(e) =>
                            void updateSandboxCharacter({
                              adapter,
                              member: bot,
                              publicState,
                              teamsPublic,
                              teamLocations,
                              patch: {
                                avatarConfig: {
                                  ...botCfg,
                                  hat: e.target.value as SardineHatId,
                                },
                              },
                            })
                          }
                          className="cmf-input min-h-[30px] px-2 py-1 text-[11px]"
                        >
                          {SARDINE_HAT_OPTIONS.map((h) => (
                            <option key={h.id} value={h.id}>
                              Kopf: {h.label}
                            </option>
                          ))}
                        </select>

                        <select
                          value={botCfg.glasses}
                          onChange={(e) =>
                            void updateSandboxCharacter({
                              adapter,
                              member: bot,
                              publicState,
                              teamsPublic,
                              teamLocations,
                              patch: {
                                avatarConfig: {
                                  ...botCfg,
                                  glasses: e.target.value as SardineGlassesId,
                                },
                              },
                            })
                          }
                          className="cmf-input min-h-[30px] px-2 py-1 text-[11px]"
                        >
                          {SARDINE_GLASSES_OPTIONS.map((g) => (
                            <option key={g.id} value={g.id}>
                              Brille: {g.label}
                            </option>
                          ))}
                        </select>

                        <select
                          value={botCfg.extra}
                          onChange={(e) =>
                            void updateSandboxCharacter({
                              adapter,
                              member: bot,
                              publicState,
                              teamsPublic,
                              teamLocations,
                              patch: {
                                avatarConfig: {
                                  ...botCfg,
                                  extra: e.target.value as SardineExtraId,
                                },
                              },
                            })
                          }
                          className="cmf-input min-h-[30px] px-2 py-1 text-[11px]"
                        >
                          {SARDINE_EXTRA_OPTIONS.map((ex) => (
                            <option key={ex.id} value={ex.id}>
                              Extra: {ex.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export interface AdminSandboxMapDockProps {
  adapter: DatabaseAdapter;
  publicState: PublicGameState;
  hiderPrivate: HiderPrivateState | null;
  members: Record<string, MemberRecord>;
  teamsPublic: Record<string, TeamPublic>;
  teamLocations: Record<string, TeamLocation | null>;
  activeTarget: SandboxPuppetTarget;
  onChangeTarget: (next: SandboxPuppetTarget) => void;
  autoWalkEnabled: boolean;
  onToggleAutoWalk: () => void;
  onOpenConsoleTab?: () => void;
}

const QUICK_CLUE_BUTTONS: ReadonlyArray<{
  type: QuestionType;
  label: string;
}> = [
  { type: 'SPLIT_NS', label: 'Nord/Süd' },
  { type: 'SPLIT_EW', label: 'Ost/West' },
  { type: 'RADIUS_RADAR', label: '250m Radar' },
  { type: 'DONUT_RING', label: 'Donut-Ring' },
  { type: 'CONE_45', label: '45°-Kegel' },
  { type: 'OSM_GREEN', label: 'Grünfläche' },
  { type: 'OSM_TRANSIT', label: 'ÖPNV' },
];

export const AdminSandboxMapDock: React.FC<AdminSandboxMapDockProps> = ({
  adapter,
  publicState,
  hiderPrivate,
  members,
  teamsPublic,
  teamLocations,
  activeTarget,
  onChangeTarget,
  autoWalkEnabled,
  onToggleAutoWalk,
  onOpenConsoleTab,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const simulatedMembers = Object.values(members)
    .filter((m) => m.enabled && isSimulatedMember(m))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const occupiedTeams = TEAM_PALETTE.filter((t) => {
    const pub = teamsPublic[t.id];
    const hasMember = Object.values(members).some(
      (m) => m.enabled && m.side === 'SEEKER' && m.teamId === t.id
    );
    return hasMember || (pub?.memberPlayerIds.length ?? 0) > 0;
  });

  const targetValue =
    activeTarget.kind === 'NONE'
      ? 'NONE'
      : activeTarget.kind === 'TEAM'
        ? `TEAM:${activeTarget.teamId}`
        : `MEMBER:${activeTarget.uid}`;

  const handleSelectValue = (val: string) => {
    if (val === 'NONE') {
      onChangeTarget({ kind: 'NONE' });
    } else if (val.startsWith('TEAM:')) {
      onChangeTarget({ kind: 'TEAM', teamId: val.slice(5) });
    } else if (val.startsWith('MEMBER:')) {
      onChangeTarget({ kind: 'MEMBER', uid: val.slice(7) });
    }
  };

  const selectedTeamId =
    activeTarget.kind === 'TEAM'
      ? activeTarget.teamId
      : activeTarget.kind === 'MEMBER' &&
          members[activeTarget.uid]?.side === 'SEEKER'
        ? (members[activeTarget.uid]?.teamId ?? null)
        : null;

  const selectedHiderMember =
    activeTarget.kind === 'MEMBER' &&
    members[activeTarget.uid]?.side === 'HIDER'
      ? members[activeTarget.uid]
      : null;

  const isRunningClassic =
    publicState.status === 'RUNNING' &&
    (publicState.gameMode ?? 'CLASSIC') === 'CLASSIC';

  const flashNote = (msg: string) => {
    setStatusNote(msg);
    setTimeout(() => {
      setStatusNote((cur) => (cur === msg ? null : cur));
    }, 2600);
  };

  return (
    <div
      data-testid="admin-sandbox-map-dock"
      className="pointer-events-auto absolute bottom-3 left-2.5 right-2.5 z-[410] mx-auto max-w-xl"
    >
      <div className="rounded-2xl border border-emerald-500/45 bg-[#020804]/95 p-2.5 text-[#F8FAFC] shadow-2xl backdrop-blur-md space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-[#00FF41]">
              <Bot className="h-3.5 w-3.5" />
            </span>

            <select
              data-testid="sandbox-map-target-select"
              aria-label="Karten-Steuerziel wählen"
              value={targetValue}
              onChange={(e) => handleSelectValue(e.target.value)}
              className="min-h-[34px] min-w-0 flex-1 rounded-xl border border-emerald-500/35 bg-[#09150D] px-2.5 py-1 font-tech text-[11px] font-bold text-[#F8FAFC] outline-none"
            >
              <option value="NONE">Steuerung: Aus (Nur zuschauen)</option>
              {occupiedTeams.length > 0 && (
                <optgroup label="Ganze Sucher-Teams bewegen (Dose)">
                  {occupiedTeams.map((t) => (
                    <option key={t.id} value={`TEAM:${t.id}`}>
                      Team bewegen: {teamsPublic[t.id]?.name ?? t.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {simulatedMembers.length > 0 && (
                <optgroup label="Einzelne Test-Charaktere">
                  {simulatedMembers.map((m) => (
                    <option key={m.uid} value={`MEMBER:${m.uid}`}>
                      {m.side === 'HIDER' ? 'Sardine' : 'Sucher'}: {m.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            {simulatedMembers.length > 0 && (
              <button
                type="button"
                data-testid="sandbox-map-autowalk-btn"
                onClick={onToggleAutoWalk}
                className={`inline-flex min-h-[34px] items-center gap-1 rounded-xl border px-2.5 py-1 font-tech text-[10px] font-bold uppercase transition-all ${
                  autoWalkEnabled
                    ? 'border-[#00FF41] bg-[#00FF41]/20 text-[#00FF41]'
                    : 'border-white/15 bg-white/5 text-slate-300'
                }`}
                title="Lässt alle Online-Bots automatisch durch das Spielgebiet laufen"
              >
                <Footprints className="h-3.5 w-3.5" />
                <span>{autoWalkEnabled ? 'Auto AN' : 'Auto'}</span>
              </button>
            )}

            <button
              type="button"
              data-testid="sandbox-map-expand-btn"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex min-h-[34px] items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-2.5 py-1 font-tech text-[10px] font-bold text-[#00FF41] uppercase"
            >
              <span>Aktionen</span>
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>

        {activeTarget.kind !== 'NONE' && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-tech text-[10px] font-bold text-emerald-300 uppercase">
            <span className="inline-flex items-center gap-1.5 truncate">
              <Crosshair className="h-3 w-3 shrink-0 text-[#00FF41]" />
              <span>Tippe auf die Karte, um das gewählte Ziel dorthin zu bewegen!</span>
            </span>
            <button
              type="button"
              onClick={() => onChangeTarget({ kind: 'NONE' })}
              className="shrink-0 text-[9px] text-white/80 underline"
            >
              Stop
            </button>
          </div>
        )}

        {statusNote && (
          <div className="rounded-lg bg-emerald-500/20 px-2.5 py-1 font-tech text-[10px] font-bold text-[#00FF41] uppercase">
            {statusNote}
          </div>
        )}

        {expanded && (
          <div className="space-y-2 border-t border-white/10 pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={busyAction}
                onClick={async () => {
                  setBusyAction(true);
                  try {
                    const created = await spawnDefaultSandboxPreset({
                      adapter,
                      publicState,
                      teamsPublic,
                      teamLocations,
                    });
                    if (created[0]) {
                      onChangeTarget({ kind: 'TEAM', teamId: 'team-1' });
                    }
                    flashNote('4 Test-Bots gespawnt (1 Sardine + 2 Teams)!');
                  } finally {
                    setBusyAction(false);
                  }
                }}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 font-tech text-[10px] font-bold text-[#00FF41] uppercase"
              >
                <Sparkles className="h-3 w-3" />
                <span>+ Testgruppe spawnen</span>
              </button>

              {onOpenConsoleTab && (
                <button
                  type="button"
                  onClick={onOpenConsoleTab}
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 font-tech text-[10px] font-bold text-slate-200 uppercase"
                >
                  <Play className="h-3 w-3" />
                  <span>Bots anpassen / Rundenstart</span>
                </button>
              )}

              {selectedHiderMember &&
                (publicState.gameMode ?? 'CLASSIC') === 'CLASSIC' && (
                  <button
                    type="button"
                    disabled={busyAction || !hiderPrivate}
                    onClick={async () => {
                      if (!hiderPrivate) return;
                      setBusyAction(true);
                      try {
                        const loc =
                          hiderPrivate.hiderLocations?.[
                            selectedHiderMember.uid
                          ] ?? pickPointInsidePlayArea(publicState);
                        await lockHiderAnchorAndGenerateRadar({
                          adapter,
                          uid: selectedHiderMember.uid,
                          targetLocation: { lat: loc.lat, lng: loc.lng },
                          accuracy: 6,
                          serverNowMs: adapter.getServerNow(),
                          publicState,
                          currentHiderPrivate: hiderPrivate,
                          startSearchImmediately:
                            publicState.status === 'RUNNING' &&
                            publicState.currentPhase === 'HIDING',
                        });
                        flashNote('Versteck (HQ) & Radar-Stufen fixiert!');
                      } finally {
                        setBusyAction(false);
                      }
                    }}
                    className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-amber-400/40 bg-amber-500/20 px-2.5 py-1 font-tech text-[10px] font-bold text-amber-300 uppercase"
                  >
                    <Crosshair className="h-3 w-3" />
                    <span>HQ hier fixieren</span>
                  </button>
                )}
            </div>

            {selectedTeamId && publicState.status === 'RUNNING' && (
              <div className="space-y-1.5 rounded-xl border border-white/10 bg-white/5 p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-tech text-[10px] font-bold text-slate-300 uppercase">
                    Aktionen als{' '}
                    <strong className="text-[#00FF41]">
                      {teamsPublic[selectedTeamId]?.name ?? selectedTeamId}
                    </strong>
                    :
                  </span>
                  <button
                    type="button"
                    data-testid="sandbox-map-catch-btn"
                    disabled={
                      busyAction ||
                      teamsPublic[selectedTeamId]?.status === 'JOINED_SARDINES'
                    }
                    onClick={async () => {
                      setBusyAction(true);
                      try {
                        await triggerSandboxTeamCatch({
                          adapter,
                          publicState,
                          hiderPrivate,
                          teamId: selectedTeamId,
                          members,
                        });
                        flashNote('QR-Catch für Team ausgelöst!');
                      } catch (err) {
                        flashNote(
                          err instanceof Error ? err.message : 'Catch-Fehler'
                        );
                      } finally {
                        setBusyAction(false);
                      }
                    }}
                    className="inline-flex min-h-[30px] items-center gap-1 rounded-lg bg-[#FF4D00] px-2.5 py-1 font-tech text-[10px] font-bold text-white uppercase disabled:opacity-40"
                  >
                    <QrCode className="h-3 w-3" />
                    <span>Sardinen finden (Catch)</span>
                  </button>
                </div>

                {isRunningClassic && (
                  <div className="flex flex-wrap gap-1">
                    {QUICK_CLUE_BUTTONS.map((btn) => (
                      <button
                        key={btn.type}
                        type="button"
                        disabled={busyAction}
                        onClick={async () => {
                          setBusyAction(true);
                          try {
                            await triggerSandboxTeamClue({
                              adapter,
                              publicState,
                              teamId: selectedTeamId,
                              questionType: btn.type,
                              teamLocation:
                                teamLocations[selectedTeamId] ?? null,
                              members,
                            });
                            flashNote(`Hinweis „${btn.label}“ angefragt!`);
                          } finally {
                            setBusyAction(false);
                          }
                        }}
                        className="rounded-lg border border-white/15 bg-black/40 px-2 py-1 font-tech text-[9.5px] font-bold text-slate-200 uppercase hover:border-[#00FF41] hover:text-[#00FF41]"
                      >
                        + {btn.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
