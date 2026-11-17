import {
  onAuthStateChanged,
  signInAnonymously,
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
  createDefaultPublicState,
  createDefaultTeams,
  DEFAULT_PLAY_AREA_FEATURE,
  DEFAULT_RADAR_SCHEDULE,
  GAME_ID,
  isLegacyPlaceholderPlayArea,
  MEDIA_AUTO_EXPIRE_MS,
  MEDIA_POST_DOWNLOAD_EXPIRE_MS,
  OFFICIAL_81247_AREA_NAME,
  sanitizePlayAreaState,
  TEAM_MEMBER_FIX_MAX_AGE_MS,
  TEAM_MEMBER_LAST_ONLINE_WINDOW_MS,
  TEAM_PALETTE,
} from '../config/gameConfig';
import {
  computeAccountPasswordHash,
  isAdminAccountId,
  isOverviewMember,
  validateAccountPassword,
  validateAndNormalizeAccountName,
} from '../config/players';
import { getBrowserDemoStore } from '../demo/demoStore';
import { distanceMeters, roundCoord5 } from '../geo/distance';
import {
  generateRandomId,
  generateRoomCode,
  generateSessionSecrets,
  isValidRoomCode,
  normalizeRoomCode,
} from './qrService';
import type {
  AccountPublicRecord,
  ActiveLeashViolationInfo,
  AdminLobbyOverviewItem,
  AuthUserSummary,
  CatchRequest,
  CatchRequestStatus,
  ClueRecord,
  ClueRequest,
  ClueRequestStatus,
  ControllerLease,
  EmergencyMessage,
  GeoFix,
  HiderPrivateState,
  JoinRequest,
  LeaderboardEntry,
  LobbyDirectoryEntry,
  MemberRecord,
  PlayerAllTimeStats,
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

  getRoomCode(): string;
  setRoomCode(roomCode: string): void;
  createHostedRoom(params: {
    hostPlayerId: string;
    hostName: string;
    avatar?: string;
  }): Promise<{
    roomCode: string;
    member: MemberRecord;
    publicState: PublicGameState;
  }>;
  joinRoomByCode(params: {
    roomCode: string;
    playerId: string;
    playerName: string;
    avatar?: string;
  }): Promise<{
    roomCode: string;
    member: MemberRecord;
    publicState: PublicGameState;
  }>;
  addActiveTeamIdIfRunning(teamId: string): Promise<void>;

  getServerNow(): number;
  subscribeConnectionStatus(cb: (connected: boolean) => void): UnsubscribeFn;
  subscribeServerTimeOffset(cb: (offsetMs: number) => void): UnsubscribeFn;

  registerAccount(params: {
    name: string;
    password: string;
  }): Promise<{ user: AuthUserSummary; member: MemberRecord }>;
  loginWithAccount(params: {
    name: string;
    password: string;
  }): Promise<{ user: AuthUserSummary; member: MemberRecord }>;
  changeAccountPassword(params: {
    playerId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void>;
  fetchAccountProfile(playerId: string): Promise<AccountPublicRecord | null>;
  updateAccountProfile(
    playerId: string,
    patch: { avatar?: string; stats?: PlayerAllTimeStats }
  ): Promise<void>;
  subscribeAllAccounts(
    cb: (accounts: Record<string, AccountPublicRecord>) => void
  ): UnsubscribeFn;
  resetAccountPasswordByAdmin(
    playerId: string,
    newPassword: string
  ): Promise<void>;
  setAccountBlockedByAdmin(playerId: string, blocked: boolean): Promise<void>;
  deleteAccountByAdmin(playerId: string): Promise<void>;
  registerSelfMemberIfMissing(member: MemberRecord): Promise<void>;
  fetchPlayerAssignment(playerId: string): Promise<{ side: MemberRecord['side']; teamId: string | null } | null>;
  savePlayerAssignment(playerId: string, side: MemberRecord['side'], teamId: string | null): Promise<void>;
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
    defaultTeams: Record<string, TeamPublic>,
    defaultSecrets?: { qrSecret: string; shortCode: string }
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
  rerollHiderSecrets(): Promise<{ qrSecret: string; shortCode: string }>;
  writeHiderLocationPrivate(uid: string, fix: GeoFix): Promise<void>;

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
  markMediaDownloadedAndShortenExpiry(
    teamId: string,
    requestId: string,
    nowMs: number,
    postDownloadTtlMs?: number
  ): Promise<void>;
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
  undoClueByHost(teamId: string, clue: ClueRecord): Promise<void>;
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

  setPlayerReadyState(
    uid: string,
    playerId: string,
    readyToken: string | null,
    nowMs: number
  ): Promise<void>;

  sendEmergencyMessage(msg: EmergencyMessage): Promise<void>;
  clearOwnEmergencyMessage(uid: string): Promise<void>;

  setLeashViolationAlert(params: {
    uid: string;
    sessionId: string;
    alertStartedAt: number;
    exposeAt: number;
    violationReason?: ActiveLeashViolationInfo['violationReason'];
    exposedLat?: number;
    exposedLng?: number;
    exposedAccuracy?: number;
    nowMs: number;
  }): Promise<void>;
  clearLeashViolationAlert(uid: string): Promise<void>;

  startRoundWhenAllReady(params: {
    starterUid: string;
    publicState: PublicGameState;
    enabledMembers: MemberRecord[];
    currentHiderPrivate: HiderPrivateState | null;
    nowMs: number;
  }): Promise<void>;

  syncRoomDirectoryEntry(publicState: PublicGameState): Promise<void>;
  deleteLobbyRoom(roomCode: string): Promise<void>;
  pruneExpiredLobbies(nowMs?: number): Promise<string[]>;
  subscribeAllLobbiesOverview(
    cb: (lobbies: AdminLobbyOverviewItem[]) => void,
    hintRoomCodes?: string[]
  ): UnsubscribeFn;
  subscribePlayerHostedLobbies(
    playerId: string,
    cb: (lobbies: AdminLobbyOverviewItem[]) => void,
    hintRoomCodes?: string[]
  ): UnsubscribeFn;
}

export const LOBBY_INACTIVE_TTL_MS = 24 * 60 * 60 * 1000;

export function hasAnyOnlineTabInRoom(
  members: Record<string, MemberRecord>,
  presence: Record<string, Record<string, PresenceSession>>
): boolean {
  if (
    filterOnlineEnabledMembers(members, presence, undefined, {
      includeOverview: true,
    }).length > 0
  ) {
    return true;
  }
  return Object.values(presence).some((sessions) => isMemberTabOnline(sessions));
}

export function extractLatestLobbyActivityMs(params: {
  publicState?: PublicGameState | null;
  directoryEntry?: LobbyDirectoryEntry | null;
  members?: Record<string, MemberRecord>;
  presence?: Record<string, Record<string, PresenceSession>>;
}): number {
  const {
    publicState = null,
    directoryEntry = null,
    members = {},
    presence = {},
  } = params;
  let maxTs = Math.max(
    directoryEntry?.updatedAt ?? 0,
    directoryEntry?.createdAt ?? 0,
    publicState?.createdAt ?? 0,
    publicState?.gameStartTimestamp ?? 0,
    publicState?.searchStartTimestamp ?? 0
  );
  for (const m of Object.values(members)) {
    if (typeof m?.updatedAt === 'number' && m.updatedAt > maxTs) {
      maxTs = m.updatedAt;
    }
  }
  for (const userSessions of Object.values(presence)) {
    for (const sess of Object.values(userSessions ?? {})) {
      if (typeof sess?.lastSeen === 'number' && sess.lastSeen > maxTs) {
        maxTs = sess.lastSeen;
      }
    }
  }
  return maxTs;
}

export function isLobbyExpiredByInactivity(params: {
  onlineCount: number;
  hasAnyOnlineTab?: boolean;
  lastActivityAt: number;
  nowMs: number;
  ttlMs?: number;
}): boolean {
  const {
    onlineCount,
    hasAnyOnlineTab = false,
    lastActivityAt,
    nowMs,
    ttlMs = LOBBY_INACTIVE_TTL_MS,
  } = params;
  if (onlineCount > 0 || hasAnyOnlineTab) return false;
  if (!Number.isFinite(lastActivityAt) || lastActivityAt <= 0) return false;
  return nowMs - lastActivityAt >= ttlMs;
}

const ACCOUNTS_ROOT_PATH = `games/${GAME_ID}`;

function stripUndefinedDeep<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

export function buildReadyToken(sessionId: string): string {
  return sessionId;
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
      key !== 'round_start_meta' &&
      key !== 'leash_alert'
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

export function getPlayerLastTabSeenTimestamp(
  playerId: string,
  members: Record<string, MemberRecord>,
  presence: Record<string, Record<string, PresenceSession>>
): number {
  let maxSeen = 0;
  for (const m of Object.values(members)) {
    if (!m.enabled || m.playerId !== playerId) continue;
    const sessions = presence[m.uid];
    if (!sessions) continue;
    for (const [key, sess] of Object.entries(sessions)) {
      if (
        key === 'emergency_alert' ||
        key === 'ready_state' ||
        key === 'hider_pw_lock' ||
        key === 'round_start_meta' ||
        key === 'leash_alert'
      ) {
        continue;
      }
      if (typeof sess?.lastSeen === 'number' && sess.lastSeen > maxSeen) {
        maxSeen = sess.lastSeen;
      }
    }
  }
  return maxSeen;
}

export interface TeamMemberMapMarker {
  key: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  playerId: string;
  playerName: string;
  avatar?: string;
  lat: number;
  lng: number;
  accuracy: number;
  fixTimestamp: number;
  lastOnlineAt: number;
  isOnlineNow: boolean;
  isOwnPlayer: boolean;
  offsetPxX: number;
  offsetPxY: number;
}

/**
 * Ermittelt für jedes sichtbare Sucher-Team die darzustellenden Mitglieds-Positionen:
 * - Zeigt die letzte Position jedes Teammitglieds, sofern es in den letzten 20 Minuten online war.
 * - Fallen Mitglieder nach >20 Min. Offline-Zeit heraus, schrumpft die Anzeige bis nur noch 1 Position übrig ist.
 * - Diese letzte verbleibende Position des Teams bleibt sichtbar, bis eine neue Position aus diesem Team eintrifft.
 */
export function resolveVisibleTeamMemberMarkers(params: {
  visibleTeamLocations: Record<string, TeamLocation | null>;
  teamsPublic: Record<string, TeamPublic>;
  members: Record<string, MemberRecord>;
  presence: Record<string, Record<string, PresenceSession>>;
  activeTeamIds?: string[];
  ownMember?: MemberRecord | null;
  ownFix?: GeoFix | null;
  nowMs: number;
  onlineWindowMs?: number;
}): TeamMemberMapMarker[] {
  const {
    visibleTeamLocations,
    teamsPublic,
    members,
    presence,
    activeTeamIds,
    ownMember = null,
    ownFix = null,
    nowMs,
    onlineWindowMs = TEAM_MEMBER_LAST_ONLINE_WINDOW_MS,
  } = params;

  const activeSet = activeTeamIds ? new Set(activeTeamIds) : null;
  const deduped = deduplicateEnabledMembers(members, presence);
  const memberByPlayerId = new Map<string, MemberRecord>();
  const memberByUid = new Map<string, MemberRecord>();
  for (const m of Object.values(members)) {
    if (m.enabled && !isOverviewMember(m)) {
      memberByUid.set(m.uid, m);
    }
  }
  for (const m of deduped) {
    memberByPlayerId.set(m.playerId, m);
  }

  const markers: TeamMemberMapMarker[] = [];

  for (const [teamId, teamLoc] of Object.entries(visibleTeamLocations)) {
    if (activeSet && !activeSet.has(teamId)) continue;
    const pub = teamsPublic[teamId];
    if (
      !pub ||
      pub.status === 'JOINED_SARDINES' ||
      pub.memberPlayerIds.length === 0
    ) {
      continue;
    }

    // Sammle alle Spieler-IDs dieses Teams (sowohl aus teamsPublic als auch aus aktiven MemberRecords)
    const teamPlayerIdSet = new Set<string>(pub.memberPlayerIds);
    for (const m of deduped) {
      if (m.side === 'SEEKER' && m.teamId === teamId) {
        teamPlayerIdSet.add(m.playerId);
      }
    }

    const memberFixesMap = teamLoc?.memberFixes ?? {};
    const positionedCandidates: Array<Omit<TeamMemberMapMarker, 'offsetPxX' | 'offsetPxY'>> = [];

    for (const pid of teamPlayerIdSet) {
      const memberRec = memberByPlayerId.get(pid);
      const isOwnPlayer = Boolean(
        ownMember &&
          ownMember.side === 'SEEKER' &&
          ownMember.teamId === teamId &&
          ownMember.playerId === pid
      );

      let fix: GeoFix | null = memberFixesMap[pid] ?? null;
      if (isOwnPlayer && ownFix && Number.isFinite(ownFix.lat) && Number.isFinite(ownFix.lng)) {
        fix = {
          lat: ownFix.lat,
          lng: ownFix.lng,
          accuracy: ownFix.accuracy,
          timestamp: Math.max(ownFix.timestamp || 0, fix?.timestamp || 0, nowMs),
        };
      }

      if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) {
        continue;
      }

      const isOnlineNow = isPlayerOnline(
        pid,
        members,
        presence,
        ownMember?.uid
      );
      const lastTabSeen = getPlayerLastTabSeenTimestamp(pid, members, presence);
      const lastOnlineAt = isOnlineNow
        ? nowMs
        : Math.max(fix.timestamp || 0, lastTabSeen || 0);

      positionedCandidates.push({
        key: `${teamId}:${pid}`,
        teamId,
        teamName: pub.name,
        teamColor: pub.color,
        playerId: pid,
        playerName: memberRec?.name ?? pid,
        avatar: memberRec?.avatar,
        lat: fix.lat,
        lng: fix.lng,
        accuracy: fix.accuracy,
        fixTimestamp: fix.timestamp || 0,
        lastOnlineAt,
        isOnlineNow,
        isOwnPlayer,
      });
    }

    // Fallback für ältere TeamLocation-Einträge ohne memberFixes
    if (
      positionedCandidates.length === 0 &&
      teamLoc &&
      Number.isFinite(teamLoc.lat) &&
      Number.isFinite(teamLoc.lng)
    ) {
      const byUpdater = teamLoc.updatedByUid
        ? memberByUid.get(teamLoc.updatedByUid)
        : undefined;
      const fallbackPid =
        (byUpdater && teamPlayerIdSet.has(byUpdater.playerId)
          ? byUpdater.playerId
          : null) ??
        pub.beaconPlayerId ??
        pub.memberPlayerIds[0];
      if (fallbackPid) {
        const memberRec = memberByPlayerId.get(fallbackPid);
        const isOnlineNow = isPlayerOnline(
          fallbackPid,
          members,
          presence,
          ownMember?.uid
        );
        const lastTabSeen = getPlayerLastTabSeenTimestamp(
          fallbackPid,
          members,
          presence
        );
        const lastOnlineAt = isOnlineNow
          ? nowMs
          : Math.max(teamLoc.timestamp || 0, lastTabSeen || 0);
        positionedCandidates.push({
          key: `${teamId}:${fallbackPid}`,
          teamId,
          teamName: pub.name,
          teamColor: pub.color,
          playerId: fallbackPid,
          playerName: memberRec?.name ?? fallbackPid,
          avatar: memberRec?.avatar,
          lat: teamLoc.lat,
          lng: teamLoc.lng,
          accuracy: teamLoc.accuracy,
          fixTimestamp: teamLoc.timestamp || 0,
          lastOnlineAt,
          isOnlineNow,
          isOwnPlayer: Boolean(
            ownMember && ownMember.playerId === fallbackPid
          ),
        });
      }
    }

    if (positionedCandidates.length === 0) continue;

    // 20-Minuten-Regel mit „Mindestens-1-übrig“-Garantie:
    // Solange >= 1 Mitglied in den letzten 20 Min. online war (oder eine neue Position gesendet hat),
    // zeige alle diese aktiven/kürzlichen Mitglieder; andernfalls behalte genau die 1 neueste Position
    // des Teams bei, bis wieder eine neue Position aus diesem Team eintrifft.
    const recentCandidates = positionedCandidates.filter(
      (c) => c.isOnlineNow || nowMs - c.lastOnlineAt <= onlineWindowMs
    );

    let selectedForTeam: Array<Omit<TeamMemberMapMarker, 'offsetPxX' | 'offsetPxY'>>;
    if (recentCandidates.length >= 1) {
      selectedForTeam = recentCandidates.sort((a, b) =>
        a.playerName.localeCompare(b.playerName, 'de')
      );
    } else {
      const sortedByNewest = [...positionedCandidates].sort((a, b) => {
        if (b.fixTimestamp !== a.fixTimestamp) {
          return b.fixTimestamp - a.fixTimestamp;
        }
        if (b.lastOnlineAt !== a.lastOnlineAt) {
          return b.lastOnlineAt - a.lastOnlineAt;
        }
        return a.playerName.localeCompare(b.playerName, 'de');
      });
      selectedForTeam = [sortedByNewest[0]];
    }

    for (const item of selectedForTeam) {
      markers.push({
        ...item,
        offsetPxX: 0,
        offsetPxY: 0,
      });
    }
  }

  // Deterministischer Fächer-Versatz, falls mehrere Fische fast exakt am selben Ort (<= 10 m) stehen
  const assigned = new Set<number>();
  for (let i = 0; i < markers.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = [i];
    assigned.add(i);
    for (let j = i + 1; j < markers.length; j++) {
      if (assigned.has(j)) continue;
      if (distanceMeters(markers[i], markers[j]) <= 10) {
        cluster.push(j);
        assigned.add(j);
      }
    }
    if (cluster.length > 1) {
      const n = cluster.length;
      cluster.forEach((memberIdx, k) => {
        const centered = k - (n - 1) / 2;
        markers[memberIdx].offsetPxX = Math.round(centered * 34);
        markers[memberIdx].offsetPxY = n >= 3 && k % 2 === 1 ? -14 : 0;
      });
    }
  }

  return markers;
}

export function deduplicateEnabledMembers(
  members: Record<string, MemberRecord>,
  presence: Record<string, Record<string, PresenceSession>>,
  options?: { includeOverview?: boolean }
): MemberRecord[] {
  const deduped = new Map<string, MemberRecord>();
  for (const m of Object.values(members)) {
    if (!m.enabled) continue;
    if (!options?.includeOverview && isOverviewMember(m)) continue;
    const prev = deduped.get(m.playerId);
    if (!prev) {
      deduped.set(m.playerId, m);
      continue;
    }
    const mUpdated = m.updatedAt ?? 0;
    const prevUpdated = prev.updatedAt ?? 0;
    if (mUpdated !== prevUpdated) {
      if (mUpdated > prevUpdated) {
        deduped.set(m.playerId, m);
      }
      continue;
    }
    const mOnline = isMemberTabOnline(presence[m.uid]);
    const prevOnline = isMemberTabOnline(presence[prev.uid]);
    if (mOnline !== prevOnline) {
      if (mOnline) {
        deduped.set(m.playerId, m);
      }
      continue;
    }
    const mAssigned = m.side !== 'UNASSIGNED';
    const prevAssigned = prev.side !== 'UNASSIGNED';
    if (mAssigned && !prevAssigned) {
      deduped.set(m.playerId, m);
    }
  }
  return Array.from(deduped.values());
}

/**
 * Liefert vor dem Rundenstart ausschließlich die aktiv eingeloggten & online verbundenen Spieler.
 * Offline-Spieler sowie der Overview-Account blockieren dadurch weder die Gruppen noch den „Bereit“-Countdown.
 */
export function filterOnlineEnabledMembers(
  members: Record<string, MemberRecord>,
  presence: Record<string, Record<string, PresenceSession>>,
  ownUid?: string,
  options?: { includeOverview?: boolean }
): MemberRecord[] {
  const deduped = deduplicateEnabledMembers(members, presence, options);
  return deduped.filter((m) =>
    isPlayerOnline(m.playerId, members, presence, ownUid)
  );
}

/**
 * Liefert alle aktivierten Mitglieder des Verstecker-Teams (`side === 'HIDER'`),
 * unabhängig davon, ob sie aktuell online oder offline sind (exkl. Overview, Sucher & Unassigned).
 * Nur diese Spieler müssen sich in der Lobby bereitmachen.
 */
export function getRequiredReadyHiderMembers(
  members: Record<string, MemberRecord>,
  presence: Record<string, Record<string, PresenceSession>>
): MemberRecord[] {
  return deduplicateEnabledMembers(members, presence).filter(
    (m) => m.side === 'HIDER'
  );
}

export function buildDirectoryEntryFromPublicState(
  pub: PublicGameState,
  roomCodeFallback: string,
  nowMs: number
): LobbyDirectoryEntry {
  const code = normalizeRoomCode(pub.roomCode ?? roomCodeFallback) || GAME_ID;
  const safeStatus = pub.status === 'EMERGENCY_STOP' ? 'LOBBY' : pub.status;
  return {
    roomCode: code,
    hostPlayerId: pub.hostPlayerId ?? 'admin',
    hostName: pub.hostName ?? 'Admin',
    status: safeStatus,
    currentPhase: pub.currentPhase,
    gameMode: pub.gameMode === 'MANHUNT' ? 'MANHUNT' : 'CLASSIC',
    playAreaName: pub.playArea?.name ?? OFFICIAL_81247_AREA_NAME,
    createdAt: pub.createdAt ?? nowMs,
    updatedAt: nowMs,
  };
}

export function buildAdminLobbyOverviewItem(params: {
  roomCode: string;
  publicState: PublicGameState | null;
  directoryEntry?: LobbyDirectoryEntry | null;
  members?: Record<string, MemberRecord>;
  presence?: Record<string, Record<string, PresenceSession>>;
  teamsPublic?: Record<string, TeamPublic>;
}): AdminLobbyOverviewItem | null {
  const {
    roomCode,
    publicState,
    directoryEntry = null,
    members = {},
    presence = {},
    teamsPublic = {},
  } = params;

  if (!publicState && !directoryEntry) {
    return null;
  }

  const normalizedCode = normalizeRoomCode(roomCode) || GAME_ID;
  const rawStatus = publicState?.status ?? directoryEntry?.status ?? 'LOBBY';
  const status = rawStatus === 'EMERGENCY_STOP' ? 'LOBBY' : rawStatus;
  const currentPhase =
    publicState?.currentPhase ?? directoryEntry?.currentPhase ?? 'LOBBY';
  const gameMode =
    (publicState?.gameMode ?? directoryEntry?.gameMode) === 'MANHUNT'
      ? 'MANHUNT'
      : 'CLASSIC';
  const playAreaName =
    publicState?.playArea?.name ??
    directoryEntry?.playAreaName ??
    OFFICIAL_81247_AREA_NAME;
  const hostPlayerId =
    publicState?.hostPlayerId ?? directoryEntry?.hostPlayerId ?? 'admin';
  const hostName =
    publicState?.hostName ?? directoryEntry?.hostName ?? 'Admin';
  const createdAt = publicState?.createdAt ?? directoryEntry?.createdAt ?? 0;

  const enabledMembers = deduplicateEnabledMembers(members, presence);
  const onlineMembers = filterOnlineEnabledMembers(members, presence);
  const updatedAt = extractLatestLobbyActivityMs({
    publicState,
    directoryEntry,
    members,
    presence,
  });

  const hiderNames = enabledMembers
    .filter((m) => m.side === 'HIDER')
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b, 'de'));

  const seekerTeamSummaries = TEAM_PALETTE.map((palette) => {
    const assigned = enabledMembers.filter(
      (m) => m.side === 'SEEKER' && m.teamId === palette.id
    );
    return {
      id: palette.id,
      name: teamsPublic[palette.id]?.name ?? palette.name,
      color: teamsPublic[palette.id]?.color ?? palette.color,
      memberNames: assigned
        .map((m) => m.name)
        .sort((a, b) => a.localeCompare(b, 'de')),
    };
  }).filter((t) => t.memberNames.length > 0);

  const unassignedNames = enabledMembers
    .filter(
      (m) => m.side === 'UNASSIGNED' || (m.side === 'SEEKER' && !m.teamId)
    )
    .map((m) => m.name)
    .sort((a, b) => a.localeCompare(b, 'de'));

  return {
    roomCode: normalizedCode,
    hostPlayerId,
    hostName,
    status,
    currentPhase,
    gameMode,
    playAreaName,
    createdAt,
    updatedAt,
    memberCount: enabledMembers.length,
    onlineCount: onlineMembers.length,
    hiderNames,
    seekerTeamSummaries,
    unassignedNames,
  };
}

