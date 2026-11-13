import React, { useCallback, useRef } from 'react';
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
 * Taktiler CMF × Nothing Hardware-Drehknopf („Raw Light“ Designsystem):
 * - Unterstützt sowohl feste Schrittweiten (`min`/`max`/`step` oder `wrapAround` 0°–355°)
 *   als auch diskrete Rasterstufen (`options`, z. B. `[50, 100, 250, 500, 1000]`).
 * - Bedienbar per Dreh-/Ziehgeste direkt am Knopf, Mausrad, Tastatur-Pfeiltasten
 *   sowie über die rastenden Hardware-Schritttasten [- / +].
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
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartValRef = useRef<number>(value);

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

  // Winkelberechnung für die optische Dreh-Markierung
  let rotationDeg = 0;
  let normalizedProgress = 0;
  if (options && options.length > 1) {
    const idx = Math.max(0, options.indexOf(value));
    normalizedProgress = idx / (options.length - 1);
    rotationDeg = -135 + normalizedProgress * 270;
  } else if (wrapAround) {
    const span = Math.max(1, max - min + step);
    normalizedProgress = ((value - min) % span) / span;
    rotationDeg = normalizedProgress * 360;
  } else {
    const span = Math.max(1, max - min);
    normalizedProgress = Math.max(0, Math.min(1, (value - min) / span));
    rotationDeg = -135 + normalizedProgress * 270;
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    dragStartValRef.current = value;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartPosRef.current === null) return;
    const dy = dragStartPosRef.current.y - e.clientY;
    const dx = e.clientX - dragStartPosRef.current.x;
    const dominantDelta = Math.abs(dx) > Math.abs(dy) ? dx : dy;
    const pixelsPerStep = 14;
    const stepsMoved = Math.round(dominantDelta / pixelsPerStep);

    if (options && options.length > 0) {
      const startIdx = Math.max(0, options.indexOf(dragStartValRef.current));
      const nextIdx = wrapAround
        ? (((startIdx + stepsMoved) % options.length) + options.length) %
          options.length
        : Math.max(0, Math.min(options.length - 1, startIdx + stepsMoved));
      const nextVal = options[nextIdx];
      if (nextVal !== value) onChange(nextVal);
      return;
    }

    const nextVal = normalizeNextValue(
      dragStartValRef.current + stepsMoved * step
    );
    if (nextVal !== value) {
      onChange(nextVal);
    }
  };

  const handlePointerUp = () => {
    dragStartPosRef.current = null;
  };

  const displayStr = formatValue ? formatValue(value) : `${value}${unit}`;
  const stepHint =
    options && options.length > 0
      ? `STUFEN: ${options.map((o) => `${o}${unit}`).join(' · ')}`
      : `SCHRITT: ${step}${unit}`;

  const showCompassPresets = wrapAround && min === 0 && max === 355;

  return (
    <div data-testid={dataTestId} className="cmf-well space-y-2.5 p-3">
      <div className="flex items-center justify-between gap-2">
        {/* Linke Seite: Label, OLED-Digitalanzeige & Schrittweiten-Info */}
        <div className="min-w-0 flex-1 space-y-1">
          <span className="block truncate font-tech text-[10px] font-bold tracking-wider text-[var(--text-muted)] uppercase">
            {label}
          </span>
          <div className="cmf-oled inline-flex items-center gap-2 px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--cmf-orange)]" />
            <span className="font-dot text-sm text-[#F8FAFC]">{displayStr}</span>
          </div>
          <span className="hidden font-tech text-[9px] tracking-wider text-[var(--text-muted)] uppercase sm:block">
            {stepHint}
          </span>
        </div>

        {/* Rechte Seite: Physischer CMF-Drehknopf mit rastenden 44x44 [- / +] Tasten */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => stepByDelta(-1)}
            aria-label={`${ariaLabel ?? label} verringern`}
            className="cmf-btn-secondary flex h-11 w-11 items-center justify-center text-[var(--text-main)]"
            title={`-${step}${unit}`}
          >
            <Minus className="h-4 w-4" />
          </button>

          {/* Taktiles Dreh-Rad (Horizontal/Vertikal-Drag / Wheel / Keyboard Slider) */}
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
            title="Ziehen oder drehen zum Verstellen"
            className="relative flex h-14 w-14 cursor-grab touch-none items-center justify-center rounded-full border-2 border-[var(--shell-border)] bg-[var(--bg-module)] shadow-[0_3px_8px_rgba(24,27,32,0.14),inset_0_1.5px_0_rgba(255,255,255,0.9)] select-none active:cursor-grabbing"
          >
            {/* Äußerer Skalenring */}
            <div className="pointer-events-none absolute inset-1 rounded-full border border-dashed border-[var(--hardware-ring)]" />

            {/* Drehbarer Aluminium-Kern mit Signal-Orange-Zeiger */}
            <div
              className="pointer-events-none relative flex h-10 w-10 items-center justify-center rounded-full border border-[var(--shell-border)] bg-[var(--bg-well)] shadow-inner transition-transform duration-100"
              style={{ transform: `rotate(${rotationDeg}deg)` }}
            >
              <span className="absolute top-1 h-2.5 w-1 rounded-full bg-[var(--cmf-orange)]" />
              <span className="h-2 w-2 rounded-full bg-[var(--hardware-ring)]" />
            </div>
          </div>

          <button
            type="button"
            onClick={() => stepByDelta(1)}
            aria-label={`${ariaLabel ?? label} erhöhen`}
            className="cmf-btn-secondary flex h-11 w-11 items-center justify-center text-[var(--text-main)]"
            title={`+${step}${unit}`}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Einhand-Schnellwahl-Pills auf dem Smartphone für Stufenwerte oder Himmelsrichtungen */}
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
