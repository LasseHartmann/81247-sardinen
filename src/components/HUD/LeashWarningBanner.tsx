import React from 'react';
import { AlertOctagon } from 'lucide-react';
import type { LeashMonitorState } from '../../hooks/useGeolocation';

export interface LeashWarningBannerProps {
  isOwnSideHider: boolean;
  leashState: LeashMonitorState;
  publicLeashAlertActive: boolean;
}

export const LeashWarningBanner: React.FC<LeashWarningBannerProps> = ({
  isOwnSideHider,
  leashState,
  publicLeashAlertActive,
}) => {
  // 1. Rotes Vollbreiten-Warnbanner für Verstecker beim Verlassen des 20m-Radius
  if (isOwnSideHider && leashState.warningActive) {
    return (
      <div
        role="alert"
        className="w-full border-b-2 border-rose-300 bg-rose-600 px-4 py-2.5 text-white shadow-xl"
      >
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertOctagon className="h-6 w-6 shrink-0 animate-pulse" />
            <div>
              <p className="text-sm font-black tracking-wide uppercase">
                ACHTUNG: Zurück ins 20m-Versteck!
              </p>
              <p className="text-xs text-rose-100">
                Aktuelle Abweichung: ca. {leashState.distanceFromAnchorMeters ?? '>20'} m
                {leashState.publicAlertTriggered
                  ? ' • Alle Teams wurden neutral informiert!'
                  : ' • Kehre sofort in den Kreis zurück.'}
              </p>
            </div>
          </div>
          {leashState.countdownSecondsLeft !== null &&
            leashState.countdownSecondsLeft > 0 && (
              <div className="rounded-lg bg-slate-950/75 px-3 py-1 text-right font-mono text-lg font-black text-rose-200">
                {leashState.countdownSecondsLeft}s
              </div>
            )}
        </div>
      </div>
    );
  }

  // 2. Neutrale Meldung für alle übrigen Teams nach Ablauf der 60s-Frist (ohne Koordinaten-Leak!)
  if (!isOwnSideHider && publicLeashAlertActive) {
    return (
      <div
        role="status"
        className="w-full border-b border-rose-500/60 bg-rose-950/90 px-4 py-2 text-center text-xs font-semibold text-rose-200 shadow-lg backdrop-blur"
      >
        Die Verstecker haben ihren 20m-Versteckradius vorübergehend verlassen!
      </div>
    );
  }

  return null;
};
