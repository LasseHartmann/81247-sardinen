import * as turf from '@turf/turf';
import {
  createDefaultTeams,
  getQuestionPenaltyMs,
  QUESTION_CATEGORY_MAP,
  TEAM_PALETTE,
} from '../config/gameConfig';
import {
  createRandomSardineAvatar,
  serializeSardineAvatar,
  type SardineAvatarConfig,
} from '../config/sardineAvatar';
import { isPointInPlayArea, snapPointIntoPlayArea } from '../geo/boundary';
import { destinationPoint, roundCoord5 } from '../geo/distance';
import {
  buildReadyToken,
  computeAveragedTeamLocationFromMemberFixes,
  isMemberTabOnline,
  type DatabaseAdapter,
} from './databaseAdapter';
import { generateRandomId } from './qrService';
import type {
  CatchRequest,
  ClueRequest,
  GeoFix,
  HiderPrivateState,
  LatLng,
  MemberRecord,
  PresenceSession,
  PublicGameState,
  QuestionParams,
  QuestionType,
  TeamLocation,
  TeamPublic,
} from '../types/game';
import { computeNetElapsedMs } from '../utils/formatting';

export const SANDBOX_PREFIX = 'sim_';

export function isSimulatedMember(
  member?: { uid?: string | null; playerId?: string | null } | null
): boolean {
  if (!member) return false;
  const uid = (member.uid ?? '').trim().toLowerCase();
  const pid = (member.playerId ?? '').trim().toLowerCase();
  return uid.startsWith(SANDBOX_PREFIX) || pid.startsWith(SANDBOX_PREFIX);
}

export function pickPointInsidePlayArea(
  publicState: PublicGameState,
  rng: () => number = Math.random
): LatLng {
  const poly = publicState.playArea.polygon;
  try {
    const [minLng, minLat, maxLng, maxLat] = turf.bbox(poly);
    for (let i = 0; i < 32; i++) {
      const cand: LatLng = {
        lat: minLat + (0.15 + 0.7 * rng()) * (maxLat - minLat),
        lng: minLng + (0.15 + 0.7 * rng()) * (maxLng - minLng),
      };
      if (isPointInPlayArea(cand, poly)) {
        return {
          lat: roundCoord5(cand.lat),
          lng: roundCoord5(cand.lng),
        };
      }
    }
    const center = turf.centerOfMass(poly).geometry.coordinates;
    const snapped = snapPointIntoPlayArea(
      { lat: center[1], lng: center[0] },
      poly
    );
    return {
      lat: roundCoord5(snapped.lat),
      lng: roundCoord5(snapped.lng),
    };
  } catch {
    return {
      lat: publicState.safetyPoint.lat,
      lng: publicState.safetyPoint.lng,
    };
  }
}

export interface SpawnSandboxCharacterParams {
  adapter: DatabaseAdapter;
  publicState: PublicGameState;
  teamsPublic: Record<string, TeamPublic>;
  teamLocations?: Record<string, TeamLocation | null>;
  name: string;
  selection: 'HIDER' | 'UNASSIGNED' | string; // 'HIDER' | 'UNASSIGNED' | 'team-1'..'team-6'
  avatarConfig?: SardineAvatarConfig;
  online?: boolean;
  ready?: boolean;
  initialLocation?: LatLng;
}

