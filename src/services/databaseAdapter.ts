import {
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  get,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  set,
  update,
} from 'firebase/database';
import { getFirebaseClients, isFirebaseConfigured } from '../config/firebase';
import {
  DEFAULT_PLAY_AREA_FEATURE,
  GAME_ID,
  isLegacyPlaceholderPlayArea,
  OFFICIAL_81247_AREA_NAME,
  PLAYER_SEAT_TTL_MS,
  TEAM_MEMBER_FIX_MAX_AGE_MS,
  TEAM_PALETTE,
} from '../config/gameConfig';
import { getBrowserDemoStore } from '../demo/demoStore';
import { roundCoord5 } from '../geo/distance';
import type {
  AuthUserSummary,
  CatchRequest,
  CatchRequestStatus,
  ClueRecord,
  ClueRequest,
  ClueRequestStatus,
  ControllerLease,
  GeoFix,
  HiderPrivateState,
  JoinRequest,
  LeaderboardEntry,
  MemberRecord,
  PlayerSeatClaim,
  PresenceSession,
  PublicGameState,
  TeamLocation,
  TeamPublic,
} from '../types/game';

export type UnsubscribeFn = () => void;

export type ControllerPublicPatch = Partial<
  Pick<
    PublicGameState,
    | 'currentPhase'
    | 'status'
    | 'radarCircle'
    | 'leashAlertActive'
    | 'searchStartTimestamp'
    | 'pausedBeforeSearchMs'
    | 'anchorLocked'
  >
>;

/**
 * Einheitlicher Datenvertrag für Firebase Realtime Database (Spark-Plan)
 * sowie die lokale Offline-Simulation (localStorage + BroadcastChannel).
 */
export interface DatabaseAdapter {
  readonly mode: 'firebase' | 'demo';

  getServerNow(): number;
  subscribeConnectionStatus(cb: (connected: boolean) => void): UnsubscribeFn;
  subscribeServerTimeOffset(cb: (offsetMs: number) => void): UnsubscribeFn;

  signInWithPresetPlayer(loginEmail: string, password?: string): Promise<AuthUserSummary>;
  registerSelfMemberIfMissing(member: MemberRecord): Promise<void>;
  claimInitialHostRole(uid: string, playerId: string, name: string): Promise<void>;
  removeMemberByHost(uid: string): Promise<void>;
  tryAcquireOrRenewPlayerSeat(
    playerId: string,
    uid: string,
    tabId: string,
    nowMs: number
  ): Promise<{ acquired: boolean; holder: PlayerSeatClaim | null }>;
  releasePlayerSeat(playerId: string, uid: string, tabId: string): Promise<void>;
  subscribePlayerSeat(
    playerId: string,
    cb: (claim: PlayerSeatClaim | null) => void
  ): UnsubscribeFn;
  signOut(): Promise<void>;
  subscribeAuth(cb: (user: AuthUserSummary | null) => void): UnsubscribeFn;

  subscribeOwnMember(uid: string, cb: (member: MemberRecord | null) => void): UnsubscribeFn;
  subscribeAllMembers(cb: (members: Record<string, MemberRecord>) => void): UnsubscribeFn;
  upsertJoinRequest(req: JoinRequest): Promise<void>;
  subscribeOwnJoinRequest(uid: string, cb: (req: JoinRequest | null) => void): UnsubscribeFn;
  subscribeAllJoinRequests(cb: (reqs: Record<string, JoinRequest>) => void): UnsubscribeFn;
  approveJoinRequest(req: JoinRequest, defaults?: Partial<MemberRecord>): Promise<void>;
  updateMember(uid: string, member: MemberRecord): Promise<void>;
  registerTabPresence(uid: string, browserSessionId: string, deviceInfo: string): UnsubscribeFn;
  subscribePresence(
    cb: (presence: Record<string, Record<string, PresenceSession>>) => void
  ): UnsubscribeFn;
  cleanupOrphanedPresence(targetUid?: string): Promise<void>;

