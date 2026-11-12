import { useCallback, useEffect, useState } from 'react';
import { isFirebaseConfigured } from '../config/firebase';
import { PLAYER_SEAT_HEARTBEAT_MS } from '../config/gameConfig';
import {
  findPresetPlayerById,
  resolveAllowedPlayerByNameInput,
  verifyAdminCode,
  type PresetPlayer,
} from '../config/players';
import { resolveDatabaseAdapter, type DatabaseAdapter } from '../services/databaseAdapter';
import { generateRandomId } from '../services/qrService';
import type { AuthUserSummary, JoinRequest, MemberRecord } from '../types/game';

const BROWSER_TAB_SESSION_KEY = 'sardinen_81247_tab_session_id';
const CHOSEN_PLAYER_STORAGE_KEY = 'sardinen_81247_chosen_player_v4';

function saveChosenPlayer(preset: PresetPlayer): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(
        CHOSEN_PLAYER_STORAGE_KEY,
        JSON.stringify({ playerId: preset.id })
      );
    }
  } catch {
    // Ignorieren
  }
}

function loadChosenPlayer(): PresetPlayer | null {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(CHOSEN_PLAYER_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { playerId?: string };
        if (parsed?.playerId) {
          return findPresetPlayerById(parsed.playerId) ?? null;
        }
      }
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
 * Verwaltet den direkten Login per Namenseingabe (strikte Whitelist der 11 Freunde),
 * verhindert Doppelbelegung durch fremde Geräte (ohne mehrere Tabs desselben Nutzers zu sperren)
 * und schaltet Admin-Rechte für Lasse & Linus per 4-stelligem Code frei.
 */
export function useAuth(): {
  adapter: DatabaseAdapter;
  firebaseAvailable: boolean;
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  ownMember: MemberRecord | null;
  memberLoading: boolean;
  ownJoinRequest: JoinRequest | null;
  seatConflictError: string | null;
  loginError: string | null;
  loginByTypedName: (typedName: string) => Promise<void>;
  unlockAdminWithCode: (code: string) => Promise<{ ok: boolean; error?: string }>;
  lockAdminConsole: () => Promise<void>;
  claimInitialHost: () => Promise<void>;
  exitOrLogout: () => Promise<void>;
} {
  const adapter = resolveDatabaseAdapter(false);

  const [authUser, setAuthUser] = useState<AuthUserSummary | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(true);
  const [ownMember, setOwnMember] = useState<MemberRecord | null>(null);
  const [memberLoading, setMemberLoading] = useState<boolean>(false);
  const [ownJoinRequest, setOwnJoinRequest] = useState<JoinRequest | null>(null);
  const [seatConflictError, setSeatConflictError] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);

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
      setOwnMember(null);
      setOwnJoinRequest(null);
      setMemberLoading(false);
      return;
    }

    setMemberLoading(true);
    let attemptedAutoRegister = false;
    let hadExistingMember = false;

    const unsubMember = adapter.subscribeOwnMember(authUser.uid, (member) => {
      setOwnMember(member);
      setMemberLoading(false);

      if (member) {
        hadExistingMember = true;
      } else if (hadExistingMember) {
        // Spieler wurde vom Admin aus der Runde gekickt!
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(CHOSEN_PLAYER_STORAGE_KEY);
        }
        setLoginError('Du wurdest vom Spielleiter aus der Runde entfernt.');
        void adapter.signOut();
        return;
      }

      // Beim frischen Öffnen/Neuladen der App sicherstellen, dass ein offenes Admin-Flag sofort gesperrt startet
      if (member && member.isHost && !attemptedAutoRegister) {
        attemptedAutoRegister = true;
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
        return;
      }

      if (!member && !attemptedAutoRegister) {
        attemptedAutoRegister = true;
        const chosen = loadChosenPlayer();
        if (chosen) {
          void (async () => {
            try {
              const seat = await adapter.tryAcquireOrRenewPlayerSeat(
                chosen.id,
                authUser.uid,
                tabId,
                adapter.getServerNow()
              );
              if (!seat.acquired) {
                setSeatConflictError(
                  `${chosen.name} ist bereits auf einem anderen Gerät aktiv eingeloggt.`
                );
                void adapter.signOut();
                return;
              }
            } catch {
              // Falls Firebase-Regeln für playerClaims noch nicht veröffentlicht sind, Login nicht blockieren
            }
            try {
              await adapter.registerSelfMemberIfMissing({
                uid: authUser.uid,
                playerId: chosen.id,
                name: chosen.name,
                isHost: false,
                enabled: true,
                side: 'UNASSIGNED',
                teamId: null,
              });
            } catch {
              // Ignorieren
            }
          })();
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
  }, [adapter, authUser, tabId]);

  // Globale 1-Person-pro-Name-Sitzsperre (pro UID/Gerät, niemals Tab-Sperre im selben Browser!)
  useEffect(() => {
    if (!authUser || !ownMember?.enabled) return;

    let cancelled = false;
    const playerId = ownMember.playerId;
    const playerName = ownMember.name;
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
        // Bei kurzzeitigem Offline-Zustand oder fehlenden Rules nicht sperren
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
  }, [adapter, authUser, ownMember?.enabled, ownMember?.name, ownMember?.playerId, tabId]);

  // Präsenz registrieren
  useEffect(() => {
    if (!authUser || !ownMember?.enabled) return;
    const ua =
      typeof navigator !== 'undefined'
        ? navigator.userAgent.slice(0, 64)
        : 'Browser';
    return adapter.registerTabPresence(authUser.uid, tabId, ua);
  }, [adapter, authUser, ownMember?.enabled, tabId]);

  const loginByTypedName = useCallback(
    async (typedName: string) => {
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
        // Nur ausloggen, falls auf einen anderen Spielernamen gewechselt wird
        if (authUser && ownMember && ownMember.playerId !== matched.id) {
          await adapter
            .releasePlayerSeat(ownMember.playerId, authUser.uid, tabId)
            .catch(() => {});
          await adapter.signOut();
        }
        const signedIn = await adapter.signInWithPresetPlayer(matched.loginEmail);

        // Prüfe, ob bereits ein anderes Gerät (andere UID) diesen Spielernamen nutzt
        try {
          const seat = await adapter.tryAcquireOrRenewPlayerSeat(
            matched.id,
            signedIn.uid,
            tabId,
            adapter.getServerNow()
          );
          if (!seat.acquired) {
            await adapter.signOut();
            setLoginError(
              `${matched.name} ist bereits auf einem anderen Gerät eingeloggt!`
            );
            return;
          }
        } catch {
          // Falls playerClaims-Rules in Firebase noch nicht aktualisiert sind, Login trotzdem erlauben
        }

        saveChosenPlayer(matched);
        await adapter.registerSelfMemberIfMissing({
          uid: signedIn.uid,
          playerId: matched.id,
          name: matched.name,
          isHost: false,
          enabled: true,
          side: 'UNASSIGNED',
          teamId: null,
        });
      } catch {
        setLoginError(
          'Anmeldung fehlgeschlagen. Bitte prüfe deine Internetverbindung.'
        );
      }
    },
    [adapter, authUser, ownMember, tabId]
  );

  const unlockAdminWithCode = useCallback(
    async (code: string): Promise<{ ok: boolean; error?: string }> => {
      if (!authUser || !ownMember) {
        return { ok: false, error: 'Nicht angemeldet.' };
      }
      if (ownMember.playerId !== 'lasse' && ownMember.playerId !== 'linus') {
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
          ...ownMember,
          isHost: true,
          enabled: true,
          side: ownMember.side === 'UNASSIGNED' ? 'HIDER' : ownMember.side,
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
    [adapter, authUser, ownMember]
  );

  const lockAdminConsole = useCallback(async () => {
    if (!authUser || !ownMember || !ownMember.isHost) return;
    const lockedCopy: MemberRecord = {
      uid: ownMember.uid,
      playerId: ownMember.playerId,
      name: ownMember.name,
      isHost: false,
      enabled: true,
      side: ownMember.side,
      teamId: ownMember.teamId,
    };
    try {
      await adapter.updateMember(authUser.uid, lockedCopy);
    } catch {
      // Ignorieren
    }
  }, [adapter, authUser, ownMember]);

  const claimInitialHost = useCallback(async () => {
    setLoginError(
      'Bitte logge dich als Lasse oder Linus ein und schalte den Admin-Modus über den Admin-Code frei.'
    );
  }, []);

  const exitOrLogout = useCallback(async () => {
    setLoginError(null);
    setSeatConflictError(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CHOSEN_PLAYER_STORAGE_KEY);
    }
    if (authUser && ownMember) {
      await adapter
        .releasePlayerSeat(ownMember.playerId, authUser.uid, tabId)
        .catch(() => {});
    }
    await adapter.signOut();
  }, [adapter, authUser, ownMember, tabId]);

  return {
    adapter,
    firebaseAvailable: isFirebaseConfigured,
    authUser,
    authLoading,
    ownMember,
    memberLoading,
    ownJoinRequest,
    seatConflictError,
    loginError,
    loginByTypedName,
    unlockAdminWithCode,
    lockAdminConsole,
    claimInitialHost,
    exitOrLogout,
  };
}
