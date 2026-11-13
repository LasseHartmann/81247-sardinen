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
  createDefaultTeams,
  DEFAULT_PLAY_AREA_FEATURE,
  GAME_ID,
  isLegacyPlaceholderPlayArea,
  OFFICIAL_81247_AREA_NAME,
  TEAM_MEMBER_FIX_MAX_AGE_MS,
  TEAM_PALETTE,
} from '../config/gameConfig';
import { getBrowserDemoStore } from '../demo/demoStore';
import { roundCoord5 } from '../geo/distance';
import { generateRandomId, generateSessionSecrets } from './qrService';
import type {
  AuthUserSummary,
  CatchRequest,
  CatchRequestStatus,
  ClueRecord,
  ClueRequest,
  ClueRequestStatus,
  ControllerLease,
  EmergencyMessage,
  GeoFix,
  HiderLoginLock,
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
  fetchPlayerAssignment(playerId: string): Promise<{ side: MemberRecord['side']; teamId: string | null } | null>;
  savePlayerAssignment(playerId: string, side: MemberRecord['side'], teamId: string | null): Promise<void>;
  claimInitialHostRole(uid: string, playerId: string, name: string): Promise<void>;
  removeMemberByHost(uid: string): Promise<void>;
  kickPlayerByHost(playerId: string, memberUids: string[]): Promise<void>;
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

  setHiderPasswordAndTriggerLogout(params: {
    uid: string;
    sessionId: string;
    cleanPassword: string;
    passwordHash: string;
    hiderPlayerIds: string[];
    nowMs: number;
  }): Promise<HiderLoginLock>;

  setPlayerReadyState(
    uid: string,
    playerId: string,
    readyToken: string | null,
    nowMs: number
  ): Promise<void>;

  sendEmergencyMessage(msg: EmergencyMessage): Promise<void>;
  clearOwnEmergencyMessage(uid: string): Promise<void>;

  fetchLoginSecurityContext(): Promise<{
    publicState: PublicGameState | null;
    members: Record<string, MemberRecord>;
    activeHiderLock: HiderLoginLock | null;
  }>;

  startRoundWhenAllReady(params: {
    starterUid: string;
    publicState: PublicGameState;
    enabledMembers: MemberRecord[];
    currentHiderPrivate: HiderPrivateState | null;
    nowMs: number;
  }): Promise<void>;
}

const ROOT_PATH = `games/${GAME_ID}`;

function stripUndefinedDeep<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

export function buildReadyToken(
  sessionId: string,
  logoutGen: string
): string {
  return `${sessionId}:${logoutGen}`;
}

export function isMemberTabOnline(
  sessions: Record<string, PresenceSession> | undefined
): boolean {
  if (!sessions) return false;
  return Object.entries(sessions).some(
    ([key, s]) =>
      Boolean(s?.online) &&
      key !== 'emergency_alert' &&
      key !== 'ready_state' &&
      key !== 'hider_pw_lock' &&
      key !== 'round_start_meta'
  );
}

export function isPlayerOnline(
  playerId: string,
  members: Record<string, MemberRecord>,
  presence: Record<string, Record<string, PresenceSession>>,
  ownUid?: string
): boolean {
  for (const m of Object.values(members)) {
    if (!m.enabled || m.playerId !== playerId) continue;
    if (ownUid && m.uid === ownUid) return true;
    if (isMemberTabOnline(presence[m.uid])) return true;
  }
  return false;
}

export function deduplicateEnabledMembers(
  members: Record<string, MemberRecord>,
  presence: Record<string, Record<string, PresenceSession>>
): MemberRecord[] {
  const deduped = new Map<string, MemberRecord>();
  for (const m of Object.values(members)) {
    if (!m.enabled) continue;
    const prev = deduped.get(m.playerId);
    if (!prev) {
      deduped.set(m.playerId, m);
      continue;
    }
    const mAssigned = m.side !== 'UNASSIGNED';
    const prevAssigned = prev.side !== 'UNASSIGNED';
    if (mAssigned && !prevAssigned) {
      deduped.set(m.playerId, m);
      continue;
    }
    if (mAssigned === prevAssigned) {
      const mOnline = isMemberTabOnline(presence[m.uid]);
      const prevOnline = isMemberTabOnline(presence[prev.uid]);
      if (mOnline && !prevOnline) {
        deduped.set(m.playerId, m);
      }
    }
  }
  return Array.from(deduped.values());
}