  subscribePublicState(cb: (state: PublicGameState | null) => void): UnsubscribeFn;
  initializeDefaultLobbyIfNeeded(
    defaultState: PublicGameState,
    defaultTeams: Record<string, TeamPublic>
  ): Promise<void>;
  savePublicStateByHost(state: PublicGameState): Promise<void>;
  patchControllerPublicTransition(patch: ControllerPublicPatch): Promise<void>;

  subscribeControllerLease(cb: (lease: ControllerLease | null) => void): UnsubscribeFn;
  tryAcquireOrRenewLease(
    uid: string,
    sessionId: string,
    nowMs: number,
    ttlMs: number
  ): Promise<boolean>;

  subscribeHiderPrivate(cb: (priv: HiderPrivateState | null) => void): UnsubscribeFn;
  saveHiderPrivate(priv: HiderPrivateState): Promise<void>;

  subscribeTeamPublic(teamId: string, cb: (team: TeamPublic | null) => void): UnsubscribeFn;
  saveTeamPublic(teamId: string, team: TeamPublic): Promise<void>;
  subscribeTeamLocation(teamId: string, cb: (loc: TeamLocation | null) => void): UnsubscribeFn;
  writeTeamLocation(teamId: string, loc: TeamLocation): Promise<void>;
  writeTeamMemberFixAveraged(
    teamId: string,
    playerId: string,
    uid: string,
    fix: GeoFix
  ): Promise<TeamLocation | null>;
  clearTeamLocation(teamId: string): Promise<void>;

  subscribeTeamRequests(
    teamId: string,
    cb: (reqs: Record<string, ClueRequest>) => void
  ): UnsubscribeFn;
  createClueRequest(req: ClueRequest): Promise<void>;
  acknowledgeAndStripMedia(teamId: string, requestId: string, ackAt: number): Promise<void>;
  claimRequestForProcessing(
    teamId: string,
    requestId: string,
    expectedSessionId: string,
    expectedStatuses: ClueRequestStatus[],
    nextStatus: ClueRequestStatus
  ): Promise<ClueRequest | null>;
  updateClueRequest(teamId: string, requestId: string, req: ClueRequest): Promise<void>;
  adjustTeamPenaltyAndClueCountAtomically(
    teamId: string,
    deltaPenaltyMs: number,
    deltaClueCount: number
  ): Promise<TeamPublic | null>;
  saveClue(teamId: string, clue: ClueRecord): Promise<void>;
  subscribeTeamClues(
    teamId: string,
    cb: (clues: Record<string, ClueRecord>) => void
  ): UnsubscribeFn;

  submitCatchRequest(req: CatchRequest): Promise<void>;
  subscribeAllCatchRequests(cb: (reqs: Record<string, CatchRequest>) => void): UnsubscribeFn;
  subscribeOwnCatchRequest(
    requestId: string,
    cb: (req: CatchRequest | null) => void
  ): UnsubscribeFn;
  claimCatchRequest(requestId: string): Promise<CatchRequest | null>;
  finalizeCatchRequest(
    requestId: string,
    status: CatchRequestStatus,
    processedAt: number,
    errorMessage?: string
  ): Promise<void>;
  markTeamCaughtAtomically(
    teamId: string,
    catchTimestampMs: number
  ): Promise<{ transitioned: boolean; team: TeamPublic | null }>;

  saveLeaderboardEntry(entry: LeaderboardEntry): Promise<void>;
  subscribeLeaderboard(cb: (entries: Record<string, LeaderboardEntry>) => void): UnsubscribeFn;

  resetRoundByHost(
    newPublicState: PublicGameState,
    resetTeams: Record<string, TeamPublic>,
    newHiderPrivate: HiderPrivateState
  ): Promise<void>;
}

const ROOT_PATH = `games/${GAME_ID}`;

function stripUndefinedDeep<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

