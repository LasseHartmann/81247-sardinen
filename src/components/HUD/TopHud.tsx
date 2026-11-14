import React, { useState } from 'react';
import {
  Crosshair,
  KeyRound,
  Radar,
  Wifi,
  WifiOff,
  AlertTriangle,
  AlertOctagon,
  Send,
  Trash2,
} from 'lucide-react';
import { findPresetPlayerById } from '../../config/players';
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
  onUnlockAdmin?: (code: string) => Promise<{ ok: boolean; error?: string }>;
}

export const TopHud: React.FC<TopHudProps> = ({
  publicState,
  timer,
  ownMember,
  ownTeam,
  connected,
  ownFix,
  gpsStatus,
  hasActiveEmergency = false,
  ownEmergencyMessage,
  onSendEmergencyMessage,
  onClearOwnEmergencyMessage,
  onUnlockAdmin,
}) => {
  const activePhase =
    publicState.status === 'LOBBY' ? 'LOBBY' : timer.computedPhase;
  const isManhunt = (publicState.gameMode ?? 'CLASSIC') === 'MANHUNT';
  const isRunning = publicState.status === 'RUNNING';
  const isPaused = publicState.status === 'PAUSED';

  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminCode, setAdminCode] = useState('');
  const [adminErr, setAdminErr] = useState<string | null>(null);

  const [emergencyDrawerOpen, setEmergencyDrawerOpen] = useState(false);
  const [emergencyDraft, setEmergencyDraft] = useState('');
  const [sendingEmergency, setSendingEmergency] = useState(false);

  const canUnlockAdmin =
    !ownMember.isHost &&
    Boolean(onUnlockAdmin) &&
    Boolean(findPresetPlayerById(ownMember.playerId)?.canUnlockAdmin);

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
        {/* Eingebettete schwarze OLED-Telemetrie-Insel: Timer + Phase + Radar (einzeilig & überlaufsicher auf Smartphones) */}
        <div className="cmf-oled flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 sm:flex-initial sm:gap-2.5 sm:px-3">
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {!connected ? (
              <WifiOff
                className="h-3.5 w-3.5 shrink-0 text-[var(--nothing-red)]"
                aria-label="Offline"
              />
            ) : isRunning ? (
              <span className="nothing-red-dot" title="Live-Sitzung aktiv" />
            ) : (
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  isPaused ? 'bg-[var(--cmf-amber)]' : 'bg-[var(--cmf-teal)]'
                }`}
              />
            )}
            <span
              data-testid="hud-net-clock"
              className="font-dot text-sm leading-none text-[#F8FAFC] sm:text-lg"
            >
              {formatDurationClock(timer.netElapsedMs)}
            </span>
          </div>

          <div className="h-5 shrink-0 border-l border-dashed border-[#27272A] sm:h-6" />

          <div className="flex min-w-0 items-center gap-1 font-tech text-[10px] font-bold tracking-wide text-[var(--cmf-amber)] sm:text-xs">
            <Radar className="h-3 w-3 shrink-0 text-[var(--cmf-teal)] sm:h-3.5 sm:w-3.5" />
            <span className="truncate whitespace-nowrap">
              {activePhase === 'LOBBY'
                ? isManhunt
                  ? 'Lobby • Manhunt'
                  : 'Lobby'
                : timer.nextStageRemainingMs !== null
                  ? isManhunt
                    ? activePhase === 'HIDING'
                      ? `Jagd in ${formatDurationClock(timer.nextStageRemainingMs)}`
                      : `Zone in ${formatDurationClock(timer.nextStageRemainingMs)}`
                    : `Tipp in ${formatDurationClock(timer.nextStageRemainingMs)}`
                  : isManhunt
                    ? '150m Zone'
                    : '25m Radar'}
            </span>
          </div>
        </div>

        {/* Rechte Hardware-Statusleiste: Strafzeit, GPS, Funk, Notfall & Admin */}
        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          {ownTeam &&
            (ownTeam.status === 'JOINED_SARDINES' ? (
              <div
                title="Euer gesamtes Team gehört jetzt zum Verstecker-Team (Sardinen)"
                className="cmf-badge-teal rounded-lg px-1.5 py-1 font-tech text-[10px] font-bold tracking-wide uppercase sm:px-2 sm:text-[11px]"
              >
                SARDINEN
              </div>
            ) : !isManhunt ? (
              <div
                title="Aufgelaufene Hinweis-Strafzeit / Zeitbonus deines Teams"
                className={`rounded-lg px-1.5 py-1 text-[10px] font-bold tracking-wide uppercase sm:px-2 sm:text-[11px] ${
                  ownTeam.penaltyMs > 0
                    ? 'cmf-badge-orange'
                    : ownTeam.penaltyMs < 0
                      ? 'cmf-badge-teal'
                      : 'cmf-well hidden font-tech text-[var(--text-muted)] min-[390px]:inline-flex'
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
            title="GPS-Status & Genauigkeit"
            className={`inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-bold uppercase sm:px-2 sm:text-[11px] ${
              gpsStatus === 'DENIED' ? 'cmf-badge-orange' : 'cmf-badge-teal'
            }`}
          >
            {gpsStatus === 'DENIED' ? (
              <>
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="hidden min-[380px]:inline">NO GPS</span>
              </>
            ) : (
              <>
                <Crosshair className="h-3 w-3 shrink-0" />
                <span>
                  {gpsStatus === 'MANUAL_TEST'
                    ? 'PIN'
                    : ownFix
                      ? `±${Math.min(999, Math.round(ownFix.accuracy))}m`
                      : '...'}
                </span>
              </>
            )}
          </div>

          <div
            title={connected ? 'Live verbunden' : 'Offline'}
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
            onClick={() => {
              setAdminModalOpen(false);
              setEmergencyDrawerOpen((v) => !v);
            }}
            aria-label="Notfallnachricht"
            title="Notfallnachricht an alle senden oder eigene löschen"
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

          {canUnlockAdmin && (
            <button
              type="button"
              data-testid="open-admin-code-btn"
              onClick={() => {
                setEmergencyDrawerOpen(false);
                setAdminErr(null);
                setAdminModalOpen((v) => !v);
              }}
              aria-label="Admin-Code eingeben"
              title="Admin-Code eingeben"
              className={`inline-flex min-h-[40px] min-w-[40px] items-center justify-center gap-1 px-2 py-1.5 font-tech text-[11px] font-bold tracking-wider uppercase sm:px-2.5 ${
                adminModalOpen ? 'cmf-btn-active' : 'cmf-btn-secondary'
              }`}
            >
              <KeyRound className="h-4 w-4 shrink-0 text-[var(--cmf-amber)]" />
              <span className="hidden sm:inline">Admin</span>
            </button>
          )}
        </div>
      </div>

      {/* Aufklappbares Hardware-Modul: Notfallnachricht */}
      {emergencyDrawerOpen && (
        <div className="cmf-module cmf-drawer-down mx-auto mt-2 max-w-xl space-y-2.5 p-3">
          <div className="flex items-center justify-between border-b cmf-divider pb-2">
            <span className="font-tech text-[10px] font-bold tracking-wider text-[var(--cmf-orange)] uppercase sm:text-[11px]">
              NOTFALL-KANAL // FÜR ALLE SICHTBAR
            </span>
            <button
              type="button"
              onClick={() => setEmergencyDrawerOpen(false)}
              className="min-h-[32px] px-1.5 font-tech text-[11px] font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] uppercase"
            >
              [Schließen]
            </button>
          </div>

          {ownEmergencyMessage && (
            <div className="cmf-well flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
              <span className="text-[var(--text-main)]">
                Aktiv gesendet: <strong>{ownEmergencyMessage.text}</strong>
              </span>
              <button
                type="button"
                onClick={async () => {
                  await onClearOwnEmergencyMessage();
                  setEmergencyDrawerOpen(false);
                }}
                className="cmf-btn-active font-tech inline-flex min-h-[38px] items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold uppercase"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Nachricht löschen
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
              placeholder={
                ownEmergencyMessage
                  ? 'Nachricht aktualisieren ...'
                  : 'Was ist passiert? (Verletzung, Hilfe, Standort ...)'
              }
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

      {/* Aufklappbares Hardware-Modul: Admin-Entsperrung */}
      {adminModalOpen && canUnlockAdmin && onUnlockAdmin && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setAdminErr(null);
            const res = await onUnlockAdmin(adminCode);
            if (res.ok) {
              setAdminModalOpen(false);
              setAdminCode('');
            } else {
              setAdminErr(res.error ?? 'Falscher Admin-Code.');
            }
          }}
          className={`cmf-module cmf-drawer-down mx-auto mt-2 flex max-w-md flex-wrap items-center gap-2 p-2.5 ${
            adminErr ? 'cmf-shake' : ''
          }`}
        >
          <input
            type="password"
            data-testid="admin-code-input"
            inputMode="numeric"
            enterKeyHint="done"
            autoFocus
            value={adminCode}
            onChange={(e) => setAdminCode(e.target.value)}
            placeholder="Admin-Code eingeben"
            className="cmf-input font-tech min-h-[44px] flex-1 px-3 py-2 text-base font-bold tracking-widest sm:text-xs"
          />
          <button
            type="submit"
            data-testid="submit-admin-code-btn"
            disabled={!adminCode.trim()}
            className="cmf-btn-primary font-dot min-h-[44px] px-4 py-2 text-xs"
          >
            OK
          </button>
          {adminErr && (
            <span className="w-full font-tech text-[11px] font-bold text-[var(--cmf-orange)]">
              {adminErr}
            </span>
          )}
        </form>
      )}
    </header>
  );
};