/**
 * Liefert vor dem Rundenstart ausschließlich die aktiv eingeloggten & online verbundenen Spieler.
 * Offline-Spieler blockieren dadurch weder die Gruppen noch den „Bereit“-Countdown.
 */
export function filterOnlineEnabledMembers(
  members: Record<string, MemberRecord>,
  presence: Record<string, Record<string, PresenceSession>>,
  ownUid?: string
): MemberRecord[] {
  const deduped = deduplicateEnabledMembers(members, presence);
  return deduped.filter((m) =>
    isPlayerOnline(m.playerId, members, presence, ownUid)
  );
}

export function extractActiveHiderLock(
  publicState: PublicGameState | null,
  presence: Record<string, Record<string, PresenceSession>>,
  members: Record<string, MemberRecord>
): HiderLoginLock | null {
  const sessionId = publicState?.sessionId;
  if (!sessionId) return null;

  let latest: HiderLoginLock | null = null;
  if (publicState?.hiderLock && publicState.hiderLock.sessionId === sessionId) {
    latest = { ...publicState.hiderLock };
  }

  for (const userSessions of Object.values(presence)) {
    const lockEntry = userSessions?.hider_pw_lock;
    if (
      lockEntry &&
      lockEntry.sessionId === sessionId &&
      lockEntry.passwordHash &&
      lockEntry.logoutGen
    ) {
      const candidateSetAt = lockEntry.lastSeen || 0;
      if (!latest || candidateSetAt >= latest.setAt) {
        latest = {
          sessionId,
          passwordHash: lockEntry.passwordHash,
          hiderPlayerIds: Array.isArray(lockEntry.hiderPlayerIds)
            ? [...lockEntry.hiderPlayerIds]
            : [],
          logoutGen: lockEntry.logoutGen,
          setAt: candidateSetAt,
        };
      }
    }
  }

  if (!latest) return null;

  const combinedHiderIds = new Set<string>(latest.hiderPlayerIds);
  for (const m of deduplicateEnabledMembers(members, presence)) {
    if (m.side === 'HIDER') {
      combinedHiderIds.add(m.playerId);
    }
  }

  return {
    ...latest,
    hiderPlayerIds: Array.from(combinedHiderIds),
  };
}

export function extractReadyPlayerIds(
  publicState: PublicGameState | null,
  activeHiderLock: HiderLoginLock | null,
  presence: Record<string, Record<string, PresenceSession>>
): string[] {
  if (!publicState || !activeHiderLock) return [];
  const expectedToken = buildReadyToken(
    publicState.sessionId,
    activeHiderLock.logoutGen
  );
  const readySet = new Set<string>();
  for (const userSessions of Object.values(presence)) {
    const readyEntry = userSessions?.ready_state;
    if (
      readyEntry &&
      readyEntry.readyToken === expectedToken &&
      readyEntry.playerId
    ) {
      readySet.add(readyEntry.playerId);
    }
  }
  return Array.from(readySet);
}

export function extractEmergencyMessages(
  presence: Record<string, Record<string, PresenceSession>>
): EmergencyMessage[] {
  const list: EmergencyMessage[] = [];
  for (const [uid, userSessions] of Object.entries(presence)) {
    const alert = userSessions?.emergency_alert;
    if (alert && typeof alert.emergencyText === 'string' && alert.emergencyText.trim()) {
      list.push({
        uid,
        playerId: alert.playerId ?? uid,
        senderName: alert.senderName ?? 'Spieler',
        text: alert.emergencyText.trim(),
        createdAt: alert.lastSeen || 0,
        lat:
          typeof alert.emergencyLat === 'number' && Number.isFinite(alert.emergencyLat)
            ? alert.emergencyLat
            : undefined,
        lng:
          typeof alert.emergencyLng === 'number' && Number.isFinite(alert.emergencyLng)
            ? alert.emergencyLng
            : undefined,
        accuracy:
          typeof alert.emergencyAccuracy === 'number' &&
          Number.isFinite(alert.emergencyAccuracy)
            ? alert.emergencyAccuracy
            : undefined,
      });
    }
  }
  return list.sort((a, b) => a.createdAt - b.createdAt);
}