export function computeAveragedTeamLocationFromMemberFixes(
  prevLocation: TeamLocation | null,
  playerId: string,
  uid: string,
  fix: GeoFix,
  nowMs: number
): TeamLocation {
  const prevFixes = prevLocation?.memberFixes ?? {};
  const nextFixes: Record<string, GeoFix> = {};

  // Behalte nur frische Fixes (max. 5 Minuten alt), damit ein ausgefallenes Handy den Schnitt nicht ewig wegzieht
  for (const [pid, oldFix] of Object.entries(prevFixes)) {
    if (oldFix && nowMs - oldFix.timestamp <= TEAM_MEMBER_FIX_MAX_AGE_MS) {
      nextFixes[pid] = oldFix;
    }
  }

  nextFixes[playerId] = {
    lat: roundCoord5(fix.lat),
    lng: roundCoord5(fix.lng),
    accuracy: Math.round(fix.accuracy),
    timestamp: nowMs,
  };

  const activeList = Object.values(nextFixes);
  const count = activeList.length;
  const sumLat = activeList.reduce((acc, f) => acc + f.lat, 0);
  const sumLng = activeList.reduce((acc, f) => acc + f.lng, 0);
  const sumAcc = activeList.reduce((acc, f) => acc + f.accuracy, 0);

  return {
    lat: roundCoord5(sumLat / count),
    lng: roundCoord5(sumLng / count),
    accuracy: Math.max(4, Math.round(sumAcc / count)),
    timestamp: nowMs,
    updatedByUid: uid,
    activeContributorCount: count,
    memberFixes: nextFixes,
  };
}

/**
 * Produktiver Firebase-RTDB-Adapter (ausschließlich Spark-Plan, keine Selbstregistrierung).
 */
