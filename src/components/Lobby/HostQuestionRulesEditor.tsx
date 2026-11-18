import React, { useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Compass,
  Eye,
  Minus,
  Plus,
  RotateCcw,
  Settings2,
  Trees,
} from 'lucide-react';
import {
  DEFAULT_QUESTION_RULES_CONFIG,
  getRadiusRadarOptions,
  isDefaultQuestionRulesConfig,
  resolveQuestionRulesConfig,
} from '../../config/gameConfig';
import type { QuestionRulesConfig } from '../../types/game';
import { RadarDistancesMenuModal } from './RadarDistancesMenuModal';

export type LobbyRulePreviewTarget =
  | 'OSM_TRANSIT'
  | 'OSM_RECYCLING'
  | 'OSM_GREEN'
  | 'DONUT_RING'
  | 'THERMOMETER'
  | 'RADIUS_RADAR';

export interface HostQuestionRulesEditorProps {
  questionConfig?: Partial<QuestionRulesConfig> | null;
  disabled?: boolean;
  defaultCategoriesExpanded?: boolean;
  onChange: (nextConfig: QuestionRulesConfig) => void;
  onOpenRulePreview?: (
    target: LobbyRulePreviewTarget,
    initialRadiusMeters?: number
  ) => void;
}

interface StepperRowProps {
  label: string;
  sublabel?: string;
  valueText: string;
  valueTestId: string;
  minusTestId: string;
  plusTestId: string;
  canDecrease: boolean;
  canIncrease: boolean;
  disabled?: boolean;
  onDecrease: () => void;
  onIncrease: () => void;
}

const StepperRow: React.FC<StepperRowProps> = ({
  label,
  sublabel,
  valueText,
  valueTestId,
  minusTestId,
  plusTestId,
  canDecrease,
  canIncrease,
  disabled,
  onDecrease,
  onIncrease,
}) => (
  <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-[var(--shell-border)] bg-white/85 px-3 py-2">
    <div className="min-w-0">
      <span className="font-industrial block truncate text-xs font-bold text-[var(--text-main)]">
        {label}
      </span>
      {sublabel && (
        <span className="block text-[10px] text-[var(--text-muted)]">
          {sublabel}
        </span>
      )}
    </div>

    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        data-testid={minusTestId}
        disabled={disabled || !canDecrease}
        onClick={onDecrease}
        className="cmf-btn-secondary flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-35"
        aria-label={`${label} verringern`}
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <span
        data-testid={valueTestId}
        className="font-dot min-w-[64px] text-center text-xs font-bold text-[var(--text-main)]"
      >
        {valueText}
      </span>
      <button
        type="button"
        data-testid={plusTestId}
        disabled={disabled || !canIncrease}
        onClick={onIncrease}
        className="cmf-btn-secondary flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-35"
        aria-label={`${label} erhöhen`}
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
);

interface DistanceCounterRowProps {
  label: string;
  sublabel: string;
  valueMeters: number;
  minMeters: number;
  maxMeters: number;
  valueTestId: string;
  minusTestId: string;
  plusTestId: string;
  inputTestId: string;
  previewTestId: string;
  disabled?: boolean;
  onChangeMeters: (nextMeters: number) => void;
  onPreview?: () => void;
}

