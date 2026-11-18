import React, { useState } from 'react';
import { isAdminAccountId } from '../../config/players';
import type {
  RecentRoomEntry,
  StoredPlayerSession,
} from '../../hooks/useAuth';
import type { DatabaseAdapter } from '../../services/databaseAdapter';
import { normalizeRoomCode } from '../../services/qrService';
import { PlayerAvatar } from '../Common/PlayerAvatar';
import { ThemeToggleButton } from '../Common/ThemeToggleButton';
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
        className={`cmf-chassis my-auto w-full space-y-4 p-5 sm:p-6 ${
          isAdmin ? 'max-w-2xl' : 'max-w-md'
        }`}
      >
        {/* Spieler-Kopfzeile + Theme-Toggle & Abmelden */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--module-sub)] p-1">
              <PlayerAvatar
                avatar={account.avatar}
                playerId={account}
                size="md"
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-base font-semibold text-[var(--text-main)]">
                  {account.name}
                </h1>
                {isAdmin && (
                  <span className="cmf-badge-orange shrink-0 rounded-full px-2 py-0.5 text-[10px]">
                    Admin
                  </span>
                )}
              </div>
              <span className="block text-xs text-[var(--text-muted)]">
                81247 Sardinen
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggleButton compact />
            <button
              type="button"
              data-testid="hub-logout-btn"
              onClick={() => void onLogout()}
              disabled={busy}
              className="cmf-btn-secondary min-h-[36px] px-3.5 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              Abmelden
            </button>
          </div>
        </div>

        {!firebaseAvailable && (
          <div className="cmf-badge-amber rounded-2xl px-3.5 py-2 text-xs">
            Demo-Modus aktiv · Code{' '}
            <strong className="font-mono-code">81247</strong> eingeben oder
            Lobby erstellen.
          </div>
        )}

        {roomError && (
          <div
            role="alert"
            data-testid="hub-room-error"
            className="cmf-badge-orange cmf-shake rounded-2xl px-3.5 py-2.5 text-xs"
          >
            {roomError}
          </div>
        )}

        {/* Nothing OS Widget-Kachel für Code-Beitritt */}
        <section className="cmf-well space-y-2.5 p-4">
          <label
            htmlFor="hub-join-code-field"
            className="block text-xs font-medium text-[var(--text-muted)]"
          >
            Mit Code beitreten
          </label>

          <form
            onSubmit={(e) => void handleJoinSubmit(e)}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              id="hub-join-code-field"
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
              placeholder="6-stelliger Code"
              className="cmf-input font-mono-code min-h-[44px] flex-1 rounded-full px-4 py-2 text-base text-[var(--text-main)] uppercase placeholder:font-sans placeholder:text-sm placeholder:tracking-normal placeholder:normal-case"
            />
            <button
              type="submit"
              data-testid="hub-join-game-btn"
              disabled={busy || !normalizeRoomCode(joinInput)}
              className="cmf-btn-primary min-h-[44px] shrink-0 px-5 py-2 text-sm font-medium disabled:opacity-40"
            >
              {busy ? 'Prüfe …' : 'Beitreten'}
            </button>
          </form>
        </section>

        {/* Eigene Lobby erstellen */}
        <section className="flex items-center justify-between gap-3 pt-1">
          <span className="text-sm text-[var(--text-muted)]">
            Eigene Runde starten
          </span>

          <button
            type="button"
            data-testid="hub-host-game-btn"
            disabled={busy}
            onClick={() => void onHostNewGame()}
            className="cmf-btn-primary min-h-[40px] shrink-0 px-4 py-2 text-xs font-medium disabled:opacity-50"
          >
            {busy ? 'Erstelle …' : 'Neue Lobby'}
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
