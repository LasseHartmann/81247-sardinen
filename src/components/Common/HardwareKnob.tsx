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

/**
 * Taktiles CMF × Nothing Thermostat-Drehrad („Raw Light“ Designsystem):
 * - Echte kreisförmige Thermostat-Winkelsteuerung (`Math.atan2` um den Mittelpunkt):
 *   Finger oder Maus einfach im Kreis über den Skalenring führen wie bei einem echten Raumthermostat.
 * - Präzisions-Skalenstriche (Ticks) leuchten bis zum aktuellen Sollwert in Signal-Orange (#FF4D00).
 * - Rundes, tiefschwarzes OLED-Zentraldisplay im Inneren des Drehrings + rastende [- / +] Tasten.
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

  // Winkelberechnung für das Thermostat-Rad:
  // - Standard-Thermostat: 270°-Bogen von -135° (links unten) über 0° (oben) bis +135° (rechts unten)
  // - Kompass-Thermostat (wrapAround): 360°-Vollkreis von 0° (Nord) im Uhrzeigersinn
  let rotationDeg = 0;
  let normalizedProgress = 0;
  if (options && options.length > 1) {
    const idx = Math.max(0, options.indexOf(value));
    normalizedProgress = idx / (options.length - 1);
    rotationDeg = -135 + normalizedProgress * 270;
  } else if (wrapAround) {
    const span = Math.max(1, max - min + step);
    normalizedProgress = (((value - min) % span) + span) % span / span;
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

      // Zu nah am exakten Mittelpunkt (< 10px) ignorieren, um Winkel-Springen zu vermeiden
      if (Math.hypot(dx, dy) < 10) return;

      // Winkel in Grad: 0° = 12 Uhr (Oben), +90° = 3 Uhr (Rechts), -90° = 9 Uhr (Links), ±180° = 6 Uhr (Unten)
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

      // 270°-Thermostat-Skala (-135° bis +135°).
      // Im unteren Totbereich (zwischen +135° und -135°) sanft am jeweiligen Anschlag halten:
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

  // Generiere Skalen-Ticks für den Thermostat-Ring
  const ticks = useMemo(() => {
    const count = wrapAround ? 36 : 28;
    const list: Array<{ deg: number; active: boolean; major: boolean }> = [];
    for (let i = 0; i < count; i++) {
      if (wrapAround) {
        const deg = (i / count) * 360;
        const diff = Math.abs(
          ((((deg - rotationDeg) % 360) + 540) % 360) - 180
        );
        list.push({
          deg,
          active: diff <= 12,
          major: i % 9 === 0,
        });
      } else {
        const ratio = i / (count - 1);
        const deg = -135 + ratio * 270;
        list.push({
          deg,
          active: ratio <= normalizedProgress + 0.005,
          major: i === 0 || i === count - 1 || i === Math.floor((count - 1) / 2),
        });
      }
    }
    return list;
  }, [normalizedProgress, rotationDeg, wrapAround]);

  const displayStr = formatValue ? formatValue(value) : `${value}${unit}`;
  const minLabel = options && options.length > 0 ? `${options[0]}${unit.trim()}` : `${min}${unit.trim()}`;
  const maxLabel =
    options && options.length > 0
      ? `${options[options.length - 1]}${unit.trim()}`
      : `${max}${unit.trim()}`;

  const showCompassPresets = wrapAround && min === 0 && max === 355;
  const showHidingTimePresets = !wrapAround && !options && min === 5 && max === 60;

  // Berechne die Position des leuchtenden Thermostat-Abgriffpunkts auf dem Radius r=54 (SVG 140x140, Zentrum 70,70)
  const rad = ((rotationDeg - 90) * Math.PI) / 180;
  const thumbX = 70 + 54 * Math.cos(rad);
  const thumbY = 70 + 54 * Math.sin(rad);

  return (
    <div data-testid={dataTestId} className="cmf-well space-y-2.5 p-3">
      {/* Kopfzeile mit Titel & Modus-Hinweis */}
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
          {label}
        </span>
        <span className="font-tech text-[9px] font-bold tracking-wider text-[var(--cmf-orange)] uppercase">
          THERMOSTAT-DIAL // DREHEN ODER TIPPEN
        </span>
      </div>

      {/* Haupt-Thermostat-Einheit: [-] Taste links, 140px Thermostat-Drehrad in der Mitte, [+] Taste rechts */}
      <div className="flex items-center justify-center gap-3 sm:gap-5 py-1">
        <button
          type="button"
          onClick={() => stepByDelta(-1)}
          aria-label={`${ariaLabel ?? label} verringern`}
          className="cmf-btn-secondary flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[var(--text-main)] shadow-sm active:scale-95"
          title={`-${step}${unit}`}
        >
          <Minus className="h-5 w-5" />
        </button>

        {/* Kreisförmiges Thermostat-Drehrad mit 360°/270° Winkel-Tracking */}
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
          title="Im Kreis ziehen oder auf den Ring tippen wie bei einem Thermostat"
          className={`relative flex h-[140px] w-[140px] shrink-0 cursor-grab touch-none items-center justify-center rounded-full border-2 bg-[var(--bg-module)] shadow-[0_6px_18px_rgba(24,27,32,0.16),inset_0_2px_0_rgba(255,255,255,0.95)] select-none active:cursor-grabbing ${
            isDragging
              ? 'border-[var(--cmf-orange)] ring-2 ring-[var(--cmf-orange)]/25'
              : 'border-[var(--shell-border)]'
          }`}
        >
          {/* SVG Thermostat-Skala mit leuchtenden Ticks und aktivem Stellring-Punkt */}
          <svg
            viewBox="0 0 140 140"
            className="pointer-events-none absolute inset-0 h-full w-full"
          >
            {/* Äußere feine Rändelspur */}
            <circle
              cx="70"
              cy="70"
              r="63"
              fill="none"
              stroke="rgba(24,27,32,0.08)"
              strokeWidth="1"
              strokeDasharray="2 3"
            />

            {/* Thermostat-Ticks rund um den Umfang */}
            {ticks.map((t, idx) => {
              const a = ((t.deg - 90) * Math.PI) / 180;
              const rOuter = 61;
              const rInner = t.major ? 50 : 53;
              const x1 = 70 + rInner * Math.cos(a);
              const y1 = 70 + rInner * Math.sin(a);
              const x2 = 70 + rOuter * Math.cos(a);
              const y2 = 70 + rOuter * Math.sin(a);
              return (
                <line
                  key={idx}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={t.active ? '#FF4D00' : '#9AA4AE'}
                  strokeWidth={t.major ? 2.4 : 1.6}
                  strokeLinecap="round"
                  opacity={t.active ? 1 : 0.55}
                />
              );
            })}

            {/* Leuchtender Thermostat-Stellpunkt auf der Kreisbahn */}
            <circle
              cx={thumbX}
              cy={thumbY}
              r="7"
              fill="#FF4D00"
              stroke="#FFFFFF"
              strokeWidth="2.2"
            />
          </svg>

          {/* Eingelassenes rundes OLED-Thermostat-Zentraldisplay */}
          <div className="cmf-oled pointer-events-none relative z-10 flex h-[84px] w-[84px] flex-col items-center justify-center rounded-full border border-[#27272A] px-2 text-center shadow-inner">
            <span className="mb-0.5 h-1.5 w-1.5 rounded-full bg-[var(--cmf-orange)]" />
            <span className="font-dot text-base leading-tight text-[#F8FAFC] sm:text-lg">
              {displayStr}
            </span>
            <span className="mt-0.5 font-tech text-[8px] font-bold tracking-widest text-[#9AA4AE] uppercase">
              {wrapAround ? 'KOMPASS' : 'SOLLWERT'}
            </span>
          </div>

          {/* Min/Max oder Himmelsrichtungs-Beschriftung unten am Thermostat-Sockel */}
          {!wrapAround ? (
            <div className="pointer-events-none absolute right-3 bottom-1.5 left-3 flex items-center justify-between font-tech text-[8px] font-bold text-[var(--text-muted)] uppercase">
              <span>{minLabel}</span>
              <span>{maxLabel}</span>
            </div>
          ) : (
            <span className="pointer-events-none absolute top-1 font-tech text-[8px] font-bold text-[var(--cmf-orange)] uppercase">
              N
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => stepByDelta(1)}
          aria-label={`${ariaLabel ?? label} erhöhen`}
          className="cmf-btn-secondary flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-[var(--text-main)] shadow-sm active:scale-95"
          title={`+${step}${unit}`}
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      {/* Einhand-Schnellwahl-Pills unterhalb des Thermostats */}
      {options && options.length > 0 && (
        <div className="grid grid-cols-5 gap-1 pt-0.5">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              className={`min-h-[36px] rounded-lg px-1 py-1 font-tech text-[10px] font-bold uppercase ${
                value === opt
                  ? 'cmf-btn-active'
                  : 'cmf-btn-secondary bg-white/60 text-[var(--text-main)]'
              }`}
            >
              {opt}
              {unit.trim()}
            </button>
          ))}
        </div>
      )}

      {showHidingTimePresets && (
        <div className="grid grid-cols-5 gap-1 pt-0.5">
          {[10, 15, 20, 30, 45].map((presetMin) => (
            <button
              key={presetMin}
              type="button"
              onClick={() => onChange(presetMin)}
              className={`min-h-[36px] rounded-lg px-1 py-1 font-tech text-[10px] font-bold uppercase ${
                value === presetMin
                  ? 'cmf-btn-active'
                  : 'cmf-btn-secondary bg-white/60 text-[var(--text-main)]'
              }`}
            >
              {presetMin}m
            </button>
          ))}
        </div>
      )}

      {showCompassPresets && (
        <div className="grid grid-cols-4 gap-1.5 pt-0.5">
          {[
            { lbl: 'N 0°', deg: 0 },
            { lbl: 'O 90°', deg: 90 },
            { lbl: 'S 180°', deg: 180 },
            { lbl: 'W 270°', deg: 270 },
          ].map((preset) => (
            <button
              key={preset.deg}
              type="button"
              onClick={() => onChange(preset.deg)}
              className={`min-h-[36px] rounded-lg px-2 py-1 font-tech text-[10px] font-bold uppercase ${
                value === preset.deg
                  ? 'cmf-btn-active'
                  : 'cmf-btn-secondary bg-white/60 text-[var(--text-main)]'
              }`}
            >
              {preset.lbl}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
