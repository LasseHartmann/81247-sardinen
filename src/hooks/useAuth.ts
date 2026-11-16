import { useCallback, useEffect, useRef, useState } from 'react';
import { isFirebaseConfigured } from '../config/firebase';
import { isAdminAccountId } from '../config/players';
import {
  resolveDatabaseAdapter,
  type DatabaseAdapter,
} from '../services/databaseAdapter';
import {
  generateRandomId,
  isValidRoomCode,
  normalizeRoomCode,
} from '../services/qrService';
import type {
  AuthUserSummary,
  MemberRecord,
} from '../types/game';

const BROWSER_TAB_SESSION_KEY = 'sardinen_81247_tab_session_id';
const CHOSEN_PLAYER_STORAGE_KEY = 'sardinen_81247_account_session_v1';
const ACTIVE_ROOM_STORAGE_KEY = 'sardinen_81247_active_room_v1';
const RECENT_ROOMS_STORAGE_KEY = 'sardinen_81247_recent_rooms_v1';

export interface StoredPlayerSession {
  playerId: string;
  name: string;
  avatar?: string;
}

export interface RecentRoomEntry {
  roomCode: string;
  hostName?: string;
  joinedAt: number;
}

function saveStoredSession(session: StoredPlayerSession): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CHOSEN_PLAYER_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignorieren
  }
}

function loadStoredSession(): StoredPlayerSession | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(CHOSEN_PLAYER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredPlayerSession>;
        if (parsed?.playerId && typeof parsed.playerId === 'string') {
          return {
            playerId: parsed.playerId,
            name: parsed.name ?? parsed.playerId,
            ...(parsed.avatar ? { avatar: parsed.avatar } : {}),
          };
        }
      }
    }
  } catch {
    // Ignorieren
  }
  return null;
}

function clearStoredSession(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CHOSEN_PLAYER_STORAGE_KEY);
    }
  } catch {
    // Ignorieren
  }
}

function readUrlRoomParam(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('room') ?? params.get('code');
    if (!raw) return null;
    const normalized = normalizeRoomCode(raw);
    return isValidRoomCode(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function syncUrlRoomParam(roomCode: string | null): void {
  try {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    url.searchParams.delete('code');
    if (roomCode) {
      url.searchParams.set('room', roomCode);
    } else {
      url.searchParams.delete('room');
    }
    window.history.replaceState(null, '', url.toString());
  } catch {
    // Ignorieren
  }
}

function loadSavedActiveRoom(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(ACTIVE_ROOM_STORAGE_KEY);
      if (raw) {
        const normalized = normalizeRoomCode(raw);
        if (isValidRoomCode(normalized)) return normalized;
      }
    }
  } catch {
    // Ignorieren
  }
  return null;
}

function saveActiveRoom(roomCode: string | null): void {
  try {
    if (typeof localStorage !== 'undefined') {
      if (roomCode) {
        localStorage.setItem(ACTIVE_ROOM_STORAGE_KEY, roomCode);
      } else {
        localStorage.removeItem(ACTIVE_ROOM_STORAGE_KEY);
      }
    }
  } catch {
    // Ignorieren
  }
}

function loadRecentRooms(): RecentRoomEntry[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(RECENT_ROOMS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RecentRoomEntry[];
        if (Array.isArray(parsed)) {
          return parsed
            .filter(
              (r) =>
                r &&
                typeof r.roomCode === 'string' &&
                isValidRoomCode(r.roomCode)
            )
            .slice(0, 5);
        }
      }
    }
  } catch {
    // Ignorieren
  }
  return [];
}

function recordRecentRoom(
  entry: RecentRoomEntry
): RecentRoomEntry[] {
  const prev = loadRecentRooms().filter((r) => r.roomCode !== entry.roomCode);
  const next = [entry, ...prev].slice(0, 5);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(RECENT_ROOMS_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    // Ignorieren
  }
  return next;
}

function getOrCreateBrowserTabSessionId(): string {
  if (typeof sessionStorage === 'undefined') {
    return generateRandomId('tab');
  }
  const existing = sessionStorage.getItem(BROWSER_TAB_SESSION_KEY);
  if (existing) return existing;
  const fresh = generateRandomId('tab');
  sessionStorage.setItem(BROWSER_TAB_SESSION_KEY, fresh);
  return fresh;
}

