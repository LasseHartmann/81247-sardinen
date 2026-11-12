import { useCallback, useEffect, useState } from 'react';
import { isFirebaseConfigured } from '../config/firebase';
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
 * Verwaltet den direkten Login per Namenseingabe (strikte Whitelist der 11 Freunde,
 * kein Dropdown, kein Passwort). Lasse und Linus können nach dem Login über einen Button
 * per 4-stelligem Admin-Code ihre Admin-Rechte (`isHost: true`) freischalten.
 */
export function useAuth(): {
  adapter: DatabaseAdapter;
  isDemoMode: boolean;
  firebaseAvailable: boolean;
  authUser: AuthUserSummary | null;
  authLoading: boolean;
  ownMember: MemberRecord | null;
  memberLoading: boolean;
  ownJoinRequest: JoinRequest | null;
  loginError: string | null;
  loginByTypedName: (typedName: string) => Promise<void>;
  unlockAdminWithCode: (code: string) => Promise<{ ok: boolean; error?: string }>;
  claimInitialHost: () => Promise<void>;
  enterDemoMode: () => void;
  exitDemoOrLogout: () => Promise<void>;
} {
  const [forceDemo, setForceDemo] = useState<boolean>(() => !isFirebaseConfigured);
  const adapter = resolveDatabaseAdapter(forceDemo);
  const isDemoMode = adapter.mode === 'demo';

  const [authUser, setAuthUser] = useState<AuthUserSummary | null>(null);
  const [authLoading, setAuthLoading] = useState<boolean>(!isDemoMode);
  const [ownMember, setOwnMember] = useState<MemberRecord | null>(null);
  const [memberLoading, setMemberLoading] = useState<boolean>(false);
  const [ownJoinRequest, setOwnJoinRequest] = useState<JoinRequest | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [demoUnlocked, setDemoUnlocked] = useState<boolean>(false);

  useEffect(() => {
    setAuthLoading(true);
    const unsub = adapter.subscribeAuth((user) => {
      if (isDemoMode && !demoUnlocked && isFirebaseConfigured) {
        setAuthUser(null);
        setAuthLoading(false);
        return;
      }
      setAuthUser(user);
      setAuthLoading(false);
    });
    return unsub;
  }, [adapter, isDemoMode, demoUnlocked]);

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

      if (!member && !attemptedAutoRegister) {
        attemptedAutoRegister = true;
        const chosen = loadChosenPlayer();
        if (chosen) {
          void adapter
            .registerSelfMemberIfMissing({
              uid: authUser.uid,
              playerId: chosen.id,
              name: chosen.name,
              isHost: false,
              enabled: true,
              side: 'UNASSIGNED',
              teamId: null,
            })
            .catch(() => {
              void adapter
                .upsertJoinRequest({
                  uid: authUser.uid,
                  playerId: chosen.id,
                  name: chosen.name,
                  requestedAt: adapter.getServerNow(),
                })
                .catch(() => {});
            });
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

  // Multi-Tab-Präsenz registrieren
  useEffect(() => {
    if (!authUser || !ownMember?.enabled) return;
    const tabId = getOrCreateBrowserTabSessionId();
    const ua =
      typeof navigator !== 'undefined'
        ? navigator.userAgent.slice(0, 64)
        : 'Browser';
    return adapter.registerTabPresence(authUser.uid, tabId, ua);
  }, [adapter, authUser, ownMember?.enabled]);

  const loginByTypedName = useCallback(
    async (typedName: string) => {
      setLoginError(null);
      const matched = resolveAllowedPlayerByNameInput(typedName);
      if (!matched) {
        setLoginError(
          'Dieser Name steht nicht auf der Spielerliste. Bitte gib deinen exakten Vornamen ein.'
        );
        return;
      }

      saveChosenPlayer(matched);

      try {
        if (!isDemoMode && authUser) {
          await adapter.signOut();
        }
        const signedIn = await adapter.signInWithPresetPlayer(matched.loginEmail);
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
          'Anmeldung fehlgeschlagen. Prüfe bitte, ob in Firebase unter „Authentication → Sign-in method“ „Anonym“ aktiviert ist und die neuesten database.rules.json veröffentlicht wurden.'
        );
      }
    },
    [adapter, authUser, isDemoMode]
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

  const claimInitialHost = useCallback(async () => {
    setLoginError(
      'Bitte logge dich als Lasse oder Linus ein und schalte den Admin-Modus über den Admin-Code frei.'
    );
  }, []);

  const enterDemoMode = useCallback(() => {
    setLoginError(null);
    setForceDemo(true);
    setDemoUnlocked(true);
  }, []);

  const exitDemoOrLogout = useCallback(async () => {
    setLoginError(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CHOSEN_PLAYER_STORAGE_KEY);
    }
    if (isDemoMode) {
      setDemoUnlocked(false);
      if (isFirebaseConfigured) {
        setForceDemo(false);
      } else {
        setAuthUser(null);
      }
      return;
    }
    await adapter.signOut();
  }, [adapter, isDemoMode]);

  return {
    adapter,
    isDemoMode,
    firebaseAvailable: isFirebaseConfigured,
    authUser,
    authLoading,
    ownMember,
    memberLoading,
    ownJoinRequest,
    loginError,
    loginByTypedName,
    unlockAdminWithCode,
    claimInitialHost,
    enterDemoMode,
    exitDemoOrLogout,
  };
}