const DistanceCounterRow: React.FC<DistanceCounterRowProps> = ({
  label,
  sublabel,
  valueMeters,
  minMeters,
  maxMeters,
  valueTestId,
  minusTestId,
  plusTestId,
  inputTestId,
  previewTestId,
  disabled,
  onChangeMeters,
  onPreview,
}) => (
  <div className="min-w-0 space-y-2 rounded-xl border border-[var(--shell-border)] bg-white/85 p-2.5">
    <div className="flex flex-wrap items-start justify-between gap-1.5">
      <div className="min-w-0 flex-1">
        <span className="font-industrial block truncate text-xs font-bold text-[var(--text-main)]">
          {label}
        </span>
        <span className="block text-[10px] leading-tight text-[var(--text-muted)]">
          {sublabel}
        </span>
      </div>

      {onPreview && (
        <button
          type="button"
          data-testid={previewTestId}
          onClick={onPreview}
          className="cmf-btn-secondary inline-flex h-7 shrink-0 items-center gap-1 px-2.5 text-[11px] font-semibold"
        >
          <Eye className="h-3 w-3 shrink-0" />
          <span>Vorschau</span>
        </button>
      )}
    </div>

    {/* Kompakte Zähler-Leiste mit Buttons (ohne Slider, niemals überbreit) */}
    <div className="flex flex-wrap items-center justify-between gap-1 rounded-lg bg-[var(--module-sub)] p-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          data-testid={minusTestId}
          disabled={disabled || valueMeters <= minMeters}
          onClick={() => onChangeMeters(Math.max(minMeters, valueMeters - 25))}
          aria-label={`${label} um 25 m verringern`}
          className="cmf-btn-secondary h-7 px-2 text-[11px] font-semibold disabled:opacity-35"
        >
          -25
        </button>
        <button
          type="button"
          disabled={disabled || valueMeters <= minMeters}
          onClick={() => onChangeMeters(Math.max(minMeters, valueMeters - 5))}
          aria-label={`${label} um 5 m verringern`}
          className="cmf-btn-secondary flex h-7 w-7 shrink-0 items-center justify-center disabled:opacity-35"
        >
          <Minus className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center justify-center gap-1 px-1">
        <span data-testid={valueTestId} className="sr-only">
          {valueMeters} m
        </span>
        <input
          type="number"
          data-testid={inputTestId}
          min={minMeters}
          max={maxMeters}
          disabled={disabled}
          aria-label={`${label} exakt in Metern`}
          value={valueMeters}
          onChange={(e) => {
            const parsed = Math.round(Number(e.target.value));
            if (Number.isFinite(parsed) && parsed >= minMeters) {
              onChangeMeters(Math.min(maxMeters, parsed));
            }
          }}
          className="cmf-input font-dot h-7 w-16 px-1.5 text-center text-xs font-bold"
        />
        <span className="text-[11px] font-semibold text-[var(--text-muted)]">
          m
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={disabled || valueMeters >= maxMeters}
          onClick={() => onChangeMeters(Math.min(maxMeters, valueMeters + 5))}
          aria-label={`${label} um 5 m erhöhen`}
          className="cmf-btn-secondary flex h-7 w-7 shrink-0 items-center justify-center disabled:opacity-35"
        >
          <Plus className="h-3 w-3" />
        </button>
        <button
          type="button"
          data-testid={plusTestId}
          disabled={disabled || valueMeters >= maxMeters}
          onClick={() => onChangeMeters(Math.min(maxMeters, valueMeters + 25))}
          aria-label={`${label} um 25 m erhöhen`}
          className="cmf-btn-secondary h-7 px-2 text-[11px] font-semibold disabled:opacity-35"
        >
          +25
        </button>
      </div>
    </div>
  </div>
);