function normalizeMemberHostFlag(
  member: MemberRecord | null
): MemberRecord | null {
  if (!member) return null;
  const shouldBeHost = Boolean(
    member.isHost || isAdminAccountId(member.playerId)
  );
  if (member.isHost === shouldBeHost) return member;
  return {
    ...member,
    isHost: shouldBeHost,
  };
}

/**
 * Verwaltet die Selbstregistrierung & Anmeldung per Benutzername + Passwort
 * sowie das Erstellen & Beitreten von Spielräumen per Spiel-Code.
 */
export function useAuth(): {
  adapter: DatabaseAdapter;
  firebaseAvailable: boolean;
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  isSessionUnlocked: boolean;
  accountSession: StoredPlayerSession | null;
  activeRoomCode: string | null;
  pendingInviteRoomCode: string | null;
  recentRooms: RecentRoomEntry[];
  roomBusy: boolean;
  roomError: string | null;
  clearRoomError: () => void;
  hostNewGame: () => Promise<string | null>;
  joinGameByCode: (code: string) => Promise<boolean>;
  leaveCurrentRoom: () => Promise<void>;
  ownMember: MemberRecord | null;
  memberLoading: boolean;
  seatConflictError: string | null;
  loginError: string | null;
  clearLoginError: () => void;
  loginWithCredentials: (name: string, password: string) => Promise<void>;
  registerWithCredentials: (name: string, password: string) => Promise<void>;
  applyOptimisticMemberPatch: (patch: Partial<MemberRecord>) => void;
  exitOrLogout: () => Promise<void>;
} {
  const adapter = resolveDatabaseAdapter(false);

  const [accountSession, setAccountSession] =
    useState<StoredPlayerSession | null>(() => loadStoredSession());
  const [pendingInviteRoomCode, setPendingInviteRoomCode] = useState<
    string | null
  >(() => readUrlRoomParam());
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(() => {
    const hasSession = Boolean(loadStoredSession()?.playerId);
    if (!hasSession) return null;
    const fromUrl = readUrlRoomParam();
    const saved = fromUrl ?? loadSavedActiveRoom();
    if (saved) {
      adapter.setRoomCode(saved);
    }
    return saved;
  });
  const [recentRooms, setRecentRooms] = useState<RecentRoomEntry[]>(() =>
    loadRecentRooms()
  );
  const [roomBusy, setRoomBusy] = useState<boolean>(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  const [authUser, setAuthUser] = useState<AuthUserSummary | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [firebaseMember, setFirebaseMember] = useState<MemberRecord | null>(
    null
  );
  const [memberLoading, setMemberLoading] = useState<boolean>(false);
  const [isSessionUnlocked, setIsSessionUnlocked] = useState<boolean>(() =>
    Boolean(loadStoredSession()?.playerId)
  );
  const [seatConflictError, setSeatConflictError] = useState<string | null>(
    null
  );
  const [loginError, setLoginError] = useState<string | null>(null);

  const authActionInFlightRef = useRef(false);
  const roomActionInFlightRef = useRef(false);
  const tabId = getOrCreateBrowserTabSessionId();

  useEffect(() => {
    if (activeRoomCode) {
      adapter.setRoomCode(activeRoomCode);
    }
  }, [adapter, activeRoomCode]);

  useEffect(() => {
    setAuthLoading(true);
    const unsub = adapter.subscribeAuth((user) => {
      setAuthUser(user);
      setAuthLoading(false);
      if (!user && !authActionInFlightRef.current) {
        clearStoredSession();
        saveActiveRoom(null);
        setAccountSession(null);
        setActiveRoomCode(null);
        setIsSessionUnlocked(false);
      }
    });
    return unsub;
  }, [adapter]);

  useEffect(() => {
    if (!authUser || !isSessionUnlocked || !activeRoomCode) {
      setFirebaseMember(null);
      setMemberLoading(false);
      return;
    }

    adapter.setRoomCode(activeRoomCode);
    setMemberLoading(true);
    let hadExistingMember = false;
    let attemptedAutoRejoin = false;

    const unsubMember = adapter.subscribeOwnMember(
      authUser.uid,
      (rawMember) => {
        const member = normalizeMemberHostFlag(rawMember);
        if (member) {
          hadExistingMember = true;
          setFirebaseMember(member);
          setMemberLoading(false);
          return;
        }

        if (
          authActionInFlightRef.current ||
          roomActionInFlightRef.current
        ) {
          return;
        }

        if (hadExistingMember) {
          // Vom Host aus dem aktuellen Raum entfernt -> zurück zur Raumauswahl (Konto bleibt eingeloggt)
          setFirebaseMember(null);
          setMemberLoading(false);
          saveActiveRoom(null);
          syncUrlRoomParam(null);
          setActiveRoomCode(null);
          setRoomError('Du wurdest aus diesem Spielraum entfernt.');
          return;
        }

        const savedAcct = loadStoredSession();
        if (!attemptedAutoRejoin && savedAcct) {
          attemptedAutoRejoin = true;
          roomActionInFlightRef.current = true;
          void adapter
            .joinRoomByCode({
              roomCode: activeRoomCode,
              playerId: savedAcct.playerId,
              playerName: savedAcct.name,
              avatar: savedAcct.avatar,
            })
            .then((res) => {
              setFirebaseMember(normalizeMemberHostFlag(res.member));
              setMemberLoading(false);
            })
            .catch((err) => {
              setFirebaseMember(null);
              setMemberLoading(false);
              saveActiveRoom(null);
              syncUrlRoomParam(null);
              setActiveRoomCode(null);
              setRoomError(
                err instanceof Error
                  ? err.message
                  : 'Spielraum nicht mehr verfügbar.'
              );
            })
            .finally(() => {
              roomActionInFlightRef.current = false;
            });
        } else {
          setFirebaseMember(null);
          setMemberLoading(false);
          saveActiveRoom(null);
          syncUrlRoomParam(null);
          setActiveRoomCode(null);
        }
      }
    );

    return () => {
      unsubMember();
    };
  }, [adapter, authUser, isSessionUnlocked, activeRoomCode]);

  const activeMember =
    isSessionUnlocked && activeRoomCode ? firebaseMember : null;

  // Präsenz nur registrieren, solange das Konto aktiv in einem Raum eingeloggt ist
  useEffect(() => {
    if (!authUser || !activeRoomCode || !activeMember?.enabled) return;
    adapter.setRoomCode(activeRoomCode);
    const ua =
      typeof navigator !== 'undefined'
        ? navigator.userAgent.slice(0, 64)
        : 'Browser';
    return adapter.registerTabPresence(authUser.uid, tabId, ua);
  }, [adapter, authUser, activeRoomCode, activeMember?.enabled, tabId]);

  const clearLoginError = useCallback(() => {
    setLoginError(null);
  }, []);

  const clearRoomError = useCallback(() => {
    setRoomError(null);
  }, []);

  const hostNewGame = useCallback(async (): Promise<string | null> => {
    const session = accountSession ?? loadStoredSession();
    if (!session) {
      setRoomError('Bitte melde dich zuerst mit deinem Konto an.');
      return null;
    }
    setRoomError(null);
    setRoomBusy(true);
    roomActionInFlightRef.current = true;
    try {
      const res = await adapter.createHostedRoom({
        hostPlayerId: session.playerId,
        hostName: session.name,
        avatar: session.avatar,
      });
      adapter.setRoomCode(res.roomCode);
      saveActiveRoom(res.roomCode);
      syncUrlRoomParam(res.roomCode);
      setPendingInviteRoomCode(null);
      setRecentRooms(
        recordRecentRoom({
          roomCode: res.roomCode,
          hostName: res.publicState.hostName ?? session.name,
          joinedAt: Date.now(),
        })
      );
      const normalized = normalizeMemberHostFlag(res.member)!;
      setFirebaseMember(normalized);
      setActiveRoomCode(res.roomCode);
      await adapter
        .tryAcquireOrRenewPlayerSeat(
          normalized.playerId,
          normalized.uid,
          tabId,
          adapter.getServerNow()
        )
        .catch(() => {});
      return res.roomCode;
    } catch (err) {
      setRoomError(
        err instanceof Error
          ? err.message
          : 'Spielraum konnte nicht erstellt werden.'
      );
      return null;
    } finally {
      roomActionInFlightRef.current = false;
      setRoomBusy(false);
    }
  }, [accountSession, adapter, tabId]);

  const joinGameByCode = useCallback(
    async (rawCode: string): Promise<boolean> => {
      const session = accountSession ?? loadStoredSession();
      if (!session) {
        setRoomError('Bitte melde dich zuerst mit deinem Konto an.');
        return false;
      }
      setRoomError(null);
      setRoomBusy(true);
      roomActionInFlightRef.current = true;
      try {
        const res = await adapter.joinRoomByCode({
          roomCode: rawCode,
          playerId: session.playerId,
          playerName: session.name,
          avatar: session.avatar,
        });
        adapter.setRoomCode(res.roomCode);
        saveActiveRoom(res.roomCode);
        syncUrlRoomParam(res.roomCode);
        setPendingInviteRoomCode(null);
        setRecentRooms(
          recordRecentRoom({
            roomCode: res.roomCode,
            hostName: res.publicState.hostName,
            joinedAt: Date.now(),
          })
        );
        const normalized = normalizeMemberHostFlag(res.member)!;
        setFirebaseMember(normalized);
        setActiveRoomCode(res.roomCode);
        await adapter
          .tryAcquireOrRenewPlayerSeat(
            normalized.playerId,
            normalized.uid,
            tabId,
            adapter.getServerNow()
          )
          .catch(() => {});
        return true;
      } catch (err) {
        setRoomError(
          err instanceof Error
            ? err.message
            : 'Beitritt zum Spiel fehlgeschlagen.'
        );
        return false;
      } finally {
        roomActionInFlightRef.current = false;
        setRoomBusy(false);
      }
    },
    [accountSession, adapter, tabId]
  );

  const leaveCurrentRoom = useCallback(async (): Promise<void> => {
    setRoomError(null);
    if (authUser && firebaseMember && activeRoomCode) {
      adapter.setRoomCode(activeRoomCode);
      await adapter
        .setPlayerReadyState(
          authUser.uid,
          firebaseMember.playerId,
          null,
          adapter.getServerNow()
        )
        .catch(() => {});
      await adapter
        .releasePlayerSeat(firebaseMember.playerId, authUser.uid, tabId)
        .catch(() => {});
    }
    saveActiveRoom(null);
    syncUrlRoomParam(null);
    setPendingInviteRoomCode(null);
    setActiveRoomCode(null);
    setFirebaseMember(null);
  }, [activeRoomCode, adapter, authUser, firebaseMember, tabId]);

  const finalizePostAuthRoomIfInvited = useCallback(
    async (session: StoredPlayerSession) => {
      const inviteCode = pendingInviteRoomCode ?? readUrlRoomParam();
      if (!inviteCode) {
        setActiveRoomCode(null);
        setFirebaseMember(null);
        return;
      }
      roomActionInFlightRef.current = true;
      setRoomBusy(true);
      try {
        const res = await adapter.joinRoomByCode({
          roomCode: inviteCode,
          playerId: session.playerId,
          playerName: session.name,
          avatar: session.avatar,
        });
        adapter.setRoomCode(res.roomCode);
        saveActiveRoom(res.roomCode);
        syncUrlRoomParam(res.roomCode);
        setPendingInviteRoomCode(null);
        setRecentRooms(
          recordRecentRoom({
            roomCode: res.roomCode,
            hostName: res.publicState.hostName,
            joinedAt: Date.now(),
          })
        );
        const normalized = normalizeMemberHostFlag(res.member)!;
        setFirebaseMember(normalized);
        setActiveRoomCode(res.roomCode);
        await adapter
          .tryAcquireOrRenewPlayerSeat(
            normalized.playerId,
            normalized.uid,
            tabId,
            adapter.getServerNow()
          )
          .catch(() => {});
      } catch (err) {
        saveActiveRoom(null);
        syncUrlRoomParam(null);
        setPendingInviteRoomCode(null);
        setActiveRoomCode(null);
        setFirebaseMember(null);
        setRoomError(
          err instanceof Error
            ? err.message
            : `Raum „${inviteCode}“ konnte nicht geöffnet werden.`
        );
      } finally {
        roomActionInFlightRef.current = false;
        setRoomBusy(false);
      }
    },
    [adapter, pendingInviteRoomCode, tabId]
  );

  const loginWithCredentials = useCallback(
    async (name: string, password: string) => {
      setLoginError(null);
      setRoomError(null);
      setSeatConflictError(null);
      authActionInFlightRef.current = true;
      try {
        const { user, member } = await adapter.loginWithAccount({
          name,
          password,
        });
        const normalized = normalizeMemberHostFlag(member)!;
        const session: StoredPlayerSession = {
          playerId: normalized.playerId,
          name: normalized.name,
          ...(normalized.avatar ? { avatar: normalized.avatar } : {}),
        };
        setAuthUser(user);
        setAccountSession(session);
        saveStoredSession(session);
        setIsSessionUnlocked(true);
        await finalizePostAuthRoomIfInvited(session);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Anmeldung fehlgeschlagen. Bitte prüfe deine Eingaben.';
        setLoginError(message);
      } finally {
        authActionInFlightRef.current = false;
      }
    },
    [adapter, finalizePostAuthRoomIfInvited]
  );

  const registerWithCredentials = useCallback(
    async (name: string, password: string) => {
      setLoginError(null);
      setRoomError(null);
      setSeatConflictError(null);
      authActionInFlightRef.current = true;
      try {
        const { user, member } = await adapter.registerAccount({
          name,
          password,
        });
        const normalized = normalizeMemberHostFlag(member)!;
        const session: StoredPlayerSession = {
          playerId: normalized.playerId,
          name: normalized.name,
          ...(normalized.avatar ? { avatar: normalized.avatar } : {}),
        };
        setAuthUser(user);
        setAccountSession(session);
        saveStoredSession(session);
        setIsSessionUnlocked(true);
        await finalizePostAuthRoomIfInvited(session);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Registrierung fehlgeschlagen. Bitte versuche es erneut.';
        setLoginError(message);
      } finally {
        authActionInFlightRef.current = false;
      }
    },
    [adapter, finalizePostAuthRoomIfInvited]
  );

  const exitOrLogout = useCallback(async () => {
    setLoginError(null);
    setRoomError(null);
    setSeatConflictError(null);
    if (authUser && firebaseMember && activeRoomCode) {
      adapter.setRoomCode(activeRoomCode);
      await adapter
        .setPlayerReadyState(
          authUser.uid,
          firebaseMember.playerId,
          null,
          adapter.getServerNow()
        )
        .catch(() => {});
      await adapter
        .releasePlayerSeat(firebaseMember.playerId, authUser.uid, tabId)
        .catch(() => {});
    }
    clearStoredSession();
    saveActiveRoom(null);
    syncUrlRoomParam(null);
    setAccountSession(null);
    setActiveRoomCode(null);
    setFirebaseMember(null);
    setIsSessionUnlocked(false);
  }, [activeRoomCode, adapter, authUser, firebaseMember, tabId]);

  const applyOptimisticMemberPatch = useCallback(
    (patch: Partial<MemberRecord>) => {
      setFirebaseMember((prev) => {
        if (!prev) return prev;
        const next = normalizeMemberHostFlag({ ...prev, ...patch });
        if (patch.avatar !== undefined && next) {
          const updatedSession: StoredPlayerSession = {
            playerId: next.playerId,
            name: next.name,
            ...(next.avatar ? { avatar: next.avatar } : {}),
          };
          setAccountSession(updatedSession);
          saveStoredSession(updatedSession);
        }
        return next;
      });
    },
    []
  );

  return {
    adapter,
    firebaseAvailable: isFirebaseConfigured,
    authUser,
    authLoading,
    isSessionUnlocked,
    accountSession,
    activeRoomCode,
    pendingInviteRoomCode,
    recentRooms,
    roomBusy,
    roomError,
    clearRoomError,
    hostNewGame,
    joinGameByCode,
    leaveCurrentRoom,
    ownMember: activeMember,
    memberLoading,
    seatConflictError,
    loginError,
    clearLoginError,
    loginWithCredentials,
    registerWithCredentials,
    applyOptimisticMemberPatch,
    exitOrLogout,
  };
}
