import React from 'react';
import { WifiOff, PauseCircle, RefreshCw } from 'lucide-react';
import type { GameStatus } from '../../types/game';

export interface StatusBannersProps {
  connected: boolean;
  isControllerDisconnected: boolean;
  gameStatus: GameStatus | null;
}

export const StatusBanners: React.FC<StatusBannersProps> = ({
  connected,
  isControllerDisconnected,
  gameStatus,
}) => {
  return (
    <div className="z-30 flex flex-col">
      {!connected && (
        <div
          role="alert"
          className="cmf-alert-slide flex items-center justify-center gap-2 border-b border-[var(--shell-border)] bg-[var(--module-bg)] px-3 py-1.5 font-tech text-[11px] font-bold tracking-wide text-[var(--cmf-orange)] uppercase"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-orange)]" />
          Offline – verbindet automatisch neu ...
        </div>
      )}

      {isControllerDisconnected && (
        <div
          role="status"
          className="cmf-alert-slide flex items-center justify-center gap-2 border-b border-[var(--shell-border)] bg-[var(--module-sub)] px-3 py-1.5 font-tech text-[11px] font-medium text-[var(--text-main)]"
        >
          <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--cmf-amber)]" />
          <span>Verbindung wird synchronisiert ...</span>
        </div>
      )}

      {gameStatus === 'PAUSED' && (
        <div className="cmf-alert-slide flex items-center justify-center gap-2 border-b border-[#27272A] bg-[#0B0D10] px-3 py-1.5 font-tech text-[11px] font-bold tracking-wider text-[var(--cmf-amber)] uppercase">
          <PauseCircle className="h-4 w-4 shrink-0 text-[var(--cmf-amber)]" />
          Spiel pausiert – Zeit angehalten
        </div>
      )}
    </div>
  );
};