export async function spawnSandboxCharacter(
  params: SpawnSandboxCharacterParams
): Promise<MemberRecord> {
  const {
    adapter,
    publicState,
    teamsPublic,
    teamLocations = {},
    name,
    selection,
    avatarConfig,
    online = true,
    ready = selection === 'HIDER',
    initialLocation,
  } = params;

  const nowMs = adapter.getServerNow();
  const suffix = generateRandomId('bot').replace(/^bot_/, '').slice(0, 8);
  const playerId = `${SANDBOX_PREFIX}${suffix}`;
  const uid = `${SANDBOX_PREFIX}uid_${suffix}`;
  const cleanName = name.trim().slice(0, 22) || `Bot ${suffix.slice(0, 4)}`;

  const side: MemberRecord['side'] =
    selection === 'HIDER'
      ? 'HIDER'
      : selection === 'UNASSIGNED'
        ? 'UNASSIGNED'
        : 'SEEKER';
  const teamId = side === 'SEEKER' ? selection : null;

  const chosenAvatar = serializeSardineAvatar(
    avatarConfig ?? createRandomSardineAvatar(playerId)
  );

  const member: MemberRecord = {
    uid,
    playerId,
    name: cleanName,
    isHost: false,
    enabled: true,
    side,
    teamId,
    avatar: chosenAvatar,
    updatedAt: nowMs,
  };

  await adapter.updateMember(uid, member);
  await adapter.savePlayerAssignment(playerId, side, teamId);

  if (online) {
    await adapter.setSimulatedMemberPresence(uid, {
      online: true,
      lastSeen: nowMs,
      deviceInfo: 'Sandbox-Bot',
    });
  }

  if (side === 'HIDER' && ready && publicState.status === 'LOBBY') {
    await adapter.setPlayerReadyState(
      uid,
      playerId,
      buildReadyToken(publicState.sessionId),
      nowMs
    );
  }

  const spawnPt = initialLocation ?? pickPointInsidePlayArea(publicState);
  const fix: GeoFix = {
    lat: spawnPt.lat,
    lng: spawnPt.lng,
    accuracy: 6,
    timestamp: nowMs,
  };

  if (side === 'HIDER') {
    await adapter.writeHiderLocationPrivate(uid, fix);
  } else if (side === 'SEEKER' && teamId) {
    const defaults = createDefaultTeams();
    const curTeam = teamsPublic[teamId] ?? defaults[teamId];
    if (curTeam) {
      const nextMembers = curTeam.memberPlayerIds.includes(playerId)
        ? curTeam.memberPlayerIds
        : [...curTeam.memberPlayerIds, playerId];
      await adapter.saveTeamPublic(teamId, {
        ...curTeam,
        memberPlayerIds: nextMembers,
        beaconPlayerId: curTeam.beaconPlayerId ?? playerId,
      });
    }
    if (publicState.status !== 'LOBBY') {
      await adapter.addActiveTeamIdIfRunning(teamId);
    }
    if (online) {
      const prevLoc = teamLocations[teamId] ?? null;
      const nextLoc = computeAveragedTeamLocationFromMemberFixes(
        prevLoc,
        playerId,
        uid,
        fix,
        nowMs
      );
      await adapter.writeTeamLocation(teamId, nextLoc);
    }
  }

  return member;
}

