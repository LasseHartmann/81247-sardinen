import type { PlayerAllTimeStats } from '../types/game';

export const AVATAR_LOGO_ID = 'LOGO';

export const PLAYER_AVATAR_OPTIONS: ReadonlyArray<{
  id: string;
  label: string;
}> = [
  { id: '', label: 'Kein Icon' },
  { id: AVATAR_LOGO_ID, label: '81247 Sardinen Logo' },
  { id: '🐟', label: 'Sardine' },
  { id: '🦈', label: 'Hai' },
  { id: '🐙', label: 'Krake' },
  { id: '🦊', label: 'Fuchs' },
  { id: '🐺', label: 'Wolf' },
  { id: '🦅', label: 'Adler' },
  { id: '🕵️', label: 'Detektiv' },
  { id: '🥷', label: 'Ninja' },
  { id: '⚡', label: 'Blitz' },
  { id: '🔥', label: 'Feuer' },
  { id: '🧭', label: 'Kompass' },
  { id: '🎯', label: 'Volltreffer' },
  { id: '👑', label: 'Krone' },
  { id: '👻', label: 'Geist' },
  { id: '🚀', label: 'Rakete' },
  { id: '🥨', label: 'Brezn' },
  { id: '🌲', label: 'Wald' },
  { id: '💎', label: 'Diamant' },
];

export interface PlayerDevicePreferences {
  soundEnabled: boolean;
  soundVolume: number; // 0.1 .. 1.0
  vibrationEnabled: boolean;
  notificationsEnabled: boolean;
  powerSaveMode: boolean;
}

const PREFS_STORAGE_KEY = 'sardinen_81247_device_prefs_v1';
const STATS_STORAGE_PREFIX = 'sardinen_81247_player_stats_v1_';

export const DEFAULT_DEVICE_PREFERENCES: PlayerDevicePreferences = {
  soundEnabled: true,
  soundVolume: 0.7,
  vibrationEnabled: true,
  notificationsEnabled: false,
  powerSaveMode: false,
};

export function loadDevicePreferences(): PlayerDevicePreferences {
  try {
    if (typeof localStorage === 'undefined') {
      return { ...DEFAULT_DEVICE_PREFERENCES };
    }
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DEVICE_PREFERENCES };
    const parsed = JSON.parse(raw) as Partial<PlayerDevicePreferences>;
    return {
      soundEnabled:
        typeof parsed.soundEnabled === 'boolean'
          ? parsed.soundEnabled
          : DEFAULT_DEVICE_PREFERENCES.soundEnabled,
      soundVolume:
        typeof parsed.soundVolume === 'number' &&
        Number.isFinite(parsed.soundVolume)
          ? Math.min(1, Math.max(0.1, parsed.soundVolume))
          : DEFAULT_DEVICE_PREFERENCES.soundVolume,
      vibrationEnabled:
        typeof parsed.vibrationEnabled === 'boolean'
          ? parsed.vibrationEnabled
          : DEFAULT_DEVICE_PREFERENCES.vibrationEnabled,
      notificationsEnabled:
        typeof parsed.notificationsEnabled === 'boolean'
          ? parsed.notificationsEnabled
          : DEFAULT_DEVICE_PREFERENCES.notificationsEnabled,
      powerSaveMode:
        typeof parsed.powerSaveMode === 'boolean'
          ? parsed.powerSaveMode
          : DEFAULT_DEVICE_PREFERENCES.powerSaveMode,
    };
  } catch {
    return { ...DEFAULT_DEVICE_PREFERENCES };
  }
}

export function saveDevicePreferences(prefs: PlayerDevicePreferences): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    }
  } catch {
    // Ignorieren
  }
  applyPowerSaveAttributeToDom(prefs.powerSaveMode);
}

export function applyPowerSaveAttributeToDom(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  if (enabled) {
    document.documentElement.setAttribute('data-power-save', 'true');
  } else {
    document.documentElement.removeAttribute('data-power-save');
  }
}

