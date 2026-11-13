import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

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

  const updateValueFromPointerClientXY = useCallback(
    (clientX: number, clientY: number) => {
      const el = dialRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;

      if (Math.hypot(dx, dy) < 10) return;

      let degFromTop = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
      if (degFromTop > 180) degFromTop -= 360;
      if (degFromTop < -180) degFromTop += 360;

      if (wrapAround) {
        const compassDeg = ((degFromTop % 360) + 360) % 360;
        const span = Math.max(1, max - min + step);
        const rawVal = min + (compassDeg / 360) * span;
        const nextVal = normalizeNextValue(rawVal);
        if (nextVal !== value) onChange(nextVal);
        return;
      }

      const clampedDeg = Math.max(-135, Math.min(135, degFromTop));
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

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    updateValueFromPointerClientXY(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    updateValueFromPointerClientXY(e.clientX, e.clientY);
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  // Nothing Dot-Matrix LED-Ring (32 diskrete LED-Punkte für 270°-Thermostat, 36 für 360°-Kompass)
  const ledDots = useMemo(() => {
    const count = wrapAround ? 36 : 29;
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
          major: i % 9 === 0,
        });
      } else {
        const ratio = i / (count - 1);
        const deg = -135 + ratio * 270;
        const isCurrent = Math.abs(ratio - normalizedProgress) <= 0.55 / (count - 1);
        list.push({
          deg,
          active: ratio <= normalizedProgress + 0.005,
          isCurrent,
          major: i % 7 === 0,
        });
      }
    }
    return list;
  }, [normalizedProgress, rotationDeg, wrapAround]);

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

  const showCompassPresets = wrapAround && min === 0 && max === 355;
  const showHidingTimePresets =
    !wrapAround && !options && min === 5 && max === 60;

  // SVG-Geometrie (164 x 164 Koordinatensystem, Zentrum 82, 82)
  const rad = ((rotationDeg - 90) * Math.PI) / 180;
  // Position der Nothing-Drehmulde (Finger Dimple / Pointer Capsule) auf dem Rotor
  const dimpleX = 82 + 44 * Math.cos(rad);
  const dimpleY = 82 + 44 * Math.sin(rad);
  // Äußere LED-Spitze
  const tipX = 82 + 64 * Math.cos(rad);
  const tipY = 82 + 64 * Math.sin(rad);

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

      {/* Haupt-Instrumentenfeld: Links [-] Taster, Mitte Nothing Smart Dial, Rechts [+] Taster */}
      <div className="my-2 flex items-center justify-between gap-2 sm:justify-center sm:gap-5">
        {/* Linker mechanischer Nothing-Taster [-] */}
        <button
          type="button"
          onClick={() => stepByDelta(-1)}
          aria-label={`${ariaLabel ?? label} verringern`}
          title={`-${step}${unit}`}
          className="group relative flex h-[64px] w-[54px] sm:w-[62px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-[var(--shell-border)] bg-[var(--module-bg)] text-[var(--text-main)] shadow-[0_4px_10px_rgba(20,25,30,0.07),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-150 hover:border-[var(--hardware-border)] active:translate-y-0.5 active:scale-95"
        >
          <span className="absolute top-1.5 left-2 h-1 w-1 rounded-full bg-[#9AA4AE] group-hover:bg-[var(--cmf-orange)]" />
          <Minus className="h-4 w-4 stroke-[2.2]" />
          <span className="font-tech text-[8px] font-bold tracking-widest text-[var(--text-muted)] uppercase">
            -{stepBtnLabel}
          </span>
        </button>

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
          title="Im Kreis drehen oder antippen wie beim Nothing / CMF Smart Dial"
          className={`relative flex h-[160px] w-[160px] sm:h-[168px] sm:w-[168px] shrink-0 cursor-grab touch-none items-center justify-center rounded-full select-none active:cursor-grabbing transition-transform duration-200 ${
            isDragging ? 'scale-[1.025]' : ''
          }`}
        >
          <svg
            viewBox="0 0 164 164"
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          >
            {/* 1. Äußerer gefräster Polycarbonat-/Aluminium-Flansch mit 4 Eck-Nietpunkten */}
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

            {/* 3. Nothing Dot-Matrix LED-Skalenring (runde LED-Pills wie bei Nothing OS / Glyph) */}
            {ledDots.map((dot, idx) => {
              const a = ((dot.deg - 90) * Math.PI) / 180;
              const rDot = 64;
              const cxDot = 82 + rDot * Math.cos(a);
              const cyDot = 82 + rDot * Math.sin(a);

              const fill = dot.isCurrent
                ? '#FF4D00'
                : dot.active
                  ? '#F8FAFC'
                  : '#272B33';
              const radius = dot.isCurrent ? 3.3 : dot.major ? 2.3 : 1.65;

              return (
                <circle
                  key={idx}
                  cx={cxDot}
                  cy={cyDot}
                  r={radius}
                  fill={fill}
                  style={{
                    transition: 'fill 110ms ease, r 110ms ease',
                  }}
                />
              );
            })}

            {/* 4. Präziser Signal-Orange Zeigerstrahl vom Rotor zur aktiven LED */}
            <line
              x1={dimpleX}
              y1={dimpleY}
              x2={tipX}
              y2={tipY}
              stroke="#FF4D00"
              strokeWidth="2"
              strokeLinecap="round"
            />

            {/* 5.Innerer drehbarer Smart-Dial-Rotorring */}
            <circle
              cx="82"
              cy="82"
              r="51"
              fill="#111418"
              stroke={isDragging ? '#FF4D00' : '#2E343D'}
              strokeWidth="1.25"
            />

            {/* Charakteristische CMF Smart-Dial Finger-Mulde ( Finger Dimple ) auf dem Rotor */}
            <circle
              cx={dimpleX}
              cy={dimpleY}
              r={isDragging ? 6.2 : 5.4}
              fill="#FF4D00"
              stroke="#0B0D10"
              strokeWidth="1.8"
            />
            <circle
              cx={dimpleX}
              cy={dimpleY}
              r="1.8"
              fill="#FFFFFF"
            />

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

        {/* Rechter mechanischer Nothing-Taster [+] */}
        <button
          type="button"
          onClick={() => stepByDelta(1)}
          aria-label={`${ariaLabel ?? label} erhöhen`}
          title={`+${step}${unit}`}
          className="group relative flex h-[64px] w-[54px] sm:w-[62px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-[var(--shell-border)] bg-[var(--module-bg)] text-[var(--text-main)] shadow-[0_4px_10px_rgba(20,25,30,0.07),inset_0_1px_0_rgba(255,255,255,0.9)] transition-all duration-150 hover:border-[var(--hardware-border)] active:translate-y-0.5 active:scale-95"
        >
          <span className="absolute top-1.5 right-2 h-1 w-1 rounded-full bg-[var(--cmf-orange)]" />
          <Plus className="h-4 w-4 stroke-[2.2]" />
          <span className="font-tech text-[8px] font-bold tracking-widest text-[var(--text-muted)] uppercase">
            +{stepBtnLabel}
          </span>
        </button>
      </div>

      {/* Untere Nothing-Schnellrast-Tasten (Detent Presets) */}
      {options && options.length > 0 && (
        <div className="grid grid-cols-5 gap-1 border-t border-dashed border-[var(--shell-border)] pt-2">
          {options.map((opt) => {
            const active = value === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange(opt)}
                className={`min-h-[34px] rounded-lg px-1 py-1 font-tech text-[10px] font-bold tracking-wider uppercase transition-all ${
                  active
                    ? 'bg-[#0B0D10] text-[#F8FAFC] shadow-sm ring-1 ring-[var(--cmf-orange)]'
                    : 'border border-[var(--shell-border)] bg-white/65 text-[var(--text-main)] hover:bg-white'
                }`}
              >
                {opt}
                {cleanUnit}
              </button>
            );
          })}
        </div>
      )}

      {showHidingTimePresets && (
        <div className="grid grid-cols-5 gap-1 border-t border-dashed border-[var(--shell-border)] pt-2">
          {[10, 15, 20, 30, 45].map((presetMin) => {
            const active = value === presetMin;
            return (
              <button
                key={presetMin}
                type="button"
                onClick={() => onChange(presetMin)}
                className={`min-h-[34px] rounded-lg px-1 py-1 font-tech text-[10px] font-bold tracking-wider uppercase transition-all ${
                  active
                    ? 'bg-[#0B0D10] text-[#F8FAFC] shadow-sm ring-1 ring-[var(--cmf-orange)]'
                    : 'border border-[var(--shell-border)] bg-white/65 text-[var(--text-main)] hover:bg-white'
                }`}
              >
                {presetMin}m
              </button>
            );
          })}
        </div>
      )}

      {showCompassPresets && (
        <div className="grid grid-cols-4 gap-1.5 border-t border-dashed border-[var(--shell-border)] pt-2">
          {[
            { lbl: 'N // 000°', deg: 0 },
            { lbl: 'O // 090°', deg: 90 },
            { lbl: 'S // 180°', deg: 180 },
            { lbl: 'W // 270°', deg: 270 },
          ].map((preset) => {
            const active = value === preset.deg;
            return (
              <button
                key={preset.deg}
                type="button"
                onClick={() => onChange(preset.deg)}
                className={`min-h-[34px] rounded-lg px-2 py-1 font-tech text-[10px] font-bold tracking-wider uppercase transition-all ${
                  active
                    ? 'bg-[#0B0D10] text-[#F8FAFC] shadow-sm ring-1 ring-[var(--cmf-orange)]'
                    : 'border border-[var(--shell-border)] bg-white/65 text-[var(--text-main)] hover:bg-white'
                }`}
              >
                {preset.lbl}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