export function createFirebaseDatabaseAdapter(): DatabaseAdapter {
  const clients = getFirebaseClients();
  if (!clients) {
    throw new Error('Firebase ist nicht konfiguriert.');
  }
  const { auth, db } = clients;
  let serverTimeOffsetMs = 0;

  // Initialer Listener auf Server-Zeitoffset
  onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    const val = snap.val();
    if (typeof val === 'number') {
      serverTimeOffsetMs = val;
    }
  });

  const adapter: DatabaseAdapter = {
    mode: 'firebase',

    getServerNow(): number {
      return Date.now() + serverTimeOffsetMs;
    },

    subscribeConnectionStatus(cb): UnsubscribeFn {
      return onValue(ref(db, '.info/connected'), (snap) => {
        cb(Boolean(snap.val()));
      });
    },

    subscribeServerTimeOffset(cb): UnsubscribeFn {
      return onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
        const val = typeof snap.val() === 'number' ? snap.val() : 0;
        serverTimeOffsetMs = val;
        cb(val);
      });
    },

    async signInWithPresetPlayer(loginEmail, password): Promise<AuthUserSummary> {
      if (password && password.trim().length > 0) {
        const cred = await signInWithEmailAndPassword(auth, loginEmail, password);
        return {
          uid: cred.user.uid,
          email: cred.user.email ?? loginEmail,
        };
      }
      if (auth.currentUser) {
        return {
          uid: auth.currentUser.uid,
          email: loginEmail,
        };
      }
      // Passwortloser Freundeskreis-Modus via Firebase Anonymous Auth
      const anonCred = await signInAnonymously(auth);
      return {
        uid: anonCred.user.uid,
        email: loginEmail,
      };
    },

    async claimInitialHostRole(uid, playerId, name): Promise<void> {
      const hostMember: MemberRecord = {
        uid,
        playerId,
        name,
        isHost: true,
        enabled: true,
        side: 'HIDER',
        teamId: null,
      };
      await set(
        ref(db, `${ROOT_PATH}/members/${uid}`),
        stripUndefinedDeep(hostMember)
      );
      await remove(ref(db, `${ROOT_PATH}/joinRequests/${uid}`)).catch(() => {});
    },

    async registerSelfMemberIfMissing(member): Promise<void> {
      const memberRef = ref(db, `${ROOT_PATH}/members/${member.uid}`);
      const snap = await get(memberRef);
      if (!snap.exists()) {
        await set(memberRef, stripUndefinedDeep(member));
      }
    },

    async removeMemberByHost(uid): Promise<void> {
      await remove(ref(db, `${ROOT_PATH}/members/${uid}`));
    },

    async tryAcquireOrRenewPlayerSeat(
      playerId,
      uid,
      tabId,
      nowMs
    ): Promise<{ acquired: boolean; holder: PlayerSeatClaim | null }> {
      const claimRef = ref(db, `${ROOT_PATH}/playerClaims/${playerId}`);
      let won = false;
      const tx = await runTransaction(claimRef, (cur: PlayerSeatClaim | null) => {
        if (
          !cur ||
          cur.heartbeatAt < nowMs - PLAYER_SEAT_TTL_MS ||
          cur.uid === uid
        ) {
          won = true;
          return {
            uid,
            tabId,
            heartbeatAt: nowMs,
          };
        }
        won = false;
        return; // Abbruch: anderes Gerät (andere UID) hält aktiven Sitz
      });

      const currentVal = (tx.snapshot.val() as PlayerSeatClaim | null) ?? null;
      const acquired =
        Boolean(tx.committed && won) ||
        Boolean(currentVal && currentVal.uid === uid);

      if (acquired) {
        onDisconnect(claimRef)
          .remove()
          .catch(() => {});
      }

      return {
        acquired,
        holder: currentVal,
      };
    },

    async releasePlayerSeat(playerId, uid): Promise<void> {
      const claimRef = ref(db, `${ROOT_PATH}/playerClaims/${playerId}`);
      try {
        const snap = await get(claimRef);
        const val = snap.val() as PlayerSeatClaim | null;
        if (val && val.uid === uid) {
          await remove(claimRef);
        }
      } catch {
        // Ignorieren
      }
    },

    subscribePlayerSeat(playerId, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/playerClaims/${playerId}`),
        (snap) => cb((snap.val() as PlayerSeatClaim | null) ?? null),
        () => cb(null)
      );
    },

    async signOut(): Promise<void> {
      await firebaseSignOut(auth);
    },

    subscribeAuth(cb): UnsubscribeFn {
      return onAuthStateChanged(auth, (user) => {
        if (!user) {
          cb(null);
          return;
        }
        cb({ uid: user.uid, email: user.email });
      });
    },

    subscribeOwnMember(uid, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/members/${uid}`),
        (snap) => {
          const val = snap.val();
          cb(val ? ({ ...val, uid } as MemberRecord) : null);
        },
        () => cb(null)
      );
    },

    subscribeAllMembers(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/members`),
        (snap) => {
          const raw = (snap.val() ?? {}) as Record<string, MemberRecord>;
          const mapped: Record<string, MemberRecord> = {};
          for (const [uid, rec] of Object.entries(raw)) {
            mapped[uid] = { ...rec, uid };
          }
          cb(mapped);
        },
        () => cb({})
      );
    },

    async upsertJoinRequest(req): Promise<void> {
      await set(
        ref(db, `${ROOT_PATH}/joinRequests/${req.uid}`),
        stripUndefinedDeep(req)
      );
    },

    subscribeOwnJoinRequest(uid, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/joinRequests/${uid}`),
        (snap) => cb((snap.val() as JoinRequest | null) ?? null),
        () => cb(null)
      );
    },

    subscribeAllJoinRequests(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/joinRequests`),
        (snap) => cb((snap.val() as Record<string, JoinRequest> | null) ?? {}),
        () => cb({})
      );
    },

    async approveJoinRequest(req, defaults): Promise<void> {
      const assignedSide = defaults?.side ?? 'SEEKER';
      const assignedTeam = assignedSide === 'SEEKER' ? (defaults?.teamId ?? 'team-1') : null;
      const member: MemberRecord = {
        uid: req.uid,
        playerId: req.playerId,
        name: req.name,
        isHost: Boolean(defaults?.isHost),
        enabled: true,
        side: assignedSide,
        teamId: assignedTeam,
      };
      await set(ref(db, `${ROOT_PATH}/members/${req.uid}`), stripUndefinedDeep(member));
      if (assignedTeam) {
        await runTransaction(
          ref(db, `${ROOT_PATH}/teams/${assignedTeam}/public`),
          (current: TeamPublic | null) => {
            if (!current) return current;
            const list = Array.isArray(current.memberPlayerIds)
              ? [...current.memberPlayerIds]
              : [];
            if (!list.includes(req.playerId)) {
              list.push(req.playerId);
            }
            return {
              ...current,
              memberPlayerIds: list,
              beaconPlayerId: current.beaconPlayerId ?? req.playerId,
            };
          }
        );
      }
      await remove(ref(db, `${ROOT_PATH}/joinRequests/${req.uid}`));
    },

    async updateMember(uid, member): Promise<void> {
      await set(
        ref(db, `${ROOT_PATH}/members/${uid}`),
        stripUndefinedDeep(member)
      );
    },

    registerTabPresence(uid, browserSessionId, deviceInfo): UnsubscribeFn {
      const sessionRef = ref(db, `${ROOT_PATH}/presence/${uid}/${browserSessionId}`);
      const connectedRef = ref(db, '.info/connected');

      const unsub = onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
          onDisconnect(sessionRef)
            .remove()
            .then(() => {
              set(sessionRef, {
                online: true,
                lastSeen: adapter.getServerNow(),
                deviceInfo,
              }).catch(() => {});
            })
            .catch(() => {});
        }
      });

      return () => {
        unsub();
        remove(sessionRef).catch(() => {});
      };
    },

    subscribePresence(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/presence`),
        (snap) =>
          cb(
            (snap.val() as Record<string, Record<string, PresenceSession>> | null) ??
              {}
          ),
        () => cb({})
      );
    },

    async cleanupOrphanedPresence(targetUid): Promise<void> {
      if (targetUid) {
        await remove(ref(db, `${ROOT_PATH}/presence/${targetUid}`));
      } else {
        await remove(ref(db, `${ROOT_PATH}/presence`));
      }
    },

    subscribePublicState(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/state/public`),
        (snap) => {
          const val = snap.val() as PublicGameState | null;
          if (!val) {
            cb(null);
            return;
          }
          const upgradedPlayArea = isLegacyPlaceholderPlayArea(val.playArea)
            ? {
                polygon: structuredClone(DEFAULT_PLAY_AREA_FEATURE),
                confirmed: true,
                confirmedAt: val.playArea?.confirmedAt ?? Date.now(),
                confirmedByUid: 'osm_official_81247',
                name: OFFICIAL_81247_AREA_NAME,
              }
            : val.playArea;

          cb({
            ...val,
            status: val.status === 'EMERGENCY_STOP' ? 'LOBBY' : val.status,
            playArea: upgradedPlayArea,
            pausedAt: val.pausedAt ?? null,
            gameStartTimestamp: val.gameStartTimestamp ?? null,
            searchStartTimestamp: val.searchStartTimestamp ?? null,
            radarCircle: val.radarCircle ?? null,
            emergencyStopReason: null,
            totalPausedMs: val.totalPausedMs ?? 0,
            pausedBeforeSearchMs: val.pausedBeforeSearchMs ?? 0,
            activeTeamIds:
              val.activeTeamIds ?? TEAM_PALETTE.map((t) => t.id),
          });
        },
        () => cb(null)
      );
    },

    async initializeDefaultLobbyIfNeeded(defaultState, defaultTeams): Promise<void> {
      const stateSnap = await get(ref(db, `${ROOT_PATH}/state/public`));
      if (!stateSnap.exists()) {
        await set(
          ref(db, `${ROOT_PATH}/state/public`),
          stripUndefinedDeep(defaultState)
        );
      }
      for (const [teamId, team] of Object.entries(defaultTeams)) {
        const teamSnap = await get(ref(db, `${ROOT_PATH}/teams/${teamId}/public`));
        if (!teamSnap.exists()) {
          await set(
            ref(db, `${ROOT_PATH}/teams/${teamId}/public`),
            stripUndefinedDeep(team)
          );
        }
      }
    },

    async savePublicStateByHost(state): Promise<void> {
      await set(ref(db, `${ROOT_PATH}/state/public`), stripUndefinedDeep(state));
    },

    async patchControllerPublicTransition(patch): Promise<void> {
      const updates: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(patch)) {
        updates[`${ROOT_PATH}/state/public/${key}`] =
          val === undefined ? null : stripUndefinedDeep(val);
      }
      await update(ref(db), updates);
    },

    subscribeControllerLease(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/state/controller`),
        (snap) => cb((snap.val() as ControllerLease | null) ?? null),
        () => cb(null)
      );
    },

    async tryAcquireOrRenewLease(uid, sessionId, nowMs, ttlMs): Promise<boolean> {
      const tx = await runTransaction(
        ref(db, `${ROOT_PATH}/state/controller`),
        (current: ControllerLease | null) => {
          if (
            !current ||
            !current.controllerUid ||
            current.controllerUid === uid ||
            current.leaseExpiresAt < nowMs
          ) {
            return {
              controllerUid: uid,
              heartbeatAt: nowMs,
              leaseExpiresAt: nowMs + ttlMs,
              sessionId,
            };
          }
          return; // Abbruch: anderer aktiver Controller hält gültigen Lease
        }
      );
      return tx.committed && tx.snapshot.val()?.controllerUid === uid;
    },

    subscribeHiderPrivate(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/state/hiderPrivate`),
        (snap) => {
          const val = snap.val() as HiderPrivateState | null;
          if (!val) {
            cb(null);
            return;
          }
          cb({
            anchorPoint: val.anchorPoint ?? null,
            radarStages: val.radarStages ?? [],
            qrSecret: val.qrSecret ?? '',
            shortCode: val.shortCode ?? '',
          });
        },
        () => cb(null)
      );
    },

    async saveHiderPrivate(priv): Promise<void> {
      await set(
        ref(db, `${ROOT_PATH}/state/hiderPrivate`),
        stripUndefinedDeep(priv)
      );
    },

    subscribeTeamPublic(teamId, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/teams/${teamId}/public`),
        (snap) => {
          const val = snap.val() as TeamPublic | null;
          if (!val) {
            cb(null);
            return;
          }
          cb({
            ...val,
            memberPlayerIds: val.memberPlayerIds ?? [],
            beaconPlayerId: val.beaconPlayerId ?? null,
            catchTimestampMs: val.catchTimestampMs ?? null,
            penaltyMs: val.penaltyMs ?? 0,
            clueCount: val.clueCount ?? 0,
          });
        },
        () => cb(null)
      );
    },

    async saveTeamPublic(teamId, team): Promise<void> {
      await set(
        ref(db, `${ROOT_PATH}/teams/${teamId}/public`),
        stripUndefinedDeep(team)
      );
    },

    subscribeTeamLocation(teamId, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/teams/${teamId}/location`),
        (snap) => cb((snap.val() as TeamLocation | null) ?? null),
        () => cb(null)
      );
    },

    async writeTeamLocation(teamId, loc): Promise<void> {
      await set(
        ref(db, `${ROOT_PATH}/teams/${teamId}/location`),
        stripUndefinedDeep(loc)
      );
    },

    async writeTeamMemberFixAveraged(
      teamId,
      playerId,
      uid,
      fix
    ): Promise<TeamLocation | null> {
      const locRef = ref(db, `${ROOT_PATH}/teams/${teamId}/location`);
      const nowMs = adapter.getServerNow();
      const tx = await runTransaction(locRef, (cur: TeamLocation | null) => {
        return stripUndefinedDeep(
          computeAveragedTeamLocationFromMemberFixes(
            cur,
            playerId,
            uid,
            fix,
            nowMs
          )
        );
      });
      return (tx.snapshot.val() as TeamLocation | null) ?? null;
    },

    async clearTeamLocation(teamId): Promise<void> {
      await remove(ref(db, `${ROOT_PATH}/teams/${teamId}/location`));
    },

    subscribeTeamRequests(teamId, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/requests/${teamId}`),
        (snap) => cb((snap.val() as Record<string, ClueRequest> | null) ?? {}),
        () => cb({})
      );
    },

    async createClueRequest(req): Promise<void> {
      await set(
        ref(db, `${ROOT_PATH}/requests/${req.teamId}/${req.id}`),
        stripUndefinedDeep(req)
      );
    },

    async acknowledgeAndStripMedia(teamId, requestId, ackAt): Promise<void> {
      const reqRef = ref(db, `${ROOT_PATH}/requests/${teamId}/${requestId}`);
      await runTransaction(reqRef, (cur: ClueRequest | null) => {
        if (!cur) return cur;
        const copy = { ...cur, mediaAcknowledgedAt: ackAt };
        delete copy.mediaBase64;
        return stripUndefinedDeep(copy);
      });
    },

    async claimRequestForProcessing(
      teamId,
      requestId,
      expectedSessionId,
      expectedStatuses,
      nextStatus
    ): Promise<ClueRequest | null> {
      const tx = await runTransaction(
        ref(db, `${ROOT_PATH}/requests/${teamId}/${requestId}`),
        (cur: ClueRequest | null) => {
          if (!cur) return cur;
          if (
            cur.sessionId !== expectedSessionId ||
            !expectedStatuses.includes(cur.status)
          ) {
            return;
          }
          return {
            ...cur,
            status: nextStatus,
          };
        }
      );
      if (!tx.committed) return null;
      return (tx.snapshot.val() as ClueRequest | null) ?? null;
    },

    async updateClueRequest(teamId, requestId, req): Promise<void> {
      await set(
        ref(db, `${ROOT_PATH}/requests/${teamId}/${requestId}`),
        stripUndefinedDeep(req)
      );
    },

    async adjustTeamPenaltyAndClueCountAtomically(
      teamId,
      deltaPenaltyMs,
      deltaClueCount
    ): Promise<TeamPublic | null> {
      const tx = await runTransaction(
        ref(db, `${ROOT_PATH}/teams/${teamId}/public`),
        (cur: TeamPublic | null) => {
          if (!cur) return cur;
          return {
            ...cur,
            penaltyMs: Math.max(0, (cur.penaltyMs || 0) + deltaPenaltyMs),
            clueCount: Math.max(0, (cur.clueCount || 0) + deltaClueCount),
          };
        }
      );
      return (tx.snapshot.val() as TeamPublic | null) ?? null;
    },

    async saveClue(teamId, clue): Promise<void> {
      await set(
        ref(db, `${ROOT_PATH}/clues/${teamId}/${clue.id}`),
        stripUndefinedDeep(clue)
      );
    },

    subscribeTeamClues(teamId, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/clues/${teamId}`),
        (snap) => cb((snap.val() as Record<string, ClueRecord> | null) ?? {}),
        () => cb({})
      );
    },

    async submitCatchRequest(req): Promise<void> {
      await set(
        ref(db, `${ROOT_PATH}/catchRequests/${req.id}`),
        stripUndefinedDeep(req)
      );
    },

    subscribeAllCatchRequests(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/catchRequests`),
        (snap) => cb((snap.val() as Record<string, CatchRequest> | null) ?? {}),
        () => cb({})
      );
    },

    subscribeOwnCatchRequest(requestId, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/catchRequests/${requestId}`),
        (snap) => cb((snap.val() as CatchRequest | null) ?? null),
        () => cb(null)
      );
    },

    async claimCatchRequest(requestId): Promise<CatchRequest | null> {
      const tx = await runTransaction(
        ref(db, `${ROOT_PATH}/catchRequests/${requestId}`),
        (cur: CatchRequest | null) => {
          if (!cur || cur.status !== 'PENDING') return;
          return { ...cur, status: 'PROCESSING' as CatchRequestStatus };
        }
      );
      if (!tx.committed) return null;
      return (tx.snapshot.val() as CatchRequest | null) ?? null;
    },

    async finalizeCatchRequest(
      requestId,
      status,
      processedAt,
      errorMessage
    ): Promise<void> {
      const updates: Record<string, unknown> = {
        status,
        processedAt,
      };
      if (errorMessage) updates.errorMessage = errorMessage;
      await update(ref(db, `${ROOT_PATH}/catchRequests/${requestId}`), updates);
    },

    async markTeamCaughtAtomically(
      teamId,
      catchTimestampMs
    ): Promise<{ transitioned: boolean; team: TeamPublic | null }> {
      let didTransition = false;
      const tx = await runTransaction(
        ref(db, `${ROOT_PATH}/teams/${teamId}/public`),
        (cur: TeamPublic | null) => {
          if (!cur) return cur;
          if (cur.status !== 'ACTIVE') {
            didTransition = false;
            return;
          }
          didTransition = true;
          return {
            ...cur,
            status: 'JOINED_SARDINES' as const,
            catchTimestampMs,
          };
        }
      );
      return {
        transitioned: tx.committed && didTransition,
        team: (tx.snapshot.val() as TeamPublic | null) ?? null,
      };
    },

    async saveLeaderboardEntry(entry): Promise<void> {
      await set(
        ref(db, `${ROOT_PATH}/leaderboard/${entry.teamId}`),
        stripUndefinedDeep(entry)
      );
    },

    subscribeLeaderboard(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ROOT_PATH}/leaderboard`),
        (snap) =>
          cb((snap.val() as Record<string, LeaderboardEntry> | null) ?? {}),
        () => cb({})
      );
    },

    async resetRoundByHost(
      newPublicState,
      resetTeams,
      newHiderPrivate
    ): Promise<void> {
      await set(
        ref(db, `${ROOT_PATH}/state/public`),
        stripUndefinedDeep(newPublicState)
      );
      await remove(ref(db, `${ROOT_PATH}/state/controller`));
      await set(
        ref(db, `${ROOT_PATH}/state/hiderPrivate`),
        stripUndefinedDeep(newHiderPrivate)
      );
      await remove(ref(db, `${ROOT_PATH}/clues`));
      await remove(ref(db, `${ROOT_PATH}/requests`));
      await remove(ref(db, `${ROOT_PATH}/catchRequests`));
      await remove(ref(db, `${ROOT_PATH}/leaderboard`));
      for (const [teamId, team] of Object.entries(resetTeams)) {
        await set(
          ref(db, `${ROOT_PATH}/teams/${teamId}/public`),
          stripUndefinedDeep(team)
        );
        await remove(ref(db, `${ROOT_PATH}/teams/${teamId}/location`));
      }
    },
  };

  return adapter;
}

let cachedFirebaseAdapter: DatabaseAdapter | null = null;

/**
 * Liefert den aktiven Datenbank-Adapter.
 * Wichtig: Ist Firebase konfiguriert und der Nutzer nicht explizit im Demo-Modus,
 * bleibt auch bei Netzverlust strikt der Firebase-Adapter aktiv (kein stiller Demo-Wechsel!).
 */
export function resolveDatabaseAdapter(forceDemoMode: boolean): DatabaseAdapter {
  if (forceDemoMode || !isFirebaseConfigured) {
    return getBrowserDemoStore().adapter;
  }
  if (!cachedFirebaseAdapter) {
    cachedFirebaseAdapter = createFirebaseDatabaseAdapter();
  }
  return cachedFirebaseAdapter;
}
