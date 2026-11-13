import React, { useCallback, useEffect, useRef } from 'react';

export interface PhysicsBottomSheetProps {
  collapsed: boolean;
  onCollapsedChange: (nextCollapsed: boolean) => void;
  header: React.ReactNode;
  children: React.ReactNode;
  maxWidthClass?: string;
  sheetClassName?: string;
  bodyClassName?: string;
  handleTestId?: string;
  allowBodyDrag?: boolean;
}

interface VelocitySample {
  y: number;
  t: number;
}

const SPRING_STIFFNESS = 390;
const SPRING_DAMPING = 32;
const FLICK_VELOCITY_THRESHOLD = 360; // px/s
const DRAG_SLOP_PX = 5;

function rubberBand(distance: number, maxStretch: number): number {
  if (distance <= 0 || maxStretch <= 0) return 0;
  const c = 0.55;
  return (
    (1 - 1 / ((distance * c) / maxStretch + 1)) * maxStretch
  );
}

/**
 * Taktiles Bottom-Sheet mit echter Feder-Dämpfer-Physik (60/120fps via direktem DOM-Transform):
 * - 1:1 Finger-/Maus-Tracking mit Gummi-Widerstand (Rubber-Banding) an Ober- und Unterkante
 * - Geschwindigkeitsbasierte Flick-Erkennung (schnelles Wischen klappt sofort auf/zu)
 * - Kritisch gedämpfte Feder-Simulation (Nothing-OS-inspiriertes Einrasten)
 * - Durchlässig für Karten-Klicks oberhalb der Leiste im eingeklappten Zustand
 */
