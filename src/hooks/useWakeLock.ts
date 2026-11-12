import { useEffect, useState } from 'react';

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
}

/**
 * Hält das Smartphone-Display während des Spielens zuverlässig wach (`navigator.wakeLock`),
 * fordert den Lock automatisch bei jeder Rückkehr in den Tab oder bei der nächsten Touch-Geste
 * neu an, falls der Browser ihn zwischendurch freigegeben hat.
 */
export function useWakeLock(active: boolean): {
  wakeLockSupported: boolean;
  wakeLockHeld: boolean;
} {
  const supported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!active || !supported) {
      setHeld(false);
      return;
    }

    let cancelled = false;
    let sentinel: WakeLockSentinelLike | null = null;

    const acquire = async () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      if (sentinel && !sentinel.released) {
        setHeld(true);
        return;
      }
      try {
        const navWithWake = navigator as Navigator & {
          wakeLock?: {
            request: (type: 'screen') => Promise<WakeLockSentinelLike>;
          };
        };
        if (!navWithWake.wakeLock) return;
        const nextSentinel = await navWithWake.wakeLock.request('screen');
        if (cancelled) {
          nextSentinel.release().catch(() => {});
          return;
        }
        sentinel = nextSentinel;
        setHeld(true);
        nextSentinel.addEventListener?.('release', () => {
          if (!cancelled) {
            setHeld(false);
          }
        });
      } catch {
        if (!cancelled) {
          setHeld(false);
        }
      }
    };

    void acquire();

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        void acquire();
      }
    };

    // Manche mobilen Browser (insb. iOS Safari / PWAs) erlauben wakeLock.request erst nach einer Nutzerinteraktion
    const onUserInteraction = () => {
      if (!cancelled && (!sentinel || sentinel.released)) {
        void acquire();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', onVisibilityOrFocus);
    window.addEventListener('pointerdown', onUserInteraction, { passive: true });
    window.addEventListener('touchstart', onUserInteraction, { passive: true });

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', onVisibilityOrFocus);
      window.removeEventListener('pointerdown', onUserInteraction);
      window.removeEventListener('touchstart', onUserInteraction);
      if (sentinel) {
        sentinel.release().catch(() => {});
      }
      setHeld(false);
    };
  }, [active, supported]);

  return { wakeLockSupported: supported, wakeLockHeld: held };
}
