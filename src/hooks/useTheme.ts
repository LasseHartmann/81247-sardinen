import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'sardinen_theme_preference';

function readStoredTheme(): ThemeMode | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'dark' || raw === 'light') return raw;
  } catch {
    // localStorage blockiert
  }
  return null;
}

function readDeviceTheme(): ThemeMode {
  if (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function'
  ) {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    } catch {
      return 'light';
    }
  }
  return 'light';
}

export function resolveInitialTheme(): ThemeMode {
  return readStoredTheme() ?? readDeviceTheme();
}

export function applyThemeToDocument(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#000000' : '#F1F1F3');
  }
}

const listeners = new Set<() => void>();

function notifyThemeListeners(): void {
  for (const fn of listeners) {
    fn();
  }
}

export function useTheme(): {
  theme: ThemeMode;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (next: ThemeMode) => void;
} {
  const [theme, setThemeState] = useState<ThemeMode>(() =>
    resolveInitialTheme()
  );

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    const syncFromCurrent = () => {
      const next = resolveInitialTheme();
      setThemeState(next);
      applyThemeToDocument(next);
    };

    listeners.add(syncFromCurrent);

    let mql: MediaQueryList | null = null;
    const handleMediaChange = () => {
      // Nur folgen, solange der Nutzer noch nicht selbst umgeschaltet hat
      if (readStoredTheme() === null) {
        syncFromCurrent();
      }
    };

    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
    ) {
      try {
        mql = window.matchMedia('(prefers-color-scheme: dark)');
        if (typeof mql.addEventListener === 'function') {
          mql.addEventListener('change', handleMediaChange);
        }
      } catch {
        mql = null;
      }
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) {
        syncFromCurrent();
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      listeners.delete(syncFromCurrent);
      if (mql && typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', handleMediaChange);
      }
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // localStorage nicht verfügbar
    }
    setThemeState(next);
    applyThemeToDocument(next);
    notifyThemeListeners();
  }, []);

  const toggleTheme = useCallback(() => {
    const current = resolveInitialTheme();
    setTheme(current === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  return {
    theme,
    isDark: theme === 'dark',
    toggleTheme,
    setTheme,
  };
}
