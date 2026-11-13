import React, { useCallback, useMemo, useRef, useState } from 'react';

export interface HardwareKnobProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly number[];
  wrapAround?: boolean;
  unit?: string;
  formatValue?: (val: number) => string;
  onChange: (nextValue: number) => void;
  ariaLabel?: string;
  dataTestId?: string;
}

function getCompassCardinalDe(deg: number): string {
  const norm = ((deg % 360) + 360) % 360;
  const dirs = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'] as const;
  return dirs[Math.round(norm / 45) % 8];
}

/**
 * Nothing × CMF Rotary Smart Dial („Raw Light" Industrial Hardware):
 * - Inspiriert vom CMF Smart Dial, Nothing OS Dot-Matrix Widgets & Teenage Engineering Encodern.
 * - Echte 270°/360° Winkel-Drehsteuerung (`Math.atan2`) direkt auf dem Drehring.
 * - Tiefschwarzes OLED-Zifferblatt (#0B0D10) im gefrästen Polycarbonat-Chassissockel mit
 *   Nothing-typischem LED-Dot-Matrix-Leuchtring, Fadenkreuz-Achsen, Dreh-Mulde (Finger Dimple)
 *   und physischen Schritt-Wippen.
 */
export const HardwareKnob: React.FC<HardwareKnobProps> = ({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  options,
  wrapAround = false,
  unit = '',
  formatValue,
  onChange,
  ariaLabel,
  dataTestId,
}) => {
  const dialRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    mode: 'ring' | 'center';
    prevPointerDeg: number;
    virtualDeg: number;
    lastClientX: number;
    lastClientY: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const normalizeNextValue = useCallback(
    (rawVal: number): number => {
      if (options && options.length > 0) {
        let best = options[0];
        let bestDiff = Math.abs(rawVal - best);
        for (const opt of options) {
          const d = Math.abs(rawVal - opt);
          if (d < bestDiff) {
            best = opt;
            bestDiff = d;
          }
        }
        return best;
      }

      const snapped = Math.round((rawVal - min) / step) * step + min;
      if (wrapAround) {
        const span = max - min + step;
        return ((((snapped - min) % span) + span) % span) + min;
      }
      return Math.max(min, Math.min(max, snapped));
    },
    [max, min, options, step, wrapAround]
  );

  const stepByDelta = useCallback(
    (deltaSteps: number) => {
      if (options && options.length > 0) {
        const curIdx = Math.max(0, options.indexOf(value));
        const nextIdx = wrapAround
          ? (curIdx + deltaSteps + options.length) % options.length
          : Math.max(0, Math.min(options.length - 1, curIdx + deltaSteps));
        const nextVal = options[nextIdx];
        if (nextVal !== value) onChange(nextVal);
        return;
      }

      const nextVal = normalizeNextValue(value + deltaSteps * step);
      if (nextVal !== value) {
        onChange(nextVal);
      }
    },
    [normalizeNextValue, onChange, options, step, value, wrapAround]
  );

  // Winkelberechnung:
  // - Thermostat-Modus (!wrapAround): 270°-Bogen von -135° (7:30 Uhr) über 0° (12 Uhr) bis +135° (4:30 Uhr)
  // - Kompass-Modus (wrapAround): 360°-Vollkreis von 0° (Nord) im Uhrzeigersinn
  let rotationDeg = 0;
  let normalizedProgress = 0;
  if (options && options.length > 1) {
    const idx = Math.max(0, options.indexOf(value));
    normalizedProgress = idx / (options.length - 1);
    rotationDeg = -135 + normalizedProgress * 270;
  } else if (wrapAround) {
    const span = Math.max(1, max - min + step);
    normalizedProgress = ((((value - min) % span) + span) % span) / span;
    rotationDeg = normalizedProgress * 360;
  } else {
    const span = Math.max(1, max - min);
    normalizedProgress = Math.max(0, Math.min(1, (value - min) / span));
    rotationDeg = -135 + normalizedProgress * 270;
  }

  const applyAngleDegrees = useCallback(
    (targetDeg: number) => {
      if (wrapAround) {
        const compassDeg = ((targetDeg % 360) + 360) % 360;
        const span = Math.max(1, max - min + step);
        const rawVal = min + (compassDeg / 360) * span;
        const nextVal = normalizeNextValue(rawVal);
        if (nextVal !== value) onChange(nextVal);
        return;
      }

      const clampedDeg = Math.max(-135, Math.min(135, targetDeg));
      const ratio = (clampedDeg + 135) / 270;

      if (options && options.length > 0) {
        const idx = Math.round(ratio * (options.length - 1));
        const safeIdx = Math.max(0, Math.min(options.length - 1, idx));
        const nextVal = options[safeIdx];
        if (nextVal !== value) onChange(nextVal);
        return;
      }

      const rawVal = min + ratio * (max - min);
      const nextVal = normalizeNextValue(rawVal);
      if (nextVal !== value) onChange(nextVal);
    },
    [max, min, normalizeNextValue, onChange, options, step, value, wrapAround]
  );

  const getPointerMetrics = useCallback((clientX: number, clientY: number) => {
    const el = dialRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    let degFromTop = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (degFromTop > 180) degFromTop -= 360;
    if (degFromTop <= -180) degFromTop += 360;
    return { dist, degFromTop };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore environments without synthetic pointer capture support
    }

    const metrics = getPointerMetrics(e.clientX, e.clientY);
    if (!metrics) return;

    setIsDragging(true);

    if (metrics.dist >= 16) {
      const initialVirtual = wrapAround
        ? ((metrics.degFromTop % 360) + 360) % 360
        : Math.max(-135, Math.min(135, metrics.degFromTop));

      dragStateRef.current = {
        active: true,
        mode: 'ring',
        prevPointerDeg: metrics.degFromTop,
        virtualDeg: initialVirtual,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
      };
      applyAngleDegrees(initialVirtual);
    } else {
      dragStateRef.current = {
        active: true,
        mode: 'center',
        prevPointerDeg: metrics.degFromTop,
        virtualDeg: rotationDeg,
        lastClientX: e.clientX,
        lastClientY: e.clientY,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || !drag.active) return;

    const metrics = getPointerMetrics(e.clientX, e.clientY);
    if (!metrics) return;

    if (drag.mode === 'center') {
      if (metrics.dist >= 22) {
        drag.mode = 'ring';
        drag.prevPointerDeg = metrics.degFromTop;
        drag.lastClientX = e.clientX;
        drag.lastClientY = e.clientY;
        return;
      }

      const deltaPx =
        e.clientX - drag.lastClientX - (e.clientY - drag.lastClientY);
      drag.lastClientX = e.clientX;
      drag.lastClientY = e.clientY;
      drag.virtualDeg = wrapAround
        ? (((drag.virtualDeg + deltaPx * 1.6) % 360) + 360) % 360
        : Math.max(-135, Math.min(135, drag.virtualDeg + deltaPx * 1.6));
      applyAngleDegrees(drag.virtualDeg);
      return;
    }

    // In der Nähe der Radmitte (< 12px) Winkel-Flattern durch atan2-Singularität vermeiden
    if (metrics.dist < 12) return;

    const deltaDeg =
      ((metrics.degFromTop - drag.prevPointerDeg + 540) % 360) - 180;
    drag.prevPointerDeg = metrics.degFromTop;

    if (wrapAround) {
      const nextCompass = ((metrics.degFromTop % 360) + 360) % 360;
      drag.virtualDeg = nextCompass;
      applyAngleDegrees(nextCompass);
      return;
    }

    // Im 270°-Thermostat-Modus verhindertes Überspringen über die untere 6-Uhr-Lücke (-135° <-> +135°)
    let nextVirtual = Math.max(-145, Math.min(145, drag.virtualDeg + deltaDeg));
    if (
      metrics.degFromTop >= -135 &&
      metrics.degFromTop <= 135 &&
      Math.abs(nextVirtual) <= 135
    ) {
      nextVirtual = metrics.degFromTop;
    }
    drag.virtualDeg = nextVirtual;
    applyAngleDegrees(Math.max(-135, Math.min(135, nextVirtual)));
  };

  const handlePointerUp = () => {
    dragStateRef.current = null;
    setIsDragging(false);
  };

  // Nothing Dot-Matrix LED-Ring:
  // - 360°-Kompass: 36 LEDs (alle 10°)
  // - 10er-Skala (z. B. 5..55 Min. in 5er-Schritten): 31 LEDs, sodass jede Rastung & 30 Min. (Top-Mitte) exakt sitzt
  // - 5er-Optionsskala / Standard: 29 LEDs
  const ledDots = useMemo(() => {
    const stepSpanCount =
      !wrapAround && (!options || options.length === 0) && step > 0
        ? Math.round((max - min) / step)
        : 0;
    const count = wrapAround ? 36 : stepSpanCount === 10 ? 31 : 29;
    const majorEvery = wrapAround ? 9 : stepSpanCount === 10 ? 3 : 7;

    const list: Array<{
      deg: number;
      active: boolean;
      isCurrent: boolean;
      major: boolean;
    }> = [];
    for (let i = 0; i < count; i++) {
      if (wrapAround) {
        const deg = (i / count) * 360;
        const angularDiff = Math.abs(
          ((((deg - rotationDeg) % 360) + 540) % 360) - 180
        );
        list.push({
          deg,
          active: angularDiff <= 22.5,
          isCurrent: angularDiff <= 5.5,
          major: i % majorEvery === 0,
        });
      } else {
        const ratio = i / (count - 1);
        const deg = -135 + ratio * 270;
        const isCurrent = Math.abs(ratio - normalizedProgress) <= 0.55 / (count - 1);
        list.push({
          deg,
          active: ratio <= normalizedProgress + 0.005,
          isCurrent,
          major: i % majorEvery === 0,
        });
      }
    }
    return list;
  }, [max, min, normalizedProgress, options, rotationDeg, step, wrapAround]);

  // Äußere Rändel-Kerben (Knurling) am Aluminium-Gehäusering
  const knurlAngles = useMemo(
    () => Array.from({ length: 48 }, (_, i) => i * 7.5),
    []
  );

  const cleanUnit = unit.trim();
  const numericDisplay = formatValue
    ? formatValue(value)
    : wrapAround
      ? `${String(value).padStart(3, '0')}°`
      : `${value}`;

  const minLabel =
    options && options.length > 0
      ? `${options[0]}${cleanUnit}`
      : `${min}${cleanUnit}`;
  const maxLabel =
    options && options.length > 0
      ? `${options[options.length - 1]}${cleanUnit}`
      : `${max}${cleanUnit}`;

  const stepBtnLabel = options
    ? 'STUFE'
    : `${step}${cleanUnit || '°'}`;

  return (
    <div
      data-testid={dataTestId}
      className="relative overflow-hidden rounded-2xl border border-[var(--shell-border)] bg-[var(--module-sub)] p-3 sm:p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
    >
      {/* Technische Nothing-Eckmarkierungen (Exposed Hardware Crosshairs) */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-2 left-2.5 font-tech text-[9px] leading-none text-[#9AA4AE] select-none"
      >
        +
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-2 right-2.5 font-tech text-[9px] leading-none text-[#9AA4AE] select-none"
      >
        +
      </span>

      {/* Obere Telemetrie-Leiste im Nothing OS Stil */}
      <div className="flex items-center justify-between gap-2 border-b border-dashed border-[var(--shell-border)] px-3 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
              isDragging
                ? 'bg-[var(--nothing-red)] shadow-[0_0_8px_#D71921]'
                : 'bg-[var(--cmf-orange)]'
            }`}
          />
          <span className="truncate font-tech text-[10px] font-bold tracking-[0.12em] text-[var(--text-main)] uppercase">
            {label}
          </span>
        </div>
        <span className="shrink-0 rounded border border-[var(--shell-border)] bg-white/60 px-1.5 py-0.5 font-tech text-[9px] font-bold tracking-widest text-[var(--text-muted)] uppercase">
          {wrapAround ? 'NTH // AZIMUTH 360°' : `NTH // DIAL Δ${stepBtnLabel}`}
        </span>
      </div>

      {/* Haupt-Instrumentenfeld: Nur das Nothing Smart Dial */}
      <div className="mt-2.5 mb-1 flex items-center justify-center">
        {/* NOTHING × CMF ROTARY SMART DIAL */}
        <div
          ref={dialRef}
          role="slider"
          tabIndex={0}
          aria-label={ariaLabel ?? label}
          aria-valuemin={options ? options[0] : min}
          aria-valuemax={options ? options[options.length - 1] : max}
          aria-valuenow={value}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
          onWheel={(e) => {
            e.preventDefault();
            stepByDelta(e.deltaY < 0 ? 1 : -1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
              e.preventDefault();
              stepByDelta(1);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
              e.preventDefault();
              stepByDelta(-1);
            }
          }}
          style={{ touchAction: 'none' }}
          title="Im Kreis drehen oder antippen wie beim Nothing / CMF Smart Dial"
          className={`relative flex h-[168px] w-[168px] sm:h-[176px] sm:w-[176px] shrink-0 cursor-grab touch-none items-center justify-center rounded-full select-none active:cursor-grabbing transition-transform duration-200 ${
            isDragging ? 'scale-[1.025]' : ''
          }`}
        >
          <svg
            viewBox="0 0 164 164"
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          >
            {/* 1. Äußerer gefräster Polycarbonat-/Aluminium-Flansch */}
            <circle
              cx="82"
              cy="82"
              r="79"
              fill="#E4E9EE"
              stroke={isDragging ? '#FF4D00' : '#B8C2CC'}
              strokeWidth="1.5"
            />

            {/* Feine mechanische Rändelung (Knurling) am Außenring */}
            {knurlAngles.map((ang, i) => {
              const rA = ((ang - 90) * Math.PI) / 180;
              const x1 = 82 + 75.5 * Math.cos(rA);
              const y1 = 82 + 75.5 * Math.sin(rA);
              const x2 = 82 + 78.5 * Math.cos(rA);
              const y2 = 82 + 78.5 * Math.sin(rA);
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="#9AA4AE"
                  strokeWidth="1"
                  opacity="0.45"
                />
              );
            })}

            {/* 2. Tiefschwarzes Nothing OLED-Zifferblatt (#0B0D10) */}
            <circle
              cx="82"
              cy="82"
              r="72"
              fill="#0B0D10"
              stroke="#27272A"
              strokeWidth="1.5"
            />

            {/* Subtiles technisches Fadenkreuz & gestrichelter Telemetrie-Orbit im OLED-Glas */}
            <line
              x1="82"
              y1="14"
              x2="82"
              y2="150"
              stroke="#1E232A"
              strokeWidth="0.75"
              strokeDasharray="2 3"
            />
            <line
              x1="14"
              y1="82"
              x2="150"
              y2="82"
              stroke="#1E232A"
              strokeWidth="0.75"
              strokeDasharray="2 3"
            />
            <circle
              cx="82"
              cy="82"
              r="55"
              fill="none"
              stroke="#22272E"
              strokeWidth="1"
              strokeDasharray="1.5 3.5"
            />

            {/* 3. Nothing Dot-Matrix LED-Skalenring */}
            {ledDots.map((dot, idx) => {
              const a = ((dot.deg - 90) * Math.PI) / 180;
              const rDot = 64.5;
              const cxDot = 82 + rDot * Math.cos(a);
              const cyDot = 82 + rDot * Math.sin(a);

              const fill = dot.isCurrent
                ? '#FF4D00'
                : dot.active
                  ? '#F8FAFC'
                  : '#272B33';
              const radius = dot.isCurrent ? 3.2 : dot.major ? 2.2 : 1.55;

              return (
                <circle
                  key={idx}
                  cx={cxDot}
                  cy={cyDot}
                  r={radius}
                  fill={fill}
                />
              );
            })}

            {/* 4. Innerer drehbarer Smart-Dial-Rotorring (unterhalb des Zeigers) */}
            <circle
              cx="82"
              cy="82"
              r="50"
              fill="#111418"
              stroke={isDragging ? '#FF4D00' : '#2E343D'}
              strokeWidth="1.25"
            />

            {/* 5. Drehbarer Nothing × CMF Zeiger & Finger-Mulde AUF dem Rotor */}
            <g transform={`rotate(${rotationDeg} 82 82)`}>
              {/* Präziser Signal-Orange Zeigerstrahl von der Mulde bis knapp vor die LED-Skala */}
              <line
                x1="82"
                y1="38"
                x2="82"
                y2="22.5"
                stroke="#FF4D00"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
              {/* Scharfe Zeigerspitze Richtung aktiver LED */}
              <polygon
                points="82,19.5 79.3,24.5 84.7,24.5"
                fill="#FF4D00"
              />
              {/* Charakteristische CMF Smart-Dial Finger-Mulde (Finger Dimple) */}
              <circle
                cx="82"
                cy="37"
                r={isDragging ? 6.2 : 5.4}
                fill="#FF4D00"
                stroke="#0B0D10"
                strokeWidth="1.8"
              />
              <circle
                cx="82"
                cy="37"
                r="1.75"
                fill="#FFFFFF"
              />
            </g>

            {/* 6. Skalenbeschriftung im OLED-Zifferblatt (N/O/S/W bei Kompass, MIN/MAX bei Thermostat) */}
            {wrapAround ? (
              <>
                <text
                  x="82"
                  y="24"
                  textAnchor="middle"
                  fill="#FF4D00"
                  fontSize="7.5"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="700"
                >
                  N
                </text>
                <text
                  x="141"
                  y="84.5"
                  textAnchor="middle"
                  fill="#606A75"
                  fontSize="7"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="700"
                >
                  90
                </text>
                <text
                  x="82"
                  y="145"
                  textAnchor="middle"
                  fill="#606A75"
                  fontSize="7"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="700"
                >
                  S
                </text>
                <text
                  x="23"
                  y="84.5"
                  textAnchor="middle"
                  fill="#606A75"
                  fontSize="7"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="700"
                >
                  270
                </text>
              </>
            ) : (
              <>
                <text
                  x="52"
                  y="141"
                  textAnchor="middle"
                  fill="#9AA4AE"
                  fontSize="7.5"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="700"
                >
                  {minLabel}
                </text>
                <text
                  x="82"
                  y="139"
                  textAnchor="middle"
                  fill="#FF4D00"
                  fontSize="6.5"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="700"
                  letterSpacing="1"
                >
                  •••
                </text>
                <text
                  x="112"
                  y="141"
                  textAnchor="middle"
                  fill="#9AA4AE"
                  fontSize="7.5"
                  fontFamily="JetBrains Mono, monospace"
                  fontWeight="700"
                >
                  {maxLabel}
                </text>
              </>
            )}
          </svg>

          {/* Zentrale Nothing Dot-Matrix Telemetrie-Anzeige */}
          <div className="pointer-events-none relative z-10 flex h-[76px] w-[76px] flex-col items-center justify-center rounded-full text-center">
            <span className="font-tech text-[7.5px] font-bold tracking-[0.18em] text-[#9AA4AE] uppercase">
              {wrapAround ? getCompassCardinalDe(value) : 'SETPOINT'}
            </span>

            <span className="font-dot mt-0.5 text-xl leading-none tracking-wider text-[#F8FAFC] sm:text-[22px]">
              {numericDisplay}
            </span>

            {!formatValue && !wrapAround && cleanUnit && (
              <span className="mt-1 rounded bg-[#1C2026] px-1.5 py-0.2 font-tech text-[8px] font-bold tracking-widest text-[var(--cmf-orange)] uppercase">
                {cleanUnit}
              </span>
            )}

            {wrapAround && (
              <span className="mt-1 rounded bg-[#1C2026] px-1.5 py-0.2 font-tech text-[8px] font-bold tracking-widest text-[var(--cmf-teal)] uppercase">
                KEGEL 45°
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