export function extractRoundStartMeta(
  publicState: PublicGameState | null,
  presence: Record<string, Record<string, PresenceSession>>
): { gameStartTimestamp: number; activeTeamIds: string[] } | null {
  const sessionId = publicState?.sessionId;
  if (!sessionId) return null;
  let bestAt = -1;
  let result: { gameStartTimestamp: number; activeTeamIds: string[] } | null = null;
  for (const userSessions of Object.values(presence)) {
    const meta = userSessions?.round_start_meta;
    if (
      meta &&
      meta.sessionId === sessionId &&
      typeof meta.gameStartTimestamp === 'number'
    ) {
      const ts = meta.lastSeen || meta.gameStartTimestamp;
      if (ts > bestAt) {
        bestAt = ts;
        result = {
          gameStartTimestamp: meta.gameStartTimestamp,
          activeTeamIds: Array.isArray(meta.activeTeamIds)
            ? meta.activeTeamIds
            : TEAM_PALETTE.map((t) => t.id),
        };
      }
    }
  }
  return result;
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

    async fetchPlayerAssignment(playerId) {
      try {
        const snap = await get(ref(db, `${ROOT_PATH}/assignments/${playerId}`));
        if (!snap.exists()) return null;
        const val = snap.val() as { side?: MemberRecord['side']; teamId?: string | null };
        if (!val?.side) return null;
        return {
          side: val.side,
          teamId: val.side === 'SEEKER' ? (val.teamId ?? null) : null,
        };
      } catch {
        return null;
      }
    },

    async savePlayerAssignment(playerId, side, teamId): Promise<void> {
      try {
        await set(
          ref(db, `${ROOT_PATH}/assignments/${playerId}`),
          stripUndefinedDeep({
            side,
            teamId: side === 'SEEKER' ? (teamId ?? null) : null,
          })
        );
      } catch {
        // Ignorieren, falls ältere Firebase-Rules aktiv sind
      }
    },

    async removeMemberByHost(uid): Promise<void> {
      await remove(ref(db, `${ROOT_PATH}/members/${uid}`));
    },

    async kickPlayerByHost(playerId, memberUids): Promise<void> {
      for (const targetUid of memberUids) {
        await remove(ref(db, `${ROOT_PATH}/members/${targetUid}`)).catch(() => {});
        await remove(ref(db, `${ROOT_PATH}/joinRequests/${targetUid}`)).catch(() => {});
        // Entferne Sitzungen & Ready-Status, aber lasse eine etwaige Notfallnachricht des Spielers bestehen!
        const presSnap = await get(ref(db, `${ROOT_PATH}/presence/${targetUid}`)).catch(
          () => null
        );
        if (presSnap && presSnap.exists()) {
          const sessions = presSnap.val() as Record<string, PresenceSession>;
          for (const key of Object.keys(sessions)) {
            if (key !== 'emergency_alert') {
              await remove(
                ref(db, `${ROOT_PATH}/presence/${targetUid}/${key}`)
              ).catch(() => {});
            }
          }
        }
      }
      await remove(ref(db, `${ROOT_PATH}/playerClaims/${playerId}`)).catch(() => {});

      for (const palette of TEAM_PALETTE) {
        await runTransaction(
          ref(db, `${ROOT_PATH}/teams/${palette.id}/public`),
          (cur: TeamPublic | null) => {
            if (!cur) return cur;
            const list = Array.isArray(cur.memberPlayerIds)
              ? cur.memberPlayerIds.filter((pid) => pid !== playerId)
              : [];
            const nextBeacon =
              list.length === 0
                ? null
                : cur.beaconPlayerId && list.includes(cur.beaconPlayerId)
                  ? cur.beaconPlayerId
                  : list[0];
            return {
              ...cur,
              memberPlayerIds: list,
              beaconPlayerId: nextBeacon,
            };
          }
        ).catch(() => {});
      }
    },

    async tryAcquireOrRenewPlayerSeat(
      playerId,
      uid,
      tabId,
      nowMs
    ): Promise<{ acquired: boolean; holder: PlayerSeatClaim | null }> {
      // Mehrere Geräte pro Spieler sind ausdrücklich erlaubt.
      const claim: PlayerSeatClaim = { uid, tabId, heartbeatAt: nowMs };
      try {
        await set(ref(db, `${ROOT_PATH}/playerClaims/${playerId}`), claim);
      } catch {
        // Falls parallel ein anderes Gerät schreibt oder Rules greifen, Login dennoch erlauben
      }
      return {
        acquired: true,
        holder: claim,
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
      const presSnap = await get(
        ref(db, targetUid ? `${ROOT_PATH}/presence/${targetUid}` : `${ROOT_PATH}/presence`)
      ).catch(() => null);
      if (!presSnap || !presSnap.exists()) return;

      if (targetUid) {
        const sessions = presSnap.val() as Record<string, PresenceSession>;
        for (const key of Object.keys(sessions)) {
          if (key.startsWith('tab_')) {
            await remove(ref(db, `${ROOT_PATH}/presence/${targetUid}/${key}`)).catch(
              () => {}
            );
          }
        }
      } else {
        const all = presSnap.val() as Record<string, Record<string, PresenceSession>>;
        for (const [uid, sessions] of Object.entries(all)) {
          for (const key of Object.keys(sessions ?? {})) {
            if (key.startsWith('tab_')) {
              await remove(ref(db, `${ROOT_PATH}/presence/${uid}/${key}`)).catch(
                () => {}
              );
            }
          }
        }
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
        stripUndefinedDeep({ ...newPublicState, hiderLock: null })
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

    async setHiderPasswordAndTriggerLogout({
      uid,
      sessionId,
      cleanPassword,
      passwordHash,
      hiderPlayerIds,
      nowMs,
    }): Promise<HiderLoginLock> {
      const logoutGen = generateRandomId('pwlogout');
      const lock: HiderLoginLock = {
        sessionId,
        passwordHash,
        hiderPlayerIds,
        logoutGen,
        setAt: nowMs,
      };

      // 1. Speichere das Verstecker-Passwort als QR-Secret & Fang-Code in hiderPrivate
      await set(
        ref(db, `${ROOT_PATH}/state/hiderPrivate`),
        stripUndefinedDeep({
          anchorPoint: null,
          radarStages: [],
          qrSecret: cleanPassword,
          shortCode: cleanPassword,
        })
      );

      // 2. Schreibe Lock-Metadaten in presence (funktioniert sofort für jeden Hider) + optional in state/public/hiderLock
      await set(
        ref(db, `${ROOT_PATH}/presence/${uid}/hider_pw_lock`),
        stripUndefinedDeep({
          online: false,
          lastSeen: nowMs,
          kind: 'HIDER_PW_LOCK',
          sessionId,
          passwordHash,
          hiderPlayerIds,
          logoutGen,
        })
      );

      await set(
        ref(db, `${ROOT_PATH}/state/public/hiderLock`),
        stripUndefinedDeep(lock)
      ).catch(() => {});

      await remove(ref(db, `${ROOT_PATH}/presence/${uid}/ready_state`)).catch(
        () => {}
      );

      return lock;
    },

    async setPlayerReadyState(uid, playerId, readyToken, nowMs): Promise<void> {
      const readyRef = ref(db, `${ROOT_PATH}/presence/${uid}/ready_state`);
      if (!readyToken) {
        await remove(readyRef).catch(() => {});
        return;
      }
      await set(
        readyRef,
        stripUndefinedDeep({
          online: false,
          lastSeen: nowMs,
          kind: 'READY_STATE',
          playerId,
          readyToken,
        })
      );
    },

    async sendEmergencyMessage(msg): Promise<void> {
      const alertRef = ref(db, `${ROOT_PATH}/presence/${msg.uid}/emergency_alert`);
      await set(
        alertRef,
        stripUndefinedDeep({
          online: false,
          lastSeen: msg.createdAt,
          kind: 'EMERGENCY_ALERT',
          playerId: msg.playerId,
          senderName: msg.senderName,
          emergencyText: msg.text.trim(),
          emergencyLat:
            typeof msg.lat === 'number' && Number.isFinite(msg.lat)
              ? roundCoord5(msg.lat)
              : undefined,
          emergencyLng:
            typeof msg.lng === 'number' && Number.isFinite(msg.lng)
              ? roundCoord5(msg.lng)
              : undefined,
          emergencyAccuracy:
            typeof msg.accuracy === 'number' && Number.isFinite(msg.accuracy)
              ? Math.round(msg.accuracy)
              : undefined,
        })
      );
    },

    async clearOwnEmergencyMessage(uid): Promise<void> {
      await remove(ref(db, `${ROOT_PATH}/presence/${uid}/emergency_alert`));
    },

    async fetchLoginSecurityContext() {
      let pub: PublicGameState | null = null;
      let members: Record<string, MemberRecord> = {};
      let presence: Record<string, Record<string, PresenceSession>> = {};

      try {
        const pubSnap = await get(ref(db, `${ROOT_PATH}/state/public`));
        if (pubSnap.exists()) {
          pub = pubSnap.val() as PublicGameState;
        }
      } catch {
        // Falls vollständiger state/public noch nicht lesbar ist, versuche hiderLock direkt zu lesen
        try {
          const lockSnap = await get(ref(db, `${ROOT_PATH}/state/public/hiderLock`));
          if (lockSnap.exists()) {
            const hl = lockSnap.val() as HiderLoginLock;
            return {
              publicState: null,
              members: {},
              activeHiderLock: hl,
            };
          }
        } catch {
          // Ignorieren
        }
      }

      try {
        const memSnap = await get(ref(db, `${ROOT_PATH}/members`));
        if (memSnap.exists()) {
          const raw = memSnap.val() as Record<string, MemberRecord>;
          for (const [u, rec] of Object.entries(raw)) {
            members[u] = { ...rec, uid: u };
          }
        }
      } catch {
        // Ignorieren
      }

      try {
        const presSnap = await get(ref(db, `${ROOT_PATH}/presence`));
        if (presSnap.exists()) {
          presence = presSnap.val() as Record<string, Record<string, PresenceSession>>;
        }
      } catch {
        // Ignorieren
      }

      const activeHiderLock = extractActiveHiderLock(pub, presence, members);
      return {
        publicState: pub,
        members,
        activeHiderLock,
      };
    },

    async startRoundWhenAllReady({
      starterUid,
      publicState,
      enabledMembers,
      currentHiderPrivate,
      nowMs,
    }): Promise<void> {
      const nextTeams = createDefaultTeams();
      for (const m of enabledMembers) {
        if (m.enabled && m.side === 'SEEKER' && m.teamId && nextTeams[m.teamId]) {
          if (!nextTeams[m.teamId].memberPlayerIds.includes(m.playerId)) {
            nextTeams[m.teamId].memberPlayerIds.push(m.playerId);
          }
          nextTeams[m.teamId].beaconPlayerId =
            nextTeams[m.teamId].memberPlayerIds[0] ?? null;
        }
      }

      const occupiedTeamIds = Object.values(nextTeams)
        .filter((t) => t.memberPlayerIds.length > 0)
        .map((t) => t.id);

      const fallbackSecrets = generateSessionSecrets();
      const preservedSecret =
        currentHiderPrivate?.qrSecret?.trim() || fallbackSecrets.qrSecret;
      const preservedShortCode =
        currentHiderPrivate?.shortCode?.trim() || fallbackSecrets.shortCode;

      await set(
        ref(db, `${ROOT_PATH}/state/hiderPrivate`),
        stripUndefinedDeep({
          anchorPoint: null,
          radarStages: [],
          qrSecret: preservedSecret,
          shortCode: preservedShortCode,
        })
      );

      for (const [teamId, team] of Object.entries(nextTeams)) {
        await set(
          ref(db, `${ROOT_PATH}/teams/${teamId}/public`),
          stripUndefinedDeep(team)
        );
        await remove(ref(db, `${ROOT_PATH}/teams/${teamId}/location`)).catch(
          () => {}
        );
      }

      await remove(ref(db, `${ROOT_PATH}/leaderboard`)).catch(() => {});
      await remove(ref(db, `${ROOT_PATH}/clues`)).catch(() => {});
      await remove(ref(db, `${ROOT_PATH}/requests`)).catch(() => {});
      await remove(ref(db, `${ROOT_PATH}/catchRequests`)).catch(() => {});

      // Speichere Rundenstart-Metadaten parallel in presence (Fallback, falls ältere DB-Rules aktiv sind)
      await set(
        ref(db, `${ROOT_PATH}/presence/${starterUid}/round_start_meta`),
        stripUndefinedDeep({
          online: false,
          lastSeen: nowMs,
          kind: 'ROUND_START_META',
          sessionId: publicState.sessionId,
          gameStartTimestamp: nowMs,
          activeTeamIds: occupiedTeamIds,
        })
      );

      try {
        await update(ref(db, `${ROOT_PATH}/state/public`), {
          status: 'RUNNING',
          currentPhase: 'HIDING',
          gameStartTimestamp: nowMs,
          searchStartTimestamp: null,
          pausedAt: null,
          totalPausedMs: 0,
          pausedBeforeSearchMs: 0,
          anchorLocked: false,
          radarCircle: null,
          leashAlertActive: false,
          activeTeamIds: occupiedTeamIds,
        });
      } catch {
        // Fallback auf die strikt erlaubten Controller-Felder
        await update(ref(db, `${ROOT_PATH}/state/public`), {
          status: 'RUNNING',
          currentPhase: 'HIDING',
          searchStartTimestamp: null,
          pausedBeforeSearchMs: 0,
          anchorLocked: false,
          radarCircle: null,
          leashAlertActive: false,
        });
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