export const HostQuestionRulesEditor: React.FC<HostQuestionRulesEditorProps> = ({
  questionConfig,
  disabled = false,
  defaultCategoriesExpanded = true,
  onChange,
  onOpenRulePreview,
}) => {
  const cfg = resolveQuestionRulesConfig(questionConfig);
  const transitDist = cfg.transitDistanceMeters ?? cfg.environmentDistanceMeters;
  const radarRadii = getRadiusRadarOptions(questionConfig);
  const isDefault = isDefaultQuestionRulesConfig(questionConfig);

  const [openCategories, setOpenCategories] = useState<Record<1 | 2 | 3 | 4, boolean>>({
    1: defaultCategoriesExpanded,
    2: defaultCategoriesExpanded,
    3: defaultCategoriesExpanded,
    4: defaultCategoriesExpanded,
  });
  const [radarMenuOpen, setRadarMenuOpen] = useState(false);

  const toggleCategory = (catId: 1 | 2 | 3 | 4) => {
    setOpenCategories((prev) => ({
      ...prev,
      [catId]: !prev[catId],
    }));
  };

  const patch = (partial: Partial<QuestionRulesConfig>) => {
    if (disabled) return;
    onChange(resolveQuestionRulesConfig({ ...cfg, ...partial }));
  };

  return (
    <div
      data-testid="host-question-rules-editor"
      className="min-w-0 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-tech block text-[11px] font-bold text-[var(--text-muted)] uppercase">
            Frage-Kategorien: Preise &amp; Distanzen
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">
            Tippe auf eine Kategorie zum Auf-/Zuklappen oder nutze die Kartenvorschau.
          </span>
        </div>

        {!isDefault && (
          <button
            type="button"
            data-testid="question-rules-reset-btn"
            disabled={disabled}
            onClick={() => onChange({ ...DEFAULT_QUESTION_RULES_CONFIG })}
            className="cmf-btn-secondary font-tech inline-flex min-h-[32px] items-center gap-1.5 rounded-xl px-2.5 py-1 text-[10px] font-bold uppercase"
          >
            <RotateCcw className="h-3 w-3 text-[var(--cmf-orange)]" />
            <span>Standardwerte</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {/* KATEGORIE 1: Richtung & Warm/Kalt */}
        <div
          data-testid="question-rules-cat-1"
          className="cmf-well min-w-0 space-y-2 p-3"
        >
          <button
            type="button"
            data-testid="toggle-question-rules-cat-1"
            aria-expanded={openCategories[1]}
            onClick={() => toggleCategory(1)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex min-w-0 items-center gap-1.5 font-industrial text-xs font-bold text-[var(--text-main)]">
              <Compass className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-teal)]" />
              <span className="truncate">1. Richtung &amp; Warm/Kalt</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="font-tech text-[10px] font-bold text-[var(--text-muted)]">
                +{cfg.directionPriceMinutes}/+{cfg.thermometerPriceMinutes}m · {cfg.thermometerDistanceMeters}m
              </span>
              {openCategories[1] ? (
                <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              )}
            </span>
          </button>

          {openCategories[1] && (
            <div className="space-y-2 pt-1">
              <StepperRow
                label="Richtung & 45°-Kegel (Preis)"
                sublabel="Nord/Süd, Ost/West & Kegel"
                valueText={`+${cfg.directionPriceMinutes} Min.`}
                valueTestId="question-rule-direction-price"
                minusTestId="question-rule-direction-price-minus"
                plusTestId="question-rule-direction-price-plus"
                canDecrease={cfg.directionPriceMinutes > 0}
                canIncrease={cfg.directionPriceMinutes < 120}
                disabled={disabled}
                onDecrease={() =>
                  patch({ directionPriceMinutes: cfg.directionPriceMinutes - 1 })
                }
                onIncrease={() =>
                  patch({ directionPriceMinutes: cfg.directionPriceMinutes + 1 })
                }
              />

              <StepperRow
                label="Thermometer (Preis)"
                sublabel="Warm oder Kalt"
                valueText={`+${cfg.thermometerPriceMinutes} Min.`}
                valueTestId="question-rule-thermo-price"
                minusTestId="question-rule-thermo-price-minus"
                plusTestId="question-rule-thermo-price-plus"
                canDecrease={cfg.thermometerPriceMinutes > 0}
                canIncrease={cfg.thermometerPriceMinutes < 120}
                disabled={disabled}
                onDecrease={() =>
                  patch({
                    thermometerPriceMinutes: cfg.thermometerPriceMinutes - 1,
                  })
                }
                onIncrease={() =>
                  patch({
                    thermometerPriceMinutes: cfg.thermometerPriceMinutes + 1,
                  })
                }
              />

              <DistanceCounterRow
                label="Thermometer (Distanz)"
                sublabel="Stoppt automatisch nach Laufstrecke"
                valueMeters={cfg.thermometerDistanceMeters}
                minMeters={10}
                maxMeters={2000}
                valueTestId="question-rule-thermo-distance"
                minusTestId="question-rule-thermo-distance-minus"
                plusTestId="question-rule-thermo-distance-plus"
                inputTestId="question-rule-thermo-distance-input"
                previewTestId="preview-rule-thermo-btn"
                disabled={disabled}
                onChangeMeters={(nextMeters) =>
                  patch({ thermometerDistanceMeters: nextMeters })
                }
                onPreview={
                  onOpenRulePreview
                    ? () => onOpenRulePreview('THERMOMETER')
                    : undefined
                }
              />
            </div>
          )}
        </div>

        {/* KATEGORIE 2: Abstand & Umkreis */}
        <div
          data-testid="question-rules-cat-2"
          className="cmf-well min-w-0 space-y-2 p-3"
        >
          <button
            type="button"
            data-testid="toggle-question-rules-cat-2"
            aria-expanded={openCategories[2]}
            onClick={() => toggleCategory(2)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex min-w-0 items-center gap-1.5 font-industrial text-xs font-bold text-[var(--text-main)]">
              <CircleDot className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-teal)]" />
              <span className="truncate">2. Abstand &amp; Umkreis</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="font-tech text-[10px] font-bold text-[var(--text-muted)]">
                +{cfg.radiusRadarPriceMinutes}/+{cfg.donutRingPriceMinutes}m · {cfg.donutRingStepMeters}m
              </span>
              {openCategories[2] ? (
                <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              )}
            </span>
          </button>

          {openCategories[2] && (
            <div className="space-y-2 pt-1">
              <StepperRow
                label="Umkreis-Check (Preis)"
                sublabel="Radius-Radar um Sucher"
                valueText={`+${cfg.radiusRadarPriceMinutes} Min.`}
                valueTestId="question-rule-radius-price"
                minusTestId="question-rule-radius-price-minus"
                plusTestId="question-rule-radius-price-plus"
                canDecrease={cfg.radiusRadarPriceMinutes > 0}
                canIncrease={cfg.radiusRadarPriceMinutes < 120}
                disabled={disabled}
                onDecrease={() =>
                  patch({
                    radiusRadarPriceMinutes: cfg.radiusRadarPriceMinutes - 1,
                  })
                }
                onIncrease={() =>
                  patch({
                    radiusRadarPriceMinutes: cfg.radiusRadarPriceMinutes + 1,
                  })
                }
              />

              {/* Extra-Menü für Radar-Distanzen (Hinzufügen, Entfernen & Vorschau) */}
              <div className="min-w-0 rounded-xl border border-[var(--shell-border)] bg-white/85 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="font-industrial block truncate text-xs font-bold text-[var(--text-main)]">
                      Radar-Distanzen ({radarRadii.length})
                    </span>
                    <span className="block truncate text-[10px] text-[var(--text-muted)]">
                      {radarRadii.map((r) => `${r} m`).join(' · ')}
                    </span>
                  </div>

                  <button
                    type="button"
                    data-testid="open-radar-distances-menu-btn"
                    disabled={disabled}
                    onClick={() => setRadarMenuOpen(true)}
                    className="cmf-btn-secondary inline-flex h-8 shrink-0 items-center gap-1.5 px-2.5 text-xs font-semibold"
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    <span>Radar-Menü</span>
                  </button>
                </div>
              </div>

              <StepperRow
                label="Entfernungs-Ring (Preis)"
                sublabel="Donut-Ring Abstand"
                valueText={`+${cfg.donutRingPriceMinutes} Min.`}
                valueTestId="question-rule-donut-price"
                minusTestId="question-rule-donut-price-minus"
                plusTestId="question-rule-donut-price-plus"
                canDecrease={cfg.donutRingPriceMinutes > 0}
                canIncrease={cfg.donutRingPriceMinutes < 120}
                disabled={disabled}
                onDecrease={() =>
                  patch({ donutRingPriceMinutes: cfg.donutRingPriceMinutes - 1 })
                }
                onIncrease={() =>
                  patch({ donutRingPriceMinutes: cfg.donutRingPriceMinutes + 1 })
                }
              />

              <DistanceCounterRow
                label="Entfernungs-Ring / Donut (Distanz)"
                sublabel={`Ringbreite (z. B. 0–${cfg.donutRingStepMeters} m)`}
                valueMeters={cfg.donutRingStepMeters}
                minMeters={10}
                maxMeters={2000}
                valueTestId="question-rule-donut-distance"
                minusTestId="question-rule-donut-distance-minus"
                plusTestId="question-rule-donut-distance-plus"
                inputTestId="question-rule-donut-distance-input"
                previewTestId="preview-rule-donut-btn"
                disabled={disabled}
                onChangeMeters={(nextMeters) =>
                  patch({ donutRingStepMeters: nextMeters })
                }
                onPreview={
                  onOpenRulePreview
                    ? () => onOpenRulePreview('DONUT_RING')
                    : undefined
                }
              />
            </div>
          )}
        </div>

        {/* KATEGORIE 3: Umgebungs-Check */}
        <div
          data-testid="question-rules-cat-3"
          className="cmf-well min-w-0 space-y-2 p-3"
        >
          <button
            type="button"
            data-testid="toggle-question-rules-cat-3"
            aria-expanded={openCategories[3]}
            onClick={() => toggleCategory(3)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex min-w-0 items-center gap-1.5 font-industrial text-xs font-bold text-[var(--text-main)]">
              <Trees className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-amber)]" />
              <span className="truncate">3. Umgebungs-Check</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="font-tech text-[10px] font-bold text-[var(--text-muted)]">
                +{cfg.environmentPriceMinutes}m · {transitDist}/{cfg.environmentDistanceMeters}m
              </span>
              {openCategories[3] ? (
                <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              )}
            </span>
          </button>

          {openCategories[3] && (
            <div className="space-y-2 pt-1">
              <StepperRow
                label="Umgebungs-Check (Preis)"
                sublabel="Haltestelle, Wertstoff & Grünfläche"
                valueText={`+${cfg.environmentPriceMinutes} Min.`}
                valueTestId="question-rule-env-price"
                minusTestId="question-rule-env-price-minus"
                plusTestId="question-rule-env-price-plus"
                canDecrease={cfg.environmentPriceMinutes > 0}
                canIncrease={cfg.environmentPriceMinutes < 120}
                disabled={disabled}
                onDecrease={() =>
                  patch({
                    environmentPriceMinutes: cfg.environmentPriceMinutes - 1,
                  })
                }
                onIncrease={() =>
                  patch({
                    environmentPriceMinutes: cfg.environmentPriceMinutes + 1,
                  })
                }
              />

              <DistanceCounterRow
                label="Haltestelle (Distanz)"
                sublabel="Prüf-Umkreis um Bus & Bahn"
                valueMeters={transitDist}
                minMeters={10}
                maxMeters={1000}
                valueTestId="question-rule-transit-distance"
                minusTestId="question-rule-transit-distance-minus"
                plusTestId="question-rule-transit-distance-plus"
                inputTestId="question-rule-transit-distance-input"
                previewTestId="preview-rule-transit-btn"
                disabled={disabled}
                onChangeMeters={(nextMeters) =>
                  patch({ transitDistanceMeters: nextMeters })
                }
                onPreview={
                  onOpenRulePreview
                    ? () => onOpenRulePreview('OSM_TRANSIT')
                    : undefined
                }
              />

              <DistanceCounterRow
                label="Wertstoffinsel (Distanz)"
                sublabel="Prüf-Umkreis um Wertstoffinseln"
                valueMeters={cfg.environmentDistanceMeters}
                minMeters={10}
                maxMeters={1000}
                valueTestId="question-rule-env-distance"
                minusTestId="question-rule-env-distance-minus"
                plusTestId="question-rule-env-distance-plus"
                inputTestId="question-rule-env-distance-input"
                previewTestId="preview-rule-recycling-btn"
                disabled={disabled}
                onChangeMeters={(nextMeters) =>
                  patch({ environmentDistanceMeters: nextMeters })
                }
                onPreview={
                  onOpenRulePreview
                    ? () => onOpenRulePreview('OSM_RECYCLING')
                    : undefined
                }
              />

              {/* Grünflächen-Kartenvorschau */}
              <div className="min-w-0 rounded-xl border border-[var(--shell-border)] bg-white/85 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <span className="font-industrial block truncate text-xs font-bold text-[var(--text-main)]">
                      Grünflächen &amp; Parks
                    </span>
                    <span className="block text-[10px] text-[var(--text-muted)]">
                      Alle Grünflächen im Gebiet (+20 m Rand)
                    </span>
                  </div>

                  {onOpenRulePreview && (
                    <button
                      type="button"
                      data-testid="preview-rule-green-btn"
                      onClick={() => onOpenRulePreview('OSM_GREEN')}
                      className="cmf-btn-secondary inline-flex h-7 shrink-0 items-center gap-1 px-2.5 text-[11px] font-semibold"
                    >
                      <Eye className="h-3 w-3 shrink-0" />
                      <span>Vorschau</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* KATEGORIE 4: Live-Fotos */}
        <div
          data-testid="question-rules-cat-4"
          className="cmf-well min-w-0 space-y-2 p-3"
        >
          <button
            type="button"
            data-testid="toggle-question-rules-cat-4"
            aria-expanded={openCategories[4]}
            onClick={() => toggleCategory(4)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex min-w-0 items-center gap-1.5 font-industrial text-xs font-bold text-[var(--text-main)]">
              <Camera className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-orange)]" />
              <span className="truncate">4. Live-Foto anfordern</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="font-tech text-[10px] font-bold text-[var(--text-muted)]">
                +{cfg.photoPriceMinutes}m
              </span>
              {openCategories[4] ? (
                <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
              )}
            </span>
          </button>

          {openCategories[4] && (
            <div className="space-y-2 pt-1">
              <StepperRow
                label="Live-Foto (Preis)"
                sublabel={`Himmel / Boden (Timeout-Bonus: -${cfg.photoPriceMinutes * 2} Min.)`}
                valueText={`+${cfg.photoPriceMinutes} Min.`}
                valueTestId="question-rule-photo-price"
                minusTestId="question-rule-photo-price-minus"
                plusTestId="question-rule-photo-price-plus"
                canDecrease={cfg.photoPriceMinutes > 0}
                canIncrease={cfg.photoPriceMinutes < 120}
                disabled={disabled}
                onDecrease={() =>
                  patch({ photoPriceMinutes: cfg.photoPriceMinutes - 1 })
                }
                onIncrease={() =>
                  patch({ photoPriceMinutes: cfg.photoPriceMinutes + 1 })
                }
              />
            </div>
          )}
        </div>
      </div>

      <RadarDistancesMenuModal
        open={radarMenuOpen}
        questionConfig={questionConfig}
        disabled={disabled}
        onClose={() => setRadarMenuOpen(false)}
        onChangeRadii={(nextRadii, preferredDefault) => {
          const nextDefault =
            preferredDefault !== undefined && nextRadii.includes(preferredDefault)
              ? preferredDefault
              : nextRadii.includes(cfg.radiusRadarDistanceMeters)
                ? cfg.radiusRadarDistanceMeters
                : nextRadii[Math.floor(nextRadii.length / 2)] ?? nextRadii[0] ?? 250;
          patch({
            radiusRadarOptionsMeters: nextRadii,
            radiusRadarDistanceMeters: nextDefault,
          });
        }}
        onPreviewRadius={
          onOpenRulePreview
            ? (radiusMeters) => onOpenRulePreview('RADIUS_RADAR', radiusMeters)
            : undefined
        }
      />
    </div>
  );
};
