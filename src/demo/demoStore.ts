import {
  createDefaultPublicState,
  createDefaultTeams,
  GAME_ID,
  MEDIA_AUTO_EXPIRE_MS,
  MEDIA_POST_DOWNLOAD_EXPIRE_MS,
  sanitizePlayAreaState,
} from '../config/gameConfig';
import {
  computeAccountPasswordHash,
  isAdminAccountId,
  validateAccountPassword,
  validateAndNormalizeAccountName,
  verifyAccountPasswordHash,
} from '../config/players';
import { snapPointIntoPlayArea } from '../geo/boundary';
import { destinationPoint, roundLatLng5 } from '../geo/distance';
import {
  computeAveragedTeamLocationFromMemberFixes,
  type ControllerPublicPatch,
  type DatabaseAdapter,
  type UnsubscribeFn,
} from '../services/databaseAdapter';
import {
  generateRandomId,
  generateRoomCode,
  generateSessionSecrets,
  isValidRoomCode,
  normalizeRoomCode,
} from '../services/qrService';
import type {
  AccountPublicRecord,
  AuthUserSummary,
  CatchRequest,
  CatchRequestStatus,
  ClueRecord,
  ClueRequest,
  ControllerLease,
  DemoRoleId,
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

const DEMO_STORAGE_KEY = 'sardinen_81247_demo_tree_v4';
const DEMO_ROLE_SESSION_KEY = 'sardinen_81247_demo_role_v4';
const DEMO_BROADCAST_CHANNEL = 'sardinen_81247_demo';

export interface DemoRoomSlice {
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

export interface DemoDatabaseTree extends DemoRoomSlice {
  clockOffsetMs: number;
  gpsSimActive: boolean;
  accounts: Record<string, AccountPublicRecord>;
  accountSecrets: Record<string, { passwordHash: string }>;
  rooms?: Record<string, DemoRoomSlice>;
}

const DEMO_ROLE_TO_UID: Record<DemoRoleId, string> = {
  HOST: 'demo_uid_admin',
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
  pubState.roomCode = GAME_ID;
  pubState.hostPlayerId = 'admin';
  pubState.hostName = 'Admin';
  pubState.createdAt = nowMs;
  pubState.playArea.confirmed = true;
  pubState.playArea.confirmedAt = nowMs;
  pubState.playArea.confirmedByUid = 'demo_uid_admin';
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
    demo_uid_admin: {
      uid: 'demo_uid_admin',
      playerId: 'admin',
      name: 'Admin',
      isHost: true,
      enabled: true,
      side: 'UNASSIGNED',
      teamId: null,
    },
    demo_uid_lasse: {
      uid: 'demo_uid_lasse',
      playerId: 'lasse',
      name: 'Lasse',
      isHost: false,
      enabled: true,
      side: 'HIDER',
      teamId: null,
    },
    demo_uid_linus: {
      uid: 'demo_uid_linus',
      playerId: 'linus',
      name: 'Linus',
      isHost: false,
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

  const accounts: Record<string, AccountPublicRecord> = {};
  const accountSecrets: Record<string, { passwordHash: string }> = {};
  for (const m of Object.values(members)) {
    accounts[m.playerId] = {
      playerId: m.playerId,
      name: m.name,
      createdAt: nowMs,
    };
    const defaultPw = m.playerId === 'admin' ? 'admin123' : 'demo1234';
    accountSecrets[m.playerId] = {
      passwordHash: computeAccountPasswordHash(m.playerId, defaultPw),
    };
  }

  return {
    clockOffsetMs: 0,
    gpsSimActive: false,
    accounts,
    accountSecrets,
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
  let activeCustomUid: string | null = null;
  let currentRoomCode: string = GAME_ID;

  function buildEmptyRoomSlice(roomCode: string, nowMs: number): DemoRoomSlice {
    const sessionId = generateRandomId('session');
    const secrets = generateSessionSecrets();
    const pubState = createDefaultPublicState(sessionId);
    pubState.roomCode = roomCode;
    pubState.createdAt = nowMs;
    pubState.allowTestClicks = true;
    const baseTeams = createDefaultTeams();
    const teamsTree: DemoRoomSlice['teams'] = {};
    for (const [id, pub] of Object.entries(baseTeams)) {
      teamsTree[id] = { public: pub, location: null };
    }
    return {
      members: {},
      playerClaims: {},
      assignments: {},
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
          hiderLocations: {},
        },
      },
      clues: {},
      requests: {},
      catchRequests: {},
      leaderboard: {},
    };
  }

  function getRoomSlice(
    tree: DemoDatabaseTree,
    roomCode = currentRoomCode
  ): DemoRoomSlice | null {
    if (roomCode === GAME_ID) return tree;
    return tree.rooms?.[roomCode] ?? null;
  }

  function requireRoomSlice(
    tree: DemoDatabaseTree,
    roomCode = currentRoomCode
  ): DemoRoomSlice {
    if (roomCode === GAME_ID) return tree;
    if (!tree.rooms) tree.rooms = {};
    if (!tree.rooms[roomCode]) {
      tree.rooms[roomCode] = buildEmptyRoomSlice(
        roomCode,
        Date.now() + (tree.clockOffsetMs || 0)
      );
    }
    return tree.rooms[roomCode];
  }

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
    const uid = activeCustomUid ?? DEMO_ROLE_TO_UID[currentRole];
    return {
      uid,
      email: null,
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

    getRoomCode(): string {
      return currentRoomCode;
    },

    setRoomCode(roomCode: string): void {
      const normalized = normalizeRoomCode(roomCode);
      const next = isValidRoomCode(normalized) ? normalized : GAME_ID;
      if (next !== currentRoomCode) {
        currentRoomCode = next;
        notifyAll();
      }
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
      const curTree = readTree();
      let roomCode = generateRoomCode(6);
      for (let i = 0; i < 12; i++) {
        const candidate = generateRoomCode(6);
        if (candidate !== GAME_ID && !curTree.rooms?.[candidate]) {
          roomCode = candidate;
          break;
        }
      }

      const nowMs = adapter.getServerNow();
      const canonicalHostName = isAdminAccountId(normalizedHostId)
        ? 'Admin'
        : hostName.trim() || normalizedHostId;
      const uid = activeCustomUid ?? `demo_uid_${normalizedHostId}`;

      const freshSlice = buildEmptyRoomSlice(roomCode, nowMs);
      freshSlice.state.public.hostPlayerId = normalizedHostId;
      freshSlice.state.public.hostName = canonicalHostName;
      freshSlice.state.public.playArea.confirmedByUid = uid;

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
      freshSlice.members[uid] = structuredClone(member);

      currentRoomCode = roomCode;
      activeCustomUid = uid;
      writeTree((t) => {
        if (!t.rooms) t.rooms = {};
        t.rooms[roomCode] = freshSlice;
      });
      notifyAuth();

      return {
        roomCode,
        member,
        publicState: structuredClone(freshSlice.state.public),
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

      const curTree = readTree();
      const slice = getRoomSlice(curTree, roomCode);
      if (!slice) {
        throw new Error(
          `Kein Spiel mit dem Code „${roomCode}“ gefunden. Bitte prüfe den Code.`
        );
      }

      const isAdmin = isAdminAccountId(normalizedPlayerId);
      const shouldBeHost = Boolean(
        isAdmin ||
          (slice.state.public.hostPlayerId &&
            slice.state.public.hostPlayerId === normalizedPlayerId)
      );

      const existingMember = Object.values(slice.members).find(
        (m) => m.playerId === normalizedPlayerId
      );
      const uid =
        existingMember?.uid ??
        activeCustomUid ??
        `demo_uid_${normalizedPlayerId}`;
      const fromAssign = slice.assignments?.[normalizedPlayerId] ?? null;

      const inheritedSide: MemberRecord['side'] = isAdmin
        ? 'UNASSIGNED'
        : fromAssign
          ? fromAssign.side
          : (existingMember?.side ?? 'UNASSIGNED');
      const inheritedTeamId =
        inheritedSide === 'SEEKER'
          ? (fromAssign?.teamId ?? existingMember?.teamId ?? null)
          : null;
      const inheritedAvatar =
        avatar ??
        curTree.accounts?.[normalizedPlayerId]?.avatar ??
        existingMember?.avatar;

      const member: MemberRecord = {
        uid,
        playerId: normalizedPlayerId,
        name: isAdmin ? 'Admin' : playerName.trim() || normalizedPlayerId,
        isHost: shouldBeHost,
        enabled: true,
        side: inheritedSide,
        teamId: inheritedTeamId,
        ...(inheritedAvatar ? { avatar: inheritedAvatar } : {}),
        updatedAt: adapter.getServerNow(),
      };

      currentRoomCode = roomCode;
      activeCustomUid = uid;
      let pubOut: PublicGameState = slice.state.public;
      writeTree((t) => {
        const r = requireRoomSlice(t, roomCode);
        r.members[uid] = structuredClone(member);
        pubOut = structuredClone({
          ...r.state.public,
          roomCode: r.state.public.roomCode ?? roomCode,
        });
      });
      notifyAuth();

      return {
        roomCode,
        member,
        publicState: pubOut,
      };
    },

    async addActiveTeamIdIfRunning(teamId: string): Promise<void> {
      if (!teamId) return;
      writeTree((t) => {
        const r = getRoomSlice(t);
        if (!r) return;
        const list = Array.isArray(r.state.public.activeTeamIds)
          ? [...r.state.public.activeTeamIds]
          : [];
        if (!list.includes(teamId)) {
          list.push(teamId);
          r.state.public.activeTeamIds = list;
        }
      });
    },

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
      const { playerId, displayName, isAdmin } = nameCheck;
      const curTree = readTree();
      if (curTree.accounts?.[playerId]) {
        throw new Error(
          'Dieser Benutzername ist bereits vergeben. Bitte melde dich mit deinem Passwort an.'
        );
      }

      const nowMs = adapter.getServerNow();
      const passwordHash = computeAccountPasswordHash(
        playerId,
        pwCheck.password
      );
      const uid = `demo_uid_${playerId}`;
      const curSlice = getRoomSlice(curTree);
      const shouldBeHost = Boolean(
        isAdmin ||
          (curSlice?.state.public.hostPlayerId &&
            curSlice.state.public.hostPlayerId === playerId)
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

      writeTree((t) => {
        if (!t.accounts) t.accounts = {};
        if (!t.accountSecrets) t.accountSecrets = {};
        t.accounts[playerId] = {
          playerId,
          name: displayName,
          createdAt: nowMs,
        };
        t.accountSecrets[playerId] = { passwordHash };
        const r = getRoomSlice(t);
        if (r) {
          r.members[uid] = structuredClone(member);
        }
      });

      activeCustomUid = uid;
      notifyAuth();
      return {
        user: { uid, email: null },
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
      const { playerId, displayName, isAdmin } = nameCheck;
      const curTree = readTree();
      const acct = curTree.accounts?.[playerId];
      if (!acct) {
        throw new Error(
          'Dieses Konto existiert noch nicht. Wechsle auf „Konto erstellen“, um es neu anzulegen.'
        );
      }
      const expectedHash = curTree.accountSecrets?.[playerId]?.passwordHash;
      if (!verifyAccountPasswordHash(playerId, password, expectedHash)) {
        throw new Error('Falsches Passwort.');
      }

      const curSlice = getRoomSlice(curTree);
      const existingMember = curSlice
        ? Object.values(curSlice.members).find((m) => m.playerId === playerId)
        : undefined;
      const rootExisting = Object.values(curTree.members).find(
        (m) => m.playerId === playerId
      );
      const uid =
        existingMember?.uid ?? rootExisting?.uid ?? `demo_uid_${playerId}`;
      const shouldBeHost = Boolean(
        isAdmin ||
          (curSlice?.state.public.hostPlayerId &&
            curSlice.state.public.hostPlayerId === playerId)
      );
      const remoteAssignment = isAdmin
        ? null
        : await adapter.fetchPlayerAssignment(playerId);
      const side: MemberRecord['side'] = isAdmin
        ? 'UNASSIGNED'
        : remoteAssignment
          ? remoteAssignment.side
          : (existingMember?.side ?? 'UNASSIGNED');
      const teamId =
        side === 'SEEKER'
          ? (remoteAssignment?.teamId ?? existingMember?.teamId ?? null)
          : null;
      const inheritedAvatar = acct.avatar ?? existingMember?.avatar;

      const member: MemberRecord = {
        uid,
        playerId,
        name: isAdmin ? 'Admin' : acct.name || displayName,
        isHost: shouldBeHost,
        enabled: true,
        side,
        teamId,
        ...(inheritedAvatar ? { avatar: inheritedAvatar } : {}),
        updatedAt: adapter.getServerNow(),
      };

      writeTree((t) => {
        const r = getRoomSlice(t);
        if (r) {
          r.members[uid] = structuredClone(member);
        }
      });

      activeCustomUid = uid;
      notifyAuth();
      return {
        user: { uid, email: null },
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

      const curTree = readTree();
      const acct = curTree.accounts?.[normalizedId];
      if (!acct) {
        throw new Error('Dieses Konto existiert nicht.');
      }
      const expectedHash = curTree.accountSecrets?.[normalizedId]?.passwordHash;
      if (
        !verifyAccountPasswordHash(normalizedId, currentPassword, expectedHash)
      ) {
        throw new Error('Das aktuelle Passwort ist nicht korrekt.');
      }

      const nextHash = computeAccountPasswordHash(
        normalizedId,
        pwCheck.password
      );
      writeTree((t) => {
        if (!t.accountSecrets) t.accountSecrets = {};
        t.accountSecrets[normalizedId] = { passwordHash: nextHash };
      });
    },

    async fetchAccountProfile(playerId): Promise<AccountPublicRecord | null> {
      const normalizedId = playerId.trim().toLowerCase();
      const t = readTree();
      const rec = t.accounts?.[normalizedId];
      return rec ? structuredClone(rec) : null;
    },

    async updateAccountProfile(playerId, patch): Promise<void> {
      const normalizedId = playerId.trim().toLowerCase();
      if (!normalizedId) return;
      const nowMs = adapter.getServerNow();
      writeTree((t) => {
        if (!t.accounts) t.accounts = {};
        const prev = t.accounts[normalizedId] ?? {
          playerId: normalizedId,
          name: normalizedId,
          createdAt: nowMs,
        };
        const next: AccountPublicRecord = { ...prev };
        if (patch.avatar !== undefined) {
          if (patch.avatar) {
            next.avatar = patch.avatar;
          } else {
            delete next.avatar;
          }
        }
        if (patch.stats !== undefined) {
          next.stats = structuredClone(patch.stats);
        }
        t.accounts[normalizedId] = next;
      });
    },

    async registerSelfMemberIfMissing(member): Promise<void> {
      writeTree((t) => {
        const r = requireRoomSlice(t);
        if (!r.members[member.uid]) {
          r.members[member.uid] = structuredClone(member);
        }
      });
    },

    async fetchPlayerAssignment(playerId) {
      const r = getRoomSlice(readTree());
      if (!r) return null;
      const fromMap = r.assignments?.[playerId];
      if (fromMap) return structuredClone(fromMap);
      const assignedMember = Object.values(r.members).find(
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
        const r = requireRoomSlice(t);
        if (!r.assignments) r.assignments = {};
        r.assignments[playerId] = {
          side,
          teamId: side === 'SEEKER' ? (teamId ?? null) : null,
        };
      });
    },

    async removeMemberByHost(uid): Promise<void> {
      writeTree((t) => {
        const r = getRoomSlice(t);
        if (r) delete r.members[uid];
      });
    },

    async kickPlayerByHost(playerId, memberUids): Promise<void> {
      writeTree((t) => {
        const r = getRoomSlice(t);
        if (!r) return;
        for (const targetUid of memberUids) {
          delete r.members[targetUid];
          delete r.joinRequests?.[targetUid];
          if (r.presence?.[targetUid]) {
            for (const key of Object.keys(r.presence[targetUid])) {
              if (key !== 'emergency_alert') {
                delete r.presence[targetUid][key];
              }
            }
          }
        }
        for (const [uid, rec] of Object.entries(r.members)) {
          if (rec.playerId === playerId) {
            delete r.members[uid];
          }
        }
        if (r.playerClaims) {
          delete r.playerClaims[playerId];
        }
        for (const team of Object.values(r.teams)) {
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
        const r = getRoomSlice(t);
        if (!r) return;
        if (!r.playerClaims) r.playerClaims = {};
        r.playerClaims[playerId] = next;
      });
      return { acquired: true, holder: next };
    },

    async releasePlayerSeat(playerId, uid): Promise<void> {
      writeTree((t) => {
        const r = getRoomSlice(t);
        if (!r) return;
        const cur = r.playerClaims?.[playerId];
        if (cur && cur.uid === uid) {
          delete r.playerClaims[playerId];
        }
      });
    },

    subscribePlayerSeat(playerId, cb): UnsubscribeFn {
      return subscribeSlice(
        (t) => getRoomSlice(t)?.playerClaims?.[playerId] ?? null,
        cb
      );
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
      return subscribeSlice((t) => {
        const m = getRoomSlice(t)?.members[uid] ?? null;
        if (!m) return null;
        return {
          ...m,
          isHost: Boolean(m.isHost || isAdminAccountId(m.playerId)),
        };
      }, cb);
    },

    subscribeAllMembers(cb): UnsubscribeFn {
      return subscribeSlice((t) => {
        const raw = getRoomSlice(t)?.members ?? {};
        const out: Record<string, MemberRecord> = {};
        for (const [uid, rec] of Object.entries(raw)) {
          out[uid] = {
            ...rec,
            uid,
            isHost: Boolean(rec.isHost || isAdminAccountId(rec.playerId)),
          };
        }
        return out;
      }, cb);
    },

    async upsertJoinRequest(req): Promise<void> {
      writeTree((t) => {
        const r = requireRoomSlice(t);
        r.joinRequests[req.uid] = structuredClone(req);
      });
    },

    subscribeOwnJoinRequest(uid, cb): UnsubscribeFn {
      return subscribeSlice(
        (t) => getRoomSlice(t)?.joinRequests[uid] ?? null,
        cb
      );
    },

    subscribeAllJoinRequests(cb): UnsubscribeFn {
      return subscribeSlice((t) => getRoomSlice(t)?.joinRequests ?? {}, cb);
    },

    async approveJoinRequest(req, defaults): Promise<void> {
      writeTree((t) => {
        const r = requireRoomSlice(t);
        const assignedTeam = defaults?.teamId ?? 'team-2';
        const assignedSide = defaults?.side ?? 'SEEKER';
        r.members[req.uid] = {
          uid: req.uid,
          playerId: req.playerId,
          name: req.name,
          isHost: Boolean(defaults?.isHost),
          enabled: true,
          side: assignedSide,
          teamId: assignedSide === 'SEEKER' ? assignedTeam : null,
        };
        if (assignedSide === 'SEEKER' && assignedTeam && r.teams[assignedTeam]) {
          const membersList = r.teams[assignedTeam].public.memberPlayerIds;
          if (!membersList.includes(req.playerId)) {
            membersList.push(req.playerId);
          }
          if (!r.teams[assignedTeam].public.beaconPlayerId) {
            r.teams[assignedTeam].public.beaconPlayerId = req.playerId;
          }
        }
        delete r.joinRequests[req.uid];
      });
    },

    async updateMember(uid, member): Promise<void> {
      writeTree((t) => {
        const r = requireRoomSlice(t);
        r.members[uid] = structuredClone(member);
        for (const team of Object.values(r.teams)) {
          team.public.memberPlayerIds = team.public.memberPlayerIds.filter(
            (pid) => pid !== member.playerId
          );
          if (team.public.beaconPlayerId === member.playerId && member.teamId !== team.public.id) {
            team.public.beaconPlayerId = team.public.memberPlayerIds[0] ?? null;
          }
        }
        if (member.side === 'SEEKER' && member.teamId && r.teams[member.teamId]) {
          const list = r.teams[member.teamId].public.memberPlayerIds;
          if (!list.includes(member.playerId)) {
            list.push(member.playerId);
          }
          if (!r.teams[member.teamId].public.beaconPlayerId) {
            r.teams[member.teamId].public.beaconPlayerId = member.playerId;
          }
        }
      });
    },

    registerTabPresence(uid, browserSessionId, deviceInfo): UnsubscribeFn {
      const targetRoom = currentRoomCode;
      writeTree((t) => {
        const r = getRoomSlice(t, targetRoom);
        if (!r) return;
        if (!r.presence[uid]) r.presence[uid] = {};
        r.presence[uid][browserSessionId] = {
          online: true,
          lastSeen: adapter.getServerNow(),
          deviceInfo,
        };
      });
      return () => {
        writeTree((t) => {
          const r = getRoomSlice(t, targetRoom);
          if (r?.presence[uid]) {
            delete r.presence[uid][browserSessionId];
            if (Object.keys(r.presence[uid]).length === 0) {
              delete r.presence[uid];
            }
          }
        });
      };
    },

    subscribePresence(cb): UnsubscribeFn {
      return subscribeSlice((t) => getRoomSlice(t)?.presence ?? {}, cb);
    },

    async cleanupOrphanedPresence(targetUid): Promise<void> {
      writeTree((t) => {
        const r = getRoomSlice(t);
        if (!r) return;
        if (targetUid) {
          if (r.presence[targetUid]) {
            for (const key of Object.keys(r.presence[targetUid])) {
              if (key.startsWith('tab_')) {
                delete r.presence[targetUid][key];
              }
            }
          }
        } else {
          for (const sessions of Object.values(r.presence)) {
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
      return subscribeSlice((t) => {
        const pub = getRoomSlice(t)?.state.public ?? null;
        if (!pub) return null;
        return {
          ...pub,
          roomCode: pub.roomCode ?? currentRoomCode,
          playArea: sanitizePlayAreaState(pub.playArea),
        };
      }, cb);
    },

    async initializeDefaultLobbyIfNeeded(
      defaultState,
      defaultTeams,
      defaultSecrets
    ): Promise<void> {
      writeTree((t) => {
        const r = requireRoomSlice(t);
        if (!r.state?.public) {
          r.state.public = {
            ...structuredClone(defaultState),
            roomCode: defaultState.roomCode ?? currentRoomCode,
          };
        }
        if (defaultSecrets && !r.state?.hiderPrivate) {
          r.state.hiderPrivate = {
            anchorPoint: null,
            radarStages: [],
            qrSecret: defaultSecrets.qrSecret,
            shortCode: defaultSecrets.shortCode,
            hiderLocations: {},
          };
        }
        for (const [id, team] of Object.entries(defaultTeams)) {
          if (!r.teams[id]) {
            r.teams[id] = { public: structuredClone(team), location: null };
          }
        }
      });
    },

    async savePublicStateByHost(state): Promise<void> {
      writeTree((t) => {
        const r = requireRoomSlice(t);
        r.state.public = {
          ...structuredClone(state),
          roomCode: state.roomCode ?? currentRoomCode,
        };
      });
    },

    async patchControllerPublicTransition(patch: ControllerPublicPatch): Promise<void> {
      writeTree((t) => {
        const r = getRoomSlice(t);
        if (!r) return;
        r.state.public = {
          ...r.state.public,
          ...structuredClone(patch),
        };
      });
    },

    subscribeControllerLease(cb): UnsubscribeFn {
      return subscribeSlice((t) => getRoomSlice(t)?.state.controller ?? null, cb);
    },

    async tryAcquireOrRenewLease(uid, sessionId, nowMs, ttlMs): Promise<boolean> {
      let acquired = false;
      writeTree((t) => {
        const r = getRoomSlice(t);
        if (!r) return;
        const cur = r.state.controller;
        if (
          !cur ||
          !cur.controllerUid ||
          cur.controllerUid === uid ||
          cur.leaseExpiresAt < nowMs ||
          cur.sessionId !== sessionId
        ) {
          r.state.controller = {
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
      return subscribeSlice(
        (t) => getRoomSlice(t)?.state.hiderPrivate ?? null,
        cb
      );
    },

    async saveHiderPrivate(priv): Promise<void> {
      writeTree((t) => {
        const r = requireRoomSlice(t);
        const prevLocs = r.state.hiderPrivate?.hiderLocations ?? {};
        r.state.hiderPrivate = {
          ...structuredClone(priv),
          hiderLocations:
            priv.hiderLocations !== undefined
              ? structuredClone(priv.hiderLocations)
              : structuredClone(prevLocs),
        };
      });
    },

    async rerollHiderSecrets(): Promise<{ qrSecret: string; shortCode: string }> {
      const curShort = getRoomSlice(readTree())?.state.hiderPrivate?.shortCode ?? '';
      let fresh = generateSessionSecrets();
      while (fresh.shortCode === curShort) {
        fresh = generateSessionSecrets();
      }
      writeTree((t) => {
        const r = requireRoomSlice(t);
        r.state.hiderPrivate = {
          anchorPoint: r.state.hiderPrivate?.anchorPoint ?? null,
          radarStages: r.state.hiderPrivate?.radarStages ?? [],
          qrSecret: fresh.qrSecret,
          shortCode: fresh.shortCode,
          hiderLocations: r.state.hiderPrivate?.hiderLocations ?? {},
        };
      });
      return fresh;
    },

    async writeHiderLocationPrivate(uid, fix): Promise<void> {
      writeTree((t) => {
        const r = getRoomSlice(t);
        if (!r?.state.hiderPrivate) return;
        if (!r.state.hiderPrivate.hiderLocations) {
          r.state.hiderPrivate.hiderLocations = {};
        }
        r.state.hiderPrivate.hiderLocations[uid] = structuredClone(fix);
      });
    },

    subscribeTeamPublic(teamId, cb): UnsubscribeFn {
      return subscribeSlice(
        (t) => getRoomSlice(t)?.teams[teamId]?.public ?? null,
        cb
      );
    },

    async saveTeamPublic(teamId, team): Promise<void> {
      writeTree((t) => {
        const r = requireRoomSlice(t);
        if (!r.teams[teamId]) {
          r.teams[teamId] = { public: structuredClone(team), location: null };
        } else {
          r.teams[teamId].public = structuredClone(team);
        }
      });
    },

    subscribeTeamLocation(teamId, cb): UnsubscribeFn {
      return subscribeSlice(
        (t) => getRoomSlice(t)?.teams[teamId]?.location ?? null,
        cb
      );
    },

    async writeTeamLocation(teamId, loc): Promise<void> {
      writeTree((t) => {
        const r = getRoomSlice(t);
        if (r?.teams[teamId]) {
          r.teams[teamId].location = structuredClone(loc);
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
        const r = getRoomSlice(t);
        if (!r?.teams[teamId]) return;
        const nowMs = Date.now() + (t.clockOffsetMs || 0);
        const next = computeAveragedTeamLocationFromMemberFixes(
          r.teams[teamId].location,
          playerId,
          uid,
          fix,
          nowMs
        );
        r.teams[teamId].location = next;
        updated = structuredClone(next);
      });
      return updated;
    },

    async clearTeamLocation(teamId): Promise<void> {
      writeTree((t) => {
        const r = getRoomSlice(t);
        if (r?.teams[teamId]) {
          r.teams[teamId].location = null;
        }
      });
    },

    subscribeTeamRequests(teamId, cb): UnsubscribeFn {
      return subscribeSlice(
        (t) => getRoomSlice(t)?.requests[teamId] ?? {},
        cb
      );
    },

    async createClueRequest(req): Promise<void> {
      writeTree((t) => {
        const r = requireRoomSlice(t);
        if (!r.requests[req.teamId]) {
          r.requests[req.teamId] = {};
        }
        r.requests[req.teamId][req.id] = structuredClone(req);
      });
    },

    async acknowledgeAndStripMedia(teamId, requestId, ackAt): Promise<void> {
      writeTree((t) => {
        const r = getRoomSlice(t);
        const existing = r?.requests[teamId]?.[requestId];
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
        const r = getRoomSlice(t);
        const existing = r?.requests[teamId]?.[requestId];
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
        const r = getRoomSlice(t);
        const cur = r?.requests[teamId]?.[requestId];
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
        const r = requireRoomSlice(t);
        if (!r.requests[teamId]) r.requests[teamId] = {};
        r.requests[teamId][requestId] = structuredClone(req);
      });
    },

    async adjustTeamPenaltyAndClueCountAtomically(
      teamId,
      deltaPenaltyMs,
      deltaClueCount
    ): Promise<TeamPublic | null> {
      let updated: TeamPublic | null = null;
      writeTree((t) => {
        const r = getRoomSlice(t);
        const pub = r?.teams[teamId]?.public;
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
        const r = requireRoomSlice(t);
        if (!r.clues[teamId]) r.clues[teamId] = {};
        r.clues[teamId][clue.id] = structuredClone(clue);
      });
    },

    async undoClueByHost(teamId, clue): Promise<void> {
      const appliedNetPenaltyMs =
        clue.refundedMs && clue.refundedMs > 0
          ? Math.round(clue.refundedMs / 2) - clue.refundedMs
          : clue.penaltyMs || 0;

      writeTree((t) => {
        const r = getRoomSlice(t);
        if (!r) return;
        if (r.clues[teamId]) {
          delete r.clues[teamId][clue.id];
        }
        if (clue.requestId && r.requests[teamId]) {
          delete r.requests[teamId][clue.requestId];
        }
        const pub = r.teams[teamId]?.public;
        if (pub) {
          pub.penaltyMs = (pub.penaltyMs || 0) - appliedNetPenaltyMs;
          pub.clueCount = Math.max(0, (pub.clueCount || 0) - 1);
        }
        const lb = r.leaderboard?.[teamId];
        if (lb) {
          lb.penaltyMs = (lb.penaltyMs || 0) - appliedNetPenaltyMs;
          lb.totalTimeMs = (lb.searchTimeMs || 0) + lb.penaltyMs;
          lb.clueCount = Math.max(0, (lb.clueCount || 0) - 1);
        }
      });
    },

    subscribeTeamClues(teamId, cb): UnsubscribeFn {
      return subscribeSlice((t) => getRoomSlice(t)?.clues[teamId] ?? {}, cb);
    },

    async submitCatchRequest(req): Promise<void> {
      writeTree((t) => {
        const r = requireRoomSlice(t);
        r.catchRequests[req.id] = structuredClone(req);
      });
    },

    subscribeAllCatchRequests(cb): UnsubscribeFn {
      return subscribeSlice((t) => getRoomSlice(t)?.catchRequests ?? {}, cb);
    },

    subscribeOwnCatchRequest(requestId, cb): UnsubscribeFn {
      return subscribeSlice(
        (t) => getRoomSlice(t)?.catchRequests[requestId] ?? null,
        cb
      );
    },

    async claimCatchRequest(requestId): Promise<CatchRequest | null> {
      let claimed: CatchRequest | null = null;
      writeTree((t) => {
        const r = getRoomSlice(t);
        const cur = r?.catchRequests[requestId];
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
        const r = getRoomSlice(t);
        const cur = r?.catchRequests[requestId];
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
        const r = getRoomSlice(t);
        const pub = r?.teams[teamId]?.public;
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
        const r = requireRoomSlice(t);
        r.leaderboard[entry.teamId] = structuredClone(entry);
      });
    },

    subscribeLeaderboard(cb): UnsubscribeFn {
      return subscribeSlice((t) => getRoomSlice(t)?.leaderboard ?? {}, cb);
    },

    async resetRoundByHost(newPublicState, resetTeams, newHiderPrivate): Promise<void> {
      writeTree((t) => {
        const r = requireRoomSlice(t);
        const prevPub = r.state.public;
        r.state.public = {
          roomCode: prevPub?.roomCode ?? currentRoomCode,
          hostPlayerId: prevPub?.hostPlayerId,
          hostName: prevPub?.hostName,
          createdAt: prevPub?.createdAt,
          ...structuredClone(newPublicState),
        };
        r.state.controller = null;
        r.state.hiderPrivate = structuredClone(newHiderPrivate);
        r.clues = {};
        r.requests = {};
        r.catchRequests = {};
        r.leaderboard = {};
        for (const [id, pub] of Object.entries(resetTeams)) {
          r.teams[id] = {
            public: structuredClone(pub),
            location: null,
          };
        }
      });
    },

    async setPlayerReadyState(uid, playerId, readyToken, nowMs): Promise<void> {
      writeTree((t) => {
        const r = getRoomSlice(t);
        if (!r) return;
        if (!r.presence[uid]) r.presence[uid] = {};
        if (!readyToken) {
          delete r.presence[uid].ready_state;
          return;
        }
        r.presence[uid].ready_state = {
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
        const r = requireRoomSlice(t);
        if (!r.presence[msg.uid]) r.presence[msg.uid] = {};
        r.presence[msg.uid].emergency_alert = {
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
        const r = getRoomSlice(t);
        if (r?.presence[uid]) {
          delete r.presence[uid].emergency_alert;
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
        const r = requireRoomSlice(t);
        if (!r.presence[uid]) r.presence[uid] = {};
        r.presence[uid].leash_alert = {
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
        const r = getRoomSlice(t);
        if (r?.presence[uid]) {
          delete r.presence[uid].leash_alert;
        }
      });
    },

    async startRoundWhenAllReady({
      starterUid,
      publicState,
      enabledMembers,
      currentHiderPrivate,
      nowMs,
    }): Promise<void> {
      writeTree((t) => {
        const r = requireRoomSlice(t);
        const nextTeams = createDefaultTeams();
        for (const [id, tm] of Object.entries(nextTeams)) {
          const existingName = r.teams[id]?.public?.name?.trim();
          if (existingName) {
            tm.name = existingName;
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
          .filter((tm) => tm.memberPlayerIds.length > 0)
          .map((tm) => tm.id);

        const fallback = generateSessionSecrets();
        const hasValidRandomSecrets = Boolean(
          currentHiderPrivate?.qrSecret &&
            /^[0-9a-f]{32}$/i.test(currentHiderPrivate.qrSecret) &&
            currentHiderPrivate?.shortCode?.length === 6
        );
        r.state.hiderPrivate = {
          anchorPoint: null,
          radarStages: [],
          qrSecret: hasValidRandomSecrets
            ? currentHiderPrivate!.qrSecret
            : fallback.qrSecret,
          shortCode: hasValidRandomSecrets
            ? currentHiderPrivate!.shortCode
            : fallback.shortCode,
          hiderLocations: {},
        };

        for (const [id, pub] of Object.entries(nextTeams)) {
          r.teams[id] = {
            public: pub,
            location: null,
          };
        }

        r.clues = {};
        r.requests = {};
        r.catchRequests = {};
        r.leaderboard = {};

        if (!r.presence[starterUid]) r.presence[starterUid] = {};
        r.presence[starterUid].round_start_meta = {
          online: false,
          lastSeen: nowMs,
          kind: 'ROUND_START_META',
          sessionId: publicState.sessionId,
          gameStartTimestamp: nowMs,
          activeTeamIds: occupiedTeamIds,
        };

        const immediateOpenSearch =
          (r.state.public.radarSchedule?.hidingDurationMs ?? 0) <= 0;

        r.state.public = {
          ...r.state.public,
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
      activeCustomUid = null;
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
        const r = getRoomSlice(t);
        const pub = r?.state.public;
        if (!pub?.gameStartTimestamp) return;
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
        const r = getRoomSlice(t);
        if (!r) return;
        const now = Date.now() + (t.clockOffsetMs || 0);
        const poly = r.state.public.playArea.polygon;
        for (const [teamId, entry] of Object.entries(r.teams)) {
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
      currentRoomCode = GAME_ID;
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
