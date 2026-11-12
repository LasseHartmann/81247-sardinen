import { useEffect, useState } from 'react';

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
}

/**
 * Hält das Smartphone-Display während laufender Spielrunden wach (`navigator.wakeLock`)
 * und fordert den Wake-Lock beim Zurückkehren in den Tab automatisch neu an.
 */
export function useWakeLock(active: boolean): { wakeLockSupported: boolean; wakeLockHeld: boolean } {
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
      try {
        const navWithWake = navigator as Navigator & {
          wakeLock?: {
            request: (type: 'screen') => Promise<WakeLockSentinelLike>;
          };
        };
        if (!navWithWake.wakeLock) return;
        sentinel = await navWithWake.wakeLock.request('screen');
        if (!cancelled) {
          setHeld(true);
        }
      } catch {
        if (!cancelled) {
          setHeld(false);
        }
      }
    };

    void acquire();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && !cancelled) {
        void acquire();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (sentinel) {
        sentinel.release().catch(() => {});
      }
      setHeld(false);
    };
  }, [active, supported]);

  return { wakeLockSupported: supported, wakeLockHeld: held };
}