export async function spawnDefaultSandboxPreset(params: {
  adapter: DatabaseAdapter;
  publicState: PublicGameState;
  teamsPublic: Record<string, TeamPublic>;
  teamLocations?: Record<string, TeamLocation | null>;
}): Promise<MemberRecord[]> {
  const { adapter, publicState, teamsPublic, teamLocations = {} } = params;
  const localTeams: Record<string, TeamPublic> = {
    ...createDefaultTeams(),
    ...structuredClone(teamsPublic),
  };
  const localLocs: Record<string, TeamLocation | null> = { ...teamLocations };

  const hiderPt = pickPointInsidePlayArea(publicState);
  const team1Pt = pickPointInsidePlayArea(publicState);
  const team2Pt = pickPointInsidePlayArea(publicState);

  const specs: Array<{
    name: string;
    selection: string;
    avatar: SardineAvatarConfig;
    pt: LatLng;
  }> = [
    {
      name: 'Bot Sardine',
      selection: 'HIDER',
      avatar: {
        color: 'coral',
        hat: 'beanie',
        glasses: 'diving',
        extra: 'scarf',
      },
      pt: hiderPt,
    },
    {
      name: 'Bot Alpha',
      selection: 'team-1',
      avatar: {
        color: 'cobalt',
        hat: 'fedora',
        glasses: 'reading',
        extra: 'bowtie',
      },
      pt: team1Pt,
    },
    {
      name: 'Bot Bravo',
      selection: 'team-1',
      avatar: {
        color: 'teal',
        hat: 'tracht',
        glasses: 'none',
        extra: 'pretzel',
      },
      pt: destinationPoint(team1Pt, 4, 90),
    },
    {
      name: 'Bot Charlie',
      selection: 'team-2',
      avatar: {
        color: 'violet',
        hat: 'party',
        glasses: 'eyepatch',
        extra: 'none',
      },
      pt: team2Pt,
    },
  ];

  const created: MemberRecord[] = [];
  for (const spec of specs) {
    const m = await spawnSandboxCharacter({
      adapter,
      publicState,
      teamsPublic: localTeams,
      teamLocations: localLocs,
      name: spec.name,
      selection: spec.selection,
      avatarConfig: spec.avatar,
      online: true,
      // Verstecker im Preset bewusst noch NICHT auf "Bereit" setzen, damit die Runde nicht ungewollt sofort von selbst startet, bevor Admin bereit ist
      ready: false,
      initialLocation: spec.pt,
    });
    created.push(m);
    if (m.side === 'SEEKER' && m.teamId && localTeams[m.teamId]) {
      const t = localTeams[m.teamId];
      if (!t.memberPlayerIds.includes(m.playerId)) {
        t.memberPlayerIds = [...t.memberPlayerIds, m.playerId];
      }
      t.beaconPlayerId = t.beaconPlayerId ?? m.playerId;
      localLocs[m.teamId] = computeAveragedTeamLocationFromMemberFixes(
        localLocs[m.teamId] ?? null,
        m.playerId,
        m.uid,
        { lat: spec.pt.lat, lng: spec.pt.lng, accuracy: 6, timestamp: adapter.getServerNow() },
        adapter.getServerNow()
      );
    }
  }

  return created;
}

export async function updateSandboxCharacter(params: {
  adapter: DatabaseAdapter;
  member: MemberRecord;
  publicState: PublicGameState;
  teamsPublic: Record<string, TeamPublic>;
  teamLocations: Record<string, TeamLocation | null>;
  patch: {
    name?: string;
    avatarConfig?: SardineAvatarConfig;
    selection?: string; // 'HIDER' | 'UNASSIGNED' | 'team-1'..'team-6'
    online?: boolean;
    ready?: boolean;
  };
}): Promise<void> {
  const { adapter, member, publicState, teamsPublic, teamLocations, patch } =
    params;
  const nowMs = adapter.getServerNow();

  const nextSelection =
    patch.selection ??
    (member.side === 'HIDER'
      ? 'HIDER'
      : member.side === 'SEEKER' && member.teamId
        ? member.teamId
        : 'UNASSIGNED');

  const nextSide: MemberRecord['side'] =
    nextSelection === 'HIDER'
      ? 'HIDER'
      : nextSelection === 'UNASSIGNED'
        ? 'UNASSIGNED'
        : 'SEEKER';
  const nextTeamId = nextSide === 'SEEKER' ? nextSelection : null;
  const prevTeamId = member.teamId;

  const updatedMember: MemberRecord = {
    ...member,
    name:
      patch.name !== undefined
        ? patch.name.trim().slice(0, 22) || member.name
        : member.name,
    avatar: patch.avatarConfig
      ? serializeSardineAvatar(patch.avatarConfig)
      : member.avatar,
    side: nextSide,
    teamId: nextTeamId,
    updatedAt: nowMs,
  };

  await adapter.updateMember(member.uid, updatedMember);
  await adapter.savePlayerAssignment(member.playerId, nextSide, nextTeamId);

  const defaults = createDefaultTeams();
  if (prevTeamId && prevTeamId !== nextTeamId) {
    const oldTeam = teamsPublic[prevTeamId] ?? defaults[prevTeamId];
    if (oldTeam) {
      const remaining = oldTeam.memberPlayerIds.filter(
        (pid) => pid !== member.playerId
      );
      await adapter.saveTeamPublic(prevTeamId, {
        ...oldTeam,
        memberPlayerIds: remaining,
        beaconPlayerId:
          oldTeam.beaconPlayerId === member.playerId
            ? (remaining[0] ?? null)
            : oldTeam.beaconPlayerId,
      });
    }
  }

  if (nextSide === 'SEEKER' && nextTeamId) {
    const targetTeam = teamsPublic[nextTeamId] ?? defaults[nextTeamId];
    if (targetTeam) {
      const nextList = targetTeam.memberPlayerIds.includes(member.playerId)
        ? targetTeam.memberPlayerIds
        : [...targetTeam.memberPlayerIds, member.playerId];
      await adapter.saveTeamPublic(nextTeamId, {
        ...targetTeam,
        memberPlayerIds: nextList,
        beaconPlayerId: targetTeam.beaconPlayerId ?? member.playerId,
      });
    }
    if (publicState.status !== 'LOBBY') {
      await adapter.addActiveTeamIdIfRunning(nextTeamId);
    }
    if (!teamLocations[nextTeamId]) {
      const pt = pickPointInsidePlayArea(publicState);
      await adapter.writeTeamLocation(nextTeamId, {
        lat: pt.lat,
        lng: pt.lng,
        accuracy: 6,
        timestamp: nowMs,
        updatedByUid: member.uid,
        activeContributorCount: 1,
        memberFixes: {
          [member.playerId]: {
            lat: pt.lat,
            lng: pt.lng,
            accuracy: 6,
            timestamp: nowMs,
          },
        },
      });
    }
  }

  if (patch.online !== undefined) {
    if (patch.online) {
      await adapter.setSimulatedMemberPresence(member.uid, {
        online: true,
        lastSeen: nowMs,
        deviceInfo: 'Sandbox-Bot',
      });
    } else {
      await adapter.setSimulatedMemberPresence(member.uid, null);
    }
  }

  if (patch.ready !== undefined) {
    await adapter.setPlayerReadyState(
      member.uid,
      member.playerId,
      patch.ready ? buildReadyToken(publicState.sessionId) : null,
      nowMs
    );
  }
}

