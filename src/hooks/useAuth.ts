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
const ACTIVE_TAB_CHANNEL_NAME = 'sardinen_81247_single_tab_guard';

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
 * verhindert Doppelbelegung desselben Spielers (nur 1 Person + nur 1 aktiver Browser-Tab pro Name)
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
  duplicateTabBlocked: boolean;
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
  const [duplicateTabBlocked, setDuplicateTabBlocked] = useState<boolean>(false);
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

  // Lokaler Multi-Tab-Schutz (BroadcastChannel): verhindert versehentlich zwei offene Tabs auf demselben Handy/Browser
  useEffect(() => {
    if (!authUser || !ownMember?.enabled) {
      setDuplicateTabBlocked(false);
      return;
    }
    if (typeof BroadcastChannel === 'undefined') return;

    const channel = new BroadcastChannel(ACTIVE_TAB_CHANNEL_NAME);
    let iAmOlderActiveTab = false;

    channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as {
        type?: string;
        tabId?: string;
        playerId?: string;
      } | null;
      if (!msg || msg.tabId === tabId || msg.playerId !== ownMember.playerId) {
        return;
      }
      if (msg.type === 'TAB_HELLO') {
        if (iAmOlderActiveTab) {
          channel.postMessage({
            type: 'TAB_ALREADY_OPEN',
            tabId,
            playerId: ownMember.playerId,
          });
        }
      } else if (msg.type === 'TAB_ALREADY_OPEN') {
        setDuplicateTabBlocked(true);
      }
    };

    channel.postMessage({
      type: 'TAB_HELLO',
      tabId,
      playerId: ownMember.playerId,
    });

    const markEstablishedTimer = setTimeout(() => {
      iAmOlderActiveTab = true;
    }, 250);

    return () => {
      clearTimeout(markEstablishedTimer);
      channel.close();
    };
  }, [authUser, ownMember?.enabled, ownMember?.playerId, tabId]);

  useEffect(() => {
    if (!authUser) {
      setOwnMember(null);
      setOwnJoinRequest(null);
      setMemberLoading(false);
      return;
    }

    setMemberLoading(true);
    let attemptedAutoRegister = false;

    const unsubMember = adapter.subscribeOwnMember(authUser.uid, (member) => {
      setOwnMember(member);
      setMemberLoading(false);

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
          void adapter
            .tryAcquireOrRenewPlayerSeat(
              chosen.id,
              authUser.uid,
              tabId,
              adapter.getServerNow()
            )
            .then(({ acquired }) => {
              if (!acquired) {
                setSeatConflictError(
                  `${chosen.name} ist bereits in einem anderen Tab oder auf einem anderen Gerät aktiv eingeloggt.`
                );
                void adapter.signOut();
                return;
              }
              return adapter.registerSelfMemberIfMissing({
                uid: authUser.uid,
                playerId: chosen.id,
                name: chosen.name,
                isHost: false,
                enabled: true,
                side: 'UNASSIGNED',
                teamId: null,
              });
            })
            .catch(() => {});
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

  // Globale 1-Person-pro-Name-Sitzsperre + Heartbeat + Freigabe beim Schließen
  useEffect(() => {
    if (!authUser || !ownMember?.enabled || duplicateTabBlocked) return;

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
            `${playerName} ist bereits auf einem anderen Gerät oder in einem anderen Tab aktiv.`
          );
        } else if (!cancelled) {
          setSeatConflictError(null);
        }
      } catch {
        // Bei kurzzeitigem Offline-Zustand nicht sofort sperren
      }
    };

    void beat();
    const interval = setInterval(() => {
      void beat();
    }, PLAYER_SEAT_HEARTBEAT_MS);

    const onUnload = () => {
      void adapter.releasePlayerSeat(playerId, uid, tabId);
    };
    window.addEventListener('beforeunload', onUnload);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('beforeunload', onUnload);
      void adapter.releasePlayerSeat(playerId, uid, tabId);
    };
  }, [adapter, authUser, duplicateTabBlocked, ownMember?.enabled, ownMember?.name, ownMember?.playerId, tabId]);

  // Multi-Tab-Präsenz registrieren
  useEffect(() => {
    if (!authUser || !ownMember?.enabled || duplicateTabBlocked) return;
    const ua =
      typeof navigator !== 'undefined'
        ? navigator.userAgent.slice(0, 64)
        : 'Browser';
    return adapter.registerTabPresence(authUser.uid, tabId, ua);
  }, [adapter, authUser, duplicateTabBlocked, ownMember?.enabled, tabId]);

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
        if (authUser) {
          if (ownMember) {
            await adapter.releasePlayerSeat(ownMember.playerId, authUser.uid, tabId);
          }
          await adapter.signOut();
        }
        const signedIn = await adapter.signInWithPresetPlayer(matched.loginEmail);

        // Prüfe atomar, ob dieser Spielername bereits aktiv belegt ist!
        const seat = await adapter.tryAcquireOrRenewPlayerSeat(
          matched.id,
          signedIn.uid,
          tabId,
          adapter.getServerNow()
        );
        if (!seat.acquired) {
          await adapter.signOut();
          setLoginError(
            `${matched.name} ist bereits eingeloggt! Jeder Name kann nur einmal gleichzeitig aktiv sein.`
          );
          return;
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
          'Anmeldung fehlgeschlagen. Bitte prüfe deine Verbindung und stelle sicher, dass die aktuellen database.rules.json in Firebase veröffentlicht sind.'
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
    setDuplicateTabBlocked(false);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CHOSEN_PLAYER_STORAGE_KEY);
    }
    if (authUser && ownMember) {
      await adapter.releasePlayerSeat(ownMember.playerId, authUser.uid, tabId);
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
    duplicateTabBlocked,
    seatConflictError,
    loginError,
    loginByTypedName,
    unlockAdminWithCode,
    lockAdminConsole,
    claimInitialHost,
    exitOrLogout,
  };
}
