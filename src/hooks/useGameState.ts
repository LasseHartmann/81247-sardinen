import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultPublicState,
  createDefaultTeams,
  TEAM_PALETTE,
} from '../config/gameConfig';
import {
  deduplicateEnabledMembers,
  extractActiveHiderLock,
  extractActiveLeashViolation,
  extractEmergencyMessages,
  extractReadyPlayerIds,
  extractRoundStartMeta,
  filterOnlineEnabledMembers,
  getRequiredReadyHiderMembers,
  type DatabaseAdapter,
  type UnsubscribeFn,
} from '../services/databaseAdapter';
import { generateRandomId, generateSessionSecrets } from '../services/qrService';
import type {
  ActiveLeashViolationInfo,
  CatchRequest,
  ClueRecord,
  ClueRequest,
  ControllerLease,
  EmergencyMessage,
  HiderLoginLock,
  HiderPrivateState,
  JoinRequest,
  LeaderboardEntry,
  MemberRecord,
  PresenceSession,
  PublicGameState,
  TeamLocation,
  TeamPublic,
} from '../types/game';

export interface SynchronizedGameState {
  connected: boolean;
  publicState: PublicGameState | null;
  controllerLease: ControllerLease | null;
  hiderPrivate: HiderPrivateState | null;
  members: Record<string, MemberRecord>;
  joinRequests: Record<string, JoinRequest>;
  presence: Record<string, Record<string, PresenceSession>>;
  teamsPublic: Record<string, TeamPublic>;
  teamLocations: Record<string, TeamLocation | null>;
  requestsByTeam: Record<string, Record<string, ClueRequest>>;
  cluesByTeam: Record<string, Record<string, ClueRecord>>;
  catchRequests: Record<string, CatchRequest>;
  leaderboard: Record<string, LeaderboardEntry>;
  activeHiderLock: HiderLoginLock | null;
  activeLeashViolation: ActiveLeashViolationInfo | null;
  readyPlayerIds: string[];
  emergencyMessages: EmergencyMessage[];
}

/**
 * Abonniert strikt rollen- und pfadkonform alle Spielknoten:
 * Aktive Sucher abonnieren NIEMALS `/state/hiderPrivate` oder fremde `/teams/{other}/location`!
 */
