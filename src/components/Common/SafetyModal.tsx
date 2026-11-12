import React from 'react';
import { ShieldAlert, MapPin, CheckCircle2, X } from 'lucide-react';
import type { SafetyPoint } from '../../types/game';

export interface SafetyModalProps {
  open: boolean;
  mustConfirmToProceed: boolean;
  safetyPoint: SafetyPoint;
  onConfirm: () => void;
  onClose?: () => void;
}

export const SafetyModal: React.FC<SafetyModalProps> = ({
  open,
  mustConfirmToProceed,
  safetyPoint,
  onConfirm,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-emerald-500/40 bg-slate-900 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-extrabold tracking-tight">
                Outdoor-Sicherheit & Sammelpunkt (81247)
              </h2>
              <p className="text-xs text-slate-400">
                Verbindliche Spielregeln für Obermenzing / Blutenburg / Pipping
              </p>
            </div>
          </div>

          {!mustConfirmToProceed && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Dialog schließen"
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        <ul className="mt-4 space-y-2.5 text-xs leading-relaxed text-slate-200">
          <li className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
            <strong className="text-amber-300">1. Straßenverkehr hat Vorrang:</strong>{' '}
            Blick vom Display heben beim Überqueren von Straßen (insb. Verdistraße, Menzinger Straße, Pippinger Straße) und Radwegen.
          </li>
          <li className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
            <strong className="text-rose-300">2. Sperrzonen strikt meiden:</strong>{' '}
            Kein Betreten von Privatgrundstücken, Bahnanlagen/Gleisen am S-Bahnhof Obermenzing, Baustellen oder gesperrten Uferböschungen und Wehren der Würm!
          </li>
          <li className="rounded-lg border border-slate-800 bg-slate-950/70 p-2.5">
            <strong className="text-cyan-300">3. Öffentlicher Raum & Rücksicht:</strong>{' '}
            Nur öffentlich zugängliche Wege, Parks und Plätze nutzen. Im Schlosspark Blutenburg geltende Parkregeln und Öffnungszeiten beachten.
          </li>
        </ul>

        <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-3">
          <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
            <MapPin className="h-4 w-4 shrink-0" />
            Vereinbarter Sammelpunkt bei Spielabbruch / Notfall:
          </div>
          <p className="mt-1 text-sm font-bold text-white">{safetyPoint.name}</p>
          <p className="mt-0.5 text-xs text-slate-300">{safetyPoint.description}</p>
          <p className="mt-1 font-mono text-[11px] text-emerald-400">
            Koordinaten: {safetyPoint.lat.toFixed(5)}° N, {safetyPoint.lng.toFixed(5)}° O
          </p>
        </div>

        <button
          type="button"
          onClick={onConfirm}
          data-testid="confirm-safety-btn"
          className="mt-5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-sm font-extrabold text-slate-950 shadow-lg hover:bg-emerald-400 active:scale-[0.99]"
        >
          <CheckCircle2 className="h-5 w-5" />
          {mustConfirmToProceed
            ? 'Verstanden & Sicherheitsregeln für diese Runde bestätigen'
            : 'Schließen'}
        </button>
      </div>
    </div>
  );
};