export async function removeSandboxCharacter(params: {
  adapter: DatabaseAdapter;
  member: MemberRecord;
}): Promise<void> {
  const { adapter, member } = params;
  await adapter.setSimulatedMemberPresence(member.uid, null).catch(() => {});
  await adapter
    .setPlayerReadyState(member.uid, member.playerId, null, adapter.getServerNow())
    .catch(() => {});
  await adapter.kickPlayerByHost(member.playerId, [member.uid]);
}

export async function clearAllSandboxCharacters(params: {
  adapter: DatabaseAdapter;
  members: Record<string, MemberRecord>;
}): Promise<void> {
  const { adapter, members } = params;
  const bots = Object.values(members).filter((m) => isSimulatedMember(m));
  for (const bot of bots) {
    await removeSandboxCharacter({ adapter, member: bot });
  }
}

export type SandboxPuppetTarget =
  | { kind: 'NONE' }
  | { kind: 'TEAM'; teamId: string }
  | { kind: 'MEMBER'; uid: string };

export async function moveSandboxTargetToPoint(params: {
  adapter: DatabaseAdapter;
  target: SandboxPuppetTarget;
  point: LatLng;
  members: Record<string, MemberRecord>;
  presence: Record<string, Record<string, PresenceSession>>;
  teamLocations: Record<string, TeamLocation | null>;
  hiderPrivate: HiderPrivateState | null;
  lockHiderAnchor?: boolean;
}): Promise<void> {
  const {
    adapter,
    target,
    point,
    members,
    presence,
    teamLocations,
    hiderPrivate,
    lockHiderAnchor = false,
  } = params;

  if (target.kind === 'NONE') return;
  const nowMs = adapter.getServerNow();
  const lat = roundCoord5(point.lat);
  const lng = roundCoord5(point.lng);

  if (target.kind === 'TEAM') {
    const teamMembers = Object.values(members).filter(
      (m) => m.enabled && m.side === 'SEEKER' && m.teamId === target.teamId
    );
    const onlineBots = teamMembers.filter(
      (m) => isSimulatedMember(m) && isMemberTabOnline(presence[m.uid])
    );
    const memberFixes: Record<string, GeoFix> = {};
    onlineBots.forEach((m, idx) => {
      const offsetPt =
        idx === 0 ? { lat, lng } : destinationPoint({ lat, lng }, 3, idx * 90);
      memberFixes[m.playerId] = {
        lat: roundCoord5(offsetPt.lat),
        lng: roundCoord5(offsetPt.lng),
        accuracy: 6,
        timestamp: nowMs,
      };
    });

    await adapter.writeTeamLocation(target.teamId, {
      lat,
      lng,
      accuracy: 6,
      timestamp: nowMs,
      updatedByUid: onlineBots[0]?.uid ?? 'admin_sandbox',
      activeContributorCount: Math.max(1, onlineBots.length),
      memberFixes,
    });
    return;
  }

  const m = members[target.uid];
  if (!m) return;

  if (isSimulatedMember(m) && !isMemberTabOnline(presence[m.uid])) {
    await adapter.setSimulatedMemberPresence(m.uid, {
      online: true,
      lastSeen: nowMs,
      deviceInfo: 'Sandbox-Bot',
    });
  }

  const fix: GeoFix = {
    lat,
    lng,
    accuracy: 6,
    timestamp: nowMs,
  };

  if (m.side === 'HIDER') {
    await adapter.writeHiderLocationPrivate(m.uid, fix);
    if (lockHiderAnchor && hiderPrivate) {
      await adapter.saveHiderPrivate({
        ...hiderPrivate,
        anchorPoint: {
          lat,
          lng,
          accuracy: 6,
          lockedAt: nowMs,
          lockedByUid: m.uid,
        },
        hiderLocations: {
          ...(hiderPrivate.hiderLocations ?? {}),
          [m.uid]: fix,
        },
      });
    }
  } else if (m.side === 'SEEKER' && m.teamId) {
    const prevLoc = teamLocations[m.teamId] ?? null;
    const nextLoc = computeAveragedTeamLocationFromMemberFixes(
      prevLoc,
      m.playerId,
      m.uid,
      fix,
      nowMs
    );
    await adapter.writeTeamLocation(m.teamId, nextLoc);
  }
}

