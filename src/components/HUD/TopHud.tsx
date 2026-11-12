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
  getPhaseLabelDe,
} from '../../utils/formatting';

export interface TopHudProps {
  publicState: PublicGameState;
  timer: GameTimerSnapshot;
  ownMember: MemberRecord;
  ownTeam: TeamPublic | null;
  connected: boolean;
  ownFix: GeoFix | null;
  gpsStatus: GpsPermissionState;
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
  ownEmergencyMessage,
  onSendEmergencyMessage,
  onClearOwnEmergencyMessage,
  onUnlockAdmin,
}) => {
  const activePhase =
    publicState.status === 'LOBBY' ? 'LOBBY' : timer.computedPhase;
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
    (ownMember.playerId === 'lasse' || ownMember.playerId === 'linus');

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
    <header className="pointer-events-auto z-20 border-b-[1.5px] border-[var(--shell-border)] bg-[var(--shell-bg)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-[18px]">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
        {/* Eingebettete schwarze OLED-Telemetrie-Insel: Timer + Phase + Radar */}
        <div className="cmf-oled flex items-center gap-2.5 px-3 py-1.5">
          <div className="flex items-center gap-2">
            {isRunning ? (
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
              className="font-dot text-base leading-none text-[#F8FAFC] sm:text-lg"
            >
              {formatDurationClock(timer.netElapsedMs)}
            </span>
          </div>

          <div className="h-6 border-l border-dashed border-[#27272A]" />

          <div className="flex flex-col leading-tight">
            <span className="font-tech text-[10px] font-bold tracking-wider text-[#F8FAFC] uppercase">
              {getPhaseLabelDe(activePhase)}
            </span>
            <span className="flex items-center gap-1 font-tech text-[10px] text-[var(--cmf-amber)]">
              <Radar className="h-3 w-3 shrink-0 text-[var(--cmf-teal)]" />
              <span className="truncate max-w-[140px] sm:max-w-none">
                {timer.nextStageRemainingMs !== null
                  ? `${timer.nextStageLabel} (${formatDurationClock(timer.nextStageRemainingMs)})`
                  : timer.nextStageLabel}
              </span>
            </span>
          </div>
        </div>

        {/* Rechte Hardware-Statusleiste: Strafzeit, GPS, Funk, Notfall & Admin */}
        <div className="flex items-center gap-1.5">
          {ownTeam && (
            <div
              title="Aufgelaufene Hinweis-Strafzeit deines Teams"
              className={`rounded-lg px-2 py-1 text-[11px] font-bold tracking-wide uppercase ${
                ownTeam.penaltyMs > 0
                  ? 'cmf-badge-orange'
                  : 'cmf-well font-tech text-[var(--text-muted)]'
              }`}
            >
              {formatPenaltyMinutes(ownTeam.penaltyMs)}
            </div>
          )}

          <div
            title="GPS-Status & Genauigkeit"
            className={`hidden sm:inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold uppercase ${
              gpsStatus === 'DENIED' ? 'cmf-badge-orange' : 'cmf-badge-teal'
            }`}
          >
            {gpsStatus === 'DENIED' ? (
              <>
                <AlertTriangle className="h-3 w-3" />
                <span>NO GPS</span>
              </>
            ) : (
              <>
                <Crosshair className="h-3 w-3" />
                <span>
                  {gpsStatus === 'MANUAL_TEST'
                    ? 'TESTPIN'
                    : ownFix
                      ? `±${Math.round(ownFix.accuracy)}M`
                      : 'GPS...'}
                </span>
              </>
            )}
          </div>

          <div
            title={connected ? 'Live verbunden' : 'Offline'}
            className="cmf-well flex h-8 w-8 items-center justify-center"
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
            title="Notfallnachricht an alle senden oder eigene löschen"
            className={`inline-flex min-h-[36px] items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold tracking-wider uppercase ${
              ownEmergencyMessage
                ? 'cmf-btn-primary font-dot'
                : 'cmf-btn-secondary font-tech text-[var(--text-main)]'
            }`}
          >
            <AlertOctagon
              className={`h-3.5 w-3.5 ${
                ownEmergencyMessage ? 'text-white' : 'text-[var(--cmf-orange)]'
              }`}
            />
            <span>Notfall</span>
          </button>

          {canUnlockAdmin && (
            <button
              type="button"
              onClick={() => {
                setEmergencyDrawerOpen(false);
                setAdminErr(null);
                setAdminModalOpen((v) => !v);
              }}
              title="Admin-Code eingeben"
              className={`inline-flex min-h-[36px] items-center gap-1 px-2.5 py-1.5 font-tech text-[11px] font-bold tracking-wider uppercase ${
                adminModalOpen ? 'cmf-btn-active' : 'cmf-btn-secondary'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5 text-[var(--cmf-amber)]" />
              <span className="hidden xs:inline">Admin</span>
            </button>
          )}
        </div>
      </div>

      {/* Aufklappbares Hardware-Modul: Notfallnachricht */}
      {emergencyDrawerOpen && (
        <div className="cmf-module mx-auto mt-2 max-w-xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between border-b cmf-divider pb-2">
            <span className="font-tech text-[11px] font-bold tracking-wider text-[var(--cmf-orange)] uppercase">
              NOTFALL-KANAL // DAUERHAFT FÜR ALLE SICHTBAR
            </span>
            <button
              type="button"
              onClick={() => setEmergencyDrawerOpen(false)}
              className="font-tech text-[11px] font-bold text-[var(--text-muted)] hover:text-[var(--text-main)] uppercase"
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
                className="cmf-btn-active font-tech inline-flex min-h-[34px] items-center gap-1 px-2.5 py-1 text-[11px] font-bold uppercase"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Eigene Nachricht löschen
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => void handleEmergencySubmit(e)}
            className="flex flex-wrap gap-2"
          >
            <input
              type="text"
              data-testid="emergency-message-input"
              maxLength={180}
              autoFocus
              value={emergencyDraft}
              onChange={(e) => setEmergencyDraft(e.target.value)}
              placeholder={
                ownEmergencyMessage
                  ? 'Nachricht aktualisieren ...'
                  : 'Was ist passiert? (z. B. Verletzung, Hilfe benötigt, Standort ...)'
              }
              className="cmf-input cmf-input-orange min-h-[40px] flex-1 px-3 py-1.5 text-xs font-medium"
            />
            <button
              type="submit"
              data-testid="send-emergency-message-btn"
              disabled={sendingEmergency || !emergencyDraft.trim()}
              className="cmf-btn-primary font-dot inline-flex min-h-[40px] items-center gap-1.5 px-3.5 py-1.5 text-xs"
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
          className="cmf-module mx-auto mt-2 flex max-w-md flex-wrap items-center gap-2 p-2.5"
        >
          <input
            type="password"
            inputMode="numeric"
            autoFocus
            value={adminCode}
            onChange={(e) => setAdminCode(e.target.value)}
            placeholder="Admin-Code eingeben"
            className="cmf-input font-tech min-h-[38px] flex-1 px-3 py-1.5 text-xs font-bold tracking-widest"
          />
          <button
            type="submit"
            disabled={!adminCode.trim()}
            className="cmf-btn-primary font-dot min-h-[38px] px-4 py-1.5 text-xs"
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