export type FeedbackSoundKind = 'START' | 'RADAR' | 'CLUE' | 'ALERT' | 'TEST';

let sharedAudioCtx: AudioContext | null = null;

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

export function playFeedbackSound(
  kind: FeedbackSoundKind,
  prefsInput?: PlayerDevicePreferences
): void {
  const prefs = prefsInput ?? loadDevicePreferences();
  if (!prefs.soundEnabled) return;
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const vol = Math.min(1, Math.max(0.05, prefs.soundVolume)) * 0.22;

  const scheduleTone = (
    freqHz: number,
    startOffsetSec: number,
    durationSec: number,
    wave: OscillatorType = 'triangle'
  ) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freqHz, now + startOffsetSec);
    gain.gain.setValueAtTime(0.0001, now + startOffsetSec);
    gain.gain.exponentialRampToValueAtTime(
      vol,
      now + startOffsetSec + 0.015
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + startOffsetSec + durationSec
    );
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now + startOffsetSec);
    osc.stop(now + startOffsetSec + durationSec + 0.02);
  };

  switch (kind) {
    case 'START':
      scheduleTone(523.25, 0, 0.11, 'triangle');
      scheduleTone(659.25, 0.12, 0.11, 'triangle');
      scheduleTone(783.99, 0.24, 0.18, 'triangle');
      break;
    case 'RADAR':
      scheduleTone(880, 0, 0.09, 'sine');
      scheduleTone(1174.66, 0.11, 0.15, 'sine');
      break;
    case 'CLUE':
      scheduleTone(587.33, 0, 0.08, 'triangle');
      scheduleTone(880, 0.09, 0.13, 'triangle');
      break;
    case 'ALERT':
      scheduleTone(440, 0, 0.14, 'sawtooth');
      scheduleTone(349.23, 0.16, 0.18, 'sawtooth');
      break;
    case 'TEST':
    default:
      scheduleTone(659.25, 0, 0.09, 'triangle');
      scheduleTone(987.77, 0.1, 0.14, 'triangle');
      break;
  }
}

export function triggerFeedbackVibration(
  kind: 'SHORT' | 'DOUBLE' | 'ALARM',
  prefsInput?: PlayerDevicePreferences
): boolean {
  const prefs = prefsInput ?? loadDevicePreferences();
  if (!prefs.vibrationEnabled) return false;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return false;
  }
  try {
    const pattern =
      kind === 'ALARM'
        ? [180, 80, 180, 80, 240]
        : kind === 'DOUBLE'
          ? [90, 60, 120]
          : [70];
    return navigator.vibrate(pattern);
  } catch {
    return false;
  }
}

export function getNotificationSupportState():
  | 'UNSUPPORTED'
  | NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'UNSUPPORTED';
  }
  return Notification.permission;
}

export async function requestSystemNotificationPermission(): Promise<
  'UNSUPPORTED' | NotificationPermission
> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'UNSUPPORTED';
  }
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function dispatchSystemNotification(
  title: string,
  body: string,
  prefsInput?: PlayerDevicePreferences
): void {
  const prefs = prefsInput ?? loadDevicePreferences();
  if (!prefs.notificationsEnabled) return;
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body,
      icon: '/logo.png',
      tag: `sardinen-81247-${title}`,
    });
  } catch {
    // Auf manchen Mobilbrowsern ist Notification() ohne ServiceWorker eingeschränkt
  }
}

export function createEmptyPlayerStats(): PlayerAllTimeStats {
  return {
    roundsPlayed: 0,
    catchesAsSeeker: 0,
    roundsAsHider: 0,
    bestSearchTimeMs: null,
    longestHiderTimeMs: 0,
    totalDistanceMeters: 0,
    cluesBought: 0,
    participatedSessionIds: [],
    caughtSessionIds: [],
  };
}

