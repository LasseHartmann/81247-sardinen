import { useCallback, useEffect, useState } from 'react';
import { isFirebaseConfigured } from '../config/firebase';
import { PLAYER_SEAT_HEARTBEAT_MS } from '../config/gameConfig';
import {
  findPresetPlayerById,
  resolveAllowedPlayerByNameInput,
  verifyAdminCode,
  verifyHiderPasswordHash,
} from '../config/players';
import { resolveDatabaseAdapter, type DatabaseAdapter } from '../services/databaseAdapter';
import { generateRandomId } from '../services/qrService';
import type {
  AuthUserSummary,
  HiderLoginLock,
  JoinRequest,
  MemberRecord,
} from '../types/game';

const BROWSER_TAB_SESSION_KEY = 'sardinen_81247_tab_session_id';
const CHOSEN_PLAYER_STORAGE_KEY = 'sardinen_81247_chosen_player_v5';
const LAST_ACK_LOGOUT_GEN_KEY = 'sardinen_81247_ack_logout_gen_v1';

interface StoredPlayerSession {
  playerId: string;
  ackLogoutGen: string | null;
  verifiedHiderPwHash: string | null;
}

function saveStoredSession(session: StoredPlayerSession): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CHOSEN_PLAYER_STORAGE_KEY, JSON.stringify(session));
      if (session.ackLogoutGen) {
        localStorage.setItem(LAST_ACK_LOGOUT_GEN_KEY, session.ackLogoutGen);
      }
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
        if (parsed?.playerId && findPresetPlayerById(parsed.playerId)) {
          return {
            playerId: parsed.playerId,
            ackLogoutGen: parsed.ackLogoutGen ?? null,
            verifiedHiderPwHash: parsed.verifiedHiderPwHash ?? null,
          };
        }
      }
    }
  } catch {
    // Ignorieren
  }
  return null;
}

function clearStoredSession(ackLogoutGen?: string | null): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CHOSEN_PLAYER_STORAGE_KEY);
      if (ackLogoutGen) {
        localStorage.setItem(LAST_ACK_LOGOUT_GEN_KEY, ackLogoutGen);
      }
    }
  } catch {
    // Ignorieren
  }
}

function loadLastAckLogoutGen(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(LAST_ACK_LOGOUT_GEN_KEY);
    }
  } catch {
    // Ignorieren
  }
  return null;
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

