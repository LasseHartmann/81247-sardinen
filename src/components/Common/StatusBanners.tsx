import React from 'react';
import { WifiOff, PauseCircle, ServerCrash } from 'lucide-react';
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
    <div className="flex flex-col">
      {!connected && (
        <div
          role="alert"
          className="flex items-center justify-center gap-2 border-b border-amber-500/60 bg-amber-950/95 px-3 py-1.5 text-xs font-bold text-amber-200"
        >
          <WifiOff className="h-4 w-4 shrink-0 text-amber-400" />
          Verbindung zu Firebase unterbrochen – Synchronisiere automatisch bei Netzrückkehr ...
        </div>
      )}

      {isControllerDisconnected && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 border-b border-amber-400/50 bg-slate-900/95 px-3 py-1.5 text-[11px] font-semibold text-amber-300"
        >
          <ServerCrash className="h-4 w-4 shrink-0 text-amber-400" />
          Spielleiter-/Controller-Gerät getrennt – Anfragen werden sicher in der Warteschlange gehalten
        </div>
      )}

      {gameStatus === 'PAUSED' && (
        <div className="flex items-center justify-center gap-2 border-b border-amber-500/60 bg-amber-500/20 px-3 py-1.5 text-xs font-extrabold text-amber-200 backdrop-blur">
          <PauseCircle className="h-4 w-4 shrink-0 text-amber-300" />
          SPIEL PAUSIERT – Spielzeit, Radar-Stufen und Antwortfristen sind eingefroren
        </div>
      )}
    </div>
  );
};