export async function stepAutoWalkSandboxPuppets(params: {
  adapter: DatabaseAdapter;
  publicState: PublicGameState;
  members: Record<string, MemberRecord>;
  presence: Record<string, Record<string, PresenceSession>>;
  teamLocations: Record<string, TeamLocation | null>;
  hiderPrivate: HiderPrivateState | null;
}): Promise<void> {
  const {
    adapter,
    publicState,
    members,
    presence,
    teamLocations,
    hiderPrivate,
  } = params;
  const poly = publicState.playArea.polygon;
  const nowMs = adapter.getServerNow();
  const isManhunt = (publicState.gameMode ?? 'CLASSIC') === 'MANHUNT';

  const onlineBots = Object.values(members).filter(
    (m) =>
      m.enabled && isSimulatedMember(m) && isMemberTabOnline(presence[m.uid])
  );

  // 1. Verstecker-Bots nur in Manhunt oder während der Versteckphase bewegen
  for (const bot of onlineBots) {
    if (bot.side === 'HIDER') {
      if (!isManhunt && publicState.currentPhase !== 'HIDING' && publicState.status !== 'LOBBY') {
        continue;
      }
      const prev =
        hiderPrivate?.hiderLocations?.[bot.uid] ??
        pickPointInsidePlayArea(publicState);
      const stepDist = 20 + Math.random() * 35;
      const bearing = Math.random() * 360;
      const cand = destinationPoint(prev, stepDist, bearing);
      const safe = isPointInPlayArea(cand, poly)
        ? cand
        : snapPointIntoPlayArea(cand, poly);
      await adapter.writeHiderLocationPrivate(bot.uid, {
        lat: roundCoord5(safe.lat),
        lng: roundCoord5(safe.lng),
        accuracy: 6,
        timestamp: nowMs,
      });
    }
  }

  // 2. Sucher-Teams mit Online-Bots als gemeinsame Gruppe bewegen
  for (const palette of TEAM_PALETTE) {
    const teamBots = onlineBots.filter(
      (b) => b.side === 'SEEKER' && b.teamId === palette.id
    );
    if (teamBots.length === 0) continue;
    const prevLoc =
      teamLocations[palette.id] ?? pickPointInsidePlayArea(publicState);
    const stepDist = 25 + Math.random() * 45;
    const bearing = Math.random() * 360;
    const cand = destinationPoint(prevLoc, stepDist, bearing);
    const safe = isPointInPlayArea(cand, poly)
      ? cand
      : snapPointIntoPlayArea(cand, poly);

    await moveSandboxTargetToPoint({
      adapter,
      target: { kind: 'TEAM', teamId: palette.id },
      point: safe,
      members,
      presence,
      teamLocations,
      hiderPrivate,
    });
  }
}