/**
 * Verwaltet den Login per Namenseingabe (11 erlaubte Vornamen),
 * schützt Verstecker-Accounts mit dem geheimen Verstecker-Passwort,
 * loggt alle Spieler einmalig aus sobald die Verstecker ihr Passwort setzen,
 * und schaltet Admin-Rechte für Lasse & Linus per 4-stelligem Code frei.
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
  logoutNotice: string | null;
  pendingHiderPasswordFor: string | null;
  clearPendingHiderPrompt: () => void;
  loginByTypedName: (typedName: string, hiderPassword?: string) => Promise<void>;
  syncWithActiveHiderLock: (activeHiderLock: HiderLoginLock | null) => void;
  unlockAdminWithCode: (code: string) => Promise<{ ok: boolean; error?: string }>;
  lockAdminConsole: () => Promise<void>;
  claimInitialHost: () => Promise<void>;
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
  const [logoutNotice, setLogoutNotice] = useState<string | null>(null);
  const [pendingHiderPasswordFor, setPendingHiderPasswordFor] = useState<
    string | null
  >(null);

  const tabId = getOrCreateBrowserTabSessionId();

  useEffect(() => {
    setAuthLoading(true);
    const unsub = adapter.subscribeAuth((user) => {
      setAuthUser(user);
      setAuthLoading(false);
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
    let attemptedHostLockOnBoot = false;
    let hadExistingMember = false;

    const unsubMember = adapter.subscribeOwnMember(authUser.uid, (member) => {
      setFirebaseMember(member);
      setMemberLoading(false);

      if (member) {
        hadExistingMember = true;
      } else if (hadExistingMember) {
        // Spieler wurde vom Spielleiter aus der Runde gekickt!
        clearStoredSession();
        setIsSessionUnlocked(false);
        setPendingHiderPasswordFor(null);
        setLoginError('Du wurdest vom Spielleiter aus der Runde entfernt.');
        void adapter.signOut();
        return;
      }

      // Beim frischen Öffnen/Neuladen der App sicherstellen, dass ein offenes Admin-Flag gesperrt startet
      if (member && member.isHost && !attemptedHostLockOnBoot) {
        attemptedHostLockOnBoot = true;
        void adapter
          .updateMember(authUser.uid, {
            uid: member.uid,
            playerId: member.playerId,
            name: member.name,
            isHost: false,
            enabled: true,
            side: member.side,
            teamId: member.teamId,
          })
          .catch(() => {});
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

  // Globale 1-Person-pro-Name-Sitzsperre (pro UID/Gerät, keine Tab-Sperre im selben Browser)
  useEffect(() => {
    if (!authUser || !activeMember?.enabled) return;

    let cancelled = false;
    const playerId = activeMember.playerId;
    const playerName = activeMember.name;
    const uid = authUser.uid;

    const beat = async () => {
      if (cancelled) return;
      try {
        const res = await adapter.tryAcquireOrRenewPlayerSeat(
          playerId,
          uid,
          tabId,
          adapter.getServerNow()
        );
        if (!cancelled && !res.acquired) {
          setSeatConflictError(
            `${playerName} ist bereits auf einem anderen Gerät aktiv.`
          );
        } else if (!cancelled) {
          setSeatConflictError(null);
        }
      } catch {
        // Bei kurzzeitigem Offline-Zustand nicht sperren
      }
    };

    void beat();
    const interval = setInterval(() => {
      void beat();
    }, PLAYER_SEAT_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    adapter,
    authUser,
    activeMember?.enabled,
    activeMember?.name,
    activeMember?.playerId,
    tabId,
  ]);

  // Präsenz nur registrieren, solange der Spieler aktiv eingeloggt ist
  useEffect(() => {
    if (!authUser || !activeMember?.enabled) return;
    const ua =
      typeof navigator !== 'undefined'
        ? navigator.userAgent.slice(0, 64)
        : 'Browser';
    return adapter.registerTabPresence(authUser.uid, tabId, ua);
  }, [adapter, authUser, activeMember?.enabled, tabId]);

  // Synchronisiert Zwangs-Logout bei neu gesetztem Verstecker-Passwort sowie Passwortschutz für Verstecker-Accounts
  const syncWithActiveHiderLock = useCallback(
    (activeHiderLock: HiderLoginLock | null) => {
      if (!activeHiderLock || !isSessionUnlocked) return;
      const saved = loadStoredSession();
      const lastAck = saved?.ackLogoutGen ?? loadLastAckLogoutGen();

      // 1. Verstecker haben gerade ein neues Passwort festgelegt -> ALLE Spieler sofort ausloggen!
      if (activeHiderLock.logoutGen && lastAck !== activeHiderLock.logoutGen) {
        clearStoredSession(activeHiderLock.logoutGen);
        setIsSessionUnlocked(false);
        setPendingHiderPasswordFor(null);
        setLoginError(null);
        setSeatConflictError(null);
        setLogoutNotice(
          'Die Verstecker haben ihr Passwort festgelegt – alle Spieler wurden sicherheitshalber ausgeloggt. Bitte logge dich wieder ein und klicke auf „Bereit“!'
        );
        if (authUser && firebaseMember) {
          void adapter
            .setPlayerReadyState(
              authUser.uid,
              firebaseMember.playerId,
              null,
              adapter.getServerNow()
            )
            .catch(() => {});
          void adapter
            .releasePlayerSeat(firebaseMember.playerId, authUser.uid, tabId)
            .catch(() => {});
          if (firebaseMember.isHost) {
            void adapter
              .updateMember(authUser.uid, {
                uid: firebaseMember.uid,
                playerId: firebaseMember.playerId,
                name: firebaseMember.name,
                isHost: false,
                enabled: true,
                side: firebaseMember.side,
                teamId: firebaseMember.teamId,
              })
              .catch(() => {});
          }
        }
        return;
      }

      // 2. Falls dieser Spieler ein Verstecker ist, aber das aktuelle Verstecker-Passwort in dieser Sitzung noch nicht bestätigt hat
      if (
        firebaseMember?.side === 'HIDER' &&
        activeHiderLock.passwordHash &&
        saved?.verifiedHiderPwHash !== activeHiderLock.passwordHash
      ) {
        clearStoredSession(activeHiderLock.logoutGen);
        setIsSessionUnlocked(false);
        setPendingHiderPasswordFor(firebaseMember.name);
        setLogoutNotice(
          `${firebaseMember.name} ist als Verstecker eingeteilt. Bitte gib das Verstecker-Passwort ein.`
        );
      }
    },
    [adapter, authUser, firebaseMember, isSessionUnlocked, tabId]
  );

  const clearPendingHiderPrompt = useCallback(() => {
    setPendingHiderPasswordFor(null);
    setLoginError(null);
  }, []);

  const loginByTypedName = useCallback(
    async (typedName: string, hiderPassword?: string) => {
      setLoginError(null);
      setSeatConflictError(null);
      const matched = resolveAllowedPlayerByNameInput(typedName);
      if (!matched) {
        setLoginError(
          'Dieser Name steht nicht auf der Spielerliste. Bitte gib deinen exakten Vornamen ein.'
        );
        return;
      }

      try {
        const initialSignedIn =
          authUser ?? (await adapter.signInWithPresetPlayer(matched.loginEmail));

        let ctx = await adapter.fetchLoginSecurityContext();

        // Falls auf einem komplett neuen Browser noch kein Member-Eintrag existiert und ältere DB-Rules
        // Lesezugriff erst mit aktiviertem Member erlauben: temporär neutralen UNASSIGNED-Eintrag anlegen, falls noch kein Wechsel nötig ist
        if (
          !firebaseMember &&
          !ctx.publicState &&
          !ctx.activeHiderLock &&
          Object.keys(ctx.members).length === 0
        ) {
          await adapter
            .registerSelfMemberIfMissing({
              uid: initialSignedIn.uid,
              playerId: matched.id,
              name: matched.name,
              isHost: false,
              enabled: true,
              side: 'UNASSIGNED',
              teamId: null,
            })
            .catch(() => {});
          ctx = await adapter.fetchLoginSecurityContext();
        }

        const existingAssigned = Object.values(ctx.members).find(
          (m) =>
            m.enabled && m.playerId === matched.id && m.side !== 'UNASSIGNED'
        );

        const isTargetHider = Boolean(
          ctx.activeHiderLock?.hiderPlayerIds.includes(matched.id) ||
            existingAssigned?.side === 'HIDER' ||
            (firebaseMember?.playerId === matched.id &&
              firebaseMember.side === 'HIDER')
        );

        // Wenn Verstecker-Passwort aktiv ist und Ziel-Account ein Verstecker ist -> Passwort zwingend prüfen!
        if (isTargetHider && ctx.activeHiderLock?.passwordHash) {
          if (!hiderPassword || !hiderPassword.trim()) {
            setPendingHiderPasswordFor(matched.name);
            return;
          }
          if (
            !verifyHiderPasswordHash(
              hiderPassword,
              ctx.activeHiderLock.passwordHash
            )
          ) {
            setPendingHiderPasswordFor(matched.name);
            setLoginError(
              'Falsches Verstecker-Passwort! Zugriff auf Verstecker-Account verweigert.'
            );
            return;
          }
        }

        // Erst NACH erfolgreicher Prüfung ggf. auf einen anderen Spieler wechseln
        let finalSignedIn = initialSignedIn;
        if (firebaseMember && firebaseMember.playerId !== matched.id) {
          await adapter
            .releasePlayerSeat(firebaseMember.playerId, initialSignedIn.uid, tabId)
            .catch(() => {});
          await adapter.signOut();
          finalSignedIn = await adapter.signInWithPresetPlayer(matched.loginEmail);
        }

        // Prüfe, ob bereits ein anderes Gerät diesen Spielernamen aktiv nutzt
        try {
          const seat = await adapter.tryAcquireOrRenewPlayerSeat(
            matched.id,
            finalSignedIn.uid,
            tabId,
            adapter.getServerNow()
          );
          if (!seat.acquired) {
            setLoginError(
              `${matched.name} ist bereits auf einem anderen Gerät eingeloggt!`
            );
            return;
          }
        } catch {
          // Falls playerClaims-Rules noch nicht aktiv sind, Login erlauben
        }

        const inheritedSide =
          existingAssigned?.side ?? (isTargetHider ? 'HIDER' : 'UNASSIGNED');
        const inheritedTeamId =
          inheritedSide === 'SEEKER' ? (existingAssigned?.teamId ?? null) : null;

        await adapter.registerSelfMemberIfMissing({
          uid: finalSignedIn.uid,
          playerId: matched.id,
          name: matched.name,
          isHost: false,
          enabled: true,
          side: inheritedSide,
          teamId: inheritedTeamId,
        });

        saveStoredSession({
          playerId: matched.id,
          ackLogoutGen:
            ctx.activeHiderLock?.logoutGen ?? loadLastAckLogoutGen(),
          verifiedHiderPwHash: isTargetHider
            ? (ctx.activeHiderLock?.passwordHash ?? null)
            : null,
        });

        setPendingHiderPasswordFor(null);
        setLogoutNotice(null);
        setIsSessionUnlocked(true);
      } catch {
        setLoginError(
          'Anmeldung fehlgeschlagen. Bitte prüfe deine Internetverbindung.'
        );
      }
    },
    [adapter, authUser, firebaseMember, tabId]
  );

  const unlockAdminWithCode = useCallback(
    async (code: string): Promise<{ ok: boolean; error?: string }> => {
      if (!authUser || !activeMember) {
        return { ok: false, error: 'Nicht angemeldet.' };
      }
      if (
        activeMember.playerId !== 'lasse' &&
        activeMember.playerId !== 'linus'
      ) {
        return {
          ok: false,
          error: 'Admin-Zugang ist nur für Lasse und Linus verfügbar.',
        };
      }
      const check = verifyAdminCode(code);
      if (!check.valid || !check.adminAuthHash) {
        return { ok: false, error: 'Falscher Admin-Code.' };
      }

      try {
        await adapter.updateMember(authUser.uid, {
          ...activeMember,
          isHost: true,
          enabled: true,
          side: activeMember.side === 'UNASSIGNED' ? 'HIDER' : activeMember.side,
          adminAuthHash: check.adminAuthHash,
        });
        return { ok: true };
      } catch {
        return {
          ok: false,
          error:
            'Freischaltung durch Datenbank abgelehnt. Bitte die neuesten database.rules.json in Firebase veröffentlichen.',
        };
      }
    },
    [adapter, authUser, activeMember]
  );

  const lockAdminConsole = useCallback(async () => {
    if (!authUser || !firebaseMember || !firebaseMember.isHost) return;
    const lockedCopy: MemberRecord = {
      uid: firebaseMember.uid,
      playerId: firebaseMember.playerId,
      name: firebaseMember.name,
      isHost: false,
      enabled: true,
      side: firebaseMember.side,
      teamId: firebaseMember.teamId,
    };
    try {
      await adapter.updateMember(authUser.uid, lockedCopy);
    } catch {
      // Ignorieren
    }
  }, [adapter, authUser, firebaseMember]);

  const claimInitialHost = useCallback(async () => {
    setLoginError(
      'Bitte logge dich als Lasse oder Linus ein und schalte den Admin-Modus über den Admin-Code frei.'
    );
  }, []);

  const exitOrLogout = useCallback(async () => {
    setLoginError(null);
    setSeatConflictError(null);
    setLogoutNotice(null);
    setPendingHiderPasswordFor(null);
    clearStoredSession(loadLastAckLogoutGen());
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
    logoutNotice,
    pendingHiderPasswordFor,
    clearPendingHiderPrompt,
    loginByTypedName,
    syncWithActiveHiderLock,
    unlockAdminWithCode,
    lockAdminConsole,
    claimInitialHost,
    exitOrLogout,
  };
}
