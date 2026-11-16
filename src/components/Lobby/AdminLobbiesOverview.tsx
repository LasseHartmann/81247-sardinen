import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Layers,
  MapPin,
  Radio,
  Search,
  Shield,
  Trash2,
  Users,
} from 'lucide-react';
import { isOverviewMember } from '../../config/players';
import type { DatabaseAdapter } from '../../services/databaseAdapter';
import type { AdminLobbyOverviewItem } from '../../types/game';

export interface AdminLobbiesOverviewProps {
  adapter: DatabaseAdapter;
  currentRoomCode?: string | null;
  hintRoomCodes?: string[];
  busy?: boolean;
  variant?: 'hub' | 'console';
  onOpenLobby: (roomCode: string) => Promise<void> | void;
  onAfterDeleteCurrentLobby?: (deletedRoomCode: string) => Promise<void> | void;
}

type StatusFilter = 'ALL' | 'LOBBY' | 'ACTIVE' | 'FINISHED';

function formatStatusLabel(item: AdminLobbyOverviewItem): {
  label: string;
  badgeClass: string;
} {
  if (item.status === 'RUNNING') {
    const phaseLabel =
      item.currentPhase === 'HIDING' ? 'VERSTECKEN' : 'SUCHE LÄUFT';
    return {
      label: `LÄUFT // ${phaseLabel}`,
      badgeClass: 'cmf-badge-orange',
    };
  }
  if (item.status === 'PAUSED') {
    return {
      label: 'PAUSIERT',
      badgeClass: 'cmf-badge-amber',
    };
  }
  if (item.status === 'FINISHED') {
    return {
      label: 'BEENDET',
      badgeClass: 'cmf-well text-[var(--text-muted)]',
    };
  }
  return {
    label: 'IN LOBBY',
    badgeClass: 'cmf-badge-teal',
  };
}