export function sortAdminLobbyOverviews(
  items: AdminLobbyOverviewItem[]
): AdminLobbyOverviewItem[] {
  const statusRank = (status: AdminLobbyOverviewItem['status']): number => {
    if (status === 'RUNNING' || status === 'PAUSED') return 0;
    if (status === 'LOBBY') return 1;
    return 2;
  };
  return [...items].sort((a, b) => {
    const rankDiff = statusRank(a.status) - statusRank(b.status);
    if (rankDiff !== 0) return rankDiff;
    if (b.onlineCount !== a.onlineCount) {
      return b.onlineCount - a.onlineCount;
    }
    const timeDiff = (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt);
    if (timeDiff !== 0) return timeDiff;
    if (a.roomCode === GAME_ID) return -1;
    if (b.roomCode === GAME_ID) return 1;
    return a.roomCode.localeCompare(b.roomCode, 'de');
  });
}

export function extractActiveLeashViolation(
  publicState: PublicGameState | null,
  presence: Record<string, Record<string, PresenceSession>>
): ActiveLeashViolationInfo | null {
  const sessionId = publicState?.sessionId;
  if (!sessionId || !publicState?.leashAlertActive) return null;

  let best: ActiveLeashViolationInfo | null = null;
  for (const [uid, userSessions] of Object.entries(presence)) {
    const entry = userSessions?.leash_alert;
    if (
      entry &&
      entry.sessionId === sessionId &&
      typeof entry.leashAlertStartedAt === 'number' &&
      typeof entry.leashExposeAt === 'number'
    ) {
      if (!best || (entry.lastSeen || 0) >= best.alertStartedAt) {
        best = {
          uid,
          sessionId,
          alertStartedAt: entry.leashAlertStartedAt,
          exposeAt: entry.leashExposeAt,
          violationReason: entry.leashViolationReason,
          exposedLat:
            typeof entry.exposedHiderLat === 'number' &&
            Number.isFinite(entry.exposedHiderLat)
              ? entry.exposedHiderLat
              : undefined,
          exposedLng:
            typeof entry.exposedHiderLng === 'number' &&
            Number.isFinite(entry.exposedHiderLng)
              ? entry.exposedHiderLng
              : undefined,
          exposedAccuracy:
            typeof entry.exposedHiderAccuracy === 'number' &&
            Number.isFinite(entry.exposedHiderAccuracy)
              ? entry.exposedHiderAccuracy
              : undefined,
        };
      }
    }
  }
  return best;
}