export function normalizePlayerStats(
  raw?: Partial<PlayerAllTimeStats> | null
): PlayerAllTimeStats {
  if (!raw) return createEmptyPlayerStats();
  return {
    roundsPlayed: Math.max(0, Math.round(raw.roundsPlayed ?? 0)),
    catchesAsSeeker: Math.max(0, Math.round(raw.catchesAsSeeker ?? 0)),
    roundsAsHider: Math.max(0, Math.round(raw.roundsAsHider ?? 0)),
    bestSearchTimeMs:
      typeof raw.bestSearchTimeMs === 'number' &&
      Number.isFinite(raw.bestSearchTimeMs) &&
      raw.bestSearchTimeMs > 0
        ? Math.round(raw.bestSearchTimeMs)
        : null,
    longestHiderTimeMs: Math.max(0, Math.round(raw.longestHiderTimeMs ?? 0)),
    totalDistanceMeters: Math.max(0, Math.round(raw.totalDistanceMeters ?? 0)),
    cluesBought: Math.max(0, Math.round(raw.cluesBought ?? 0)),
    participatedSessionIds: Array.isArray(raw.participatedSessionIds)
      ? Array.from(new Set(raw.participatedSessionIds)).slice(-60)
      : [],
    caughtSessionIds: Array.isArray(raw.caughtSessionIds)
      ? Array.from(new Set(raw.caughtSessionIds)).slice(-60)
      : [],
  };
}

export function mergePlayerStats(
  a?: Partial<PlayerAllTimeStats> | null,
  b?: Partial<PlayerAllTimeStats> | null
): PlayerAllTimeStats {
  const na = normalizePlayerStats(a);
  const nb = normalizePlayerStats(b);
  const mergedSessions = Array.from(
    new Set([
      ...(na.participatedSessionIds ?? []),
      ...(nb.participatedSessionIds ?? []),
    ])
  ).slice(-60);
  const mergedCaught = Array.from(
    new Set([...(na.caughtSessionIds ?? []), ...(nb.caughtSessionIds ?? [])])
  ).slice(-60);

  const bestSearch =
    na.bestSearchTimeMs !== null && nb.bestSearchTimeMs !== null
      ? Math.min(na.bestSearchTimeMs, nb.bestSearchTimeMs)
      : (na.bestSearchTimeMs ?? nb.bestSearchTimeMs ?? null);

  return {
    roundsPlayed: Math.max(
      na.roundsPlayed,
      nb.roundsPlayed,
      mergedSessions.length
    ),
    catchesAsSeeker: Math.max(
      na.catchesAsSeeker,
      nb.catchesAsSeeker,
      mergedCaught.length
    ),
    roundsAsHider: Math.max(na.roundsAsHider, nb.roundsAsHider),
    bestSearchTimeMs: bestSearch,
    longestHiderTimeMs: Math.max(na.longestHiderTimeMs, nb.longestHiderTimeMs),
    totalDistanceMeters: Math.max(
      na.totalDistanceMeters,
      nb.totalDistanceMeters
    ),
    cluesBought: Math.max(na.cluesBought, nb.cluesBought),
    participatedSessionIds: mergedSessions,
    caughtSessionIds: mergedCaught,
  };
}

export function loadLocalPlayerStats(playerId: string): PlayerAllTimeStats {
  const key = `${STATS_STORAGE_PREFIX}${playerId.trim().toLowerCase()}`;
  try {
    if (typeof localStorage === 'undefined') return createEmptyPlayerStats();
    const raw = localStorage.getItem(key);
    if (!raw) return createEmptyPlayerStats();
    return normalizePlayerStats(
      JSON.parse(raw) as Partial<PlayerAllTimeStats>
    );
  } catch {
    return createEmptyPlayerStats();
  }
}

export function saveLocalPlayerStats(
  playerId: string,
  stats: PlayerAllTimeStats
): void {
  const key = `${STATS_STORAGE_PREFIX}${playerId.trim().toLowerCase()}`;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(normalizePlayerStats(stats)));
    }
  } catch {
    // Ignorieren
  }
}
