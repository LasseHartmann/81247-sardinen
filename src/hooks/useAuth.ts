import { useCallback, useEffect, useRef, useState } from 'react';
import { isFirebaseConfigured } from '../config/firebase';
import { isAdminAccountId } from '../config/players';
import {
  resolveDatabaseAdapter,
  type DatabaseAdapter,
} from '../services/databaseAdapter';
import { generateRandomId } from '../services/qrService';
import type {
  AuthUserSummary,
  JoinRequest,
  MemberRecord,
} from '../types/game';

const BROWSER_TAB_SESSION_KEY = 'sardinen_81247_tab_session_id';
const CHOSEN_PLAYER_STORAGE_KEY = 'sardinen_81247_account_session_v1';

interface StoredPlayerSession {
  playerId: string;
  name: string;
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

function normalizeMemberHostFlag(member: MemberRecord | null): MemberRecord | null {
  if (!member) return null;
  const shouldBeHost = isAdminAccountId(member.playerId);
  if (member.isHost === shouldBeHost) return member;
  return {
    ...member,
    isHost: shouldBeHost,
  };
}

/**
 * Verwaltet die Selbstregistrierung & Anmeldung per Benutzername + Passwort.
 * Ausschließlich das Konto `admin` erhält Zugriff auf die Admin-Konsole (`isHost: true`).
 */
export function useAuth(): {
  adapter: DatabaseAdapter;
  firebaseAvailable: boolean;
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  isSessionUnlocked: boolean;
  ownMember: MemberRecord | null;
  memberLoading: boolean;
  ownJoinRequest: JoinRequest | null;
  seatConflictError: string | null;
  loginError: string | null;
  clearLoginError: () => void;
  loginWithCredentials: (name: string, password: string) => Promise<void>;
  registerWithCredentials: (name: string, password: string) => Promise<void>;
  applyOptimisticMemberPatch: (patch: Partial<MemberRecord>) => void;
  exitOrLogout: () => Promise<void>;
} {
  const adapter = resolveDatabaseAdapter(false);

  const [authUser, setAuthUser] = useState<AuthUserSummary | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [firebaseMember, setFirebaseMember] = useState<MemberRecord | null>(null);
  const [memberLoading, setMemberLoading] = useState<boolean>(false);
  const [ownJoinRequest, setOwnJoinRequest] = useState<JoinRequest | null>(null);
  const [isSessionUnlocked, setIsSessionUnlocked] = useState<boolean>(() =>
    Boolean(loadStoredSession()?.playerId)
  );
  const [seatConflictError, setSeatConflictError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

  const authActionInFlightRef = useRef(false);
  const tabId = getOrCreateBrowserTabSessionId();

  useEffect(() => {
    setAuthLoading(true);
    const unsub = adapter.subscribeAuth((user) => {
      setAuthUser(user);
      setAuthLoading(false);
      if (!user && !authActionInFlightRef.current) {
        clearStoredSession();
        setIsSessionUnlocked(false);
      }
    });
    return unsub;
  }, [adapter]);

  useEffect(() => {
    if (!authUser) {
      setFirebaseMember(null);
      setOwnJoinRequest(null);
      setMemberLoading(false);
      return;
    }

    setMemberLoading(true);
    let hadExistingMember = false;

    const unsubMember = adapter.subscribeOwnMember(authUser.uid, (rawMember) => {
      const member = normalizeMemberHostFlag(rawMember);
      setFirebaseMember(member);
      setMemberLoading(false);

      if (member) {
        hadExistingMember = true;
      } else if (hadExistingMember && !authActionInFlightRef.current) {
        clearStoredSession();
        setIsSessionUnlocked(false);
        setLoginError('Du wurdest aus der Runde entfernt.');
        void adapter.signOut();
      } else if (!member && !authActionInFlightRef.current) {
        // Gespeicherte lokale Sitzung ohne gültigen DB-Member zurück zum Login leiten
        if (loadStoredSession()) {
          clearStoredSession();
          setIsSessionUnlocked(false);
        }
      }
    });

    const unsubReq = adapter.subscribeOwnJoinRequest(authUser.uid, (req) => {
      setOwnJoinRequest(req);
    });

    return () => {
      unsubMember();
      unsubReq();
    };
  }, [adapter, authUser]);

  const activeMember = isSessionUnlocked ? firebaseMember : null;

  // Präsenz nur registrieren, solange das Konto aktiv eingeloggt ist
  useEffect(() => {
    if (!authUser || !activeMember?.enabled) return;
    const ua =
      typeof navigator !== 'undefined'
        ? navigator.userAgent.slice(0, 64)
        : 'Browser';
    return adapter.registerTabPresence(authUser.uid, tabId, ua);
  }, [adapter, authUser, activeMember?.enabled, tabId]);

  const clearLoginError = useCallback(() => {
    setLoginError(null);
  }, []);

  const loginWithCredentials = useCallback(
    async (name: string, password: string) => {
      setLoginError(null);
      setSeatConflictError(null);
      authActionInFlightRef.current = true;
      try {
        const { user, member } = await adapter.loginWithAccount({
          name,
          password,
        });
        const normalized = normalizeMemberHostFlag(member)!;
        setAuthUser(user);
        setFirebaseMember(normalized);
        saveStoredSession({
          playerId: normalized.playerId,
          name: normalized.name,
        });
        await adapter
          .tryAcquireOrRenewPlayerSeat(
            normalized.playerId,
            user.uid,
            tabId,
            adapter.getServerNow()
          )
          .catch(() => {});
        setIsSessionUnlocked(true);
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
    [adapter, tabId]
  );

  const registerWithCredentials = useCallback(
    async (name: string, password: string) => {
      setLoginError(null);
      setSeatConflictError(null);
      authActionInFlightRef.current = true;
      try {
        const { user, member } = await adapter.registerAccount({
          name,
          password,
        });
        const normalized = normalizeMemberHostFlag(member)!;
        setAuthUser(user);
        setFirebaseMember(normalized);
        saveStoredSession({
          playerId: normalized.playerId,
          name: normalized.name,
        });
        await adapter
          .tryAcquireOrRenewPlayerSeat(
            normalized.playerId,
            user.uid,
            tabId,
            adapter.getServerNow()
          )
          .catch(() => {});
        setIsSessionUnlocked(true);
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
    [adapter, tabId]
  );

  const exitOrLogout = useCallback(async () => {
    setLoginError(null);
    setSeatConflictError(null);
    clearStoredSession();
    setIsSessionUnlocked(false);
    if (authUser && firebaseMember) {
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
  }, [adapter, authUser, firebaseMember, tabId]);

  const applyOptimisticMemberPatch = useCallback(
    (patch: Partial<MemberRecord>) => {
      setFirebaseMember((prev) =>
        prev ? normalizeMemberHostFlag({ ...prev, ...patch }) : prev
      );
    },
    []
  );

  return {
    adapter,
    firebaseAvailable: isFirebaseConfigured,
    authUser,
    authLoading,
    isSessionUnlocked,
    ownMember: activeMember,
    memberLoading,
    ownJoinRequest,
    seatConflictError,
    loginError,
    clearLoginError,
    loginWithCredentials,
    registerWithCredentials,
    applyOptimisticMemberPatch,
    exitOrLogout,
  };
}