export function extractReadyPlayerIds(
  publicState: PublicGameState | null,
  presence: Record<string, Record<string, PresenceSession>>
): string[] {
  if (!publicState) return [];
  const sessionId = publicState.sessionId;
  const legacyPrefix = `${sessionId}:`;
  const readySet = new Set<string>();
  for (const userSessions of Object.values(presence)) {
    const readyEntry = userSessions?.ready_state;
    if (
      readyEntry &&
      typeof readyEntry.readyToken === 'string' &&
      (readyEntry.readyToken === sessionId ||
        readyEntry.readyToken.startsWith(legacyPrefix)) &&
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
): {
  gameStartTimestamp: number;
  activeTeamIds: string[];
  gameMode?: PublicGameState['gameMode'];
  classicSearchDurationMs?: number;
  manhuntShrinkDurationMs?: number;
  radarSchedule?: PublicGameState['radarSchedule'];
} | null {
  const sessionId = publicState?.sessionId;
  if (!sessionId) return null;
  let bestAt = -1;
  let result: {
    gameStartTimestamp: number;
    activeTeamIds: string[];
    gameMode?: PublicGameState['gameMode'];
    classicSearchDurationMs?: number;
    manhuntShrinkDurationMs?: number;
    radarSchedule?: PublicGameState['radarSchedule'];
  } | null = null;
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
          gameMode: meta.gameMode === 'MANHUNT' ? 'MANHUNT' : meta.gameMode === 'CLASSIC' ? 'CLASSIC' : undefined,
          classicSearchDurationMs:
            typeof meta.classicSearchDurationMs === 'number'
              ? meta.classicSearchDurationMs
              : undefined,
          manhuntShrinkDurationMs:
            typeof meta.manhuntShrinkDurationMs === 'number'
              ? meta.manhuntShrinkDurationMs
              : undefined,
          radarSchedule: meta.radarSchedule,
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
  const retainedMemberFixes: Record<string, GeoFix> = {};
  const MAX_ROUND_RETENTION_MS = 24 * 60 * 60_000;

  // Bewahre die letzte Position jedes Teammitglieds der Runde in memberFixes auf,
  // damit die 20-Minuten-Online-Regel & der Letzte-Position-Fallback auf der Karte exakt greifen.
  for (const [pid, oldFix] of Object.entries(prevFixes)) {
    if (oldFix && nowMs - oldFix.timestamp <= MAX_ROUND_RETENTION_MS) {
      retainedMemberFixes[pid] = oldFix;
    }
  }

  const freshEntry: GeoFix = {
    lat: roundCoord5(fix.lat),
    lng: roundCoord5(fix.lng),
    accuracy: Math.round(fix.accuracy),
    timestamp: nowMs,
  };
  retainedMemberFixes[playerId] = freshEntry;

  // Für die Durchschnitts-Koordinate des Teams zählen weiterhin nur frische Fixes (<= 5 Min.)
  const freshForAverage = Object.values(retainedMemberFixes).filter(
    (f) => nowMs - f.timestamp <= TEAM_MEMBER_FIX_MAX_AGE_MS
  );
  const activeList =
    freshForAverage.length > 0 ? freshForAverage : [freshEntry];
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
    memberFixes: retainedMemberFixes,
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
  let currentRoomCode: string = GAME_ID;
  const getRoomRootPath = (): string => `games/${currentRoomCode}`;

  const writeRoomDirectoryBestEffort = async (
    pubState: PublicGameState,
    explicitRoomCode?: string
  ): Promise<void> => {
    const code = normalizeRoomCode(
      explicitRoomCode ?? pubState.roomCode ?? currentRoomCode
    );
    if (!isValidRoomCode(code)) return;
    const entry = buildDirectoryEntryFromPublicState(
      pubState,
      code,
      adapter.getServerNow()
    );
    const hostId = (entry.hostPlayerId ?? '').trim().toLowerCase();
    await Promise.all([
      set(
        ref(db, `${ACCOUNTS_ROOT_PATH}/roomDirectory/${code}`),
        stripUndefinedDeep(entry)
      ).catch(() => {}),
      hostId && code !== GAME_ID
        ? set(
            ref(
              db,
              `${ACCOUNTS_ROOT_PATH}/accounts/${hostId}/hostedRoomCodes/${code}`
            ),
            true
          ).catch(() => {})
        : Promise.resolve(),
    ]);
  };

  // Initialer Listener auf Server-Zeitoffset
  onValue(ref(db, '.info/serverTimeOffset'), (snap) => {
    const val = snap.val();
    if (typeof val === 'number') {
      serverTimeOffsetMs = val;
    }
  });

  const adapter: DatabaseAdapter = {
    mode: 'firebase',

    getRoomCode(): string {
      return currentRoomCode;
    },

    setRoomCode(roomCode: string): void {
      const normalized = normalizeRoomCode(roomCode);
      currentRoomCode = isValidRoomCode(normalized) ? normalized : GAME_ID;
    },

    async createHostedRoom({
      hostPlayerId,
      hostName,
      avatar,
    }): Promise<{
      roomCode: string;
      member: MemberRecord;
      publicState: PublicGameState;
    }> {
      const normalizedHostId = hostPlayerId.trim().toLowerCase();
      if (!normalizedHostId) {
        throw new Error('Ungültiges Spielerkonto für Spielleiter.');
      }

      const activeUser =
        auth.currentUser ?? (await signInAnonymously(auth)).user;
      const uid = activeUser.uid;
      const nowMs = adapter.getServerNow();

      let roomCode = generateRoomCode(6);
      for (let attempt = 0; attempt < 6; attempt++) {
        const candidate = generateRoomCode(6);
        const existingSnap = await get(
          ref(db, `games/${candidate}/state/public`)
        ).catch(() => null);
        if (!existingSnap || !existingSnap.exists()) {
          roomCode = candidate;
          break;
        }
      }

      const sessionId = generateRandomId('session');
      const secrets = generateSessionSecrets();
      const canonicalHostName = isAdminAccountId(normalizedHostId)
        ? 'Admin'
        : hostName.trim() || normalizedHostId;

      const pubState: PublicGameState = {
        ...createDefaultPublicState(sessionId),
        roomCode,
        hostPlayerId: normalizedHostId,
        hostName: canonicalHostName,
        createdAt: nowMs,
      };

      try {
        await set(
          ref(db, `games/${roomCode}/state/public`),
          stripUndefinedDeep(pubState)
        );
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        if (rawMsg.toLowerCase().includes('permission')) {
          throw new Error(
            'Spielraum konnte nicht erstellt werden. Bitte prüfe, ob die aktualisierten database.rules.json veröffentlicht sind, oder melde dich kurz neu an.'
          );
        }
        throw new Error(
          'Spielraum konnte nicht erstellt werden. Bitte prüfe deine Internetverbindung.'
        );
      }

      const member: MemberRecord = {
        uid,
        playerId: normalizedHostId,
        name: canonicalHostName,
        isHost: true,
        enabled: true,
        side: 'UNASSIGNED',
        teamId: null,
        ...(avatar ? { avatar } : {}),
        updatedAt: nowMs,
      };

      await set(
        ref(db, `games/${roomCode}/members/${uid}`),
        stripUndefinedDeep(member)
      );

      await set(
        ref(db, `games/${roomCode}/state/hiderPrivate`),
        stripUndefinedDeep({
          anchorPoint: null,
          radarStages: [],
          qrSecret: secrets.qrSecret,
          shortCode: secrets.shortCode,
          hiderLocations: {},
        })
      );

      const defaultTeams = createDefaultTeams();
      await Promise.all(
        Object.entries(defaultTeams).map(([teamId, team]) =>
          set(
            ref(db, `games/${roomCode}/teams/${teamId}/public`),
            stripUndefinedDeep(team)
          )
        )
      );

      currentRoomCode = roomCode;
      void writeRoomDirectoryBestEffort(pubState, roomCode);
      return {
        roomCode,
        member,
        publicState: pubState,
      };
    },

    async joinRoomByCode({
      roomCode: rawCode,
      playerId,
      playerName,
      avatar,
    }): Promise<{
      roomCode: string;
      member: MemberRecord;
      publicState: PublicGameState;
    }> {
      const roomCode = normalizeRoomCode(rawCode);
      if (!isValidRoomCode(roomCode)) {
        throw new Error(
          'Bitte gib einen gültigen Spiel-Code ein (z. B. 6 Zeichen wie K7M4P2).'
        );
      }

      const normalizedPlayerId = playerId.trim().toLowerCase();
      if (!normalizedPlayerId) {
        throw new Error('Bitte melde dich zuerst mit deinem Konto an.');
      }

      const activeUser =
        auth.currentUser ?? (await signInAnonymously(auth)).user;
      const uid = activeUser.uid;
      const nowMs = adapter.getServerNow();
      const isAdmin = isAdminAccountId(normalizedPlayerId);

      let pubSnap = await get(ref(db, `games/${roomCode}/state/public`)).catch(
        () => null
      );

      // Klassischer Raum 81247 darf vom Admin initial angelegt werden, falls noch leer
      if ((!pubSnap || !pubSnap.exists()) && roomCode === GAME_ID && isAdmin) {
        const initSessionId = generateRandomId('session');
        const initSecrets = generateSessionSecrets();
        const initPub: PublicGameState = {
          ...createDefaultPublicState(initSessionId),
          roomCode: GAME_ID,
          hostPlayerId: 'admin',
          hostName: 'Admin',
          createdAt: nowMs,
        };
        await set(
          ref(db, `games/${roomCode}/state/public`),
          stripUndefinedDeep(initPub)
        );
        const initMember: MemberRecord = {
          uid,
          playerId: 'admin',
          name: 'Admin',
          isHost: true,
          enabled: true,
          side: 'UNASSIGNED',
          teamId: null,
          ...(avatar ? { avatar } : {}),
          updatedAt: nowMs,
        };
        await set(
          ref(db, `games/${roomCode}/members/${uid}`),
          stripUndefinedDeep(initMember)
        );
        await set(
          ref(db, `games/${roomCode}/state/hiderPrivate`),
          stripUndefinedDeep({
            anchorPoint: null,
            radarStages: [],
            qrSecret: initSecrets.qrSecret,
            shortCode: initSecrets.shortCode,
            hiderLocations: {},
          })
        );
        const defaultTeams = createDefaultTeams();
        await Promise.all(
          Object.entries(defaultTeams).map(([teamId, team]) =>
            set(
              ref(db, `games/${roomCode}/teams/${teamId}/public`),
              stripUndefinedDeep(team)
            )
          )
        );
        currentRoomCode = roomCode;
        void writeRoomDirectoryBestEffort(initPub, roomCode);
        return {
          roomCode,
          member: initMember,
          publicState: initPub,
        };
      }

      if (!pubSnap || !pubSnap.exists()) {
        throw new Error(
          `Kein Spiel mit dem Code „${roomCode}“ gefunden. Bitte prüfe den Code.`
        );
      }

      const pubVal = pubSnap.val() as PublicGameState;

      if (roomCode !== GAME_ID) {
        const [dirSnap, membersSnap, presenceSnap] = await Promise.all([
          get(ref(db, `${ACCOUNTS_ROOT_PATH}/roomDirectory/${roomCode}`)).catch(
            () => null
          ),
          get(ref(db, `games/${roomCode}/members`)).catch(() => null),
          get(ref(db, `games/${roomCode}/presence`)).catch(() => null),
        ]);
        const dirEntry = dirSnap?.exists()
          ? (dirSnap.val() as LobbyDirectoryEntry)
          : null;
        const roomMembers =
          (membersSnap?.val() as Record<string, MemberRecord> | null) ?? {};
        const roomPresence =
          (presenceSnap?.val() as Record<
            string,
            Record<string, PresenceSession>
          > | null) ?? {};
        const onlineCount = filterOnlineEnabledMembers(
          roomMembers,
          roomPresence
        ).length;
        const hasOnline = hasAnyOnlineTabInRoom(roomMembers, roomPresence);
        const lastActivityAt = extractLatestLobbyActivityMs({
          publicState: pubVal,
          directoryEntry: dirEntry,
          members: roomMembers,
          presence: roomPresence,
        });
        if (
          isLobbyExpiredByInactivity({
            onlineCount,
            hasAnyOnlineTab: hasOnline,
            lastActivityAt,
            nowMs,
          })
        ) {
          await adapter.deleteLobbyRoom(roomCode).catch(() => {});
          throw new Error(
            `Der Spielraum „${roomCode}“ wurde automatisch gelöscht, da seit 24 Stunden niemand mehr online war.`
          );
        }
      }

      const shouldBeHost = Boolean(
        isAdmin ||
          (pubVal.hostPlayerId && pubVal.hostPlayerId === normalizedPlayerId)
      );

      const existingOwnSnap = await get(
        ref(db, `games/${roomCode}/members/${uid}`)
      ).catch(() => null);
      const existingOwn = existingOwnSnap?.exists()
        ? (existingOwnSnap.val() as MemberRecord)
        : null;

      let remoteAssignment: {
        side: MemberRecord['side'];
        teamId: string | null;
      } | null = null;
      if (!isAdmin) {
        const assignSnap = await get(
          ref(db, `games/${roomCode}/assignments/${normalizedPlayerId}`)
        ).catch(() => null);
        if (assignSnap?.exists()) {
          const val = assignSnap.val() as {
            side?: MemberRecord['side'];
            teamId?: string | null;
          };
          if (val?.side) {
            remoteAssignment = {
              side: val.side,
              teamId: val.side === 'SEEKER' ? (val.teamId ?? null) : null,
            };
          }
        }
      }

      const inheritedSide: MemberRecord['side'] = isAdmin
        ? 'UNASSIGNED'
        : remoteAssignment
          ? remoteAssignment.side
          : existingOwn && existingOwn.playerId === normalizedPlayerId
            ? existingOwn.side
            : 'UNASSIGNED';

      const inheritedTeamId =
        inheritedSide === 'SEEKER'
          ? (remoteAssignment?.teamId ??
            (existingOwn?.playerId === normalizedPlayerId
              ? existingOwn.teamId
              : null) ??
            null)
          : null;

      const inheritedAvatar =
        avatar ??
        (existingOwn?.playerId === normalizedPlayerId
          ? existingOwn.avatar
          : undefined);

      const member: MemberRecord = {
        uid,
        playerId: normalizedPlayerId,
        name: isAdmin ? 'Admin' : playerName.trim() || normalizedPlayerId,
        isHost: shouldBeHost,
        enabled: true,
        side: inheritedSide,
        teamId: inheritedTeamId,
        ...(inheritedAvatar ? { avatar: inheritedAvatar } : {}),
        updatedAt: nowMs,
      };

      try {
        await set(
          ref(db, `games/${roomCode}/members/${uid}`),
          stripUndefinedDeep(member)
        );
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        if (rawMsg.toLowerCase().includes('permission')) {
          throw new Error(
            'Beitritt zum Spielraum abgelehnt. Bitte melde dich kurz neu an oder prüfe die Firebase-Regeln.'
          );
        }
        throw new Error(
          'Beitritt zum Spielraum fehlgeschlagen. Bitte prüfe deine Internetverbindung.'
        );
      }

      currentRoomCode = roomCode;
      const mergedPublic: PublicGameState = {
        ...pubVal,
        roomCode: pubVal.roomCode ?? roomCode,
      };
      void writeRoomDirectoryBestEffort(mergedPublic, roomCode);
      return {
        roomCode,
        member,
        publicState: mergedPublic,
      };
    },

    async addActiveTeamIdIfRunning(teamId: string): Promise<void> {
      if (!teamId) return;
      await runTransaction(
        ref(db, `${getRoomRootPath()}/state/public/activeTeamIds`),
        (cur: string[] | null) => {
          const list = Array.isArray(cur) ? [...cur] : [];
          if (!list.includes(teamId)) {
            list.push(teamId);
          }
          return list;
        }
      ).catch(() => {});
    },

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

    async registerAccount({
      name,
      password,
    }): Promise<{ user: AuthUserSummary; member: MemberRecord }> {
      const nameCheck = validateAndNormalizeAccountName(name);
      if (!nameCheck.valid) {
        throw new Error(nameCheck.error);
      }
      const pwCheck = validateAccountPassword(password);
      if (!pwCheck.valid) {
        throw new Error(pwCheck.error);
      }

      if (!auth.currentUser) {
        await signInAnonymously(auth);
      }

      const { playerId, displayName, isAdmin } = nameCheck;
      const acctRef = ref(db, `${ACCOUNTS_ROOT_PATH}/accounts/${playerId}`);
      const existingAcctSnap = await get(acctRef);
      if (existingAcctSnap.exists()) {
        const existingVal = existingAcctSnap.val() as Partial<AccountPublicRecord> | null;
        if (existingVal?.blocked) {
          throw new Error('Dieses Konto wurde vom Administrator gesperrt.');
        }
        throw new Error(
          'Dieser Benutzername ist bereits vergeben. Bitte melde dich mit deinem Passwort an.'
        );
      }

      // Falls das aktuelle Gerät zuvor mit einem anderen Spielerkonto eingeloggt war, frische UID holen
      if (auth.currentUser) {
        const curAuthSnap = await get(
          ref(db, `${ACCOUNTS_ROOT_PATH}/memberAuth/${auth.currentUser.uid}`)
        ).catch(() => null);
        const curMemSnap = await get(
          ref(db, `${getRoomRootPath()}/members/${auth.currentUser.uid}`)
        ).catch(() => null);
        const prevPlayerId =
          (curAuthSnap?.exists()
            ? (curAuthSnap.val() as { playerId?: string } | null)?.playerId
            : undefined) ??
          (curMemSnap?.exists()
            ? (curMemSnap.val() as MemberRecord | null)?.playerId
            : undefined);
        if (prevPlayerId && prevPlayerId !== playerId) {
          await firebaseSignOut(auth);
          await signInAnonymously(auth);
        }
      }

      const activeUser = auth.currentUser ?? (await signInAnonymously(auth)).user;
      const uid = activeUser.uid;
      const nowMs = adapter.getServerNow();
      const passwordHash = computeAccountPasswordHash(
        playerId,
        pwCheck.password
      );

      const accountRecord: AccountPublicRecord = {
        playerId,
        name: displayName,
        createdAt: nowMs,
      };

      try {
        await update(ref(db), {
          [`${ACCOUNTS_ROOT_PATH}/accounts/${playerId}`]: stripUndefinedDeep(accountRecord),
          [`${ACCOUNTS_ROOT_PATH}/accountSecrets/${playerId}`]: { passwordHash },
        });
      } catch (err) {
        const recheck = await get(acctRef).catch(() => null);
        if (recheck?.exists()) {
          throw new Error(
            'Dieser Benutzername ist bereits vergeben. Bitte melde dich mit deinem Passwort an.'
          );
        }
        const rawMsg = err instanceof Error ? err.message : String(err);
        if (rawMsg.toLowerCase().includes('permission')) {
          throw new Error(
            'Registrierung durch Datenbank abgelehnt. Bitte die aktualisierten database.rules.json in der Firebase Console veröffentlichen.'
          );
        }
        throw new Error(
          'Konto konnte nicht erstellt werden. Bitte prüfe deine Internetverbindung.'
        );
      }

      await set(ref(db, `${ACCOUNTS_ROOT_PATH}/memberAuth/${uid}`), {
        playerId,
        passwordHash,
        authenticatedAt: nowMs,
      });

      const pubSnap = await get(ref(db, `${getRoomRootPath()}/state/public`)).catch(
        () => null
      );
      const pubVal = pubSnap?.exists()
        ? (pubSnap.val() as PublicGameState)
        : null;
      const shouldBeHost = Boolean(
        isAdmin || (pubVal?.hostPlayerId && pubVal.hostPlayerId === playerId)
      );

      const remoteAssignment = isAdmin
        ? null
        : await adapter.fetchPlayerAssignment(playerId);
      const side: MemberRecord['side'] = isAdmin
        ? 'UNASSIGNED'
        : (remoteAssignment?.side ?? 'UNASSIGNED');
      const teamId =
        side === 'SEEKER' ? (remoteAssignment?.teamId ?? null) : null;

      const member: MemberRecord = {
        uid,
        playerId,
        name: displayName,
        isHost: shouldBeHost,
        enabled: true,
        side,
        teamId,
      };

      await set(
        ref(db, `${getRoomRootPath()}/members/${uid}`),
        stripUndefinedDeep(member)
      ).catch(() => {});

      return {
        user: { uid, email: activeUser.email ?? null },
        member,
      };
    },

    async loginWithAccount({
      name,
      password,
    }): Promise<{ user: AuthUserSummary; member: MemberRecord }> {
      const nameCheck = validateAndNormalizeAccountName(name);
      if (!nameCheck.valid) {
        throw new Error(nameCheck.error);
      }
      if (!password || !password.trim()) {
        throw new Error('Bitte gib dein Passwort ein.');
      }

      if (!auth.currentUser) {
        await signInAnonymously(auth);
      }

      const { playerId, displayName, isAdmin } = nameCheck;
      const acctSnap = await get(ref(db, `${ACCOUNTS_ROOT_PATH}/accounts/${playerId}`));
      if (!acctSnap.exists()) {
        throw new Error(
          'Dieses Konto existiert noch nicht. Wechsle auf „Konto erstellen“, um es neu anzulegen.'
        );
      }

      const acctVal = acctSnap.val() as Partial<AccountPublicRecord> | null;
      if (acctVal?.blocked && !isAdmin) {
        throw new Error('Dieses Konto wurde vom Administrator gesperrt.');
      }
      const canonicalName = isAdmin
        ? 'Admin'
        : acctVal?.name?.trim() || displayName;

      // Falls das Gerät aktuell mit einem anderen Spielerkonto verknüpft ist, frische UID anfordern
      if (auth.currentUser) {
        const curAuthSnap = await get(
          ref(db, `${ACCOUNTS_ROOT_PATH}/memberAuth/${auth.currentUser.uid}`)
        ).catch(() => null);
        const curMemSnap = await get(
          ref(db, `${getRoomRootPath()}/members/${auth.currentUser.uid}`)
        ).catch(() => null);
        const prevPlayerId =
          (curAuthSnap?.exists()
            ? (curAuthSnap.val() as { playerId?: string } | null)?.playerId
            : undefined) ??
          (curMemSnap?.exists()
            ? (curMemSnap.val() as MemberRecord | null)?.playerId
            : undefined);
        if (prevPlayerId && prevPlayerId !== playerId) {
          await firebaseSignOut(auth);
          await signInAnonymously(auth);
        }
      }

      const activeUser = auth.currentUser ?? (await signInAnonymously(auth)).user;
      const uid = activeUser.uid;
      const nowMs = adapter.getServerNow();
      const passwordHash = computeAccountPasswordHash(playerId, password);

      try {
        await set(ref(db, `${ACCOUNTS_ROOT_PATH}/memberAuth/${uid}`), {
          playerId,
          passwordHash,
          authenticatedAt: nowMs,
        });
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        if (rawMsg.toLowerCase().includes('permission')) {
          throw new Error('Falsches Passwort.');
        }
        throw new Error(
          'Anmeldung fehlgeschlagen. Bitte prüfe deine Internetverbindung.'
        );
      }

      const pubSnap = await get(ref(db, `${getRoomRootPath()}/state/public`)).catch(
        () => null
      );
      const pubVal = pubSnap?.exists()
        ? (pubSnap.val() as PublicGameState)
        : null;
      const shouldBeHost = Boolean(
        isAdmin || (pubVal?.hostPlayerId && pubVal.hostPlayerId === playerId)
      );

      const existingOwnSnap = await get(
        ref(db, `${getRoomRootPath()}/members/${uid}`)
      ).catch(() => null);
      const existingOwn = existingOwnSnap?.exists()
        ? (existingOwnSnap.val() as MemberRecord)
        : null;

      const remoteAssignment = isAdmin
        ? null
        : await adapter.fetchPlayerAssignment(playerId);

      const inheritedSide: MemberRecord['side'] = isAdmin
        ? 'UNASSIGNED'
        : remoteAssignment
          ? remoteAssignment.side
          : existingOwn && existingOwn.playerId === playerId
            ? existingOwn.side
            : 'UNASSIGNED';

      const inheritedTeamId =
        inheritedSide === 'SEEKER'
          ? (remoteAssignment?.teamId ??
            (existingOwn?.playerId === playerId ? existingOwn.teamId : null) ??
            null)
          : null;

      const inheritedAvatar =
        acctVal?.avatar ??
        (existingOwn?.playerId === playerId ? existingOwn.avatar : undefined);

      const member: MemberRecord = {
        uid,
        playerId,
        name: canonicalName,
        isHost: shouldBeHost,
        enabled: true,
        side: inheritedSide,
        teamId: inheritedTeamId,
        ...(inheritedAvatar ? { avatar: inheritedAvatar } : {}),
        updatedAt: nowMs,
      };

      await set(
        ref(db, `${getRoomRootPath()}/members/${uid}`),
        stripUndefinedDeep(member)
      ).catch(() => {});

      return {
        user: { uid, email: activeUser.email ?? null },
        member,
      };
    },

    async changeAccountPassword({
      playerId,
      currentPassword,
      newPassword,
    }): Promise<void> {
      const normalizedId = playerId.trim().toLowerCase();
      if (!normalizedId) {
        throw new Error('Ungültige Konto-ID.');
      }
      if (!currentPassword || !currentPassword.trim()) {
        throw new Error('Bitte gib dein aktuelles Passwort ein.');
      }
      const pwCheck = validateAccountPassword(newPassword);
      if (!pwCheck.valid) {
        throw new Error(pwCheck.error);
      }
      if (!auth.currentUser) {
        throw new Error('Nicht angemeldet. Bitte melde dich erneut an.');
      }

      const uid = auth.currentUser.uid;
      const nowMs = adapter.getServerNow();
      const currentHash = computeAccountPasswordHash(
        normalizedId,
        currentPassword
      );
      const nextHash = computeAccountPasswordHash(
        normalizedId,
        pwCheck.password
      );

      // 1. Aktuelles Passwort gegen /accountSecrets/$playerId/passwordHash prüfen
      try {
        await set(ref(db, `${ACCOUNTS_ROOT_PATH}/memberAuth/${uid}`), {
          playerId: normalizedId,
          passwordHash: currentHash,
          authenticatedAt: nowMs,
        });
      } catch (err) {
        const rawMsg = err instanceof Error ? err.message : String(err);
        if (rawMsg.toLowerCase().includes('permission')) {
          throw new Error('Das aktuelle Passwort ist nicht korrekt.');
        }
        throw new Error(
          'Passwort konnte nicht geprüft werden. Bitte prüfe deine Internetverbindung.'
        );
      }

      // 2. Neues Passwort-Secret schreiben & memberAuth aktualisieren
      await set(ref(db, `${ACCOUNTS_ROOT_PATH}/accountSecrets/${normalizedId}`), {
        passwordHash: nextHash,
      });
      await set(ref(db, `${ACCOUNTS_ROOT_PATH}/memberAuth/${uid}`), {
        playerId: normalizedId,
        passwordHash: nextHash,
        authenticatedAt: nowMs,
      });
    },

    async fetchAccountProfile(playerId): Promise<AccountPublicRecord | null> {
      const normalizedId = playerId.trim().toLowerCase();
      if (!normalizedId) return null;
      try {
        const snap = await get(ref(db, `${ACCOUNTS_ROOT_PATH}/accounts/${normalizedId}`));
        if (!snap.exists()) return null;
        return snap.val() as AccountPublicRecord;
      } catch {
        return null;
      }
    },

    async updateAccountProfile(playerId, patch): Promise<void> {
      const normalizedId = playerId.trim().toLowerCase();
      if (!normalizedId) return;
      try {
        const acctRef = ref(db, `${ACCOUNTS_ROOT_PATH}/accounts/${normalizedId}`);
        const snap = await get(acctRef);
        const existing = snap.exists()
          ? (snap.val() as AccountPublicRecord)
          : null;
        const next: AccountPublicRecord = {
          playerId: normalizedId,
          name: existing?.name ?? normalizedId,
          createdAt: existing?.createdAt ?? adapter.getServerNow(),
          ...(existing?.avatar ? { avatar: existing.avatar } : {}),
          ...(existing?.stats ? { stats: existing.stats } : {}),
          ...(existing?.blocked ? { blocked: existing.blocked } : {}),
          ...(existing?.blockedAt ? { blockedAt: existing.blockedAt } : {}),
          ...(existing?.hostedRoomCodes
            ? { hostedRoomCodes: existing.hostedRoomCodes }
            : {}),
        };
        if (patch.avatar !== undefined) {
          if (patch.avatar) {
            next.avatar = patch.avatar;
          } else {
            delete next.avatar;
          }
        }
        if (patch.stats !== undefined) {
          next.stats = patch.stats;
        }
        await set(acctRef, stripUndefinedDeep(next));
      } catch {
        // Offline oder ältere DB-Rules ignorieren
      }
    },

    subscribeAllAccounts(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${ACCOUNTS_ROOT_PATH}/accounts`),
        (snap) => {
          const val = (snap.val() ?? {}) as Record<string, AccountPublicRecord>;
          cb(val);
        },
        () => {
          cb({});
        }
      );
    },

    async resetAccountPasswordByAdmin(playerId, newPassword): Promise<void> {
      const normalizedId = playerId.trim().toLowerCase();
      if (!normalizedId) {
        throw new Error('Ungültige Konto-ID.');
      }
      const pwCheck = validateAccountPassword(newPassword);
      if (!pwCheck.valid) {
        throw new Error(pwCheck.error);
      }
      const acctSnap = await get(
        ref(db, `${ACCOUNTS_ROOT_PATH}/accounts/${normalizedId}`)
      );
      if (!acctSnap.exists()) {
        throw new Error('Dieses Konto existiert nicht.');
      }
      const nextHash = computeAccountPasswordHash(
        normalizedId,
        pwCheck.password
      );
      await set(
        ref(db, `${ACCOUNTS_ROOT_PATH}/accountSecrets/${normalizedId}`),
        { passwordHash: nextHash }
      );
    },

    async setAccountBlockedByAdmin(playerId, blocked): Promise<void> {
      const normalizedId = playerId.trim().toLowerCase();
      if (!normalizedId) {
        throw new Error('Ungültige Konto-ID.');
      }
      if (isAdminAccountId(normalizedId)) {
        throw new Error('Das Admin-Konto kann nicht gesperrt werden.');
      }
      const acctRef = ref(db, `${ACCOUNTS_ROOT_PATH}/accounts/${normalizedId}`);
      const snap = await get(acctRef);
      if (!snap.exists()) {
        throw new Error('Dieses Konto existiert nicht.');
      }
      const existing = snap.val() as AccountPublicRecord;
      const nowMs = adapter.getServerNow();
      const next: AccountPublicRecord = {
        ...existing,
        playerId: normalizedId,
      };
      if (blocked) {
        next.blocked = true;
        next.blockedAt = nowMs;
      } else {
        delete next.blocked;
        delete next.blockedAt;
      }
      await set(acctRef, stripUndefinedDeep(next));

      if (blocked) {
        await remove(
          ref(db, `${ACCOUNTS_ROOT_PATH}/playerClaims/${normalizedId}`)
        ).catch(() => {});
        const curMembersSnap = await get(
          ref(db, `${getRoomRootPath()}/members`)
        ).catch(() => null);
        const curMembers =
          (curMembersSnap?.val() as Record<string, MemberRecord> | null) ?? {};
        const matchingUids = Object.values(curMembers)
          .filter((m) => m.playerId === normalizedId)
          .map((m) => m.uid);
        if (matchingUids.length > 0) {
          await adapter
            .kickPlayerByHost(normalizedId, matchingUids)
            .catch(() => {});
        }
      }
    },

    async deleteAccountByAdmin(playerId): Promise<void> {
      const normalizedId = playerId.trim().toLowerCase();
      if (!normalizedId) {
        throw new Error('Ungültige Konto-ID.');
      }
      if (isAdminAccountId(normalizedId)) {
        throw new Error('Das Admin-Konto kann nicht gelöscht werden.');
      }
      const curMembersSnap = await get(
        ref(db, `${getRoomRootPath()}/members`)
      ).catch(() => null);
      const curMembers =
        (curMembersSnap?.val() as Record<string, MemberRecord> | null) ?? {};
      const matchingUids = Object.values(curMembers)
        .filter((m) => m.playerId === normalizedId)
        .map((m) => m.uid);
      if (matchingUids.length > 0) {
        await adapter
          .kickPlayerByHost(normalizedId, matchingUids)
          .catch(() => {});
      }

      await Promise.all([
        remove(ref(db, `${ACCOUNTS_ROOT_PATH}/accounts/${normalizedId}`)),
        remove(ref(db, `${ACCOUNTS_ROOT_PATH}/accountSecrets/${normalizedId}`)),
        remove(
          ref(db, `${ACCOUNTS_ROOT_PATH}/playerClaims/${normalizedId}`)
        ).catch(() => {}),
      ]);
    },

    async registerSelfMemberIfMissing(member): Promise<void> {
      const normalizedMember = {
        ...member,
        isHost: Boolean(member.isHost || isAdminAccountId(member.playerId)),
      };
      const memberRef = ref(
        db,
        `${getRoomRootPath()}/members/${normalizedMember.uid}`
      );
      const snap = await get(memberRef);
      if (!snap.exists()) {
        await set(memberRef, stripUndefinedDeep(normalizedMember));
      }
    },

    async fetchPlayerAssignment(playerId) {
      try {
        const snap = await get(ref(db, `${getRoomRootPath()}/assignments/${playerId}`));
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
          ref(db, `${getRoomRootPath()}/assignments/${playerId}`),
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
      await remove(ref(db, `${getRoomRootPath()}/members/${uid}`));
    },

    async kickPlayerByHost(playerId, memberUids): Promise<void> {
      for (const targetUid of memberUids) {
        await remove(ref(db, `${getRoomRootPath()}/members/${targetUid}`)).catch(() => {});
        await remove(ref(db, `${getRoomRootPath()}/joinRequests/${targetUid}`)).catch(() => {});
        // Entferne Sitzungen & Ready-Status, aber lasse eine etwaige Notfallnachricht des Spielers bestehen!
        const presSnap = await get(ref(db, `${getRoomRootPath()}/presence/${targetUid}`)).catch(
          () => null
        );
        if (presSnap && presSnap.exists()) {
          const sessions = presSnap.val() as Record<string, PresenceSession>;
          for (const key of Object.keys(sessions)) {
            if (key !== 'emergency_alert') {
              await remove(
                ref(db, `${getRoomRootPath()}/presence/${targetUid}/${key}`)
              ).catch(() => {});
            }
          }
        }
      }
      await remove(ref(db, `${getRoomRootPath()}/playerClaims/${playerId}`)).catch(() => {});

      for (const palette of TEAM_PALETTE) {
        await runTransaction(
          ref(db, `${getRoomRootPath()}/teams/${palette.id}/public`),
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
        await set(ref(db, `${getRoomRootPath()}/playerClaims/${playerId}`), claim);
      } catch {
        // Falls parallel ein anderes Gerät schreibt oder Rules greifen, Login dennoch erlauben
      }
      return {
        acquired: true,
        holder: claim,
      };
    },

    async releasePlayerSeat(playerId, uid): Promise<void> {
      const claimRef = ref(db, `${getRoomRootPath()}/playerClaims/${playerId}`);
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
        ref(db, `${getRoomRootPath()}/playerClaims/${playerId}`),
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
        ref(db, `${getRoomRootPath()}/members/${uid}`),
        (snap) => {
          const val = snap.val() as MemberRecord | null;
          cb(
            val
              ? ({
                  ...val,
                  uid,
                  isHost: Boolean(val.isHost || isAdminAccountId(val.playerId)),
                } as MemberRecord)
              : null
          );
        },
        () => cb(null)
      );
    },

    subscribeAllMembers(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${getRoomRootPath()}/members`),
        (snap) => {
          const raw = (snap.val() ?? {}) as Record<string, MemberRecord>;
          const mapped: Record<string, MemberRecord> = {};
          for (const [uid, rec] of Object.entries(raw)) {
            mapped[uid] = {
              ...rec,
              uid,
              isHost: Boolean(rec.isHost || isAdminAccountId(rec.playerId)),
            };
          }
          cb(mapped);
        },
        () => cb({})
      );
    },

    async upsertJoinRequest(req): Promise<void> {
      await set(
        ref(db, `${getRoomRootPath()}/joinRequests/${req.uid}`),
        stripUndefinedDeep(req)
      );
    },

    subscribeOwnJoinRequest(uid, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${getRoomRootPath()}/joinRequests/${uid}`),
        (snap) => cb((snap.val() as JoinRequest | null) ?? null),
        () => cb(null)
      );
    },

    subscribeAllJoinRequests(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${getRoomRootPath()}/joinRequests`),
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
      await set(ref(db, `${getRoomRootPath()}/members/${req.uid}`), stripUndefinedDeep(member));
      if (assignedTeam) {
        await runTransaction(
          ref(db, `${getRoomRootPath()}/teams/${assignedTeam}/public`),
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
      await remove(ref(db, `${getRoomRootPath()}/joinRequests/${req.uid}`));
    },

    async updateMember(uid, member): Promise<void> {
      const normalizedMember = {
        ...member,
        isHost: Boolean(member.isHost || isAdminAccountId(member.playerId)),
      };
      await set(
        ref(db, `${getRoomRootPath()}/members/${uid}`),
        stripUndefinedDeep(normalizedMember)
      );
    },

    registerTabPresence(uid, browserSessionId, deviceInfo): UnsubscribeFn {
      const sessionRef = ref(db, `${getRoomRootPath()}/presence/${uid}/${browserSessionId}`);
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
        ref(db, `${getRoomRootPath()}/presence`),
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
        ref(db, targetUid ? `${getRoomRootPath()}/presence/${targetUid}` : `${getRoomRootPath()}/presence`)
      ).catch(() => null);
      if (!presSnap || !presSnap.exists()) return;

      if (targetUid) {
        const sessions = presSnap.val() as Record<string, PresenceSession>;
        for (const key of Object.keys(sessions)) {
          if (key.startsWith('tab_')) {
            await remove(ref(db, `${getRoomRootPath()}/presence/${targetUid}/${key}`)).catch(
              () => {}
            );
          }
        }
      } else {
        const all = presSnap.val() as Record<string, Record<string, PresenceSession>>;
        for (const [uid, sessions] of Object.entries(all)) {
          for (const key of Object.keys(sessions ?? {})) {
            if (key.startsWith('tab_')) {
              await remove(ref(db, `${getRoomRootPath()}/presence/${uid}/${key}`)).catch(
                () => {}
              );
            }
          }
        }
      }
    },

    subscribePublicState(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${getRoomRootPath()}/state/public`),
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
            : sanitizePlayAreaState(val.playArea);

          const rawSched = val.radarSchedule;
          const normalizedSchedule = {
            hidingDurationMs:
              typeof rawSched?.hidingDurationMs === 'number' &&
              Number.isFinite(rawSched.hidingDurationMs)
                ? rawSched.hidingDurationMs
                : DEFAULT_RADAR_SCHEDULE.hidingDurationMs,
            stage1Ms:
              typeof rawSched?.stage1Ms === 'number' &&
              Number.isFinite(rawSched.stage1Ms)
                ? rawSched.stage1Ms
                : DEFAULT_RADAR_SCHEDULE.stage1Ms,
            stage2Ms:
              typeof rawSched?.stage2Ms === 'number' &&
              Number.isFinite(rawSched.stage2Ms)
                ? rawSched.stage2Ms
                : DEFAULT_RADAR_SCHEDULE.stage2Ms,
            stage3Ms:
              typeof rawSched?.stage3Ms === 'number' &&
              Number.isFinite(rawSched.stage3Ms)
                ? rawSched.stage3Ms
                : DEFAULT_RADAR_SCHEDULE.stage3Ms,
            stage4Ms:
              typeof rawSched?.stage4Ms === 'number' &&
              Number.isFinite(rawSched.stage4Ms)
                ? rawSched.stage4Ms
                : DEFAULT_RADAR_SCHEDULE.stage4Ms,
            stage5Ms:
              typeof rawSched?.stage5Ms === 'number' &&
              Number.isFinite(rawSched.stage5Ms)
                ? rawSched.stage5Ms
                : DEFAULT_RADAR_SCHEDULE.stage5Ms,
          };

          cb({
            ...val,
            roomCode: val.roomCode ?? currentRoomCode,
            gameMode: val.gameMode === 'MANHUNT' ? 'MANHUNT' : 'CLASSIC',
            classicSearchDurationMs: val.classicSearchDurationMs,
            manhuntShrinkDurationMs: val.manhuntShrinkDurationMs,
            radarSchedule: normalizedSchedule,
            status: val.status === 'EMERGENCY_STOP' ? 'LOBBY' : val.status,
            playArea: upgradedPlayArea,
            pausedAt: val.pausedAt ?? null,
            gameStartTimestamp: val.gameStartTimestamp ?? null,
            searchStartTimestamp: val.searchStartTimestamp ?? null,
            anchorLocked: Boolean(val.anchorLocked),
            radarCircle: val.radarCircle ?? null,
            emergencyStopReason: null,
            allowTestClicks: Boolean(val.allowTestClicks),
            leashAlertActive: Boolean(val.leashAlertActive),
            totalPausedMs: val.totalPausedMs ?? 0,
            pausedBeforeSearchMs: val.pausedBeforeSearchMs ?? 0,
            activeTeamIds:
              val.activeTeamIds ?? TEAM_PALETTE.map((t) => t.id),
          });
        },
        () => cb(null)
      );
    },

    async initializeDefaultLobbyIfNeeded(
      defaultState,
      defaultTeams,
      defaultSecrets
    ): Promise<void> {
      const stateSnap = await get(ref(db, `${getRoomRootPath()}/state/public`));
      if (!stateSnap.exists()) {
        const seeded = {
          ...defaultState,
          roomCode: defaultState.roomCode ?? currentRoomCode,
        };
        await set(
          ref(db, `${getRoomRootPath()}/state/public`),
          stripUndefinedDeep(seeded)
        );
        void writeRoomDirectoryBestEffort(seeded, currentRoomCode);
      } else {
        const existingPub = stateSnap.val() as PublicGameState;
        void writeRoomDirectoryBestEffort(existingPub, currentRoomCode);
      }
      if (defaultSecrets) {
        const privSnap = await get(ref(db, `${getRoomRootPath()}/state/hiderPrivate`)).catch(
          () => null
        );
        if (privSnap && !privSnap.exists()) {
          await set(
            ref(db, `${getRoomRootPath()}/state/hiderPrivate`),
            stripUndefinedDeep({
              anchorPoint: null,
              radarStages: [],
              qrSecret: defaultSecrets.qrSecret,
              shortCode: defaultSecrets.shortCode,
              hiderLocations: {},
            })
          );
        }
      }
      for (const [teamId, team] of Object.entries(defaultTeams)) {
        const teamSnap = await get(ref(db, `${getRoomRootPath()}/teams/${teamId}/public`));
        if (!teamSnap.exists()) {
          await set(
            ref(db, `${getRoomRootPath()}/teams/${teamId}/public`),
            stripUndefinedDeep(team)
          );
        }
      }
    },

    async savePublicStateByHost(state): Promise<void> {
      const normalized: PublicGameState = {
        ...state,
        roomCode: state.roomCode ?? currentRoomCode,
        anchorLocked: Boolean(state.anchorLocked),
        leashAlertActive: Boolean(state.leashAlertActive),
        allowTestClicks: Boolean(state.allowTestClicks),
      };
      await set(
        ref(db, `${getRoomRootPath()}/state/public`),
        stripUndefinedDeep(normalized)
      );
      void writeRoomDirectoryBestEffort(normalized, normalized.roomCode);
    },

    async patchControllerPublicTransition(patch): Promise<void> {
      const updates: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(patch)) {
        updates[`${getRoomRootPath()}/state/public/${key}`] =
          val === undefined ? null : stripUndefinedDeep(val);
      }
      await update(ref(db), updates);
      if (patch.status !== undefined || patch.currentPhase !== undefined) {
        void get(ref(db, `${getRoomRootPath()}/state/public`))
          .then((snap) => {
            if (snap.exists()) {
              return writeRoomDirectoryBestEffort(
                snap.val() as PublicGameState,
                currentRoomCode
              );
            }
          })
          .catch(() => {});
      }
    },

    subscribeControllerLease(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${getRoomRootPath()}/state/controller`),
        (snap) => cb((snap.val() as ControllerLease | null) ?? null),
        () => cb(null)
      );
    },

    async tryAcquireOrRenewLease(uid, sessionId, nowMs, ttlMs): Promise<boolean> {
      const tx = await runTransaction(
        ref(db, `${getRoomRootPath()}/state/controller`),
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
        ref(db, `${getRoomRootPath()}/state/hiderPrivate`),
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
            hiderLocations: val.hiderLocations ?? {},
          });
        },
        () => cb(null)
      );
    },

    async saveHiderPrivate(priv): Promise<void> {
      const payload: Record<string, unknown> = {
        anchorPoint: priv.anchorPoint ?? null,
        radarStages: stripUndefinedDeep(priv.radarStages ?? []),
        qrSecret: priv.qrSecret,
        shortCode: priv.shortCode,
      };
      if (priv.hiderLocations !== undefined) {
        payload.hiderLocations = stripUndefinedDeep(priv.hiderLocations);
      }
      await update(ref(db, `${getRoomRootPath()}/state/hiderPrivate`), payload);
    },

    async rerollHiderSecrets(): Promise<{ qrSecret: string; shortCode: string }> {
      const privRef = ref(db, `${getRoomRootPath()}/state/hiderPrivate`);
      const existingSnap = await get(privRef).catch(() => null);
      const existing = existingSnap?.exists()
        ? (existingSnap.val() as Partial<HiderPrivateState>)
        : null;

      let fresh = generateSessionSecrets();
      while (fresh.shortCode === existing?.shortCode) {
        fresh = generateSessionSecrets();
      }

      await set(
        privRef,
        stripUndefinedDeep({
          anchorPoint: existing?.anchorPoint ?? null,
          radarStages: existing?.radarStages ?? [],
          qrSecret: fresh.qrSecret,
          shortCode: fresh.shortCode,
          hiderLocations: existing?.hiderLocations ?? {},
        })
      );
      return fresh;
    },

    async writeHiderLocationPrivate(uid, fix): Promise<void> {
      await set(
        ref(db, `${getRoomRootPath()}/state/hiderPrivate/hiderLocations/${uid}`),
        stripUndefinedDeep(fix)
      );
    },

    subscribeTeamPublic(teamId, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${getRoomRootPath()}/teams/${teamId}/public`),
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
        ref(db, `${getRoomRootPath()}/teams/${teamId}/public`),
        stripUndefinedDeep(team)
      );
    },

    subscribeTeamLocation(teamId, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${getRoomRootPath()}/teams/${teamId}/location`),
        (snap) => cb((snap.val() as TeamLocation | null) ?? null),
        () => cb(null)
      );
    },

    async writeTeamLocation(teamId, loc): Promise<void> {
      await set(
        ref(db, `${getRoomRootPath()}/teams/${teamId}/location`),
        stripUndefinedDeep(loc)
      );
    },

    async writeTeamMemberFixAveraged(
      teamId,
      playerId,
      uid,
      fix
    ): Promise<TeamLocation | null> {
      const locRef = ref(db, `${getRoomRootPath()}/teams/${teamId}/location`);
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
      await remove(ref(db, `${getRoomRootPath()}/teams/${teamId}/location`));
    },

    subscribeTeamRequests(teamId, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${getRoomRootPath()}/requests/${teamId}`),
        (snap) => cb((snap.val() as Record<string, ClueRequest> | null) ?? {}),
        () => cb({})
      );
    },

    async createClueRequest(req): Promise<void> {
      await set(
        ref(db, `${getRoomRootPath()}/requests/${req.teamId}/${req.id}`),
        stripUndefinedDeep(req)
      );
    },

    async markMediaDownloadedAndShortenExpiry(
      teamId,
      requestId,
      nowMs,
      postDownloadTtlMs = MEDIA_POST_DOWNLOAD_EXPIRE_MS
    ): Promise<void> {
      const reqRef = ref(db, `${getRoomRootPath()}/requests/${teamId}/${requestId}`);
      await runTransaction(reqRef, (cur: ClueRequest | null) => {
        if (!cur || !cur.mediaBase64) return cur;
        const baseProcessedAt = cur.processedAt ?? cur.createdAt;
        const prevExpiresAt =
          cur.mediaExpiresAt ?? baseProcessedAt + MEDIA_AUTO_EXPIRE_MS;
        const shortenedExpiresAt = Math.min(
          prevExpiresAt,
          nowMs + postDownloadTtlMs
        );
        return stripUndefinedDeep({
          ...cur,
          mediaDownloadedAt: cur.mediaDownloadedAt ?? nowMs,
          mediaExpiresAt: shortenedExpiresAt,
        });
      });
    },

    async acknowledgeAndStripMedia(teamId, requestId, ackAt): Promise<void> {
      const reqRef = ref(db, `${getRoomRootPath()}/requests/${teamId}/${requestId}`);
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
        ref(db, `${getRoomRootPath()}/requests/${teamId}/${requestId}`),
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
        ref(db, `${getRoomRootPath()}/requests/${teamId}/${requestId}`),
        stripUndefinedDeep(req)
      );
    },

    async adjustTeamPenaltyAndClueCountAtomically(
      teamId,
      deltaPenaltyMs,
      deltaClueCount
    ): Promise<TeamPublic | null> {
      const tx = await runTransaction(
        ref(db, `${getRoomRootPath()}/teams/${teamId}/public`),
        (cur: TeamPublic | null) => {
          if (!cur) return cur;
          return {
            ...cur,
            penaltyMs: (cur.penaltyMs || 0) + deltaPenaltyMs,
            clueCount: Math.max(0, (cur.clueCount || 0) + deltaClueCount),
          };
        }
      );
      return (tx.snapshot.val() as TeamPublic | null) ?? null;
    },

    async saveClue(teamId, clue): Promise<void> {
      await set(
        ref(db, `${getRoomRootPath()}/clues/${teamId}/${clue.id}`),
        stripUndefinedDeep(clue)
      );
    },

    async undoClueByHost(teamId, clue): Promise<void> {
      const appliedNetPenaltyMs =
        clue.refundedMs && clue.refundedMs > 0
          ? Math.round(clue.refundedMs / 2) - clue.refundedMs
          : clue.penaltyMs || 0;

      await remove(ref(db, `${getRoomRootPath()}/clues/${teamId}/${clue.id}`));
      if (clue.requestId) {
        await remove(
          ref(db, `${getRoomRootPath()}/requests/${teamId}/${clue.requestId}`)
        ).catch(() => {});
      }

      await runTransaction(
        ref(db, `${getRoomRootPath()}/teams/${teamId}/public`),
        (cur: TeamPublic | null) => {
          if (!cur) return cur;
          return {
            ...cur,
            penaltyMs: (cur.penaltyMs || 0) - appliedNetPenaltyMs,
            clueCount: Math.max(0, (cur.clueCount || 0) - 1),
          };
        }
      );

      await runTransaction(
        ref(db, `${getRoomRootPath()}/leaderboard/${teamId}`),
        (cur: LeaderboardEntry | null) => {
          if (!cur) return cur;
          const nextPenaltyMs = (cur.penaltyMs || 0) - appliedNetPenaltyMs;
          return {
            ...cur,
            penaltyMs: nextPenaltyMs,
            totalTimeMs: (cur.searchTimeMs || 0) + nextPenaltyMs,
            clueCount: Math.max(0, (cur.clueCount || 0) - 1),
          };
        }
      ).catch(() => {});
    },

    subscribeTeamClues(teamId, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${getRoomRootPath()}/clues/${teamId}`),
        (snap) => cb((snap.val() as Record<string, ClueRecord> | null) ?? {}),
        () => cb({})
      );
    },

    async submitCatchRequest(req): Promise<void> {
      await set(
        ref(db, `${getRoomRootPath()}/catchRequests/${req.id}`),
        stripUndefinedDeep(req)
      );
    },

    subscribeAllCatchRequests(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${getRoomRootPath()}/catchRequests`),
        (snap) => cb((snap.val() as Record<string, CatchRequest> | null) ?? {}),
        () => cb({})
      );
    },

    subscribeOwnCatchRequest(requestId, cb): UnsubscribeFn {
      return onValue(
        ref(db, `${getRoomRootPath()}/catchRequests/${requestId}`),
        (snap) => cb((snap.val() as CatchRequest | null) ?? null),
        () => cb(null)
      );
    },

    async claimCatchRequest(requestId): Promise<CatchRequest | null> {
      const tx = await runTransaction(
        ref(db, `${getRoomRootPath()}/catchRequests/${requestId}`),
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
      await update(ref(db, `${getRoomRootPath()}/catchRequests/${requestId}`), updates);
    },

    async markTeamCaughtAtomically(
      teamId,
      catchTimestampMs
    ): Promise<{ transitioned: boolean; team: TeamPublic | null }> {
      let didTransition = false;
      const tx = await runTransaction(
        ref(db, `${getRoomRootPath()}/teams/${teamId}/public`),
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
        ref(db, `${getRoomRootPath()}/leaderboard/${entry.teamId}`),
        stripUndefinedDeep(entry)
      );
    },

    subscribeLeaderboard(cb): UnsubscribeFn {
      return onValue(
        ref(db, `${getRoomRootPath()}/leaderboard`),
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
      let existingHostFields: Partial<PublicGameState> = {};
      if (!newPublicState.hostPlayerId) {
        const prevSnap = await get(
          ref(db, `${getRoomRootPath()}/state/public`)
        ).catch(() => null);
        if (prevSnap?.exists()) {
          const prevVal = prevSnap.val() as PublicGameState;
          existingHostFields = {
            roomCode: prevVal.roomCode ?? currentRoomCode,
            hostPlayerId: prevVal.hostPlayerId,
            hostName: prevVal.hostName,
            createdAt: prevVal.createdAt,
          };
        }
      }
      const nextPublic: PublicGameState = {
        ...existingHostFields,
        ...newPublicState,
        roomCode:
          newPublicState.roomCode ??
          existingHostFields.roomCode ??
          currentRoomCode,
      };
      await set(
        ref(db, `${getRoomRootPath()}/state/public`),
        stripUndefinedDeep(nextPublic)
      );
      void writeRoomDirectoryBestEffort(nextPublic, nextPublic.roomCode);
      await remove(ref(db, `${getRoomRootPath()}/state/controller`));
      await set(
        ref(db, `${getRoomRootPath()}/state/hiderPrivate`),
        stripUndefinedDeep(newHiderPrivate)
      );
      await remove(ref(db, `${getRoomRootPath()}/clues`));
      await remove(ref(db, `${getRoomRootPath()}/requests`));
      await remove(ref(db, `${getRoomRootPath()}/catchRequests`));
      await remove(ref(db, `${getRoomRootPath()}/leaderboard`));
      for (const [teamId, team] of Object.entries(resetTeams)) {
        await set(
          ref(db, `${getRoomRootPath()}/teams/${teamId}/public`),
          stripUndefinedDeep(team)
        );
        await remove(ref(db, `${getRoomRootPath()}/teams/${teamId}/location`));
      }
    },

    async setPlayerReadyState(uid, playerId, readyToken, nowMs): Promise<void> {
      const readyRef = ref(db, `${getRoomRootPath()}/presence/${uid}/ready_state`);
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
      const alertRef = ref(db, `${getRoomRootPath()}/presence/${msg.uid}/emergency_alert`);
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
      await remove(ref(db, `${getRoomRootPath()}/presence/${uid}/emergency_alert`));
    },

    async setLeashViolationAlert({
      uid,
      sessionId,
      alertStartedAt,
      exposeAt,
      violationReason,
      exposedLat,
      exposedLng,
      exposedAccuracy,
      nowMs,
    }): Promise<void> {
      const leashRef = ref(db, `${getRoomRootPath()}/presence/${uid}/leash_alert`);
      await set(
        leashRef,
        stripUndefinedDeep({
          online: false,
          lastSeen: nowMs,
          kind: 'LEASH_ALERT',
          sessionId,
          leashAlertStartedAt: alertStartedAt,
          leashExposeAt: exposeAt,
          leashViolationReason: violationReason,
          exposedHiderLat:
            typeof exposedLat === 'number' && Number.isFinite(exposedLat)
              ? roundCoord5(exposedLat)
              : undefined,
          exposedHiderLng:
            typeof exposedLng === 'number' && Number.isFinite(exposedLng)
              ? roundCoord5(exposedLng)
              : undefined,
          exposedHiderAccuracy:
            typeof exposedAccuracy === 'number' && Number.isFinite(exposedAccuracy)
              ? Math.round(exposedAccuracy)
              : undefined,
        })
      );
    },

    async clearLeashViolationAlert(uid): Promise<void> {
      await remove(ref(db, `${getRoomRootPath()}/presence/${uid}/leash_alert`)).catch(
        () => {}
      );
    },

    async startRoundWhenAllReady({
      starterUid,
      publicState,
      enabledMembers,
      currentHiderPrivate,
      nowMs,
    }): Promise<void> {
      const nextTeams = createDefaultTeams();
      const existingTeamsSnap = await get(
        ref(db, `${getRoomRootPath()}/teams`)
      ).catch(() => null);
      const existingTeamsVal = existingTeamsSnap?.exists()
        ? (existingTeamsSnap.val() as Record<
            string,
            { public?: Partial<TeamPublic> }
          >)
        : null;
      if (existingTeamsVal) {
        for (const [id, team] of Object.entries(nextTeams)) {
          const existingName = existingTeamsVal[id]?.public?.name?.trim();
          if (existingName) {
            team.name = existingName;
          }
        }
      }
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
      const hasValidRandomSecrets = Boolean(
        currentHiderPrivate?.qrSecret &&
          /^[0-9a-f]{32}$/i.test(currentHiderPrivate.qrSecret) &&
          currentHiderPrivate?.shortCode?.length === 6
      );
      const preservedSecret = hasValidRandomSecrets
        ? currentHiderPrivate!.qrSecret
        : fallbackSecrets.qrSecret;
      const preservedShortCode = hasValidRandomSecrets
        ? currentHiderPrivate!.shortCode
        : fallbackSecrets.shortCode;

      await set(
        ref(db, `${getRoomRootPath()}/state/hiderPrivate`),
        stripUndefinedDeep({
          anchorPoint: null,
          radarStages: [],
          qrSecret: preservedSecret,
          shortCode: preservedShortCode,
          hiderLocations: {},
        })
      );

      for (const [teamId, team] of Object.entries(nextTeams)) {
        await set(
          ref(db, `${getRoomRootPath()}/teams/${teamId}/public`),
          stripUndefinedDeep(team)
        );
        await remove(ref(db, `${getRoomRootPath()}/teams/${teamId}/location`)).catch(
          () => {}
        );
      }

      await remove(ref(db, `${getRoomRootPath()}/leaderboard`)).catch(() => {});
      await remove(ref(db, `${getRoomRootPath()}/clues`)).catch(() => {});
      await remove(ref(db, `${getRoomRootPath()}/requests`)).catch(() => {});
      await remove(ref(db, `${getRoomRootPath()}/catchRequests`)).catch(() => {});

      // Speichere Rundenstart-Metadaten parallel in presence (Fallback, falls ältere DB-Rules aktiv sind)
      await set(
        ref(db, `${getRoomRootPath()}/presence/${starterUid}/round_start_meta`),
        stripUndefinedDeep({
          online: false,
          lastSeen: nowMs,
          kind: 'ROUND_START_META',
          sessionId: publicState.sessionId,
          gameStartTimestamp: nowMs,
          activeTeamIds: occupiedTeamIds,
          gameMode: publicState.gameMode === 'MANHUNT' ? 'MANHUNT' : 'CLASSIC',
          classicSearchDurationMs: publicState.classicSearchDurationMs,
          manhuntShrinkDurationMs: publicState.manhuntShrinkDurationMs,
          radarSchedule: publicState.radarSchedule,
        })
      );

      const immediateOpenSearch =
        (publicState.radarSchedule?.hidingDurationMs ?? 0) <= 0;
      const initialPhase = immediateOpenSearch ? 'OPEN_SEARCH' : 'HIDING';
      const initialSearchStart = immediateOpenSearch ? nowMs : null;

      try {
        await update(ref(db, `${getRoomRootPath()}/state/public`), {
          status: 'RUNNING',
          currentPhase: initialPhase,
          gameMode: publicState.gameMode === 'MANHUNT' ? 'MANHUNT' : 'CLASSIC',
          classicSearchDurationMs: publicState.classicSearchDurationMs ?? null,
          manhuntShrinkDurationMs: publicState.manhuntShrinkDurationMs ?? null,
          radarSchedule: stripUndefinedDeep(publicState.radarSchedule),
          gameStartTimestamp: nowMs,
          searchStartTimestamp: initialSearchStart,
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
        await update(ref(db, `${getRoomRootPath()}/state/public`), {
          status: 'RUNNING',
          currentPhase: initialPhase,
          searchStartTimestamp: initialSearchStart,
          pausedBeforeSearchMs: 0,
          anchorLocked: false,
          radarCircle: null,
          leashAlertActive: false,
        });
      }
      void writeRoomDirectoryBestEffort(
        {
          ...publicState,
          roomCode: publicState.roomCode ?? currentRoomCode,
          status: 'RUNNING',
          currentPhase: initialPhase,
          gameMode: publicState.gameMode === 'MANHUNT' ? 'MANHUNT' : 'CLASSIC',
        },
        currentRoomCode
      );
    },

    async syncRoomDirectoryEntry(publicState): Promise<void> {
      await writeRoomDirectoryBestEffort(publicState);
    },

    async deleteLobbyRoom(roomCode): Promise<void> {
      const code = normalizeRoomCode(roomCode);
      if (!isValidRoomCode(code)) return;
      const roomRoot = `games/${code}`;

      const pubSnap = await get(ref(db, `${roomRoot}/state/public`)).catch(
        () => null
      );
      const hostId = (
        (pubSnap?.val() as PublicGameState | null)?.hostPlayerId ?? ''
      )
        .trim()
        .toLowerCase();

      // 1. Zuerst alle untergeordneten Knoten löschen, solange members/$uid/isHost & state/public noch existieren
      const childPaths = [
        `${roomRoot}/state/controller`,
        `${roomRoot}/state/hiderPrivate`,
        `${roomRoot}/joinRequests`,
        `${roomRoot}/assignments`,
        `${roomRoot}/presence`,
        `${roomRoot}/clues`,
        `${roomRoot}/requests`,
        `${roomRoot}/catchRequests`,
        `${roomRoot}/leaderboard`,
        ...TEAM_PALETTE.flatMap((p) => [
          `${roomRoot}/teams/${p.id}/public`,
          `${roomRoot}/teams/${p.id}/location`,
        ]),
        `${ACCOUNTS_ROOT_PATH}/roomDirectory/${code}`,
        ...(hostId
          ? [
              `${ACCOUNTS_ROOT_PATH}/accounts/${hostId}/hostedRoomCodes/${code}`,
            ]
          : []),
      ];
      await Promise.all(
        childPaths.map((p) => remove(ref(db, p)).catch(() => {}))
      );

      // 2. Zum Schluss state/public und members entfernen
      await remove(ref(db, `${roomRoot}/state/public`)).catch(() => {});
      await remove(ref(db, `${roomRoot}/members`)).catch(() => {});
    },

    async pruneExpiredLobbies(nowMs = adapter.getServerNow()): Promise<string[]> {
      const dirSnap = await get(
        ref(db, `${ACCOUNTS_ROOT_PATH}/roomDirectory`)
      ).catch(() => null);
      const dirEntries =
        (dirSnap?.val() as Record<string, LobbyDirectoryEntry> | null) ?? {};
      const deleted: string[] = [];

      for (const [rawCode, dirEntry] of Object.entries(dirEntries)) {
        const code = normalizeRoomCode(rawCode);
        if (!isValidRoomCode(code) || code === GAME_ID) continue;
        const [pubSnap, membersSnap, presenceSnap] = await Promise.all([
          get(ref(db, `games/${code}/state/public`)).catch(() => null),
          get(ref(db, `games/${code}/members`)).catch(() => null),
          get(ref(db, `games/${code}/presence`)).catch(() => null),
        ]);
        const pubState = pubSnap?.exists()
          ? (pubSnap.val() as PublicGameState)
          : null;
        const members =
          (membersSnap?.val() as Record<string, MemberRecord> | null) ?? {};
        const presence =
          (presenceSnap?.val() as Record<
            string,
            Record<string, PresenceSession>
          > | null) ?? {};
        const onlineCount = filterOnlineEnabledMembers(members, presence).length;
        const hasOnline = hasAnyOnlineTabInRoom(members, presence);
        const lastActivityAt = extractLatestLobbyActivityMs({
          publicState: pubState,
          directoryEntry: dirEntry,
          members,
          presence,
        });
        if (
          isLobbyExpiredByInactivity({
            onlineCount,
            hasAnyOnlineTab: hasOnline,
            lastActivityAt,
            nowMs,
          })
        ) {
          await adapter.deleteLobbyRoom(code);
          deleted.push(code);
        }
      }
      return deleted;
    },

    subscribeAllLobbiesOverview(cb, hintRoomCodes = []): UnsubscribeFn {
      let disposed = false;
      let directoryEntries: Record<string, LobbyDirectoryEntry> = {};
      const prunedCodes = new Set<string>();

      interface RoomLiveRecord {
        publicLoaded: boolean;
        publicState: PublicGameState | null;
        members: Record<string, MemberRecord>;
        presence: Record<string, Record<string, PresenceSession>>;
        teamsPublic: Record<string, TeamPublic>;
        unsubs: UnsubscribeFn[];
      }

      const watchers = new Map<string, RoomLiveRecord>();

      const emit = () => {
        if (disposed) return;
        const nowMs = adapter.getServerNow();
        const items: AdminLobbyOverviewItem[] = [];
        for (const [code, rec] of watchers.entries()) {
          if (rec.publicLoaded && !rec.publicState) {
            continue;
          }
          const dirEntry = directoryEntries[code] ?? null;
          if (!rec.publicState && !dirEntry) {
            continue;
          }
          const built = buildAdminLobbyOverviewItem({
            roomCode: code,
            publicState: rec.publicState,
            directoryEntry: dirEntry,
            members: rec.members,
            presence: rec.presence,
            teamsPublic: rec.teamsPublic,
          });
          if (!built) continue;

          const hasOnline = hasAnyOnlineTabInRoom(rec.members, rec.presence);
          if (
            code !== GAME_ID &&
            isLobbyExpiredByInactivity({
              onlineCount: built.onlineCount,
              hasAnyOnlineTab: hasOnline,
              lastActivityAt: built.updatedAt || built.createdAt,
              nowMs,
            })
          ) {
            if (!prunedCodes.has(code)) {
              prunedCodes.add(code);
              void adapter.deleteLobbyRoom(code).catch(() => {});
            }
            continue;
          }
          items.push(built);
        }
        cb(sortAdminLobbyOverviews(items));
      };

      const ensureWatcherForCode = (rawCode: string) => {
        const code = normalizeRoomCode(rawCode);
        if (!isValidRoomCode(code) || watchers.has(code)) return;

        const rec: RoomLiveRecord = {
          publicLoaded: false,
          publicState: null,
          members: {},
          presence: {},
          teamsPublic: {},
          unsubs: [],
        };
        watchers.set(code, rec);

        rec.unsubs.push(
          onValue(
            ref(db, `games/${code}/state/public`),
            (snap) => {
              rec.publicLoaded = true;
              const val = snap.val() as PublicGameState | null;
              rec.publicState = val
                ? {
                    ...val,
                    roomCode: val.roomCode ?? code,
                    playArea: sanitizePlayAreaState(val.playArea),
                  }
                : null;
              emit();
            },
            () => {
              rec.publicLoaded = true;
              emit();
            }
          )
        );

        rec.unsubs.push(
          onValue(
            ref(db, `games/${code}/members`),
            (snap) => {
              const raw = (snap.val() ?? {}) as Record<string, MemberRecord>;
              const mapped: Record<string, MemberRecord> = {};
              for (const [uid, m] of Object.entries(raw)) {
                mapped[uid] = {
                  ...m,
                  uid,
                  isHost: Boolean(m.isHost || isAdminAccountId(m.playerId)),
                };
              }
              rec.members = mapped;
              emit();
            },
            () => {}
          )
        );

        rec.unsubs.push(
          onValue(
            ref(db, `games/${code}/presence`),
            (snap) => {
              rec.presence =
                (snap.val() as Record<string, Record<string, PresenceSession>> | null) ??
                {};
              emit();
            },
            () => {}
          )
        );

        for (const palette of TEAM_PALETTE) {
          rec.unsubs.push(
            onValue(
              ref(db, `games/${code}/teams/${palette.id}/public`),
              (snap) => {
                const tVal = snap.val() as TeamPublic | null;
                if (tVal) {
                  rec.teamsPublic = {
                    ...rec.teamsPublic,
                    [palette.id]: tVal,
                  };
                }
                emit();
              },
              () => {}
            )
          );
        }
      };

      const syncWatcherSet = () => {
        const wanted = new Set<string>([
          GAME_ID,
          ...Object.keys(directoryEntries)
            .map((k) => normalizeRoomCode(k))
            .filter(isValidRoomCode),
          ...hintRoomCodes.map((k) => normalizeRoomCode(k)).filter(isValidRoomCode),
        ]);

        for (const [existingCode, rec] of Array.from(watchers.entries())) {
          if (!wanted.has(existingCode)) {
            for (const u of rec.unsubs) u();
            watchers.delete(existingCode);
          }
        }
        for (const code of wanted) {
          ensureWatcherForCode(code);
        }
        emit();
      };

      syncWatcherSet();

      const unsubDir = onValue(
        ref(db, `${ACCOUNTS_ROOT_PATH}/roomDirectory`),
        (snap) => {
          directoryEntries =
            (snap.val() as Record<string, LobbyDirectoryEntry> | null) ?? {};
          syncWatcherSet();
        },
        () => {
          syncWatcherSet();
        }
      );

      return () => {
        disposed = true;
        unsubDir();
        for (const rec of watchers.values()) {
          for (const u of rec.unsubs) u();
        }
        watchers.clear();
      };
    },

    subscribePlayerHostedLobbies(
      playerId,
      cb,
      hintRoomCodes = []
    ): UnsubscribeFn {
      const normalizedPlayerId = playerId.trim().toLowerCase();
      if (!normalizedPlayerId) {
        cb([]);
        return () => {};
      }

      let disposed = false;
      let innerUnsub: UnsubscribeFn | null = null;
      let lastCodesKey = '';

      const rebuildInner = (accountCodes: string[]) => {
        if (disposed) return;
        const mergedHints = Array.from(
          new Set(
            [...hintRoomCodes, ...accountCodes]
              .map((c) => normalizeRoomCode(c))
              .filter(isValidRoomCode)
          )
        ).sort();
        const nextKey = mergedHints.join(',');
        if (innerUnsub && nextKey === lastCodesKey) {
          return;
        }
        lastCodesKey = nextKey;
        if (innerUnsub) {
          innerUnsub();
          innerUnsub = null;
        }
        innerUnsub = adapter.subscribeAllLobbiesOverview((allItems) => {
          if (disposed) return;
          const hosted = allItems.filter(
            (item) =>
              item.roomCode !== GAME_ID &&
              item.hostPlayerId.trim().toLowerCase() === normalizedPlayerId
          );
          cb(hosted);
        }, mergedHints);
      };

      rebuildInner([]);

      const unsubHostedRef = onValue(
        ref(
          db,
          `${ACCOUNTS_ROOT_PATH}/accounts/${normalizedPlayerId}/hostedRoomCodes`
        ),
        (snap) => {
          const val = (snap.val() ?? {}) as Record<string, boolean>;
          rebuildInner(Object.keys(val));
        },
        () => {
          rebuildInner([]);
        }
      );

      return () => {
        disposed = true;
        unsubHostedRef();
        if (innerUnsub) {
          innerUnsub();
          innerUnsub = null;
        }
      };
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
