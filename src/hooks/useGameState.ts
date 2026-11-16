import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultPublicState,
  createDefaultTeams,
  TEAM_PALETTE,
} from '../config/gameConfig';
import { isAdminAccountId } from '../config/players';
import {
  deduplicateEnabledMembers,
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
  HiderPrivateState,
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
  presence: Record<string, Record<string, PresenceSession>>;
  teamsPublic: Record<string, TeamPublic>;
  teamLocations: Record<string, TeamLocation | null>;
  requestsByTeam: Record<string, Record<string, ClueRequest>>;
  cluesByTeam: Record<string, Record<string, ClueRecord>>;
  catchRequests: Record<string, CatchRequest>;
  leaderboard: Record<string, LeaderboardEntry>;
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
  ownMember: MemberRecord | null,
  activeRoomCode: string | null = adapter.getRoomCode()
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
    if (!activeRoomCode || !ownMember?.enabled) {
      setRawPublicState(null);
      setControllerLease(null);
      setMembers({});
      setPresence({});
      setTeamsPublic({});
      setLeaderboard({});
      return;
    }

    adapter.setRoomCode(activeRoomCode);
    setRawPublicState(null);
    setControllerLease(null);
    setMembers({});
    setPresence({});
    setTeamsPublic({});
    setLeaderboard({});

    const isOwnHost = Boolean(
      ownMember.isHost || isAdminAccountId(ownMember.playerId)
    );

    const unsubs: UnsubscribeFn[] = [
      adapter.subscribePublicState((st) => {
        setRawPublicState(st);
        if (!st && isOwnHost) {
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
  }, [
    adapter,
    activeRoomCode,
    ownMember?.enabled,
    ownMember?.isHost,
    ownMember?.playerId,
  ]);

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

  const activeLeashViolation = useMemo(
    () => extractActiveLeashViolation(publicState, presence),
    [publicState, presence]
  );

  const readyPlayerIds = useMemo(
    () => extractReadyPlayerIds(publicState, presence),
    [publicState, presence]
  );

  const emergencyMessages = useMemo(
    () => extractEmergencyMessages(presence),
    [presence]
  );

  const ownTeamStatus = ownMember?.teamId
    ? teamsPublic[ownMember.teamId]?.status
    : undefined;

  const canReadHiderSecrets = Boolean(
    ownMember?.enabled &&
      (ownMember.isHost ||
        isAdminAccountId(ownMember.playerId) ||
        ownMember.side === 'HIDER' ||
        ownTeamStatus === 'JOINED_SARDINES')
  );

  // Hider-Geheimnisse NUR abonnieren, wenn autorisiert (Host, Admin, Hider oder JOINED_SARDINES)
  const seededMissingSecretsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeRoomCode || !canReadHiderSecrets) {
      setHiderPrivate(null);
      return;
    }
    adapter.setRoomCode(activeRoomCode);
    return adapter.subscribeHiderPrivate((priv) => {
      setHiderPrivate(priv);
      const canWriteSecrets = Boolean(
        ownMember?.enabled &&
          (ownMember.isHost ||
            isAdminAccountId(ownMember.playerId) ||
            ownMember.side === 'HIDER')
      );
      const hasValidRandomCode = Boolean(
        priv?.qrSecret &&
          /^[0-9a-f]{32}$/i.test(priv.qrSecret) &&
          priv?.shortCode?.length === 6
      );
      const sessionKey = `${activeRoomCode}_${publicState?.sessionId ?? 'init'}`;
      if (
        canWriteSecrets &&
        !hasValidRandomCode &&
        seededMissingSecretsRef.current !== sessionKey
      ) {
        seededMissingSecretsRef.current = sessionKey;
        void adapter.rerollHiderSecrets().catch(() => {
          seededMissingSecretsRef.current = null;
        });
      }
    });
  }, [
    adapter,
    activeRoomCode,
    canReadHiderSecrets,
    ownMember?.enabled,
    ownMember?.isHost,
    ownMember?.playerId,
    ownMember?.side,
    publicState?.sessionId,
  ]);

  // Automatischer Rundenstart, sobald ALLE eingeteilten Verstecker (auch offline) auf „Bereit" gedrückt haben!
  const autoStartedTokenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!ownMember?.enabled || !publicState) return;
    if (publicState.status !== 'LOBBY') return;
    if (
      !ownMember.isHost &&
      !isAdminAccountId(ownMember.playerId) &&
      ownMember.side !== 'HIDER'
    )
      return;

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

    const roundReadyToken = publicState.sessionId;
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
    hiderPrivate,
    members,
    ownMember,
    presence,
    publicState,
    readyPlayerIds,
  ]);

  // Isolierte Team-Locations, Clues, Requests & CatchRequests rollenbasiert abonnieren
  useEffect(() => {
    if (!activeRoomCode || !ownMember?.enabled) {
      setTeamLocations({});
      setRequestsByTeam({});
      setCluesByTeam({});
      setCatchRequests({});
      return;
    }
    adapter.setRoomCode(activeRoomCode);
    const unsubs: UnsubscribeFn[] = [];
    const isControllerRole = Boolean(
      ownMember.isHost ||
        isAdminAccountId(ownMember.playerId) ||
        ownMember.side === 'HIDER'
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
    activeRoomCode,
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
    presence,
    teamsPublic,
    teamLocations,
    requestsByTeam,
    cluesByTeam,
    catchRequests,
    leaderboard,
    activeLeashViolation,
    readyPlayerIds,
    emergencyMessages,
  };
}