export function useGameState(
  adapter: DatabaseAdapter,
  ownMember: MemberRecord | null
): SynchronizedGameState {
  const [connected, setConnected] = useState(true);
  const [rawPublicState, setRawPublicState] = useState<PublicGameState | null>(
    null
  );
  const [controllerLease, setControllerLease] =
    useState<ControllerLease | null>(null);
  const [hiderPrivate, setHiderPrivate] = useState<HiderPrivateState | null>(
    null
  );
  const [members, setMembers] = useState<Record<string, MemberRecord>>({});
  const [joinRequests, setJoinRequests] = useState<Record<string, JoinRequest>>(
    {}
  );
  const [presence, setPresence] = useState<
    Record<string, Record<string, PresenceSession>>
  >({});
  const [teamsPublic, setTeamsPublic] = useState<Record<string, TeamPublic>>(
    {}
  );
  const [teamLocations, setTeamLocations] = useState<
    Record<string, TeamLocation | null>
  >({});
  const [requestsByTeam, setRequestsByTeam] = useState<
    Record<string, Record<string, ClueRequest>>
  >({});
  const [cluesByTeam, setCluesByTeam] = useState<
    Record<string, Record<string, ClueRecord>>
  >({});
  const [catchRequests, setCatchRequests] = useState<
    Record<string, CatchRequest>
  >({});
  const [leaderboard, setLeaderboard] = useState<
    Record<string, LeaderboardEntry>
  >({});

  // Verbindungsstatus überwachen
  useEffect(() => {
    return adapter.subscribeConnectionStatus(setConnected);
  }, [adapter]);

  // Öffentlichen Status, Mitglieder, Präsenz, Controller-Lease und Rangliste abonnieren
  useEffect(() => {
    if (!ownMember?.enabled) return;

    const unsubs: UnsubscribeFn[] = [
      adapter.subscribePublicState((st) => {
        setRawPublicState(st);
        if (!st && ownMember.isHost) {
          const sessionId = generateRandomId('session');
          const defaults = createDefaultPublicState(sessionId);
          const defaultTeams = createDefaultTeams();
          const secrets = generateSessionSecrets();
          void adapter.initializeDefaultLobbyIfNeeded(
            defaults,
            defaultTeams,
            secrets
          );
        }
      }),
      adapter.subscribeControllerLease(setControllerLease),
      adapter.subscribeAllMembers(setMembers),
      adapter.subscribePresence(setPresence),
      adapter.subscribeLeaderboard(setLeaderboard),
    ];

    if (ownMember.isHost) {
      unsubs.push(adapter.subscribeAllJoinRequests(setJoinRequests));
    } else {
      setJoinRequests({});
    }

    const teamIds = TEAM_PALETTE.map((t) => t.id);
    for (const teamId of teamIds) {
      unsubs.push(
        adapter.subscribeTeamPublic(teamId, (pub) => {
          setTeamsPublic((prev) => {
            if (!pub) {
              const next = { ...prev };
              delete next[teamId];
              return next;
            }
            return { ...prev, [teamId]: pub };
          });
        })
      );
    }

    return () => {
      for (const fn of unsubs) fn();
    };
  }, [adapter, ownMember?.enabled, ownMember?.isHost]);

  const publicState = useMemo<PublicGameState | null>(() => {
    if (!rawPublicState) return null;
    if (
      rawPublicState.status !== 'LOBBY' &&
      rawPublicState.gameStartTimestamp === null
    ) {
      const fallbackMeta = extractRoundStartMeta(rawPublicState, presence);
      if (fallbackMeta) {
        return {
          ...rawPublicState,
          gameStartTimestamp:
            rawPublicState.gameStartTimestamp ?? fallbackMeta.gameStartTimestamp,
          activeTeamIds:
            fallbackMeta.activeTeamIds ?? rawPublicState.activeTeamIds,
          gameMode:
            rawPublicState.gameMode === 'MANHUNT' ||
            fallbackMeta.gameMode === 'MANHUNT'
              ? 'MANHUNT'
              : 'CLASSIC',
          classicSearchDurationMs:
            rawPublicState.classicSearchDurationMs ??
            fallbackMeta.classicSearchDurationMs,
          manhuntShrinkDurationMs:
            rawPublicState.manhuntShrinkDurationMs ??
            fallbackMeta.manhuntShrinkDurationMs,
          radarSchedule:
            rawPublicState.radarSchedule ?? fallbackMeta.radarSchedule,
        };
      }
    }
    return rawPublicState;
  }, [rawPublicState, presence]);

  const activeHiderLock = useMemo(
    () => extractActiveHiderLock(publicState, presence, members),
    [publicState, presence, members]
  );

  const activeLeashViolation = useMemo(
    () => extractActiveLeashViolation(publicState, presence),
    [publicState, presence]
  );

  const readyPlayerIds = useMemo(
    () => extractReadyPlayerIds(publicState, activeHiderLock, presence),
    [publicState, activeHiderLock, presence]
  );

  const emergencyMessages = useMemo(
    () => extractEmergencyMessages(presence),
    [presence]
  );

  // Wenn ein Spieler sich auf einem zweiten Gerät eingeloggt hat, gleicht ein aktiver Host ggf. fehlende Rollenzuweisungen automatisch ab
  useEffect(() => {
    if (!ownMember?.enabled || !ownMember.isHost) return;
    const assignedByPlayerId = new Map<
      string,
      { side: MemberRecord['side']; teamId: string | null }
    >();
    for (const m of Object.values(members)) {
      if (m.enabled && m.side !== 'UNASSIGNED') {
        assignedByPlayerId.set(m.playerId, {
          side: m.side,
          teamId: m.side === 'SEEKER' ? (m.teamId ?? null) : null,
        });
      }
    }
    for (const m of Object.values(members)) {
      if (!m.enabled) continue;
      const target = assignedByPlayerId.get(m.playerId);
      if (!target) continue;
      const curTeam = m.side === 'SEEKER' ? (m.teamId ?? null) : null;
      if (m.side === 'UNASSIGNED' && (m.side !== target.side || curTeam !== target.teamId)) {
        void adapter
          .updateMember(m.uid, {
            ...m,
            side: target.side,
            teamId: target.teamId,
          })
          .catch(() => {});
      }
    }
  }, [adapter, members, ownMember?.enabled, ownMember?.isHost]);

  const ownTeamStatus = ownMember?.teamId
    ? teamsPublic[ownMember.teamId]?.status
    : undefined;

  const canReadHiderSecrets = Boolean(
    ownMember?.enabled &&
      (ownMember.isHost ||
        ownMember.side === 'HIDER' ||
        ownTeamStatus === 'JOINED_SARDINES')
  );

  // Hider-Geheimnisse NUR abonnieren, wenn autorisiert (Host, Hider oder JOINED_SARDINES)
  useEffect(() => {
    if (!canReadHiderSecrets) {
      setHiderPrivate(null);
      return;
    }
    return adapter.subscribeHiderPrivate(setHiderPrivate);
  }, [adapter, canReadHiderSecrets]);

  // Automatischer Rundenstart, sobald Verstecker-Passwort gesetzt ist und ALLE Mitglieder des Verstecker-Teams (auch offline) auf „Bereit" gedrückt haben!
  const autoStartedTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ownMember?.enabled || !publicState) return;
    if (publicState.status !== 'LOBBY') return;
    if (!activeHiderLock?.passwordHash) return;
    if (!ownMember.isHost && ownMember.side !== 'HIDER') return;

    const requiredHiders = getRequiredReadyHiderMembers(
      members,
      presence
    ).sort((a, b) => a.playerId.localeCompare(b.playerId));
    if (requiredHiders.length === 0) return;

    const readySet = new Set(readyPlayerIds);
    const allHidersReady = requiredHiders.every((h) =>
      readySet.has(h.playerId)
    );
    if (!allHidersReady) return;

    const onlineList = filterOnlineEnabledMembers(
      members,
      presence,
      ownMember.uid
    );
    const allSeekers = deduplicateEnabledMembers(members, presence).filter(
      (m) => m.side === 'SEEKER' && Boolean(m.teamId)
    );
    if (allSeekers.length === 0) return;

    const roundReadyToken = `${publicState.sessionId}:${activeHiderLock.logoutGen}`;
    if (autoStartedTokenRef.current === roundReadyToken) return;

    const onlineHost = onlineList.find((m) => m.isHost);
    const onlineReadyHiders = onlineList
      .filter((m) => m.side === 'HIDER')
      .sort((a, b) => a.playerId.localeCompare(b.playerId));
    const isPrimaryStarter = onlineHost
      ? onlineHost.playerId === ownMember.playerId
      : onlineReadyHiders[0]?.playerId === ownMember.playerId;
    const delayMs = isPrimaryStarter ? 150 : 1400;

    const starterMemberPool = [...requiredHiders, ...allSeekers];

    const timerId = setTimeout(() => {
      if (autoStartedTokenRef.current === roundReadyToken) return;
      autoStartedTokenRef.current = roundReadyToken;
      void adapter
        .startRoundWhenAllReady({
          starterUid: ownMember.uid,
          publicState,
          enabledMembers: starterMemberPool,
          currentHiderPrivate: hiderPrivate,
          nowMs: adapter.getServerNow(),
        })
        .catch(() => {
          autoStartedTokenRef.current = null;
        });
    }, delayMs);

    return () => clearTimeout(timerId);
  }, [
    adapter,
    activeHiderLock,
    hiderPrivate,
    members,
    ownMember,
    presence,
    publicState,
    readyPlayerIds,
  ]);

  // Isolierte Team-Locations, Clues, Requests & CatchRequests rollenbasiert abonnieren
  useEffect(() => {
    if (!ownMember?.enabled) return;
    const unsubs: UnsubscribeFn[] = [];
    const isControllerRole = Boolean(
      ownMember.isHost || ownMember.side === 'HIDER'
    );
    const isHiderTeamMember = Boolean(
      isControllerRole || ownTeamStatus === 'JOINED_SARDINES'
    );

    const allowedTeamIds = isHiderTeamMember
      ? TEAM_PALETTE.map((t) => t.id)
      : ownMember.teamId
        ? [ownMember.teamId]
        : [];

    setTeamLocations({});
    setRequestsByTeam({});
    setCluesByTeam({});

    for (const teamId of allowedTeamIds) {
      unsubs.push(
        adapter.subscribeTeamLocation(teamId, (loc) => {
          setTeamLocations((prev) => ({ ...prev, [teamId]: loc }));
        }),
        adapter.subscribeTeamRequests(teamId, (reqs) => {
          setRequestsByTeam((prev) => ({ ...prev, [teamId]: reqs }));
        }),
        adapter.subscribeTeamClues(teamId, (clues) => {
          setCluesByTeam((prev) => ({ ...prev, [teamId]: clues }));
        })
      );
    }

    if (isControllerRole) {
      unsubs.push(adapter.subscribeAllCatchRequests(setCatchRequests));
    } else {
      setCatchRequests({});
    }

    return () => {
      for (const fn of unsubs) fn();
    };
  }, [
    adapter,
    ownMember?.enabled,
    ownMember?.isHost,
    ownMember?.side,
    ownMember?.teamId,
    ownTeamStatus,
  ]);

  return {
    connected,
    publicState,
    controllerLease,
    hiderPrivate,
    members,
    joinRequests,
    presence,
    teamsPublic,
    teamLocations,
    requestsByTeam,
    cluesByTeam,
    catchRequests,
    leaderboard,
    activeHiderLock,
    activeLeashViolation,
    readyPlayerIds,
    emergencyMessages,
  };
}
