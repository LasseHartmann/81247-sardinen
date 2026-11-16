import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  Layers,
  MapPin,
  Radio,
  Trash2,
  Users,
} from 'lucide-react';
import type { DatabaseAdapter } from '../../services/databaseAdapter';
import type { AdminLobbyOverviewItem } from '../../types/game';

export interface PlayerHostedLobbiesSectionProps {
  adapter: DatabaseAdapter;
  playerId: string;
  currentRoomCode?: string | null;
  hintRoomCodes?: string[];
  busy?: boolean;
  onOpenLobby: (roomCode: string) => Promise<void> | void;
  onAfterDeleteCurrentLobby?: (deletedRoomCode: string) => Promise<void> | void;
}

function formatStatusBadge(item: AdminLobbyOverviewItem): {
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

export const PlayerHostedLobbiesSection: React.FC<
  PlayerHostedLobbiesSectionProps
> = ({
  adapter,
  playerId,
  currentRoomCode = null,
  hintRoomCodes = [],
  busy = false,
  onOpenLobby,
  onAfterDeleteCurrentLobby,
}) => {
  const [hostedLobbies, setHostedLobbies] = useState<AdminLobbyOverviewItem[]>(
    []
  );
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [switchingCode, setSwitchingCode] = useState<string | null>(null);
  const [confirmDeleteCode, setConfirmDeleteCode] = useState<string | null>(
    null
  );
  const [deletingCode, setDeletingCode] = useState<string | null>(null);

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
    const unsub = adapter.subscribePlayerHostedLobbies(
      playerId,
      (next) => {
        setHostedLobbies(next);
      },
      hints
    );
    return () => unsub();
  }, [adapter, playerId, hintKey]);

  if (hostedLobbies.length === 0) {
    return null;
  }

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

  const handleOpen = async (code: string) => {
    if (busy || switchingCode || deletingCode) return;
    setSwitchingCode(code);
    try {
      await onOpenLobby(code);
    } finally {
      setSwitchingCode(null);
    }
  };

  const handleConfirmDelete = async (code: string) => {
    if (busy || switchingCode || deletingCode) return;
    setDeletingCode(code);
    try {
      const wasCurrent =
        Boolean(currentRoomCode) &&
        currentRoomCode?.toUpperCase() === code.toUpperCase();
      await adapter.deleteLobbyRoom(code);
      setHostedLobbies((prev) =>
        prev.filter(
          (item) => item.roomCode.toUpperCase() !== code.toUpperCase()
        )
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
      data-testid="player-hosted-lobbies-section"
      className="cmf-module space-y-3 p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b cmf-divider pb-2.5">
        <div className="flex items-center gap-2.5">
          <div className="cmf-oled flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--cmf-orange)]">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <span className="font-tech block text-[10px] font-bold tracking-wider text-[var(--cmf-orange)] uppercase">
              DEINE GEHOSTETEN SPIELRÄUME
            </span>
            <h2 className="font-industrial text-sm font-bold text-[var(--text-main)] sm:text-base">
              Aktuell von dir gehostete Lobbys ({hostedLobbies.length})
            </h2>
          </div>
        </div>
      </div>

      <div className="space-y-2.5">
        {hostedLobbies.map((item) => {
          const isCurrent =
            Boolean(currentRoomCode) &&
            currentRoomCode?.toUpperCase() === item.roomCode.toUpperCase();
          const statusBadge = formatStatusBadge(item);
          const isConfirmingDelete = confirmDeleteCode === item.roomCode;
          const isDeletingThis = deletingCode === item.roomCode;
          const isSwitchingThis = switchingCode === item.roomCode;

          return (
            <div
              key={item.roomCode}
              data-testid={`hosted-lobby-card-${item.roomCode}`}
              className={`cmf-well space-y-2.5 rounded-2xl p-3.5 transition-all ${
                isCurrent ? 'ring-2 ring-[var(--cmf-teal)]' : ''
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid={`hosted-lobby-copy-btn-${item.roomCode}`}
                    onClick={() => void handleCopyCode(item.roomCode)}
                    title="Spiel-Code kopieren"
                    className="cmf-oled inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-dot text-sm font-bold tracking-wider text-[#F8FAFC]"
                  >
                    <span>{item.roomCode}</span>
                    {copiedCode === item.roomCode ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                    ) : (
                      <Copy className="h-3 w-3 text-[#9AA4AE]" />
                    )}
                  </button>

                  <span
                    className={`rounded-full px-2.5 py-0.5 font-tech text-[10px] font-bold uppercase ${statusBadge.badgeClass}`}
                  >
                    {statusBadge.label}
                  </span>

                  <span className="cmf-well rounded-full px-2 py-0.5 font-tech text-[10px] font-bold text-[var(--text-muted)] uppercase">
                    {item.gameMode === 'MANHUNT' ? 'Manhunt' : 'Klassisch'}
                  </span>

                  {isCurrent && (
                    <span className="cmf-badge-teal rounded-full px-2 py-0.5 font-tech text-[9px] font-bold uppercase">
                      Geöffnet
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {!isCurrent && (
                    <button
                      type="button"
                      data-testid={`hosted-lobby-open-btn-${item.roomCode}`}
                      disabled={busy || isSwitchingThis || isDeletingThis}
                      onClick={() => void handleOpen(item.roomCode)}
                      className="cmf-btn-primary font-tech inline-flex min-h-[34px] items-center gap-1.5 px-3 py-1 text-[10px] font-bold uppercase disabled:opacity-50"
                    >
                      <span>
                        {isSwitchingThis ? 'Öffne ...' : 'Lobby öffnen'}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}

                  <button
                    type="button"
                    data-testid={`hosted-lobby-delete-btn-${item.roomCode}`}
                    disabled={busy || isSwitchingThis || isDeletingThis}
                    onClick={() =>
                      setConfirmDeleteCode(
                        isConfirmingDelete ? null : item.roomCode
                      )
                    }
                    className="cmf-btn-secondary font-tech inline-flex min-h-[34px] items-center gap-1 px-2.5 py-1 text-[10px] font-bold text-[#DC2626] uppercase disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Löschen</span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-[var(--cmf-orange)]" />
                  <strong className="text-[var(--text-main)]">
                    {item.playAreaName}
                  </strong>
                </span>
                <span className="inline-flex items-center gap-1">
                  <Radio className="h-3.5 w-3.5 text-[var(--cmf-teal)]" />
                  <span>{item.onlineCount} Online</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  <span>{item.memberCount} Spieler</span>
                </span>
              </div>

              {isConfirmingDelete && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#DC2626]/40 bg-[#DC2626]/10 px-3 py-2">
                  <span className="font-tech text-[10px] font-bold text-[#DC2626] uppercase">
                    Gehostete Lobby „{item.roomCode}“ wirklich löschen?
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-testid={`hosted-lobby-confirm-delete-btn-${item.roomCode}`}
                      disabled={isDeletingThis}
                      onClick={() => void handleConfirmDelete(item.roomCode)}
                      className="inline-flex min-h-[30px] items-center gap-1 rounded-lg bg-[#DC2626] px-2.5 py-1 font-tech text-[10px] font-bold text-white uppercase hover:opacity-90 disabled:opacity-50"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>
                        {isDeletingThis ? 'Lösche ...' : 'Ja, löschen'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteCode(null)}
                      className="cmf-btn-secondary font-tech inline-flex min-h-[30px] items-center px-2.5 py-1 text-[10px] font-bold uppercase"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
