import React, { useState } from 'react';
import { Eye, Minus, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import {
  DEFAULT_RADIUS_OPTIONS_METERS,
  getRadiusRadarOptions,
  normalizeRadiusRadarOptions,
} from '../../config/gameConfig';
import type { QuestionRulesConfig } from '../../types/game';

export interface RadarDistancesMenuModalProps {
  open: boolean;
  questionConfig?: Partial<QuestionRulesConfig> | null;
  disabled?: boolean;
  onClose: () => void;
  onChangeRadii: (nextRadii: number[], preferredDefault?: number) => void;
  onPreviewRadius?: (radiusMeters: number) => void;
}

export const RadarDistancesMenuModal: React.FC<RadarDistancesMenuModalProps> = ({
  open,
  questionConfig,
  disabled = false,
  onClose,
  onChangeRadii,
  onPreviewRadius,
}) => {
  const radii = getRadiusRadarOptions(questionConfig);
  const [draftMeters, setDraftMeters] = useState<string>('350');

  if (!open) return null;

  const parsedDraft = Math.round(Number(draftMeters));
  const clampedDraft = Number.isFinite(parsedDraft)
    ? Math.min(5000, Math.max(10, parsedDraft))
    : null;
  const canAddDraft =
    !disabled &&
    clampedDraft !== null &&
    !radii.includes(clampedDraft);

  const isDefaultRadii =
    radii.length === DEFAULT_RADIUS_OPTIONS_METERS.length &&
    radii.every((r, idx) => r === DEFAULT_RADIUS_OPTIONS_METERS[idx]);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAddDraft || clampedDraft === null) return;
    const next = normalizeRadiusRadarOptions([...radii, clampedDraft]);
    onChangeRadii(next, clampedDraft);
  };

  const handleRemove = (targetRadius: number) => {
    if (disabled || radii.length <= 1) return;
    const next = radii.filter((r) => r !== targetRadius);
    onChangeRadii(next);
  };

  const stepDraft = (delta: number) => {
    const base = clampedDraft ?? 250;
    const nextVal = Math.min(5000, Math.max(10, base + delta));
    setDraftMeters(String(nextVal));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Radar-Distanzen verwalten"
      data-testid="radar-distances-menu"
      onClick={onClose}
      className="fixed inset-0 z-[850] flex items-center justify-center bg-black/60 p-3 backdrop-blur-xs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cmf-chassis w-full max-w-md space-y-4 p-4 sm:p-5 text-[var(--text-main)] shadow-2xl"
      >
        <div className="flex items-center justify-between gap-2 border-b cmf-divider pb-3">
          <div>
            <h3 className="font-industrial text-base font-bold text-[var(--text-main)]">
              Radar-Distanzen verwalten
            </h3>
            <p className="text-xs text-[var(--text-muted)]">
              Umkreis-Check Radien hinzufügen, entfernen &amp; auf der Karte testen.
            </p>
          </div>
          <button
            type="button"
            aria-label="Schließen"
            data-testid="close-radar-distances-menu-btn"
            onClick={onClose}
            className="cmf-btn-secondary flex h-8 w-8 shrink-0 items-center justify-center"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Neue Distanz hinzufügen */}
        <form onSubmit={handleAdd} className="cmf-well space-y-2 p-3">
          <label
            htmlFor="new-radar-distance-input"
            className="block text-xs font-semibold text-[var(--text-main)]"
          >
            Neue Distanz hinzufügen (10–5000 m)
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={disabled}
              onClick={() => stepDraft(-25)}
              aria-label="25 Meter weniger"
              className="cmf-btn-secondary flex h-9 w-9 shrink-0 items-center justify-center"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <div className="relative flex-1">
              <input
                id="new-radar-distance-input"
                data-testid="new-radar-distance-input"
                type="number"
                min={10}
                max={5000}
                step={5}
                disabled={disabled}
                value={draftMeters}
                onChange={(e) => setDraftMeters(e.target.value)}
                placeholder="z. B. 350"
                className="cmf-input min-h-[38px] w-full pr-8 pl-3 text-sm font-bold"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-[var(--text-muted)]">
                m
              </span>
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => stepDraft(25)}
              aria-label="25 Meter mehr"
              className="cmf-btn-secondary flex h-9 w-9 shrink-0 items-center justify-center"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="submit"
              data-testid="add-radar-distance-btn"
              disabled={!canAddDraft}
              className="cmf-btn-primary min-h-[38px] shrink-0 px-3.5 py-1.5 text-xs font-semibold"
            >
              + Hinzufügen
            </button>
          </div>
          {clampedDraft !== null && radii.includes(clampedDraft) && (
            <p className="text-[11px] text-[var(--text-muted)]">
              {clampedDraft} m ist bereits in der Liste enthalten.
            </p>
          )}
        </form>

        {/* Aktuelle Liste der Radar-Distanzen */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5">
            <span className="text-xs font-semibold text-[var(--text-muted)]">
              Aktive Distanzen ({radii.length})
            </span>
            {!isDefaultRadii && (
              <button
                type="button"
                data-testid="reset-radar-distances-btn"
                disabled={disabled}
                onClick={() =>
                  onChangeRadii([...DEFAULT_RADIUS_OPTIONS_METERS], 250)
                }
                className="inline-flex items-center gap-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-main)]"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Standard (50–1000 m)</span>
              </button>
            )}
          </div>

          <div className="max-h-[220px] space-y-1.5 overflow-y-auto pr-0.5">
            {radii.map((r) => (
              <div
                key={r}
                data-testid={`radar-distance-row-${r}`}
                className="cmf-well flex items-center justify-between gap-2 px-3 py-2"
              >
                <span className="font-dot text-sm text-[var(--text-main)]">
                  {r} m
                </span>
                <div className="flex items-center gap-1.5">
                  {onPreviewRadius && (
                    <button
                      type="button"
                      data-testid={`preview-radar-distance-${r}`}
                      onClick={() => {
                        onClose();
                        onPreviewRadius(r);
                      }}
                      className="cmf-btn-secondary inline-flex min-h-[32px] items-center gap-1 px-2.5 py-1 text-xs font-medium"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>Vorschau</span>
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid={`remove-radar-distance-${r}`}
                    disabled={disabled || radii.length <= 1}
                    onClick={() => handleRemove(r)}
                    aria-label={`${r} m entfernen`}
                    title={
                      radii.length <= 1
                        ? 'Mindestens eine Distanz muss aktiv bleiben'
                        : `${r} m entfernen`
                    }
                    className="cmf-btn-secondary flex h-8 w-8 items-center justify-center text-[var(--cmf-orange)] disabled:opacity-35"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t cmf-divider pt-3">
          {onPreviewRadius && (
            <button
              type="button"
              data-testid="preview-all-radar-distances-btn"
              onClick={() => {
                const target = radii[Math.floor(radii.length / 2)] ?? radii[0] ?? 250;
                onClose();
                onPreviewRadius(target);
              }}
              className="cmf-btn-secondary inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Auf Karte testen</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="cmf-btn-primary min-h-[38px] px-5 py-1.5 text-xs font-semibold"
          >
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
};
