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

  const outside81247Countdown =
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
      {/* 1. Warnung beim Verlassen des 81247-Versteck- / Spielgebiets (mit 60s-Countdown & Hinweis auf Live-Standort-Freigabe nach einer weiteren Minute) */}
      {isOutsidePlayArea && (
        <div
          role="alert"
          data-testid="outside-play-area-banner"
          className="cmf-alert-slide w-full border-b border-[#B91C1C] bg-[#DC2626] px-4 py-2 text-white shadow-md"
        >
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <div className="text-left font-tech text-[11px] font-bold tracking-wide uppercase">
              <p>
                {isOwnSideHider
                  ? 'ACHTUNG // Du hast das 81247-Versteckgebiet verlassen! (60s Rückkehr-Countdown)'
                  : 'ACHTUNG // Du hast das 81247-Spielgebiet verlassen! Bitte sofort zurückkehren (60s Countdown).'}
              </p>
              <p className="mt-0.5 text-[10px] text-white/90">
                {isOwnSideHider
                  ? isHiderLiveExposed
                    ? 'WARNUNG: Nach Ablauf der weiteren Minute ist euer Live-Verstecker-Standort jetzt für alle freigegeben!'
                    : leashState.publicAlertTriggered
                      ? `ALLE TEAMS SIND GEWARNT // Nach einer weiteren Minute (${hiderRevealSecondsLeft ?? 60}s) wird der Live-Verstecker-Standort freigegeben!`
                      : 'Nach Ablauf der 60s werden alle Teams gewarnt und nach einer weiteren Minute wird der Live-Verstecker-Standort freigegeben!'
                  : 'Bei Versteckern außerhalb des Bereichs wird nach 60s gewarnt und nach einer weiteren Minute der Live-Verstecker-Standort freigegeben.'}
              </p>
            </div>
            <div
              data-testid="outside-play-area-countdown"
              className="cmf-oled shrink-0 px-2.5 py-1 text-right font-dot text-base text-[var(--cmf-amber)]"
            >
              {outside81247Countdown > 0
                ? `${outside81247Countdown}S`
                : isOwnSideHider &&
                    hiderRevealSecondsLeft !== null &&
                    hiderRevealSecondsLeft > 0
                  ? `LIVE ${hiderRevealSecondsLeft}S`
                  : '0S'}
            </div>
          </div>
        </div>
      )}

      {/* 2. Signal-Orange Vollbreiten-Warnbanner für Verstecker beim Verlassen des 50m-Verstecks, der aktiven Manhunt-Zone oder von 81247 */}
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
                  {leashState.violationReason === 'OUTSIDE_81247'
                    ? 'ACHTUNG: Zurück in den 81247-Bereich!'
                    : isManhunt
                      ? 'ACHTUNG: Zurück in die aktive Manhunt-Zone!'
                      : `ACHTUNG: Zurück ins ${LEASH_RADIUS_METERS}m-Versteck!`}
                </p>
                <p className="font-tech text-[11px] text-white/95">
                  {isManhunt || leashState.violationReason === 'OUTSIDE_81247'
                    ? `AUSSERHALB: ~${leashState.distanceFromAnchorMeters ?? 1}M`
                    : `ABWEICHUNG: ~${leashState.distanceFromAnchorMeters ?? `>${LEASH_RADIUS_METERS}`}M`}
                  {isHiderLiveExposed
                    ? ' // LIVE-VERSTECKER-STANDORT IST JETZT AUF DER KARTE FREIGEGEBEN!'
                    : leashState.publicAlertTriggered
                      ? ` // ALLE TEAMS INFORMIERT — NACH EINER WEITEREN MINUTE (${hiderRevealSecondsLeft ?? 60}S) WIRD DER LIVE-VERSTECKER-STANDORT FREIGEGEBEN!`
                      : ' // 60S COUNTDOWN: DANACH WARNUNG & NACH EINER WEITEREN MINUTE WIRD DER LIVE-VERSTECKER-STANDORT FREIGEGEBEN!'}
                </p>
              </div>
            </div>
            <div
              data-testid="hider-leash-countdown"
              className="cmf-oled shrink-0 px-3 py-1 text-right font-dot text-lg text-[var(--cmf-amber)]"
            >
              {leashState.countdownSecondsLeft !== null &&
              leashState.countdownSecondsLeft > 0
                ? `${leashState.countdownSecondsLeft}S`
                : hiderRevealSecondsLeft !== null && hiderRevealSecondsLeft > 0
                  ? `LIVE ${hiderRevealSecondsLeft}S`
                  : 'LIVE!'}
            </div>
          </div>
        </div>
      )}

      {/* 3. Öffentliche Meldung für alle übrigen Teams nach Ablauf der ersten 60s-Frist (inkl. Countdown der weiteren Minute bis zur Live-Standort-Freigabe!) */}
      {showPublicLeashBanner && (
        <div
          role="status"
          data-testid="public-leash-warning-banner"
          className="cmf-alert-slide w-full border-b border-[var(--shell-border)] bg-[var(--module-bg)] px-4 py-2 text-center font-tech text-[11px] font-bold tracking-wide text-[var(--cmf-orange)] uppercase"
        >
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-2">
            <span>
              {activeLeashViolation?.violationReason === 'OUTSIDE_81247'
                ? 'WARNUNG // Die Verstecker haben den 81247-Bereich verlassen!'
                : isManhunt
                  ? 'WARNUNG // Die Verstecker haben die aktive Zone verlassen!'
                  : `WARNUNG // Die Verstecker haben ihren ${LEASH_RADIUS_METERS}m-Versteckradius verlassen!`}{' '}
              {isPublicLiveExposed
                ? 'Der Live-Verstecker-Standort ist jetzt nach einer weiteren Minute auf der Karte freigegeben!'
                : `Nach einer weiteren Minute wird der Live-Verstecker-Standort freigegeben${
                    publicRevealSecondsLeft !== null
                      ? ` (${publicRevealSecondsLeft}s)`
                      : ''
                  }!`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
