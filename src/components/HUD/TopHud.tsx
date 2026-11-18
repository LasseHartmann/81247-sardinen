import React, { useState } from 'react';
import {
  Crosshair,
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
import { ThemeToggleButton } from '../Common/ThemeToggleButton';

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
      className={`pointer-events-auto z-20 border-b pt-[max(0.4rem,env(safe-area-inset-top))] pr-[max(0.65rem,env(safe-area-inset-right))] pb-1.5 pl-[max(0.65rem,env(safe-area-inset-left))] backdrop-blur-xl transition-colors duration-200 ${
        hasActiveEmergency
          ? 'border-[#FCA5A5] bg-[#B91C1C] text-white'
          : 'border-[var(--shell-border)] bg-[var(--shell-bg)]'
      }`}
    >
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
        {/* Nothing OS Status- & Spieluhr-Kapsel */}
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial sm:gap-2.5">
          <div
            className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 ${
              hasActiveEmergency
                ? 'bg-black/30 text-white'
                : 'bg-[var(--module-sub)] text-[var(--text-main)]'
            }`}
          >
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
                  isPaused ? 'bg-[var(--text-muted)]' : 'bg-[var(--text-main)]'
                }`}
              />
            )}
            <span
              className={`hidden text-[11px] font-medium min-[400px]:inline ${
                hasActiveEmergency ? 'text-white/85' : 'text-[var(--text-muted)]'
              }`}
            >
              {phaseShortLabel}
            </span>
            <span
              data-testid="hud-net-clock"
              className={`font-dot text-sm leading-none sm:text-base ${
                hasActiveEmergency ? 'text-white' : 'text-[var(--text-main)]'
              }`}
            >
              {formatDurationClock(timer.netElapsedMs)}
            </span>
          </div>

          <div
            data-testid="hud-stage-countdown"
            title={timer.nextStageLabel}
            className={`flex min-w-0 items-center gap-1.5 text-xs font-medium ${
              hasActiveEmergency ? 'text-white/90' : 'text-[var(--text-muted)]'
            }`}
          >
            {activePhase === 'LOBBY' ? (
              <span className="truncate whitespace-nowrap text-xs">
                {isManhunt ? 'Manhunt' : 'Bereit'}
              </span>
            ) : timer.nextStageRemainingMs !== null ? (
              <>
                <span className="truncate whitespace-nowrap text-xs">
                  {isManhunt
                    ? activePhase === 'HIDING'
                      ? 'Jagd in'
                      : 'Ping in'
                    : activePhase === 'HIDING'
                      ? 'Suche in'
                      : 'Radar in'}
                </span>
                <span
                  className={`font-dot shrink-0 whitespace-nowrap text-sm ${
                    hasActiveEmergency ? 'text-white' : 'text-[var(--text-main)]'
                  }`}
                >
                  {formatDurationClock(timer.nextStageRemainingMs)}
                </span>
              </>
            ) : (
              <span className="truncate whitespace-nowrap text-xs font-semibold">
                {isManhunt ? '150 m Zone' : '100 m Radar'}
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

          <ThemeToggleButton compact />

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

      {/* Zentriertes Modal-Fenster statt Layout-verschiebendem Inline-Drawer */}
      {emergencyDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Notfallnachricht senden"
          onClick={() => setEmergencyDrawerOpen(false)}
          className="fixed inset-0 z-[850] flex items-center justify-center bg-black/55 p-3 backdrop-blur-xs"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="cmf-chassis w-full max-w-md space-y-3 p-4 text-[var(--text-main)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b cmf-divider pb-2">
              <span className="font-tech text-xs font-bold text-[var(--cmf-orange)] uppercase">
                Notfallnachricht an alle Spieler
              </span>
              <button
                type="button"
                aria-label="Schließen"
                onClick={() => setEmergencyDrawerOpen(false)}
                className="cmf-btn-secondary inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)]"
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
                  className="cmf-btn-active font-tech inline-flex min-h-[34px] items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase"
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
        </div>
      )}
    </header>
  );
};
