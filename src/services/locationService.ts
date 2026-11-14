import {
  LOCATION_MIN_DISTANCE_METERS,
  LOCATION_THROTTLE_INTERVAL_MS,
} from '../config/gameConfig';
import { distanceMeters, roundCoord5 } from '../geo/distance';
import type { DatabaseAdapter } from './databaseAdapter';
import type {
  GameMode,
  GeoFix,
  LatLng,
  MemberRecord,
  TeamPublic,
} from '../types/game';

export interface ThrottleDecision {
  shouldSend: boolean;
  roundedLat: number;
  roundedLng: number;
}

/**
 * Reine Entscheidungsfunktion für das 6s- / 25m-Standort-Throttling.
 */
export function evaluateLocationThrottle(params: {
  nextFix: GeoFix;
  lastSentPoint: LatLng | null;
  lastSentAtMs: number;
  nowMs: number;
}): ThrottleDecision {
  const { nextFix, lastSentPoint, lastSentAtMs, nowMs } = params;
  const roundedLat = roundCoord5(nextFix.lat);
  const roundedLng = roundCoord5(nextFix.lng);

  if (!lastSentPoint) {
    return { shouldSend: true, roundedLat, roundedLng };
  }

  if (nowMs - lastSentAtMs < LOCATION_THROTTLE_INTERVAL_MS) {
    return { shouldSend: false, roundedLat, roundedLng };
  }

  const movedMeters = distanceMeters(lastSentPoint, {
    lat: roundedLat,
    lng: roundedLng,
  });

  if (movedMeters <= LOCATION_MIN_DISTANCE_METERS) {
    return { shouldSend: false, roundedLat, roundedLng };
  }

  return { shouldSend: true, roundedLat, roundedLng };
}

/**
 * Verwaltet die gedrosselte Synchronisation eines aktiven Sucher-Spielers
 * nach `/teams/{teamId}/location` (Durchschnittsposition aller aktiven Teammitglieder).
 */
export class SeekerBeaconBroadcaster {
  private lastSentPoint: LatLng | null = null;
  private lastSentAtMs = 0;

  reset(): void {
    this.lastSentPoint = null;
    this.lastSentAtMs = 0;
  }

  async maybePublishFix(params: {
    adapter: DatabaseAdapter;
    member: MemberRecord | null;
    team: TeamPublic | null;
    gameActive: boolean;
    fix: GeoFix | null;
  }): Promise<boolean> {
    const { adapter, member, team, gameActive, fix } = params;

    if (!member || !member.enabled || member.side !== 'SEEKER' || !member.teamId || !team) {
      return false;
    }

    // Sobald das Team bei den Sardinen ist: sofort stoppen!
    if (team.status === 'JOINED_SARDINES') {
      this.reset();
      return false;
    }

    // Jedes aktive Mitglied des Sucher-Teams trägt zur Durchschnittsposition des Teams bei
    if (!gameActive || !fix) {
      return false;
    }

    const nowMs = adapter.getServerNow();
    const decision = evaluateLocationThrottle({
      nextFix: fix,
      lastSentPoint: this.lastSentPoint,
      lastSentAtMs: this.lastSentAtMs,
      nowMs,
    });

    if (!decision.shouldSend) {
      return false;
    }

    this.lastSentPoint = {
      lat: decision.roundedLat,
      lng: decision.roundedLng,
    };
    this.lastSentAtMs = nowMs;

    await adapter.writeTeamMemberFixAveraged(team.id, member.playerId, member.uid, {
      lat: decision.roundedLat,
      lng: decision.roundedLng,
      accuracy: Math.round(fix.accuracy),
      timestamp: nowMs,
    });
    return true;
  }
}

/**
 * Synchronisiert gedrosselt (6s / 25m) die Live-Position der Verstecker ausschließlich in
 * `/state/hiderPrivate/hiderLocations/{uid}` (für aktive Sucher unlesbar!).
 * Im Manhunt-Modus dient dies für die beweglichen Zonen-Pings; im klassischen Modus als
 * echte Verstecker-Rückfallposition bei vorzeitigem Suchstart oder Seiten-Reload.
 */
export class HiderPrivateBroadcaster {
  private lastSentPoint: LatLng | null = null;
  private lastSentAtMs = 0;

  reset(): void {
    this.lastSentPoint = null;
    this.lastSentAtMs = 0;
  }

  async maybePublishFix(params: {
    adapter: DatabaseAdapter;
    member: MemberRecord | null;
    team?: TeamPublic | null;
    gameMode: GameMode;
    gameActive: boolean;
    fix: GeoFix | null;
  }): Promise<boolean> {
    const { adapter, member, team, gameMode, gameActive, fix } = params;

    const canWritePrivateFix = Boolean(
      member &&
        member.enabled &&
        (member.side === 'HIDER' ||
          (gameMode === 'MANHUNT' && team?.status === 'JOINED_SARDINES'))
    );

    if (!gameActive || !member || !canWritePrivateFix || !fix) {
      if (!gameActive) {
        this.reset();
      }
      return false;
    }

    const nowMs = adapter.getServerNow();
    const decision = evaluateLocationThrottle({
      nextFix: fix,
      lastSentPoint: this.lastSentPoint,
      lastSentAtMs: this.lastSentAtMs,
      nowMs,
    });

    if (!decision.shouldSend) {
      return false;
    }

    this.lastSentPoint = {
      lat: decision.roundedLat,
      lng: decision.roundedLng,
    };
    this.lastSentAtMs = nowMs;

    await adapter
      .writeHiderLocationPrivate(member.uid, {
        lat: decision.roundedLat,
        lng: decision.roundedLng,
        accuracy: Math.round(fix.accuracy),
        timestamp: nowMs,
      })
      .catch(() => {});
    return true;
  }
}