function formatUpdatedTimestamp(ts: number): string {
  if (!ts || !Number.isFinite(ts)) return 'Gerade eben';
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Gerade aktiv';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Vor ${diffMin} Min.`;
  const d = new Date(ts);
  return d.toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const AdminLobbiesOverview: React.FC<AdminLobbiesOverviewProps> = ({
  adapter,
  currentRoomCode = null,
  hintRoomCodes = [],
  busy = false,
  variant = 'hub',
  onOpenLobby,
  onAfterDeleteCurrentLobby,
}) => {
  const [lobbies, setLobbies] = useState<AdminLobbyOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [switchingCode, setSwitchingCode] = useState<string | null>(null);
  const [confirmDeleteCode, setConfirmDeleteCode] = useState<string | null>(
    null
  );
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const hintKey = useMemo(() => {
    const codes = [
      ...(currentRoomCode ? [currentRoomCode] : []),
      ...hintRoomCodes,
    ]
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    return Array.from(new Set(codes)).sort().join(',');
  }, [currentRoomCode, hintRoomCodes]);

  useEffect(() => {
    const hints = hintKey ? hintKey.split(',') : [];
    setLoading(true);
    const unsub = adapter.subscribeAllLobbiesOverview((next) => {
      setLobbies(next);
      setLoading(false);
    }, hints);
    return () => unsub();
  }, [adapter, hintKey]);

  const counts = useMemo(() => {
    let inLobby = 0;
    let active = 0;
    let finished = 0;
    let totalOnline = 0;
    for (const item of lobbies) {
      if (item.status === 'LOBBY') inLobby++;
      else if (item.status === 'RUNNING' || item.status === 'PAUSED') active++;
      else if (item.status === 'FINISHED') finished++;
      totalOnline += item.onlineCount;
    }
    return {
      total: lobbies.length,
      inLobby,
      active,
      finished,
      totalOnline,
    };
  }, [lobbies]);

  const filteredLobbies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return lobbies.filter((item) => {
      if (statusFilter === 'LOBBY' && item.status !== 'LOBBY') return false;
      if (
        statusFilter === 'ACTIVE' &&
        item.status !== 'RUNNING' &&
        item.status !== 'PAUSED'
      ) {
        return false;
      }
      if (statusFilter === 'FINISHED' && item.status !== 'FINISHED') {
        return false;
      }
      if (!q) return true;

      const allPlayerNames = [
        ...item.hiderNames,
        ...item.unassignedNames,
        ...item.seekerTeamSummaries.flatMap((t) => t.memberNames),
      ];
      return (
        item.roomCode.toLowerCase().includes(q) ||
        item.hostName.toLowerCase().includes(q) ||
        item.hostPlayerId.toLowerCase().includes(q) ||
        item.playAreaName.toLowerCase().includes(q) ||
        allPlayerNames.some((n) => n.toLowerCase().includes(q))
      );
    });
  }, [lobbies, searchQuery, statusFilter]);

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => {
        setCopiedCode((cur) => (cur === code ? null : cur));
      }, 1800);
    } catch {
      // Ignorieren
    }
  };

  const handleSwitch = async (code: string) => {
    if (busy || switchingCode || deletingCode) return;
    setSwitchingCode(code);
    try {
      await onOpenLobby(code);
    } finally {
      setSwitchingCode(null);
    }
  };

  const handleConfirmDeleteLobby = async (code: string) => {
    if (busy || switchingCode || deletingCode) return;
    setDeletingCode(code);
    try {
      const wasCurrent =
        Boolean(currentRoomCode) &&
        currentRoomCode?.toUpperCase() === code.toUpperCase();
      await adapter.deleteLobbyRoom(code);
      setLobbies((prev) =>
        prev.filter((item) => item.roomCode.toUpperCase() !== code.toUpperCase())
      );
      setConfirmDeleteCode(null);
      if (wasCurrent && onAfterDeleteCurrentLobby) {
        await onAfterDeleteCurrentLobby(code);
      }
    } finally {
      setDeletingCode(null);
    }
  };

  return (
    <section
      data-testid="admin-lobbies-overview"
      className="cmf-module space-y-3.5 p-4 sm:p-5"
    >
      {/* Kopfzeile */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b cmf-divider pb-3">
        <div className="flex items-center gap-2.5">
          <div className="cmf-oled flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--cmf-teal)]">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <span className="font-tech flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-[var(--cmf-teal)] uppercase">
              <Shield className="h-3 w-3" />
              ADMIN // ALLE LOBBYS LIVE
            </span>
            <h2 className="font-industrial text-base font-bold text-[var(--text-main)]">
              Übersicht aller Spielräume ({counts.total})
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="cmf-oled inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-tech text-[10px] font-bold text-[#F8FAFC] uppercase">
            <Radio className="h-3 w-3 text-[var(--cmf-teal)]" />
            <span>{counts.totalOnline} Online</span>
          </span>

          {variant === 'console' && (
            <button
              type="button"
              data-testid="admin-lobbies-collapse-btn"
              onClick={() => setCollapsed((prev) => !prev)}
              className="cmf-btn-secondary font-tech inline-flex min-h-[34px] items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase"
            >
              <span>{collapsed ? 'Ausklappen' : 'Einklappen'}</span>
              {collapsed ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          {/* KPI-Kacheln */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="cmf-well rounded-xl px-3 py-2">
              <span className="font-tech block text-[9px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                RÄUME GESAMT
              </span>
              <span
                data-testid="admin-kpi-total-rooms"
                className="font-dot text-lg font-bold text-[var(--text-main)]"
              >
                {counts.total}
              </span>
            </div>
            <div className="cmf-well rounded-xl px-3 py-2">
              <span className="font-tech block text-[9px] font-bold tracking-wider text-[var(--cmf-teal)] uppercase">
                IN LOBBY
              </span>
              <span
                data-testid="admin-kpi-lobby-rooms"
                className="font-dot text-lg font-bold text-[var(--cmf-teal)]"
              >
                {counts.inLobby}
              </span>
            </div>
            <div className="cmf-well rounded-xl px-3 py-2">
              <span className="font-tech block text-[9px] font-bold tracking-wider text-[var(--cmf-orange)] uppercase">
                SPIEL LÄUFT
              </span>
              <span
                data-testid="admin-kpi-active-rooms"
                className="font-dot text-lg font-bold text-[var(--cmf-orange)]"
              >
                {counts.active}
              </span>
            </div>
            <div className="cmf-well rounded-xl px-3 py-2">
              <span className="font-tech block text-[9px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                SPIELER ONLINE
              </span>
              <span
                data-testid="admin-kpi-online-players"
                className="font-dot text-lg font-bold text-[var(--text-main)]"
              >
                {counts.totalOnline}
              </span>
            </div>
          </div>

          {/* Filter & Suche */}
          {lobbies.length > 1 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: 'ALL', label: `Alle (${counts.total})` },
                    { id: 'LOBBY', label: `In Lobby (${counts.inLobby})` },
                    { id: 'ACTIVE', label: `Laufend (${counts.active})` },
                    { id: 'FINISHED', label: `Beendet (${counts.finished})` },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={`font-tech min-h-[32px] rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase transition-all ${
                      statusFilter === tab.id
                        ? 'cmf-btn-active'
                        : 'cmf-btn-secondary opacity-80 hover:opacity-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="relative flex-1 sm:max-w-[230px]">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  type="text"
                  data-testid="admin-lobbies-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Code, Host oder Spieler ..."
                  className="cmf-input min-h-[34px] w-full pr-2.5 pl-8 text-xs font-semibold"
                />
              </div>
            </div>
          )}

          {/* Lobby-Liste */}
          {loading && lobbies.length === 0 ? (
            <div className="cmf-well rounded-xl p-4 text-center font-tech text-xs text-[var(--text-muted)]">
              Lade aktive Lobbys ...
            </div>
          ) : filteredLobbies.length === 0 ? (
            <div className="cmf-well rounded-xl p-4 text-center text-xs text-[var(--text-muted)]">
              Keine Lobbys für den gewählten Filter gefunden.
            </div>
          ) : (
            <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-0.5">
              {filteredLobbies.map((item) => {
                const isCurrent =
                  Boolean(currentRoomCode) &&
                  currentRoomCode?.toUpperCase() === item.roomCode.toUpperCase();
                const statusMeta = formatStatusLabel(item);
                const totalSeekers = item.seekerTeamSummaries.reduce(
                  (sum, t) => sum + t.memberNames.length,
                  0
                );

                return (
                  <div
                    key={item.roomCode}
                    data-testid={`admin-lobby-card-${item.roomCode}`}
                    className={`rounded-2xl border p-3.5 transition-all ${
                      isCurrent
                        ? 'border-[var(--cmf-teal)] bg-[var(--surface-raised)] ring-1 ring-[var(--cmf-teal)]/50'
                        : 'border-[var(--shell-border)] bg-[var(--surface-raised)]'
                    }`}
                  >
                    {/* Zeile 1: Code, Status, Host & Aktion */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="cmf-oled rounded-lg px-2.5 py-1 font-dot text-sm font-bold tracking-widest text-[#F8FAFC]">
                          {item.roomCode}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleCopyCode(item.roomCode)}
                          title="Spiel-Code kopieren"
                          className="cmf-btn-secondary inline-flex h-7 items-center gap-1 px-2 font-tech text-[10px] font-bold uppercase"
                        >
                          {copiedCode === item.roomCode ? (
                            <>
                              <CheckCircle2 className="h-3 w-3 text-[var(--cmf-teal)]" />
                              <span>Kopiert</span>
                            </>
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>

                        <span
                          className={`rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold tracking-wider uppercase ${statusMeta.badgeClass}`}
                        >
                          {statusMeta.label}
                        </span>

                        {isCurrent && (
                          <span className="cmf-badge-teal rounded-full px-2 py-0.5 font-tech text-[9px] font-bold uppercase">
                            AKTUELL GEÖFFNET
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {confirmDeleteCode === item.roomCode ? (
                          <div className="flex items-center gap-1.5 rounded-xl border border-[#DC2626]/50 bg-[#DC2626]/10 px-2 py-1">
                            <span className="font-tech text-[10px] font-bold text-[#DC2626] uppercase">
                              Wirklich löschen?
                            </span>
                            <button
                              type="button"
                              data-testid={`admin-confirm-delete-lobby-${item.roomCode}`}
                              disabled={busy || Boolean(deletingCode)}
                              onClick={() =>
                                void handleConfirmDeleteLobby(item.roomCode)
                              }
                              className="inline-flex min-h-[28px] items-center gap-1 rounded-lg bg-[#DC2626] px-2.5 py-1 font-tech text-[10px] font-bold text-white uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>
                                {deletingCode === item.roomCode
                                  ? 'Lösche ...'
                                  : 'Ja, löschen'}
                              </span>
                            </button>
                            <button
                              type="button"
                              data-testid={`admin-cancel-delete-lobby-${item.roomCode}`}
                              disabled={Boolean(deletingCode)}
                              onClick={() => setConfirmDeleteCode(null)}
                              className="cmf-btn-secondary inline-flex min-h-[28px] items-center px-2 py-1 font-tech text-[10px] font-bold uppercase"
                            >
                              Abbrechen
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              data-testid={`admin-delete-lobby-${item.roomCode}`}
                              disabled={
                                busy ||
                                Boolean(switchingCode) ||
                                Boolean(deletingCode)
                              }
                              onClick={() => setConfirmDeleteCode(item.roomCode)}
                              title={`Lobby ${item.roomCode} löschen`}
                              className="cmf-btn-secondary inline-flex min-h-[36px] items-center gap-1.5 px-2.5 py-1.5 font-tech text-[10px] font-bold text-[#DC2626] uppercase transition-colors hover:border-[#DC2626]/50 disabled:opacity-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Löschen</span>
                            </button>

                            {isCurrent ? (
                              <span className="font-tech px-1.5 text-[10px] font-bold text-[var(--cmf-teal)] uppercase">
                                ✓ Aktiver Raum
                              </span>
                            ) : (
                              <button
                                type="button"
                                data-testid={`admin-open-lobby-${item.roomCode}`}
                                disabled={
                                  busy ||
                                  Boolean(switchingCode) ||
                                  Boolean(deletingCode)
                                }
                                onClick={() => void handleSwitch(item.roomCode)}
                                className="cmf-btn-primary font-dot inline-flex min-h-[36px] items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold disabled:opacity-50"
                              >
                                <span>
                                  {switchingCode === item.roomCode
                                    ? 'Öffne ...'
                                    : variant === 'console'
                                      ? 'Wechseln'
                                      : 'Lobby öffnen'}
                                </span>
                                <ArrowRight className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Zeile 2: Host, Modus, Gebiet & Spielerzahl */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                      <span>
                        {isOverviewMember({
                          playerId: item.hostPlayerId,
                          name: item.hostName,
                        }) ? (
                          <strong className="text-[var(--text-main)]">
                            System / Sandbox
                          </strong>
                        ) : (
                          <>
                            Host:{' '}
                            <strong className="text-[var(--text-main)]">
                              {item.hostName}
                            </strong>
                          </>
                        )}
                      </span>
                      <span>•</span>
                      <span className="font-tech text-[11px] font-bold text-[var(--text-main)] uppercase">
                        {item.gameMode === 'MANHUNT' ? 'Manhunt' : 'Klassisch'}
                      </span>
                      <span>•</span>
                      <span className="inline-flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 shrink-0 text-[var(--cmf-orange)]" />
                        <span className="truncate">{item.playAreaName}</span>
                      </span>
                      <span>•</span>
                      <span className="inline-flex items-center gap-1 font-tech text-[11px]">
                        <Users className="h-3 w-3 text-[var(--cmf-teal)]" />
                        <strong className="text-[var(--text-main)]">
                          {item.onlineCount}
                        </strong>{' '}
                        online / {item.memberCount} Spieler
                      </span>
                      <span className="ml-auto font-tech text-[10px] text-[var(--text-muted)]">
                        {formatUpdatedTimestamp(item.updatedAt || item.createdAt)}
                      </span>
                    </div>

                    {/* Zeile 3: Teams & Mitglieder-Schnellblick */}
                    {(item.hiderNames.length > 0 ||
                      totalSeekers > 0 ||
                      item.unassignedNames.length > 0) && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5 border-t cmf-divider pt-2 text-[11px]">
                        <span className="cmf-badge-orange inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-semibold">
                          <span>Sardinen ({item.hiderNames.length}):</span>
                          <span>
                            {item.hiderNames.length > 0
                              ? item.hiderNames.join(', ')
                              : '–'}
                          </span>
                        </span>

                        {item.seekerTeamSummaries.map((team) => (
                          <span
                            key={team.id}
                            className="cmf-well inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 font-medium text-[var(--text-main)]"
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: team.color }}
                            />
                            <strong className="font-semibold">
                              {team.name}:
                            </strong>
                            <span>{team.memberNames.join(', ')}</span>
                          </span>
                        ))}

                        {item.unassignedNames.length > 0 && (
                          <span className="cmf-well inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[var(--text-muted)]">
                            <span>Ohne Team:</span>
                            <span>{item.unassignedNames.join(', ')}</span>
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Hinweis zur automatischen 24-Stunden-Bereinigung */}
          <div className="cmf-well flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] text-[var(--text-muted)]">
            <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-teal)]" />
            <span>
              Inaktive Lobbys, in denen seit <strong>24 Stunden</strong> niemand
              mehr online war, werden automatisch gelöscht.
            </span>
          </div>
        </>
      )}
    </section>
  );
};
