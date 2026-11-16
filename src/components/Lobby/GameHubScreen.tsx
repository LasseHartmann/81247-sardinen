import React, { useState } from 'react';
import { ArrowRight, Hash, LogOut, PlusCircle } from 'lucide-react';
import { isAdminAccountId } from '../../config/players';
import type {
  RecentRoomEntry,
  StoredPlayerSession,
} from '../../hooks/useAuth';
import type { DatabaseAdapter } from '../../services/databaseAdapter';
import { normalizeRoomCode } from '../../services/qrService';
import { PlayerAvatar } from '../Common/PlayerAvatar';
import { AdminAccountManager } from './AdminAccountManager';
import { AdminLobbiesOverview } from './AdminLobbiesOverview';
import { PlayerHostedLobbiesSection } from './PlayerHostedLobbiesSection';

export interface GameHubScreenProps {
  adapter: DatabaseAdapter;
  account: StoredPlayerSession;
  firebaseAvailable: boolean;
  recentRooms: RecentRoomEntry[];
  busy: boolean;
  roomError: string | null;
  onClearError: () => void;
  onHostNewGame: () => Promise<void>;
  onJoinByCode: (code: string) => Promise<void>;
  onLogout: () => Promise<void>;
}

export const GameHubScreen: React.FC<GameHubScreenProps> = ({
  adapter,
  account,
  firebaseAvailable,
  recentRooms,
  busy,
  roomError,
  onClearError,
  onHostNewGame,
  onJoinByCode,
  onLogout,
}) => {
  const [joinInput, setJoinInput] = useState('');
  const isAdmin = isAdminAccountId(account.playerId);

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinInput.trim() || busy) return;
    await onJoinByCode(joinInput);
  };

  return (
    <div
      data-testid="game-hub-screen"
      className="cmf-drafting-bg cmf-scroll-area flex h-[100dvh] w-full flex-col items-center justify-start sm:justify-center pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] text-[var(--text-main)]"
    >
      <div
        className={`cmf-chassis cmf-sheet-up my-auto w-full space-y-4 p-5 sm:p-6 ${
          isAdmin ? 'max-w-2xl' : 'max-w-lg'
        }`}
      >
        {/* Kopfzeile mit Spielerkonto & Abmelden */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#27272A] bg-black p-1 shadow-sm">
              <img
                src="/logo.png"
                alt="81247 Sardinen Logo"
                className="h-full w-full bg-black object-contain"
              />
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <PlayerAvatar
                avatar={account.avatar}
                playerId={account}
                size="sm"
              />
              <h1 className="font-dot truncate text-lg font-bold text-[var(--text-main)]">
                {account.name}
              </h1>
              {isAdmin && (
                <span className="cmf-badge-teal shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase">
                  ADMIN
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            data-testid="hub-logout-btn"
            onClick={() => void onLogout()}
            disabled={busy}
            className="cmf-btn-secondary font-tech inline-flex min-h-[40px] shrink-0 items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold uppercase disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Abmelden</span>
          </button>
        </div>

        {!firebaseAvailable && (
          <div className="cmf-badge-amber rounded-xl px-3 py-2 text-xs font-medium">
            Demo-Modus aktiv – erstelle eine Lobby oder gib den Demo-Code{' '}
            <strong className="font-dot">81247</strong> ein.
          </div>
        )}

        {roomError && (
          <div
            role="alert"
            data-testid="hub-room-error"
            className="cmf-badge-orange cmf-shake rounded-xl px-3.5 py-2.5 text-xs font-semibold"
          >
            {roomError}
          </div>
        )}

        {/* Option 1 (Häufigster Fall): Mit Lobby-Code beitreten */}
        <section className="cmf-oled space-y-3 p-4">
          <div>
            <h2 className="font-industrial flex items-center gap-1.5 text-base font-bold text-[#F8FAFC]">
              <Hash className="h-4 w-4 text-[var(--cmf-orange)]" />
              Lobby beitreten
            </h2>
            <p className="mt-0.5 text-xs text-[#9AA4AE]">
              Gib den 6-stelligen Code eures Hosts ein.
            </p>
          </div>

          <form
            onSubmit={(e) => void handleJoinSubmit(e)}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              type="text"
              data-testid="hub-join-code-input"
              aria-label="Lobby-Code eingeben"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={120}
              value={joinInput}
              onChange={(e) => {
                if (roomError) onClearError();
                const raw = e.target.value;
                if (raw.includes('http') || raw.includes('room=')) {
                  setJoinInput(raw);
                } else {
                  setJoinInput(raw.toUpperCase());
                }
              }}
              placeholder="CODE (Z. B. K7M4P2)"
              className="cmf-input font-dot min-h-[48px] flex-1 bg-white px-4 py-2.5 text-center text-base font-bold tracking-widest text-[var(--text-main)] uppercase sm:text-left"
            />
            <button
              type="submit"
              data-testid="hub-join-game-btn"
              disabled={busy || !normalizeRoomCode(joinInput)}
              className="cmf-btn-primary font-dot inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold uppercase disabled:opacity-40"
            >
              <span>{busy ? 'Prüfe ...' : 'Beitreten'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </section>

        {/* Option 2: Eigene Lobby erstellen */}
        <section className="cmf-well flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-industrial text-sm font-bold text-[var(--text-main)] sm:text-base">
              Neue Lobby erstellen
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Du erhältst einen eigenen 6-stelligen Code zum Teilen.
            </p>
          </div>

          <button
            type="button"
            data-testid="hub-host-game-btn"
            disabled={busy}
            onClick={() => void onHostNewGame()}
            className="cmf-btn-secondary font-dot inline-flex min-h-[46px] shrink-0 items-center justify-center gap-2 bg-white px-4 py-2.5 text-xs font-bold text-[var(--text-main)] uppercase hover:bg-zinc-50 disabled:opacity-50"
          >
            <PlusCircle className="h-4 w-4 text-[var(--cmf-teal)]" />
            <span>{busy ? 'Erstelle ...' : 'Lobby erstellen'}</span>
          </button>
        </section>

        {/* Offene gehostete Lobbys (oder Admin-Verwaltung) */}
        {isAdmin ? (
          <>
            <AdminLobbiesOverview
              adapter={adapter}
              hintRoomCodes={recentRooms.map((r) => r.roomCode)}
              busy={busy}
              variant="hub"
              onOpenLobby={async (code) => {
                onClearError();
                await onJoinByCode(code);
              }}
            />
            <AdminAccountManager adapter={adapter} />
          </>
        ) : (
          <PlayerHostedLobbiesSection
            adapter={adapter}
            playerId={account.playerId}
            hintRoomCodes={recentRooms.map((r) => r.roomCode)}
            busy={busy}
            onOpenLobby={async (code) => {
              onClearError();
              await onJoinByCode(code);
            }}
          />
        )}
      </div>
    </div>
  );
};
