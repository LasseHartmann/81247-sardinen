import {
  createDefaultPublicState,
  createDefaultTeams,
  MEDIA_AUTO_EXPIRE_MS,
  MEDIA_POST_DOWNLOAD_EXPIRE_MS,
} from '../config/gameConfig';
import { PRESET_PLAYERS } from '../config/players';
import { snapPointIntoPlayArea } from '../geo/boundary';
import { destinationPoint, roundLatLng5 } from '../geo/distance';
import {
  computeAveragedTeamLocationFromMemberFixes,
  extractActiveHiderLock,
  type ControllerPublicPatch,
  type DatabaseAdapter,
  type UnsubscribeFn,
} from '../services/databaseAdapter';
import { generateRandomId, generateSessionSecrets } from '../services/qrService';
import type {
  AuthUserSummary,
  CatchRequest,
  CatchRequestStatus,
  ClueRecord,
  ClueRequest,
  ControllerLease,
  DemoRoleId,
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

const DEMO_STORAGE_KEY = 'sardinen_81247_demo_tree_v3';
const DEMO_ROLE_SESSION_KEY = 'sardinen_81247_demo_role_v3';
const DEMO_BROADCAST_CHANNEL = 'sardinen_81247_demo';

export interface DemoDatabaseTree {
  clockOffsetMs: number;
  gpsSimActive: boolean;
  members: Record<string, MemberRecord>;
  playerClaims: Record<string, PlayerSeatClaim>;
  assignments?: Record<string, { side: MemberRecord['side']; teamId: string | null }>;
  joinRequests: Record<string, JoinRequest>;
  presence: Record<string, Record<string, PresenceSession>>;
  teams: Record<
    string,
    {
      public: TeamPublic;
      location: TeamLocation | null;
    }
  >;
  state: {
    public: PublicGameState;
    controller: ControllerLease | null;
    hiderPrivate: HiderPrivateState;
  };
  clues: Record<string, Record<string, ClueRecord>>;
  requests: Record<string, Record<string, ClueRequest>>;
  catchRequests: Record<string, CatchRequest>;
  leaderboard: Record<string, LeaderboardEntry>;
}

const DEMO_ROLE_TO_UID: Record<DemoRoleId, string> = {
  HOST: 'demo_uid_lasse',
  HIDER: 'demo_uid_linus',
  TEAM_1: 'demo_uid_thomas',
  TEAM_2: 'demo_uid_nick',
  TEAM_3: 'demo_uid_lorenzo',
  TEAM_4: 'demo_uid_max',
};

export function buildInitialDemoTree(nowMs = Date.now()): DemoDatabaseTree {
  const sessionId = generateRandomId('session');
  const secrets = generateSessionSecrets();
  const pubState = createDefaultPublicState(sessionId);
  pubState.playArea.confirmed = true;
  pubState.playArea.confirmedAt = nowMs;
  pubState.playArea.confirmedByUid = 'demo_uid_lasse';
  pubState.allowTestClicks = true;

  const baseTeams = createDefaultTeams();
  baseTeams['team-1'].memberPlayerIds = ['thomas', 'robert'];
  baseTeams['team-1'].beaconPlayerId = 'thomas';
  baseTeams['team-2'].memberPlayerIds = ['nick', 'eric', 'jonah'];
  baseTeams['team-2'].beaconPlayerId = 'nick';
  baseTeams['team-3'].memberPlayerIds = ['lorenzo', 'louis'];
  baseTeams['team-3'].beaconPlayerId = 'lorenzo';
  baseTeams['team-4'].memberPlayerIds = ['max', 'roman'];
  baseTeams['team-4'].beaconPlayerId = 'max';

  const members: Record<string, MemberRecord> = {
    demo_uid_lasse: {
      uid: 'demo_uid_lasse',
      playerId: 'lasse',
      name: 'Lasse',
      isHost: true,
      enabled: true,
      side: 'HIDER',
      teamId: null,
    },
    demo_uid_linus: {
      uid: 'demo_uid_linus',
      playerId: 'linus',
      name: 'Linus',
      isHost: true,
      enabled: true,
      side: 'HIDER',
      teamId: null,
    },
    demo_uid_thomas: {
      uid: 'demo_uid_thomas',
      playerId: 'thomas',
      name: 'Thomas',
      isHost: false,
      enabled: true,
      side: 'SEEKER',
      teamId: 'team-1',
    },
    demo_uid_robert: {
      uid: 'demo_uid_robert',
      playerId: 'robert',
      name: 'Robert',
      isHost: false,
      enabled: true,
      side: 'SEEKER',
      teamId: 'team-1',
    },
    demo_uid_nick: {
      uid: 'demo_uid_nick',
      playerId: 'nick',
      name: 'Nick',
      isHost: false,
      enabled: true,
      side: 'SEEKER',
      teamId: 'team-2',
    },
    demo_uid_eric: {
      uid: 'demo_uid_eric',
      playerId: 'eric',
      name: 'Eric',
      isHost: false,
      enabled: true,
      side: 'SEEKER',
      teamId: 'team-2',
    },
    demo_uid_jonah: {
      uid: 'demo_uid_jonah',
      playerId: 'jonah',
      name: 'Jonah',
      isHost: false,
      enabled: true,
      side: 'SEEKER',
      teamId: 'team-2',
    },
    demo_uid_lorenzo: {
      uid: 'demo_uid_lorenzo',
      playerId: 'lorenzo',
      name: 'Lorenzo',
      isHost: false,
      enabled: true,
      side: 'SEEKER',
      teamId: 'team-3',
    },
    demo_uid_louis: {
      uid: 'demo_uid_louis',
      playerId: 'louis',
      name: 'Louis',
      isHost: false,
      enabled: true,
      side: 'SEEKER',
      teamId: 'team-3',
    },
    demo_uid_max: {
      uid: 'demo_uid_max',
      playerId: 'max',
      name: 'Max',
      isHost: false,
      enabled: true,
      side: 'SEEKER',
      teamId: 'team-4',
    },
    demo_uid_roman: {
      uid: 'demo_uid_roman',
      playerId: 'roman',
      name: 'Roman',
      isHost: false,
      enabled: true,
      side: 'SEEKER',
      teamId: 'team-4',
    },
  };

  const initialLocations: Record<string, TeamLocation> = {
    'team-1': {
      lat: 48.1654,
      lng: 11.4682,
      accuracy: 8,
      timestamp: nowMs,
      updatedByUid: 'demo_uid_thomas',
    },
    'team-2': {
      lat: 48.1686,
      lng: 11.4659,
      accuracy: 9,
      timestamp: nowMs,
      updatedByUid: 'demo_uid_nick',
    },
    'team-3': {
      lat: 48.1647,
      lng: 11.4885,
      accuracy: 10,
      timestamp: nowMs,
      updatedByUid: 'demo_uid_lorenzo',
    },
    'team-4': {
      lat: 48.1586,
      lng: 11.4604,
      accuracy: 7,
      timestamp: nowMs,
      updatedByUid: 'demo_uid_max',
    },
  };

  const teamsTree: DemoDatabaseTree['teams'] = {};
  for (const [teamId, pub] of Object.entries(baseTeams)) {
    teamsTree[teamId] = {
      public: pub,
      location: initialLocations[teamId] ?? null,
    };
  }

  return {
    clockOffsetMs: 0,
    gpsSimActive: false,
    members,
    playerClaims: {},
    joinRequests: {},
    presence: {},
    teams: teamsTree,
    state: {
      public: pubState,
      controller: null,
      hiderPrivate: {
        anchorPoint: null,
        radarStages: [],
        qrSecret: secrets.qrSecret,
        shortCode: secrets.shortCode,
      },
    },
    clues: {},
    requests: {},
    catchRequests: {},
    leaderboard: {},
  };
}

export interface DemoControllerApi {
  adapter: DatabaseAdapter;
  getCurrentRole(): DemoRoleId;
  switchRole(role: DemoRoleId): void;
  advanceSimulatedTime(deltaMs: number): void;
  jumpToNetMinute(targetMinutes: number): void;
  isGpsSimulationEnabled(): boolean;
  setGpsSimulationEnabled(enabled: boolean): void;
  stepGpsSimulation(): void;
  resetEntireDemoStore(): void;
  getSnapshot(): DemoDatabaseTree;
}

export function createDemoStore(options?: {
  inMemoryOnly?: boolean;
  initialNowMs?: number;
}): DemoControllerApi {
  const inMemory = Boolean(options?.inMemoryOnly);
  let memoryTree: DemoDatabaseTree = buildInitialDemoTree(options?.initialNowMs);
  let currentRole: DemoRoleId = 'HOST';

  if (!inMemory && typeof sessionStorage !== 'undefined') {
    const savedRole = sessionStorage.getItem(DEMO_ROLE_SESSION_KEY) as DemoRoleId | null;
    if (savedRole && savedRole in DEMO_ROLE_TO_UID) {
      currentRole = savedRole;
    }
  }

  const listeners = new Set<() => void>();
  const authListeners = new Set<(user: AuthUserSummary | null) => void>();

  let channel: BroadcastChannel | null = null;
  if (!inMemory && typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(DEMO_BROADCAST_CHANNEL);
      channel.onmessage = () => {
        notifyAll();
      };
    } catch {
      channel = null;
    }
  }

  if (!inMemory && typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === DEMO_STORAGE_KEY) {
        notifyAll();
      }
    });
  }

  function readTree(): DemoDatabaseTree {
    if (inMemory || typeof localStorage === 'undefined') {
      return memoryTree;
    }
    try {
      const raw = localStorage.getItem(DEMO_STORAGE_KEY);
      if (!raw) {
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(memoryTree));
        return memoryTree;
      }
      const parsed = JSON.parse(raw) as DemoDatabaseTree;
      memoryTree = parsed;
      return parsed;
    } catch {
      return memoryTree;
    }
  }

  function writeTree(mutator: (draft: DemoDatabaseTree) => void): DemoDatabaseTree {
    const current = structuredClone(readTree());
    mutator(current);
    memoryTree = current;
    if (!inMemory && typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(current));
      } catch {
        // Speicherfehler ignorieren
      }
    }
    channel?.postMessage({ type: 'SYNC', at: Date.now() });
    notifyAll();
    return current;
  }

  function notifyAll(): void {
    for (const fn of listeners) {
      fn();
    }
  }

  function notifyAuth(): void {
    const user = getCurrentAuthUser();
    for (const fn of authListeners) {
      fn(user);
    }
  }

  function getCurrentAuthUser(): AuthUserSummary {
    const uid = DEMO_ROLE_TO_UID[currentRole];
    const tree = readTree();
    const member = tree.members[uid];
    const preset = PRESET_PLAYERS.find((p) => p.id === member?.playerId);
    return {
      uid,
      email: preset?.loginEmail ?? 'lasse@81247-sardinen.local',
    };
  }

  function subscribeSlice<T>(selector: (tree: DemoDatabaseTree) => T, cb: (val: T) => void): UnsubscribeFn {
    let lastJson = '';
    const emitIfChanged = () => {
      const nextVal = selector(readTree());
      const nextJson = JSON.stringify(nextVal);
      if (nextJson !== lastJson) {
        lastJson = nextJson;
        cb(structuredClone(nextVal));
      }
    };
    listeners.add(emitIfChanged);
    emitIfChanged();
    return () => {
      listeners.delete(emitIfChanged);
    };
  }

  const adapter: DatabaseAdapter = {
    mode: 'demo',

    getServerNow(): number {
      const tree = readTree();
      return Date.now() + (tree.clockOffsetMs || 0);
    },

    subscribeConnectionStatus(cb): UnsubscribeFn {
      cb(true);
      return () => {};
    },

    subscribeServerTimeOffset(cb): UnsubscribeFn {
      return subscribeSlice((t) => t.clockOffsetMs || 0, cb);
    },

    async signInWithPresetPlayer(loginEmail): Promise<AuthUserSummary> {
      const preset = PRESET_PLAYERS.find(
        (p) => p.loginEmail.toLowerCase() === loginEmail.toLowerCase()
      );
      if (preset) {
        if (preset.id === 'lasse') currentRole = 'HOST';
        else if (preset.id === 'linus') currentRole = 'HIDER';
        else if (preset.id === 'nick' || preset.id === 'eric' || preset.id === 'jonah') currentRole = 'TEAM_2';
        else if (preset.id === 'lorenzo' || preset.id === 'louis') currentRole = 'TEAM_3';
        else if (preset.id === 'max' || preset.id === 'roman') currentRole = 'TEAM_4';
        else currentRole = 'TEAM_1';
      }
      notifyAuth();
      return getCurrentAuthUser();
    },

    async registerSelfMemberIfMissing(member): Promise<void> {
      writeTree((t) => {
        if (!t.members[member.uid]) {
          t.members[member.uid] = structuredClone(member);
        }
      });
    },

    async claimInitialHostRole(uid, playerId, name): Promise<void> {
      writeTree((t) => {
        t.members[uid] = {
          uid,
          playerId,
          name,
          isHost: true,
          enabled: true,
          side: 'HIDER',
          teamId: null,
        };
        delete t.joinRequests[uid];
      });
    },

    async fetchPlayerAssignment(playerId) {
      const t = readTree();
      const fromMap = t.assignments?.[playerId];
      if (fromMap) return structuredClone(fromMap);
      const assignedMember = Object.values(t.members).find(
        (m) => m.enabled && m.playerId === playerId && m.side !== 'UNASSIGNED'
      );
      return assignedMember
        ? {
            side: assignedMember.side,
            teamId: assignedMember.side === 'SEEKER' ? (assignedMember.teamId ?? null) : null,
          }
        : null;
    },

    async savePlayerAssignment(playerId, side, teamId): Promise<void> {
      writeTree((t) => {
        if (!t.assignments) t.assignments = {};
        t.assignments[playerId] = {
          side,
          teamId: side === 'SEEKER' ? (teamId ?? null) : null,
        };
      });
    },

    async removeMemberByHost(uid): Promise<void> {
      writeTree((t) => {
        delete t.members[uid];
      });
    },

    async kickPlayerByHost(playerId, memberUids): Promise<void> {
      writeTree((t) => {
        for (const targetUid of memberUids) {
          delete t.members[targetUid];
          delete t.joinRequests?.[targetUid];
          if (t.presence?.[targetUid]) {
            for (const key of Object.keys(t.presence[targetUid])) {
              if (key !== 'emergency_alert') {
                delete t.presence[targetUid][key];
              }
            }
          }
        }
        for (const [uid, rec] of Object.entries(t.members)) {
          if (rec.playerId === playerId) {
            delete t.members[uid];
          }
        }
        if (t.playerClaims) {
          delete t.playerClaims[playerId];
        }
        for (const team of Object.values(t.teams)) {
          team.public.memberPlayerIds = team.public.memberPlayerIds.filter(
            (pid) => pid !== playerId
          );
          if (team.public.beaconPlayerId === playerId) {
            team.public.beaconPlayerId = team.public.memberPlayerIds[0] ?? null;
          }
        }
      });
    },

    async tryAcquireOrRenewPlayerSeat(
      playerId,
      uid,
      tabId,
      nowMs
    ): Promise<{ acquired: boolean; holder: PlayerSeatClaim | null }> {
      // Mehrere Geräte pro Spieler sind ausdrücklich erlaubt.
      const next: PlayerSeatClaim = { uid, tabId, heartbeatAt: nowMs };
      writeTree((t) => {
        if (!t.playerClaims) t.playerClaims = {};
        t.playerClaims[playerId] = next;
      });
      return { acquired: true, holder: next };
    },

    async releasePlayerSeat(playerId, uid): Promise<void> {
      writeTree((t) => {
        const cur = t.playerClaims?.[playerId];
        if (cur && cur.uid === uid) {
          delete t.playerClaims[playerId];
        }
      });
    },

    subscribePlayerSeat(playerId, cb): UnsubscribeFn {
      return subscribeSlice((t) => t.playerClaims?.[playerId] ?? null, cb);
    },

    async signOut(): Promise<void> {
      // Sitzung bleibt lokal im Demo-Modus
    },

    subscribeAuth(cb): UnsubscribeFn {
      authListeners.add(cb);
      cb(getCurrentAuthUser());
      return () => {
        authListeners.delete(cb);
      };
    },

    subscribeOwnMember(uid, cb): UnsubscribeFn {
      return subscribeSlice((t) => t.members[uid] ?? null, cb);
    },

    subscribeAllMembers(cb): UnsubscribeFn {
      return subscribeSlice((t) => t.members ?? {}, cb);
    },

    async upsertJoinRequest(req): Promise<void> {
      writeTree((t) => {
        t.joinRequests[req.uid] = structuredClone(req);
      });
    },

    subscribeOwnJoinRequest(uid, cb): UnsubscribeFn {
      return subscribeSlice((t) => t.joinRequests[uid] ?? null, cb);
    },

    subscribeAllJoinRequests(cb): UnsubscribeFn {
      return subscribeSlice((t) => t.joinRequests ?? {}, cb);
    },

    async approveJoinRequest(req, defaults): Promise<void> {
      writeTree((t) => {
        const assignedTeam = defaults?.teamId ?? 'team-2';
        const assignedSide = defaults?.side ?? 'SEEKER';
        t.members[req.uid] = {
          uid: req.uid,
          playerId: req.playerId,
          name: req.name,
          isHost: Boolean(defaults?.isHost),
          enabled: true,
          side: assignedSide,
          teamId: assignedSide === 'SEEKER' ? assignedTeam : null,
        };
        if (assignedSide === 'SEEKER' && assignedTeam && t.teams[assignedTeam]) {
          const membersList = t.teams[assignedTeam].public.memberPlayerIds;
          if (!membersList.includes(req.playerId)) {
            membersList.push(req.playerId);
          }
          if (!t.teams[assignedTeam].public.beaconPlayerId) {
            t.teams[assignedTeam].public.beaconPlayerId = req.playerId;
          }
        }
        delete t.joinRequests[req.uid];
      });
    },

    async updateMember(uid, member): Promise<void> {
      writeTree((t) => {
        t.members[uid] = structuredClone(member);
        for (const team of Object.values(t.teams)) {
          team.public.memberPlayerIds = team.public.memberPlayerIds.filter(
            (pid) => pid !== member.playerId
          );
          if (team.public.beaconPlayerId === member.playerId && member.teamId !== team.public.id) {
            team.public.beaconPlayerId = team.public.memberPlayerIds[0] ?? null;
          }
        }
        if (member.side === 'SEEKER' && member.teamId && t.teams[member.teamId]) {
          const list = t.teams[member.teamId].public.memberPlayerIds;
          if (!list.includes(member.playerId)) {
            list.push(member.playerId);
          }
          if (!t.teams[member.teamId].public.beaconPlayerId) {
            t.teams[member.teamId].public.beaconPlayerId = member.playerId;
          }
        }
      });
    },

    registerTabPresence(uid, browserSessionId, deviceInfo): UnsubscribeFn {
      writeTree((t) => {
        if (!t.presence[uid]) t.presence[uid] = {};
        t.presence[uid][browserSessionId] = {
          online: true,
          lastSeen: adapter.getServerNow(),
          deviceInfo,
        };
      });
      return () => {
        writeTree((t) => {
          if (t.presence[uid]) {
            delete t.presence[uid][browserSessionId];
            if (Object.keys(t.presence[uid]).length === 0) {
              delete t.presence[uid];
            }
          }
        });
      };
    },

    subscribePresence(cb): UnsubscribeFn {
      return subscribeSlice((t) => t.presence ?? {}, cb);
    },

    async cleanupOrphanedPresence(targetUid): Promise<void> {
      writeTree((t) => {
        if (targetUid) {
          if (t.presence[targetUid]) {
            for (const key of Object.keys(t.presence[targetUid])) {
              if (key.startsWith('tab_')) {
                delete t.presence[targetUid][key];
              }
            }
          }
        } else {
          for (const sessions of Object.values(t.presence)) {
            for (const key of Object.keys(sessions)) {
              if (key.startsWith('tab_')) {
                delete sessions[key];
              }
            }
          }
        }
      });
    },

    subscribePublicState(cb): UnsubscribeFn {
      return subscribeSlice((t) => t.state.public, cb);
    },

    async initializeDefaultLobbyIfNeeded(defaultState, defaultTeams): Promise<void> {
      writeTree((t) => {
        if (!t.state?.public) {
          t.state.public = structuredClone(defaultState);
        }
        for (const [id, team] of Object.entries(defaultTeams)) {
          if (!t.teams[id]) {
            t.teams[id] = { public: structuredClone(team), location: null };
          }
        }
      });
    },

    async savePublicStateByHost(state): Promise<void> {
      writeTree((t) => {
        t.state.public = structuredClone(state);
      });
    },

    async patchControllerPublicTransition(patch: ControllerPublicPatch): Promise<void> {
      writeTree((t) => {
        t.state.public = {
          ...t.state.public,
          ...structuredClone(patch),
        };
      });
    },

    subscribeControllerLease(cb): UnsubscribeFn {
      return subscribeSlice((t) => t.state.controller, cb);
    },

    async tryAcquireOrRenewLease(uid, sessionId, nowMs, ttlMs): Promise<boolean> {
      let acquired = false;
      writeTree((t) => {
        const cur = t.state.controller;
        if (
          !cur ||
          !cur.controllerUid ||
          cur.controllerUid === uid ||
          cur.leaseExpiresAt < nowMs ||
          cur.sessionId !== sessionId
        ) {
          t.state.controller = {
            controllerUid: uid,
            heartbeatAt: nowMs,
            leaseExpiresAt: nowMs + ttlMs,
            sessionId,
          };
          acquired = true;
        }
      });
      return acquired;
    },

    subscribeHiderPrivate(cb): UnsubscribeFn {
      return subscribeSlice((t) => t.state.hiderPrivate, cb);
    },

    async saveHiderPrivate(priv): Promise<void> {
      writeTree((t) => {
        const prevLocs = t.state.hiderPrivate?.hiderLocations ?? {};
        t.state.hiderPrivate = {
          ...structuredClone(priv),
          hiderLocations:
            priv.hiderLocations !== undefined
              ? structuredClone(priv.hiderLocations)
              : structuredClone(prevLocs),
        };
      });
    },

    async writeHiderLocationPrivate(uid, fix): Promise<void> {
      writeTree((t) => {
        if (!t.state.hiderPrivate) return;
        if (!t.state.hiderPrivate.hiderLocations) {
          t.state.hiderPrivate.hiderLocations = {};
        }
        t.state.hiderPrivate.hiderLocations[uid] = structuredClone(fix);
      });
    },

    subscribeTeamPublic(teamId, cb): UnsubscribeFn {
      return subscribeSlice((t) => t.teams[teamId]?.public ?? null, cb);
    },

    async saveTeamPublic(teamId, team): Promise<void> {
      writeTree((t) => {
        if (!t.teams[teamId]) {
          t.teams[teamId] = { public: structuredClone(team), location: null };
        } else {
          t.teams[teamId].public = structuredClone(team);
        }
      });
    },

    subscribeTeamLocation(teamId, cb): UnsubscribeFn {
      return subscribeSlice((t) => t.teams[teamId]?.location ?? null, cb);
    },

    async writeTeamLocation(teamId, loc): Promise<void> {
      writeTree((t) => {
        if (t.teams[teamId]) {
          t.teams[teamId].location = structuredClone(loc);
        }
      });
    },

    async writeTeamMemberFixAveraged(
      teamId,
      playerId,
      uid,
      fix
    ): Promise<TeamLocation | null> {
      let updated: TeamLocation | null = null;
      writeTree((t) => {
        if (!t.teams[teamId]) return;
        const nowMs = Date.now() + (t.clockOffsetMs || 0);
        const next = computeAveragedTeamLocationFromMemberFixes(
          t.teams[teamId].location,
          playerId,
          uid,
          fix,
          nowMs
        );
        t.teams[teamId].location = next;
        updated = structuredClone(next);
      });
      return updated;
    },

    async clearTeamLocation(teamId): Promise<void> {
      writeTree((t) => {
        if (t.teams[teamId]) {
          t.teams[teamId].location = null;
        }
      });
    },

    subscribeTeamRequests(teamId, cb): UnsubscribeFn {
      return subscribeSlice((t) => t.requests[teamId] ?? {}, cb);
    },

    async createClueRequest(req): Promise<void> {
      writeTree((t) => {
        if (!t.requests[req.teamId]) {
          t.requests[req.teamId] = {};
        }
        t.requests[req.teamId][req.id] = structuredClone(req);
      });
    },

    async acknowledgeAndStripMedia(teamId, requestId, ackAt): Promise<void> {
      writeTree((t) => {
        const existing = t.requests[teamId]?.[requestId];
        if (existing) {
          delete existing.mediaBase64;
          existing.mediaAcknowledgedAt = ackAt;
        }
      });
    },

    async markMediaDownloadedAndShortenExpiry(
      teamId,
      requestId,
      nowMs,
      postDownloadTtlMs = MEDIA_POST_DOWNLOAD_EXPIRE_MS
    ): Promise<void> {
      writeTree((t) => {
        const existing = t.requests[teamId]?.[requestId];
        if (!existing || !existing.mediaBase64) return;
        const prevExpires =
          typeof existing.mediaExpiresAt === 'number'
            ? existing.mediaExpiresAt
            : (existing.processedAt ?? existing.createdAt) + MEDIA_AUTO_EXPIRE_MS;
        existing.mediaExpiresAt = Math.min(prevExpires, nowMs + postDownloadTtlMs);
        existing.mediaDownloadedAt = existing.mediaDownloadedAt ?? nowMs;
      });
    },

    async claimRequestForProcessing(
      teamId,
      requestId,
      expectedSessionId,
      expectedStatuses,
      nextStatus
    ): Promise<ClueRequest | null> {
      let claimed: ClueRequest | null = null;
      writeTree((t) => {
        const cur = t.requests[teamId]?.[requestId];
        if (
          cur &&
          cur.sessionId === expectedSessionId &&
          expectedStatuses.includes(cur.status)
        ) {
          cur.status = nextStatus;
          claimed = structuredClone(cur);
        }
      });
      return claimed;
    },

    async updateClueRequest(teamId, requestId, req): Promise<void> {
      writeTree((t) => {
        if (!t.requests[teamId]) t.requests[teamId] = {};
        t.requests[teamId][requestId] = structuredClone(req);
      });
    },

    async adjustTeamPenaltyAndClueCountAtomically(
      teamId,
      deltaPenaltyMs,
      deltaClueCount
    ): Promise<TeamPublic | null> {
      let updated: TeamPublic | null = null;
      writeTree((t) => {
        const pub = t.teams[teamId]?.public;
        if (pub) {
          pub.penaltyMs = (pub.penaltyMs || 0) + deltaPenaltyMs;
          pub.clueCount = Math.max(0, (pub.clueCount || 0) + deltaClueCount);
          updated = structuredClone(pub);
        }
      });
      return updated;
    },

    async saveClue(teamId, clue): Promise<void> {
      writeTree((t) => {
        if (!t.clues[teamId]) t.clues[teamId] = {};
        t.clues[teamId][clue.id] = structuredClone(clue);
      });
    },

    async undoClueByHost(teamId, clue): Promise<void> {
      const appliedNetPenaltyMs =
        clue.refundedMs && clue.refundedMs > 0
          ? Math.round(clue.refundedMs / 2) - clue.refundedMs
          : clue.penaltyMs || 0;

      writeTree((t) => {
        if (t.clues[teamId]) {
          delete t.clues[teamId][clue.id];
        }
        if (clue.requestId && t.requests[teamId]) {
          delete t.requests[teamId][clue.requestId];
        }
        const pub = t.teams[teamId]?.public;
        if (pub) {
          pub.penaltyMs = (pub.penaltyMs || 0) - appliedNetPenaltyMs;
          pub.clueCount = Math.max(0, (pub.clueCount || 0) - 1);
        }
        const lb = t.leaderboard?.[teamId];
        if (lb) {
          lb.penaltyMs = (lb.penaltyMs || 0) - appliedNetPenaltyMs;
          lb.totalTimeMs = (lb.searchTimeMs || 0) + lb.penaltyMs;
          lb.clueCount = Math.max(0, (lb.clueCount || 0) - 1);
        }
      });
    },

    subscribeTeamClues(teamId, cb): UnsubscribeFn {
      return subscribeSlice((t) => t.clues[teamId] ?? {}, cb);
    },

    async submitCatchRequest(req): Promise<void> {
      writeTree((t) => {
        t.catchRequests[req.id] = structuredClone(req);
      });
    },

    subscribeAllCatchRequests(cb): UnsubscribeFn {
      return subscribeSlice((t) => t.catchRequests ?? {}, cb);
    },

    subscribeOwnCatchRequest(requestId, cb): UnsubscribeFn {
      return subscribeSlice((t) => t.catchRequests[requestId] ?? null, cb);
    },

    async claimCatchRequest(requestId): Promise<CatchRequest | null> {
      let claimed: CatchRequest | null = null;
      writeTree((t) => {
        const cur = t.catchRequests[requestId];
        if (cur && cur.status === 'PENDING') {
          cur.status = 'PROCESSING';
          claimed = structuredClone(cur);
        }
      });
      return claimed;
    },

    async finalizeCatchRequest(
      requestId,
      status: CatchRequestStatus,
      processedAt,
      errorMessage
    ): Promise<void> {
      writeTree((t) => {
        const cur = t.catchRequests[requestId];
        if (cur) {
          cur.status = status;
          cur.processedAt = processedAt;
          if (errorMessage) cur.errorMessage = errorMessage;
        }
      });
    },

    async markTeamCaughtAtomically(
      teamId,
      catchTimestampMs
    ): Promise<{ transitioned: boolean; team: TeamPublic | null }> {
      let transitioned = false;
      let teamSnapshot: TeamPublic | null = null;
      writeTree((t) => {
        const pub = t.teams[teamId]?.public;
        if (!pub) return;
        if (pub.status === 'ACTIVE') {
          pub.status = 'JOINED_SARDINES';
          pub.catchTimestampMs = catchTimestampMs;
          transitioned = true;
        }
        teamSnapshot = structuredClone(pub);
      });
      return { transitioned, team: teamSnapshot };
    },

    async saveLeaderboardEntry(entry): Promise<void> {
      writeTree((t) => {
        t.leaderboard[entry.teamId] = structuredClone(entry);
      });
    },

    subscribeLeaderboard(cb): UnsubscribeFn {
      return subscribeSlice((t) => t.leaderboard ?? {}, cb);
    },

    async resetRoundByHost(newPublicState, resetTeams, newHiderPrivate): Promise<void> {
      writeTree((t) => {
        t.state.public = structuredClone({ ...newPublicState, hiderLock: null });
        t.state.controller = null;
        t.state.hiderPrivate = structuredClone(newHiderPrivate);
        t.clues = {};
        t.requests = {};
        t.catchRequests = {};
        t.leaderboard = {};
        for (const [id, pub] of Object.entries(resetTeams)) {
          t.teams[id] = {
            public: structuredClone(pub),
            location: null,
          };
        }
      });
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
        hiderPlayerIds: [...hiderPlayerIds],
        logoutGen,
        setAt: nowMs,
      };
      writeTree((t) => {
        t.state.hiderPrivate = {
          anchorPoint: t.state.hiderPrivate?.anchorPoint ?? null,
          radarStages: t.state.hiderPrivate?.radarStages ?? [],
          qrSecret: cleanPassword,
          shortCode: cleanPassword,
          hiderLocations: t.state.hiderPrivate?.hiderLocations ?? {},
        };
        t.state.public.hiderLock = structuredClone(lock);
        if (!t.presence[uid]) t.presence[uid] = {};
        t.presence[uid].hider_pw_lock = {
          online: false,
          lastSeen: nowMs,
          kind: 'HIDER_PW_LOCK',
          sessionId,
          passwordHash,
          hiderPlayerIds: [...hiderPlayerIds],
          logoutGen,
        };
        delete t.presence[uid].ready_state;
      });
      return lock;
    },

    async setPlayerReadyState(uid, playerId, readyToken, nowMs): Promise<void> {
      writeTree((t) => {
        if (!t.presence[uid]) t.presence[uid] = {};
        if (!readyToken) {
          delete t.presence[uid].ready_state;
          return;
        }
        t.presence[uid].ready_state = {
          online: false,
          lastSeen: nowMs,
          kind: 'READY_STATE',
          playerId,
          readyToken,
        };
      });
    },

    async sendEmergencyMessage(msg): Promise<void> {
      writeTree((t) => {
        if (!t.presence[msg.uid]) t.presence[msg.uid] = {};
        t.presence[msg.uid].emergency_alert = {
          online: false,
          lastSeen: msg.createdAt,
          kind: 'EMERGENCY_ALERT',
          playerId: msg.playerId,
          senderName: msg.senderName,
          emergencyText: msg.text.trim(),
          emergencyLat:
            typeof msg.lat === 'number' && Number.isFinite(msg.lat)
              ? msg.lat
              : undefined,
          emergencyLng:
            typeof msg.lng === 'number' && Number.isFinite(msg.lng)
              ? msg.lng
              : undefined,
          emergencyAccuracy:
            typeof msg.accuracy === 'number' && Number.isFinite(msg.accuracy)
              ? Math.round(msg.accuracy)
              : undefined,
        };
      });
    },

    async clearOwnEmergencyMessage(uid): Promise<void> {
      writeTree((t) => {
        if (t.presence[uid]) {
          delete t.presence[uid].emergency_alert;
        }
      });
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
      writeTree((t) => {
        if (!t.presence[uid]) t.presence[uid] = {};
        t.presence[uid].leash_alert = {
          online: false,
          lastSeen: nowMs,
          kind: 'LEASH_ALERT',
          sessionId,
          leashAlertStartedAt: alertStartedAt,
          leashExposeAt: exposeAt,
          leashViolationReason: violationReason,
          exposedHiderLat:
            typeof exposedLat === 'number' && Number.isFinite(exposedLat)
              ? exposedLat
              : undefined,
          exposedHiderLng:
            typeof exposedLng === 'number' && Number.isFinite(exposedLng)
              ? exposedLng
              : undefined,
          exposedHiderAccuracy:
            typeof exposedAccuracy === 'number' && Number.isFinite(exposedAccuracy)
              ? Math.round(exposedAccuracy)
              : undefined,
        };
      });
    },

    async clearLeashViolationAlert(uid): Promise<void> {
      writeTree((t) => {
        if (t.presence[uid]) {
          delete t.presence[uid].leash_alert;
        }
      });
    },

    async fetchLoginSecurityContext() {
      const t = readTree();
      const pub = structuredClone(t.state.public);
      const members = structuredClone(t.members);
      const presence = structuredClone(t.presence);
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
      writeTree((t) => {
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
          .filter((tm) => tm.memberPlayerIds.length > 0)
          .map((tm) => tm.id);

        const fallback = generateSessionSecrets();
        t.state.hiderPrivate = {
          anchorPoint: null,
          radarStages: [],
          qrSecret: currentHiderPrivate?.qrSecret?.trim() || fallback.qrSecret,
          shortCode: currentHiderPrivate?.shortCode?.trim() || fallback.shortCode,
          hiderLocations: {},
        };

        for (const [id, pub] of Object.entries(nextTeams)) {
          t.teams[id] = {
            public: pub,
            location: null,
          };
        }

        t.clues = {};
        t.requests = {};
        t.catchRequests = {};
        t.leaderboard = {};

        if (!t.presence[starterUid]) t.presence[starterUid] = {};
        t.presence[starterUid].round_start_meta = {
          online: false,
          lastSeen: nowMs,
          kind: 'ROUND_START_META',
          sessionId: publicState.sessionId,
          gameStartTimestamp: nowMs,
          activeTeamIds: occupiedTeamIds,
        };

        const immediateOpenSearch =
          (t.state.public.radarSchedule?.hidingDurationMs ?? 0) <= 0;

        t.state.public = {
          ...t.state.public,
          status: 'RUNNING',
          currentPhase: immediateOpenSearch ? 'OPEN_SEARCH' : 'HIDING',
          gameStartTimestamp: nowMs,
          searchStartTimestamp: immediateOpenSearch ? nowMs : null,
          pausedAt: null,
          totalPausedMs: 0,
          pausedBeforeSearchMs: 0,
          anchorLocked: false,
          radarCircle: null,
          leashAlertActive: false,
          activeTeamIds: occupiedTeamIds,
        };
      });
    },
  };

  return {
    adapter,

    getCurrentRole(): DemoRoleId {
      return currentRole;
    },

    switchRole(role: DemoRoleId): void {
      currentRole = role;
      if (!inMemory && typeof sessionStorage !== 'undefined') {
        sessionStorage.setItem(DEMO_ROLE_SESSION_KEY, role);
      }
      notifyAuth();
      notifyAll();
    },

    advanceSimulatedTime(deltaMs: number): void {
      writeTree((t) => {
        t.clockOffsetMs = (t.clockOffsetMs || 0) + deltaMs;
      });
    },

    jumpToNetMinute(targetMinutes: number): void {
      writeTree((t) => {
        const pub = t.state.public;
        if (!pub.gameStartTimestamp) return;
        const targetMs = targetMinutes * 60_000;
        const nowReal = Date.now();
        const currentTotalPaused = pub.totalPausedMs || 0;
        const neededServerNow = pub.gameStartTimestamp + currentTotalPaused + targetMs;
        if (neededServerNow > nowReal + (t.clockOffsetMs || 0)) {
          t.clockOffsetMs = neededServerNow - nowReal;
        }
      });
    },

    isGpsSimulationEnabled(): boolean {
      return Boolean(readTree().gpsSimActive);
    },

    setGpsSimulationEnabled(enabled: boolean): void {
      writeTree((t) => {
        t.gpsSimActive = enabled;
      });
    },

    stepGpsSimulation(): void {
      writeTree((t) => {
        if (!t.gpsSimActive) return;
        const now = Date.now() + (t.clockOffsetMs || 0);
        const poly = t.state.public.playArea.polygon;
        for (const [teamId, entry] of Object.entries(t.teams)) {
          if (entry.public.status !== 'ACTIVE') continue;
          const prev = entry.location ?? {
            lat: 48.1662,
            lng: 11.4673,
            accuracy: 9,
            timestamp: now,
            updatedByUid: DEMO_ROLE_TO_UID.TEAM_1,
          };
          const randomAngle = Math.random() * 360;
          const moved = destinationPoint(prev, 22 + Math.random() * 28, randomAngle);
          const inside = snapPointIntoPlayArea(moved, poly);
          const rounded = roundLatLng5(inside);
          entry.location = {
            lat: rounded.lat,
            lng: rounded.lng,
            accuracy: 8,
            timestamp: now,
            updatedByUid: prev.updatedByUid || `sim_${teamId}`,
          };
        }
      });
    },

    resetEntireDemoStore(): void {
      const fresh = buildInitialDemoTree();
      memoryTree = fresh;
      if (!inMemory && typeof localStorage !== 'undefined') {
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(fresh));
      }
      channel?.postMessage({ type: 'RESET', at: Date.now() });
      notifyAll();
    },

    getSnapshot(): DemoDatabaseTree {
      return structuredClone(readTree());
    },
  };
}

let singletonBrowserDemoStore: DemoControllerApi | null = null;

export function getBrowserDemoStore(): DemoControllerApi {
  if (!singletonBrowserDemoStore) {
    singletonBrowserDemoStore = createDemoStore({ inMemoryOnly: false });
  }
  return singletonBrowserDemoStore;
}
