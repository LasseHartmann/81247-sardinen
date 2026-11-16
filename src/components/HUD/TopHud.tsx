import React, { useState } from 'react';
import {
  Crosshair,
  Radar,
  Wifi,
  WifiOff,
  AlertTriangle,
  AlertOctagon,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import type { GameTimerSnapshot } from '../../hooks/useGameTimer';
import type { GpsPermissionState } from '../../hooks/useGeolocation';
import type {
  EmergencyMessage,
  GeoFix,
  MemberRecord,
  PublicGameState,
  TeamPublic,
} from '../../types/game';
import {
  formatDurationClock,
  formatPenaltyMinutes,
} from '../../utils/formatting';

export interface TopHudProps {
  publicState: PublicGameState;
  timer: GameTimerSnapshot;
  ownMember: MemberRecord;
  ownTeam: TeamPublic | null;
  connected: boolean;
  ownFix: GeoFix | null;
  gpsStatus: GpsPermissionState;
  hasActiveEmergency?: boolean;
  ownEmergencyMessage: EmergencyMessage | null;
  onSendEmergencyMessage: (text: string) => Promise<void>;
  onClearOwnEmergencyMessage: () => Promise<void>;
}

export const TopHud: React.FC<TopHudProps> = ({
  publicState,
  timer,
  ownTeam,
  connected,
  ownFix,
  gpsStatus,
  hasActiveEmergency = false,
  ownEmergencyMessage,
  onSendEmergencyMessage,
  onClearOwnEmergencyMessage,
}) => {
  const activePhase =
    publicState.status === 'LOBBY' ? 'LOBBY' : timer.computedPhase;
  const isManhunt = (publicState.gameMode ?? 'CLASSIC') === 'MANHUNT';
  const isRunning = publicState.status === 'RUNNING';
  const isPaused = publicState.status === 'PAUSED';

  const [emergencyDrawerOpen, setEmergencyDrawerOpen] = useState(false);
  const [emergencyDraft, setEmergencyDraft] = useState('');
  const [sendingEmergency, setSendingEmergency] = useState(false);

  const handleEmergencySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = emergencyDraft.trim();
    if (!cleaned) return;
    setSendingEmergency(true);
    try {
      await onSendEmergencyMessage(cleaned);
      setEmergencyDraft('');
      setEmergencyDrawerOpen(false);
    } finally {
      setSendingEmergency(false);
    }
  };

  const phaseShortLabel = isPaused
    ? 'PAUSE'
    : activePhase === 'LOBBY'
      ? 'LOBBY'
      : activePhase === 'HIDING'
        ? 'VERSTECKEN'
        : isManhunt
          ? 'JAGD'
          : 'SUCHE';

  return (
    <header
      data-emergency-active={hasActiveEmergency ? 'true' : 'false'}
      className={`pointer-events-auto z-20 border-b-[1.5px] pt-[max(0.4rem,env(safe-area-inset-top))] pr-[max(0.65rem,env(safe-area-inset-right))] pb-1.5 pl-[max(0.65rem,env(safe-area-inset-left))] transition-colors duration-300 ${
        hasActiveEmergency
          ? 'border-[#FCA5A5] bg-[#B91C1C] text-white shadow-[0_6px_24px_rgba(220,38,38,0.45)]'
          : 'border-[var(--shell-border)] bg-[var(--shell-bg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]'
      }`}
    >
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-1.5 sm:gap-2">
        {/* Schwarze OLED-Anzeige: Phase + Spieluhr + Nächstes Radar */}
        <div className="cmf-oled flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-1.5 sm:flex-initial sm:gap-2.5 sm:px-3">
          <div className="flex shrink-0 items-center gap-1.5">
            {!connected ? (
              <WifiOff
                className="h-3.5 w-3.5 shrink-0 text-[var(--nothing-red)]"
                aria-label="Offline"
              />
            ) : isRunning ? (
              <span className="nothing-red-dot" title="Spiel läuft" />
            ) : (
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  isPaused ? 'bg-[var(--cmf-amber)]' : 'bg-[var(--cmf-teal)]'
                }`}
              />
            )}
            <span className="hidden font-tech text-[9px] font-bold tracking-wider text-[#9AA4AE] uppercase min-[400px]:inline sm:text-[10px]">
              {phaseShortLabel}
            </span>
            <span
              data-testid="hud-net-clock"
              className="font-dot text-sm leading-none text-[#F8FAFC] sm:text-lg"
            >
              {formatDurationClock(timer.netElapsedMs)}
            </span>
          </div>

          <div className="h-5 shrink-0 border-l border-dashed border-[#27272A] sm:h-6" />

          <div
            data-testid="hud-stage-countdown"
            title={timer.nextStageLabel}
            className="flex min-w-0 items-center gap-1 font-tech text-[10px] font-bold tracking-wide text-[var(--cmf-amber)] sm:text-xs"
          >
            <Radar className="hidden h-3 w-3 shrink-0 text-[var(--cmf-teal)] min-[375px]:inline-block sm:h-3.5 sm:w-3.5" />
            {activePhase === 'LOBBY' ? (
              <span className="truncate whitespace-nowrap">
                {isManhunt ? 'Lobby • Manhunt' : 'Lobby'}
              </span>
            ) : timer.nextStageRemainingMs !== null ? (
              <>
                <span className="truncate whitespace-nowrap">
                  {isManhunt
                    ? activePhase === 'HIDING'
                      ? 'Jagd in'
                      : 'Ping in'
                    : activePhase === 'HIDING'
                      ? 'Suche in'
                      : 'Radar in'}
                </span>
                <span className="shrink-0 whitespace-nowrap font-dot text-[11px] leading-none text-[#FBBF24] sm:text-xs">
                  {formatDurationClock(timer.nextStageRemainingMs)}
                </span>
              </>
            ) : (
              <span className="truncate whitespace-nowrap">
                {isManhunt ? '150m Zone' : '25m Radar'}
              </span>
            )}
          </div>
        </div>

        {/* Rechte Statusleiste: Nur echte Tipp-Strafe, GPS & Notfall */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          {ownTeam &&
            (ownTeam.status === 'JOINED_SARDINES' ? (
              <div
                title="Euer Team versteckt sich jetzt mit den Sardinen"
                className="cmf-badge-teal rounded-lg px-1.5 py-1 font-tech text-[10px] font-bold tracking-wide uppercase sm:px-2 sm:text-[11px]"
              >
                VERSTECKER
              </div>
            ) : !isManhunt && ownTeam.penaltyMs !== 0 ? (
              <div
                title="Tipp-Strafe / Zeitgutschrift deines Teams"
                className={`rounded-lg px-1.5 py-1 text-[10px] font-bold tracking-wide uppercase sm:px-2 sm:text-[11px] ${
                  ownTeam.penaltyMs > 0 ? 'cmf-badge-orange' : 'cmf-badge-teal'
                }`}
              >
                <span className="sm:hidden">
                  {ownTeam.penaltyMs < 0
                    ? `${Math.round(ownTeam.penaltyMs / 60000)}m`
                    : `+${Math.round(ownTeam.penaltyMs / 60000)}m`}
                </span>
                <span className="hidden sm:inline">
                  {formatPenaltyMinutes(ownTeam.penaltyMs)}
                </span>
              </div>
            ) : null)}

          <div
            title="GPS-Genauigkeit"
            className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-bold uppercase sm:px-2 sm:text-[11px] ${
              gpsStatus === 'DENIED' ? 'cmf-badge-orange' : 'cmf-badge-teal'
            }`}
          >
            {gpsStatus === 'DENIED' ? (
              <>
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="hidden min-[380px]:inline">Kein GPS</span>
              </>
            ) : (
              <>
                <Crosshair className="h-3 w-3 shrink-0" />
                <span>
                  {gpsStatus === 'MANUAL_TEST'
                    ? 'Test-Pin'
                    : ownFix
                      ? `±${Math.min(999, Math.round(ownFix.accuracy))}m`
                      : 'GPS...'}
                </span>
              </>
            )}
          </div>

          <div
            title={connected ? 'Online' : 'Offline'}
            className="cmf-well hidden h-9 w-9 items-center justify-center sm:flex"
          >
            {connected ? (
              <Wifi className="h-4 w-4 text-[var(--cmf-teal)]" />
            ) : (
              <WifiOff className="h-4 w-4 text-[var(--nothing-red)]" />
            )}
          </div>

          <button
            type="button"
            data-testid="open-emergency-drawer-btn"
            onClick={() => setEmergencyDrawerOpen((v) => !v)}
            aria-label="Notfall"
            title="Notfallnachricht an alle senden"
            className={`inline-flex min-h-[40px] min-w-[40px] items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] font-bold tracking-wider uppercase sm:px-2.5 ${
              ownEmergencyMessage
                ? 'cmf-btn-primary font-dot'
                : 'cmf-btn-secondary font-tech text-[var(--text-main)]'
            }`}
          >
            <AlertOctagon
              className={`h-4 w-4 shrink-0 ${
                ownEmergencyMessage ? 'text-white' : 'text-[var(--cmf-orange)]'
              }`}
            />
            <span className="hidden sm:inline">Notfall</span>
          </button>
        </div>
      </div>

      {/* Aufklappbares Notfall-Fenster */}
      {emergencyDrawerOpen && (
        <div className="cmf-module cmf-drawer-down mx-auto mt-2 max-w-xl space-y-2.5 p-3">
          <div className="flex items-center justify-between border-b cmf-divider pb-2">
            <span className="font-tech text-[11px] font-bold text-[var(--cmf-orange)] uppercase">
              Notfallnachricht an alle Spieler
            </span>
            <button
              type="button"
              aria-label="Schließen"
              onClick={() => setEmergencyDrawerOpen(false)}
              className="cmf-btn-secondary inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {ownEmergencyMessage && (
            <div className="cmf-well flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="text-[var(--text-main)]">
                Gesendet: <strong>{ownEmergencyMessage.text}</strong>
              </span>
              <button
                type="button"
                onClick={async () => {
                  await onClearOwnEmergencyMessage();
                  setEmergencyDrawerOpen(false);
                }}
                className="cmf-btn-active font-tech inline-flex min-h-[36px] items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Löschen
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => void handleEmergencySubmit(e)}
            className="flex flex-col gap-2 sm:flex-row"
          >
            <input
              type="text"
              data-testid="emergency-message-input"
              enterKeyHint="send"
              maxLength={180}
              autoFocus
              value={emergencyDraft}
              onChange={(e) => setEmergencyDraft(e.target.value)}
              placeholder="Was ist passiert? (z. B. Hilfe benötigt ...)"
              className="cmf-input cmf-input-orange min-h-[44px] flex-1 px-3 py-2 text-base font-medium sm:text-xs"
            />
            <button
              type="submit"
              data-testid="send-emergency-message-btn"
              disabled={sendingEmergency || !emergencyDraft.trim()}
              className="cmf-btn-primary font-dot inline-flex min-h-[44px] items-center justify-center gap-1.5 px-4 py-2 text-xs"
            >
              <Send className="h-3.5 w-3.5" />
              {sendingEmergency ? 'Sende ...' : 'An alle senden'}
            </button>
          </form>
        </div>
      )}
    </header>
  );
};
