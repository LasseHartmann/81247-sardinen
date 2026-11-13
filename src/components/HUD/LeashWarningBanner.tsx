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
  // 1. Signal-Orange Vollbreiten-Warnbanner für Verstecker beim Verlassen des 20m-Radius
  if (isOwnSideHider && leashState.warningActive) {
    return (
      <div
        role="alert"
        className="cmf-alert-slide z-20 w-full border-b-2 border-[#E04300] bg-[var(--cmf-orange)] px-4 py-2.5 text-white shadow-md"
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertOctagon className="h-5 w-5 shrink-0 animate-pulse" />
            <div>
              <p className="font-dot text-sm font-bold tracking-wider uppercase">
                ACHTUNG: Zurück ins 20m-Versteck!
              </p>
              <p className="font-tech text-[11px] text-white/90">
                ABWEICHUNG: ~{leashState.distanceFromAnchorMeters ?? '>20'}M
                {leashState.publicAlertTriggered
                  ? ' // ALLE TEAMS WURDEN INFORMIERT'
                  : ' // SOFORT IN DEN RADIUS ZURÜCKKEHREN'}
              </p>
            </div>
          </div>
          {leashState.countdownSecondsLeft !== null &&
            leashState.countdownSecondsLeft > 0 && (
              <div className="cmf-oled px-3 py-1 text-right font-dot text-lg text-[var(--cmf-amber)]">
                {leashState.countdownSecondsLeft}S
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
        className="cmf-alert-slide z-20 w-full border-b border-[var(--shell-border)] bg-[var(--module-bg)] px-4 py-2 text-center font-tech text-[11px] font-bold tracking-wide text-[var(--cmf-orange)] uppercase backdrop-blur-md"
      >
        WARNUNG // Die Verstecker haben ihren 20m-Versteckradius vorübergehend verlassen!
      </div>
    );
  }

  return null;
};
