import React, { useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Compass,
  Minus,
  Plus,
  RotateCcw,
  Trees,
} from 'lucide-react';
import {
  DEFAULT_QUESTION_RULES_CONFIG,
  isDefaultQuestionRulesConfig,
  resolveQuestionRulesConfig,
} from '../../config/gameConfig';
import type { QuestionRulesConfig } from '../../types/game';

export interface HostQuestionRulesEditorProps {
  questionConfig?: Partial<QuestionRulesConfig> | null;
  disabled?: boolean;
  defaultCategoriesExpanded?: boolean;
  onChange: (nextConfig: QuestionRulesConfig) => void;
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
  <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--shell-border)] bg-white/85 px-3 py-2">
    <div className="min-w-0">
      <span className="font-industrial block text-xs font-bold text-[var(--text-main)]">
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
        className="font-dot min-w-[68px] text-center text-xs font-bold text-[var(--text-main)]"
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

export const HostQuestionRulesEditor: React.FC<HostQuestionRulesEditorProps> = ({
  questionConfig,
  disabled = false,
  defaultCategoriesExpanded = true,
  onChange,
}) => {
  const cfg = resolveQuestionRulesConfig(questionConfig);
  const isDefault = isDefaultQuestionRulesConfig(questionConfig);

  const [openCategories, setOpenCategories] = useState<Record<1 | 2 | 3 | 4, boolean>>({
    1: defaultCategoriesExpanded,
    2: defaultCategoriesExpanded,
    3: defaultCategoriesExpanded,
    4: defaultCategoriesExpanded,
  });

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
      className="space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="font-tech block text-[11px] font-bold text-[var(--text-muted)] uppercase">
            Frage-Kategorien: Preise &amp; Distanzen
          </span>
          <span className="text-[11px] text-[var(--text-muted)]">
            Tippe auf eine Kategorie zum Auf-/Zuklappen.
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
          className="cmf-well space-y-2 p-3"
        >
          <button
            type="button"
            data-testid="toggle-question-rules-cat-1"
            aria-expanded={openCategories[1]}
            onClick={() => toggleCategory(1)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-1.5 font-industrial text-xs font-bold text-[var(--text-main)]">
              <Compass className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-teal)]" />
              <span>1. Richtung &amp; Warm/Kalt</span>
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

              <StepperRow
                label="Thermometer (Distanz)"
                sublabel="Stoppt automatisch nach Laufstrecke"
                valueText={`${cfg.thermometerDistanceMeters} m`}
                valueTestId="question-rule-thermo-distance"
                minusTestId="question-rule-thermo-distance-minus"
                plusTestId="question-rule-thermo-distance-plus"
                canDecrease={cfg.thermometerDistanceMeters > 25}
                canIncrease={cfg.thermometerDistanceMeters < 2000}
                disabled={disabled}
                onDecrease={() =>
                  patch({
                    thermometerDistanceMeters: cfg.thermometerDistanceMeters - 25,
                  })
                }
                onIncrease={() =>
                  patch({
                    thermometerDistanceMeters: cfg.thermometerDistanceMeters + 25,
                  })
                }
              />
            </div>
          )}
        </div>

        {/* KATEGORIE 2: Abstand & Umkreis */}
        <div
          data-testid="question-rules-cat-2"
          className="cmf-well space-y-2 p-3"
        >
          <button
            type="button"
            data-testid="toggle-question-rules-cat-2"
            aria-expanded={openCategories[2]}
            onClick={() => toggleCategory(2)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-1.5 font-industrial text-xs font-bold text-[var(--text-main)]">
              <CircleDot className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-teal)]" />
              <span>2. Abstand &amp; Umkreis</span>
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

              <StepperRow
                label="Umkreis-Check (Distanz)"
                sublabel="Standard-Radius in Metern"
                valueText={`${cfg.radiusRadarDistanceMeters} m`}
                valueTestId="question-rule-radius-distance"
                minusTestId="question-rule-radius-distance-minus"
                plusTestId="question-rule-radius-distance-plus"
                canDecrease={cfg.radiusRadarDistanceMeters > 25}
                canIncrease={cfg.radiusRadarDistanceMeters < 5000}
                disabled={disabled}
                onDecrease={() =>
                  patch({
                    radiusRadarDistanceMeters: Math.max(
                      25,
                      cfg.radiusRadarDistanceMeters - 50
                    ),
                  })
                }
                onIncrease={() =>
                  patch({
                    radiusRadarDistanceMeters: cfg.radiusRadarDistanceMeters + 50,
                  })
                }
              />

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

              <StepperRow
                label="Entfernungs-Ring (Distanz)"
                sublabel={`Ringbreite (z. B. 0–${cfg.donutRingStepMeters} m)`}
                valueText={`${cfg.donutRingStepMeters} m`}
                valueTestId="question-rule-donut-distance"
                minusTestId="question-rule-donut-distance-minus"
                plusTestId="question-rule-donut-distance-plus"
                canDecrease={cfg.donutRingStepMeters > 25}
                canIncrease={cfg.donutRingStepMeters < 2000}
                disabled={disabled}
                onDecrease={() =>
                  patch({ donutRingStepMeters: cfg.donutRingStepMeters - 25 })
                }
                onIncrease={() =>
                  patch({ donutRingStepMeters: cfg.donutRingStepMeters + 25 })
                }
              />
            </div>
          )}
        </div>

        {/* KATEGORIE 3: Umgebungs-Check */}
        <div
          data-testid="question-rules-cat-3"
          className="cmf-well space-y-2 p-3"
        >
          <button
            type="button"
            data-testid="toggle-question-rules-cat-3"
            aria-expanded={openCategories[3]}
            onClick={() => toggleCategory(3)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-1.5 font-industrial text-xs font-bold text-[var(--text-main)]">
              <Trees className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-amber)]" />
              <span>3. Umgebungs-Check</span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span className="font-tech text-[10px] font-bold text-[var(--text-muted)]">
                +{cfg.environmentPriceMinutes}m · {cfg.environmentDistanceMeters}m
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

              <StepperRow
                label="Haltestelle & Wertstoff (Distanz)"
                sublabel="Prüf-Umkreis um das Versteck"
                valueText={`${cfg.environmentDistanceMeters} m`}
                valueTestId="question-rule-env-distance"
                minusTestId="question-rule-env-distance-minus"
                plusTestId="question-rule-env-distance-plus"
                canDecrease={cfg.environmentDistanceMeters > 25}
                canIncrease={cfg.environmentDistanceMeters < 1000}
                disabled={disabled}
                onDecrease={() =>
                  patch({
                    environmentDistanceMeters: cfg.environmentDistanceMeters - 25,
                  })
                }
                onIncrease={() =>
                  patch({
                    environmentDistanceMeters: cfg.environmentDistanceMeters + 25,
                  })
                }
              />
            </div>
          )}
        </div>

        {/* KATEGORIE 4: Live-Fotos */}
        <div
          data-testid="question-rules-cat-4"
          className="cmf-well space-y-2 p-3"
        >
          <button
            type="button"
            data-testid="toggle-question-rules-cat-4"
            aria-expanded={openCategories[4]}
            onClick={() => toggleCategory(4)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-1.5 font-industrial text-xs font-bold text-[var(--text-main)]">
              <Camera className="h-3.5 w-3.5 shrink-0 text-[var(--cmf-orange)]" />
              <span>4. Live-Foto anfordern</span>
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
    </div>
  );
};
