import React from 'react';
import { OctagonAlert, MapPin, RotateCcw } from 'lucide-react';
import type { SafetyPoint } from '../../types/game';

export interface EmergencyOverlayProps {
  reason: string | null;
  safetyPoint: SafetyPoint;
  isHost: boolean;
  onClearEmergencyByHost: () => Promise<void>;
}

export const EmergencyOverlay: React.FC<EmergencyOverlayProps> = ({
  reason,
  safetyPoint,
  isHost,
  onClearEmergencyByHost,
}) => {
  if (!reason) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-[980] flex flex-col items-center justify-center bg-rose-950/95 p-6 text-center text-white backdrop-blur-md"
    >
      <div className="mx-auto max-w-md space-y-5">
        <div className="mx-auto flex h-20 w-20 animate-pulse items-center justify-center rounded-full border-4 border-rose-300 bg-rose-600 shadow-2xl">
          <OctagonAlert className="h-11 w-11 text-white" />
        </div>

        <div className="space-y-2">
          <span className="inline-block rounded-full bg-rose-500/30 px-3 py-1 text-xs font-black tracking-widest text-rose-200 uppercase">
            SOFORTIGER RUNDEN-STOPP
          </span>
          <h1 className="text-2xl font-black tracking-tight">
            Alle Teams sofort zum Sammelpunkt!
          </h1>
          <p className="rounded-xl border border-rose-400/50 bg-slate-950/60 p-3 text-sm font-semibold text-rose-100">
            Grund: {reason}
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-400/50 bg-slate-950/85 p-4 text-left">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-300 uppercase">
            <MapPin className="h-4 w-4" /> Treffpunkt in 81247 München
          </div>
          <p className="mt-1 text-base font-extrabold text-white">
            {safetyPoint.name}
          </p>
          <p className="mt-1 text-xs text-slate-300">{safetyPoint.description}</p>
          <a
            href={`https://www.openstreetmap.org/?mlat=${safetyPoint.lat}&mlon=${safetyPoint.lng}#map=17/${safetyPoint.lat}/${safetyPoint.lng}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl bg-emerald-500 px-4 py-2 text-xs font-extrabold text-slate-950 hover:bg-emerald-400"
          >
            Sammelpunkt auf OpenStreetMap öffnen
          </a>
        </div>

        {isHost && (
          <button
            type="button"
            onClick={() => void onClearEmergencyByHost()}
            className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-slate-400/50 bg-slate-900 px-4 py-3 text-sm font-bold text-slate-100 hover:bg-slate-800"
          >
            <RotateCcw className="h-4 w-4" />
            Notfall-Signal aufheben & zurück in die Lobby
          </button>
        )}
      </div>
    </div>
  );
};