export async function triggerSandboxTeamClue(params: {
  adapter: DatabaseAdapter;
  publicState: PublicGameState;
  teamId: string;
  questionType: QuestionType;
  teamLocation: TeamLocation | null;
  members: Record<string, MemberRecord>;
}): Promise<void> {
  const {
    adapter,
    publicState,
    teamId,
    questionType,
    teamLocation,
    members,
  } = params;
  const nowMs = adapter.getServerNow();
  const netElapsedMs = computeNetElapsedMs(publicState, nowMs);
  const origin = teamLocation ?? pickPointInsidePlayArea(publicState);
  const teamMember = Object.values(members).find(
    (m) => m.side === 'SEEKER' && m.teamId === teamId
  );

  const qParams: QuestionParams = {};
  if (questionType === 'SPLIT_NS' || questionType === 'SPLIT_EW') {
    qParams.splitPoint = { lat: origin.lat, lng: origin.lng };
  } else if (questionType === 'RADIUS_RADAR') {
    qParams.radiusMeters = 250;
  } else if (questionType === 'CONE_45') {
    qParams.bearingDeg = 45;
  } else if (questionType === 'THERMOMETER') {
    qParams.pointA = { lat: origin.lat, lng: origin.lng };
    qParams.pointB = destinationPoint(origin, 300, 45);
  }

  const penaltyMs = getQuestionPenaltyMs(
    questionType,
    publicState.classicSearchDurationMs
  );

  const req: ClueRequest = {
    id: generateRandomId('req'),
    teamId,
    requestedByUid: teamMember?.uid ?? 'admin_sandbox',
    sessionId: publicState.sessionId,
    questionType,
    category: QUESTION_CATEGORY_MAP[questionType],
    params: qParams,
    status: 'PENDING',
    penaltyMs,
    penaltyApplied: false,
    refundedMs: 0,
    createdAt: nowMs,
    netElapsedAtRequestMs: netElapsedMs,
    requesterSnapshotLocation: {
      lat: origin.lat,
      lng: origin.lng,
      accuracy: 6,
    },
  };

  await adapter.createClueRequest(req);
}

export async function triggerSandboxTeamCatch(params: {
  adapter: DatabaseAdapter;
  publicState: PublicGameState;
  hiderPrivate: HiderPrivateState | null;
  teamId: string;
  members: Record<string, MemberRecord>;
}): Promise<void> {
  const { adapter, publicState, hiderPrivate, teamId, members } = params;
  if (!hiderPrivate?.shortCode) {
    throw new Error('Verstecker-Code ist noch nicht initialisiert.');
  }
  const nowMs = adapter.getServerNow();
  const teamMember = Object.values(members).find(
    (m) => m.side === 'SEEKER' && m.teamId === teamId
  );

  const req: CatchRequest = {
    id: generateRandomId('catch'),
    teamId,
    submittedByUid: teamMember?.uid ?? 'admin_sandbox',
    sessionId: publicState.sessionId,
    codeOrSecret: hiderPrivate.shortCode,
    status: 'PENDING',
    createdAt: nowMs,
  };

  await adapter.submitCatchRequest(req);
}
