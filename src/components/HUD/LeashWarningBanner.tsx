import React, { useEffect, useState } from 'react';
import { AlertOctagon } from 'lucide-react';
import {
  LEASH_RADIUS_METERS,
  LEASH_RETURN_COUNTDOWN_MS,
} from '../../config/gameConfig';
import type { LeashMonitorState } from '../../hooks/useGeolocation';
import type { ActiveLeashViolationInfo, GameMode } from '../../types/game';

export interface LeashWarningBannerProps {
  isOwnSideHider: boolean;
  leashState: LeashMonitorState;
  publicLeashAlertActive: boolean;
  activeLeashViolation?: ActiveLeashViolationInfo | null;
  isOutsidePlayArea?: boolean;
  gameMode?: GameMode;
}

export const LeashWarningBanner: React.FC<LeashWarningBannerProps> = ({
  isOwnSideHider,
  leashState,
  publicLeashAlertActive,
  activeLeashViolation = null,
  isOutsidePlayArea = false,
  gameMode = 'CLASSIC',
}) => {
  const isManhunt = gameMode === 'MANHUNT';
  const showHiderLeashBanner = isOwnSideHider && leashState.warningActive;
  const showPublicLeashBanner = !isOwnSideHider && publicLeashAlertActive;

  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!showPublicLeashBanner && !showHiderLeashBanner && !isOutsidePlayArea) {
      return;
    }
    setNowTick(Date.now());
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [showPublicLeashBanner, showHiderLeashBanner, isOutsidePlayArea]);

  if (!showHiderLeashBanner && !showPublicLeashBanner && !isOutsidePlayArea) {
    return null;
  }

  const outsideCountdown =
    leashState.outsidePlayAreaSecondsLeft ??
    leashState.countdownSecondsLeft ??
    Math.ceil(LEASH_RETURN_COUNTDOWN_MS / 1000);

  const publicRevealSecondsLeft = activeLeashViolation
    ? Math.ceil(Math.max(0, activeLeashViolation.exposeAt - nowTick) / 1000)
    : null;
  const isPublicLiveExposed = Boolean(
    (activeLeashViolation &&
      typeof activeLeashViolation.exposedLat === 'number' &&
      typeof activeLeashViolation.exposedLng === 'number') ||
      (publicRevealSecondsLeft !== null && publicRevealSecondsLeft <= 0)
  );

  const hiderRevealSecondsLeft =
    leashState.liveRevealSecondsLeft ?? publicRevealSecondsLeft;
  const isHiderLiveExposed =
    leashState.liveLocationExposed || isPublicLiveExposed;

  return (
    <div className="z-20 flex w-full flex-col">
      {isOutsidePlayArea && (
        <div
          role="alert"
          data-testid="outside-play-area-banner"
          className="cmf-alert-slide w-full border-b border-[#B91C1C] bg-[#DC2626] px-4 py-2 text-white shadow-md"
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <div className="text-left">
              <p className="font-dot text-xs font-bold uppercase sm:text-sm">
                Bitte zurück ins Spielgebiet!
              </p>
              <p className="text-[11px] text-white/90">
                {isOwnSideHider
                  ? isHiderLiveExposed
                    ? 'Euer Live-Standort ist jetzt für alle sichtbar!'
                    : leashState.publicAlertTriggered
                      ? `Alle gewarnt – Standort sichtbar in ${hiderRevealSecondsLeft ?? 60} s.`
                      : 'Nach 60 s werden die Sucher gewarnt.'
                  : 'Bitte bleib innerhalb der markierten Spielgrenze.'}
              </p>
            </div>
            <div
              data-testid="outside-play-area-countdown"
              className="cmf-oled shrink-0 px-2.5 py-1 text-right font-dot text-base text-[var(--cmf-amber)]"
            >
              {outsideCountdown > 0
                ? `${outsideCountdown}s`
                : isOwnSideHider &&
                    hiderRevealSecondsLeft !== null &&
                    hiderRevealSecondsLeft > 0
                  ? `${hiderRevealSecondsLeft}s`
                  : 'LIVE'}
            </div>
          </div>
        </div>
      )}

      {showHiderLeashBanner && (
        <div
          role="alert"
          data-testid="hider-leash-warning-banner"
          className="cmf-alert-slide w-full border-b-2 border-[#E04300] bg-[var(--cmf-orange)] px-4 py-2 text-white shadow-md"
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <AlertOctagon className="h-5 w-5 shrink-0 animate-pulse" />
              <div>
                <p className="font-dot text-xs font-bold uppercase sm:text-sm">
                  {leashState.violationReason === 'OUTSIDE_81247'
                    ? 'Zurück ins Spielgebiet!'
                    : isManhunt
                      ? 'Zurück in die aktive Zone!'
                      : `Zurück in den ${LEASH_RADIUS_METERS}m-Kreis!`}
                </p>
                <p className="text-[11px] text-white/95">
                  ~{leashState.distanceFromAnchorMeters ?? LEASH_RADIUS_METERS} m entfernt •{' '}
                  {isHiderLiveExposed
                    ? 'Standort für alle sichtbar!'
                    : leashState.publicAlertTriggered
                      ? `Standort sichtbar in ${hiderRevealSecondsLeft ?? 60} s`
                      : 'Warnung an alle nach 60 s'}
                </p>
              </div>
            </div>
            <div
              data-testid="hider-leash-countdown"
              className="cmf-oled shrink-0 px-3 py-1 text-right font-dot text-base text-[var(--cmf-amber)]"
            >
              {leashState.countdownSecondsLeft !== null &&
              leashState.countdownSecondsLeft > 0
                ? `${leashState.countdownSecondsLeft}s`
                : hiderRevealSecondsLeft !== null && hiderRevealSecondsLeft > 0
                  ? `${hiderRevealSecondsLeft}s`
                  : 'LIVE!'}
            </div>
          </div>
        </div>
      )}

      {showPublicLeashBanner && (
        <div
          role="status"
          data-testid="public-leash-warning-banner"
          className="cmf-alert-slide w-full border-b border-[var(--shell-border)] bg-[var(--module-bg)] px-4 py-2 text-center font-tech text-[11px] font-bold text-[var(--cmf-orange)] uppercase"
        >
          {isManhunt
            ? 'Verstecker außerhalb der aktiven Zone!'
            : `Verstecker außerhalb ihres ${LEASH_RADIUS_METERS}m-Kreises!`}{' '}
          {isPublicLiveExposed
            ? '• Live-Standort auf der Karte sichtbar!'
            : publicRevealSecondsLeft !== null
              ? `• Live-Standort in ${publicRevealSecondsLeft} s`
              : ''}
        </div>
      )}
    </div>
  );
};
