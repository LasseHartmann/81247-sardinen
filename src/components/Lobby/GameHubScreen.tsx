import React, { useState } from 'react';
import {
  ArrowRight,
  Hash,
  LogOut,
  PlusCircle,
  Sliders,
} from 'lucide-react';
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
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#27272A] bg-black p-1 shadow-sm">
              <img
                src="/logo.png"
                alt="81247 Sardinen Logo"
                className="h-full w-full bg-black object-contain"
              />
            </div>
            <div className="min-w-0">
              <span className="font-tech block text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
                SPIELZENTRALE // LOBBY-AUSWAHL
              </span>
              <div className="mt-0.5 flex items-center gap-2">
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
            Lokaler Demo-Modus aktiv – du kannst ein neues Spiel hosten oder dem Demo-Raum{' '}
            <strong className="font-dot">81247</strong> beitreten.
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

        {/* Exklusive Live-Übersicht aller Lobbys & Konto-Verwaltung für das Admin-Konto */}
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

        {/* Option 1: Eigenes Spiel hosten */}
        <section className="cmf-oled space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="cmf-badge-teal inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase">
                <Sliders className="h-3 w-3" />
                NEUE RUNDE STARTEN
              </span>
              <h2 className="font-industrial mt-2 text-base font-bold text-[#F8FAFC]">
                Eigenes Spiel hosten
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[#9AA4AE]">
                Erstellt deinen eigenen Spielraum mit persönlichem{' '}
                <strong className="text-[#F8FAFC]">6-Zeichen-Code</strong>. Als
                Host stellst du Grenzen (PLZ, Ganz München oder Kreis), Zeiten
                und Modus ein.
              </p>
            </div>
          </div>

          <button
            type="button"
            data-testid="hub-host-game-btn"
            disabled={busy}
            onClick={() => void onHostNewGame()}
            className="cmf-btn-primary font-dot flex min-h-[48px] w-full items-center justify-center gap-2 px-4 py-3 text-sm font-bold disabled:opacity-50"
          >
            <PlusCircle className="h-4 w-4" />
            <span>
              {busy ? 'Erstelle Spielraum ...' : 'Eigenes Spiel hosten'}
            </span>
          </button>
        </section>

        {/* Option 2: Mit Code beitreten */}
        <section className="cmf-well space-y-3 p-4">
          <div>
            <span className="font-tech inline-flex items-center gap-1 text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
              <Hash className="h-3 w-3 text-[var(--cmf-orange)]" />
              BESTEHENDEM SPIEL BEITRETEN
            </span>
            <h2 className="font-industrial mt-0.5 text-base font-bold text-[var(--text-main)]">
              Mit Spiel-Code beitreten
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              Gib den Spiel-Code des Hosts (z. B.{' '}
              <span className="font-dot font-bold text-[var(--text-main)]">
                K7M4P2
              </span>
              ) oder einen Einladungslink ein.
            </p>
          </div>

          <form
            onSubmit={(e) => void handleJoinSubmit(e)}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              type="text"
              data-testid="hub-join-code-input"
              aria-label="Spiel-Code eingeben"
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
              placeholder="CODE EINGEBEN (Z. B. K7M4P2)"
              className="cmf-input font-dot min-h-[48px] flex-1 px-4 py-2.5 text-center text-base font-bold tracking-widest uppercase sm:text-left"
            />
            <button
              type="submit"
              data-testid="hub-join-game-btn"
              disabled={busy || !normalizeRoomCode(joinInput)}
              className="cmf-btn-secondary font-dot inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 border-[var(--text-main)] bg-[var(--text-main)] px-5 py-2.5 text-xs font-bold text-white uppercase hover:opacity-90 disabled:opacity-40"
            >
              <span>{busy ? 'Prüfe ...' : 'Beitreten'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};