export const PhysicsBottomSheet: React.FC<PhysicsBottomSheetProps> = ({
  collapsed,
  onCollapsedChange,
  header,
  children,
  maxWidthClass = 'max-w-lg',
  sheetClassName = '',
  bodyClassName = '',
  handleTestId,
  allowBodyDrag = false,
}) => {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const collapsedRef = useRef<boolean>(collapsed);
  collapsedRef.current = collapsed;

  const onCollapsedChangeRef = useRef(onCollapsedChange);
  onCollapsedChangeRef.current = onCollapsedChange;

  const maxCollapseRef = useRef<number>(0);
  const posRef = useRef<number>(0);
  const velRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  const dragStateRef = useRef<{
    active: boolean;
    captured: boolean;
    pointerId: number;
    startClientY: number;
    startPos: number;
    startedOnInteractive: boolean;
    samples: VelocitySample[];
  } | null>(null);

  const applyTransform = useCallback((yPx: number) => {
    posRef.current = yPx;
    const el = sheetRef.current;
    if (!el) return;
    if (Math.abs(yPx) < 0.15) {
      el.style.transform = 'translate3d(0, 0px, 0)';
    } else {
      el.style.transform = `translate3d(0, ${yPx.toFixed(2)}px, 0)`;
    }
  }, []);

  const stopSpring = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const animateToTarget = useCallback(
    (targetY: number, initialVelocityPxPerSec = 0) => {
      stopSpring();
      velRef.current = initialVelocityPxPerSec;
      lastFrameTimeRef.current = performance.now();

      const step = (now: number) => {
        const rawDt = (now - lastFrameTimeRef.current) / 1000;
        lastFrameTimeRef.current = now;
        let remainingDt = Math.min(0.032, Math.max(0.001, rawDt));

        let x = posRef.current;
        let v = velRef.current;

        // Sub-Stepping für bedingungslose numerische Stabilität
        while (remainingDt > 0) {
          const dt = Math.min(0.008, remainingDt);
          const displacement = x - targetY;
          const accel = -SPRING_STIFFNESS * displacement - SPRING_DAMPING * v;
          v += accel * dt;
          x += v * dt;
          remainingDt -= dt;
        }

        velRef.current = v;

        if (Math.abs(x - targetY) < 0.35 && Math.abs(v) < 6) {
          applyTransform(targetY);
          velRef.current = 0;
          rafRef.current = null;
          return;
        }

        applyTransform(x);
        rafRef.current = requestAnimationFrame(step);
      };

      rafRef.current = requestAnimationFrame(step);
    },
    [applyTransform, stopSpring]
  );

  // Messe Body-Höhe kontinuierlich, damit Einklappen exakt bis zur Handle-Kante fährt
  useEffect(() => {
    const bodyEl = bodyRef.current;
    if (!bodyEl) return;

    const updateHeight = () => {
      const h = bodyEl.offsetHeight;
      maxCollapseRef.current = h;
      if (!dragStateRef.current?.active && rafRef.current === null) {
        applyTransform(collapsedRef.current ? h : 0);
      }
    };

    updateHeight();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        updateHeight();
      });
      ro.observe(bodyEl);
      return () => ro.disconnect();
    }
    return undefined;
  }, [applyTransform]);

  // Reagiere auf externe Änderungen von `collapsed` (z.B. Tap oder State-Wechsel) mit Feder-Physik
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    const targetY = collapsed ? maxCollapseRef.current : 0;
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      applyTransform(targetY);
      return;
    }
    if (!dragStateRef.current?.active) {
      animateToTarget(targetY, velRef.current);
    }
  }, [collapsed, animateToTarget, applyTransform]);

  useEffect(() => {
    return () => stopSpring();
  }, [stopSpring]);

  const computeMappedDragY = (rawY: number): number => {
    const maxCollapse = maxCollapseRef.current;
    if (rawY < 0) {
      return -rubberBand(-rawY, 34);
    }
    if (rawY > maxCollapse) {
      return maxCollapse + rubberBand(rawY - maxCollapse, 26);
    }
    return rawY;
  };

  const computeReleaseVelocity = (samples: VelocitySample[], now: number): number => {
    const recent = samples.filter((s) => now - s.t <= 100);
    if (recent.length < 2) return 0;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dtMs = last.t - first.t;
    if (dtMs < 8) return 0;
    const v = ((last.y - first.y) / dtMs) * 1000;
    return Math.max(-2800, Math.min(2800, v));
  };

  const beginPointerTracking = (
    e: React.PointerEvent<HTMLDivElement>,
    fromBody: boolean
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const targetEl = e.target as HTMLElement | null;
    const interactiveAncestor = targetEl?.closest(
      'button, a, input, select, textarea, label, [role="button"]'
    );

    // Im Body keine Scroll-Container blockieren, die gerade gescrollt sind
    if (fromBody) {
      const scrollAncestor = targetEl?.closest('.cmf-scroll-area') as HTMLElement | null;
      if (scrollAncestor && scrollAncestor.scrollTop > 2) {
        return;
      }
      if (targetEl?.closest('input, select, textarea')) {
        return;
      }
    }

    const now = performance.now();
    dragStateRef.current = {
      active: true,
      captured: false,
      pointerId: e.pointerId,
      startClientY: e.clientY,
      startPos: posRef.current,
      startedOnInteractive: Boolean(interactiveAncestor),
      samples: [{ y: e.clientY, t: now }],
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const st = dragStateRef.current;
    if (!st || !st.active || e.pointerId !== st.pointerId) return;

    const dy = e.clientY - st.startClientY;
    if (!st.captured) {
      if (Math.abs(dy) < DRAG_SLOP_PX) return;
      st.captured = true;
      stopSpring();
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // Ignorieren in Testumgebungen ohne PointerCapture
      }
    }

    if (e.cancelable) {
      e.preventDefault();
    }

    const now = performance.now();
    st.samples.push({ y: e.clientY, t: now });
    if (st.samples.length > 12) {
      st.samples.shift();
    }

    const rawNext = st.startPos + dy;
    applyTransform(computeMappedDragY(rawNext));
  };

  const finishPointerTracking = (
    e: React.PointerEvent<HTMLDivElement>,
    cancelled: boolean
  ) => {
    const st = dragStateRef.current;
    if (!st || !st.active || e.pointerId !== st.pointerId) return;
    dragStateRef.current = null;

    if (st.captured) {
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {
        // Ignorieren
      }
    }

    const maxCollapse = maxCollapseRef.current;

    if (!st.captured) {
      // Kurzer Tap auf die Handle-Leiste (außerhalb innerer Buttons) -> sanft umschalten!
      if (!cancelled && !st.startedOnInteractive) {
        const nextCollapsed = !collapsedRef.current;
        onCollapsedChangeRef.current(nextCollapsed);
        animateToTarget(nextCollapsed ? maxCollapse : 0, 0);
      }
      return;
    }

    const now = performance.now();
    st.samples.push({ y: e.clientY, t: now });
    const velocity = cancelled ? 0 : computeReleaseVelocity(st.samples, now);

    let nextCollapsed: boolean;
    if (maxCollapse <= 4) {
      nextCollapsed = false;
    } else if (velocity > FLICK_VELOCITY_THRESHOLD) {
      nextCollapsed = true;
    } else if (velocity < -FLICK_VELOCITY_THRESHOLD) {
      nextCollapsed = false;
    } else {
      nextCollapsed = posRef.current > maxCollapse * 0.44;
    }

    const targetY = nextCollapsed ? maxCollapse : 0;
    if (nextCollapsed !== collapsedRef.current) {
      onCollapsedChangeRef.current(nextCollapsed);
    }
    animateToTarget(targetY, velocity);
  };

  return (
    <div
      className={`pointer-events-none mx-auto w-full ${maxWidthClass} -mt-12 overflow-hidden rounded-b-[1.75rem] pt-12`}
    >
      <div
        ref={sheetRef}
        className={`cmf-chassis cmf-sheet-up pointer-events-auto flex w-full flex-col overflow-hidden will-change-transform ${sheetClassName}`}
      >
        {/* Taktile Drag-Handle-Kopfzeile */}
        <div
          data-testid={handleTestId}
          onPointerDown={(e) => beginPointerTracking(e, false)}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => finishPointerTracking(e, false)}
          onPointerCancel={(e) => finishPointerTracking(e, true)}
          className="flex cursor-grab touch-none flex-col items-center justify-center px-4 pt-2 pb-2.5 select-none active:cursor-grabbing active:bg-white/40"
        >
          <span
            aria-hidden="true"
            className="mb-1.5 h-1.5 w-11 rounded-full bg-[var(--hardware-border)] transition-colors"
          />
          <div className="w-full">{header}</div>
        </div>

        {/* Ausklappbarer Body (bleibt für exakte Physik-Höhenmessung & 60fps-Gleiten im DOM) */}
        <div
          ref={bodyRef}
          aria-hidden={collapsed}
          onPointerDown={
            allowBodyDrag ? (e) => beginPointerTracking(e, true) : undefined
          }
          onPointerMove={allowBodyDrag ? handlePointerMove : undefined}
          onPointerUp={
            allowBodyDrag ? (e) => finishPointerTracking(e, false) : undefined
          }
          onPointerCancel={
            allowBodyDrag ? (e) => finishPointerTracking(e, true) : undefined
          }
          className={`border-t border-[var(--shell-border)]/70 ${
            collapsed ? 'pointer-events-none' : ''
          } ${bodyClassName}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
