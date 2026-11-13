import React from 'react';
import { AlertOctagon } from 'lucide-react';
import { LEASH_RADIUS_METERS } from '../../config/gameConfig';
import type { LeashMonitorState } from '../../hooks/useGeolocation';

export interface LeashWarningBannerProps {
  isOwnSideHider: boolean;
  leashState: LeashMonitorState;
  publicLeashAlertActive: boolean;
  isOutsidePlayArea?: boolean;
}

export const LeashWarningBanner: React.FC<LeashWarningBannerProps> = ({
  isOwnSideHider,
  leashState,
  publicLeashAlertActive,
  isOutsidePlayArea = false,
}) => {
  const showHiderLeashBanner = isOwnSideHider && leashState.warningActive;
  const showPublicLeashBanner = !isOwnSideHider && publicLeashAlertActive;

  if (!showHiderLeashBanner && !showPublicLeashBanner && !isOutsidePlayArea) {
    return null;
  }

  return (
    <div className="z-20 flex w-full flex-col">
      {/* 1. Warnung beim Verlassen des 81247-Versteck- / Spielgebiets */}
      {isOutsidePlayArea && (
        <div
          role="alert"
          data-testid="outside-play-area-banner"
          className="cmf-alert-slide w-full border-b border-[#B91C1C] bg-[#DC2626] px-4 py-2 text-center font-tech text-[11px] font-bold tracking-wide text-white uppercase shadow-md"
        >
          {isOwnSideHider
            ? 'ACHTUNG // Du befindest dich außerhalb des 81247-Versteckgebiets!'
            : 'ACHTUNG // Du befindest dich außerhalb des 81247-Spielgebiets!'}
        </div>
      )}

      {/* 2. Signal-Orange Vollbreiten-Warnbanner für Verstecker beim Verlassen des 50m-Verstecks */}
      {showHiderLeashBanner && (
        <div
          role="alert"
          data-testid="hider-leash-warning-banner"
          className="cmf-alert-slide w-full border-b-2 border-[#E04300] bg-[var(--cmf-orange)] px-4 py-2.5 text-white shadow-md"
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <AlertOctagon className="h-5 w-5 shrink-0 animate-pulse" />
              <div>
                <p className="font-dot text-sm font-bold tracking-wider uppercase">
                  ACHTUNG: Zurück ins {LEASH_RADIUS_METERS}m-Versteck!
                </p>
                <p className="font-tech text-[11px] text-white/90">
                  ABWEICHUNG: ~{leashState.distanceFromAnchorMeters ?? `>${LEASH_RADIUS_METERS}`}M
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
      )}

      {/* 3. Neutrale Meldung für alle übrigen Teams nach Ablauf der 60s-Frist (ohne Koordinaten-Leak!) */}
      {showPublicLeashBanner && (
        <div
          role="status"
          className="cmf-alert-slide w-full border-b border-[var(--shell-border)] bg-[var(--module-bg)] px-4 py-2 text-center font-tech text-[11px] font-bold tracking-wide text-[var(--cmf-orange)] uppercase backdrop-blur-md"
        >
          WARNUNG // Die Verstecker haben ihren {LEASH_RADIUS_METERS}m-Versteckradius vorübergehend verlassen!
        </div>
      )}
    </div>
  );
};
