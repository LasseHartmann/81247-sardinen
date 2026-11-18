import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Minus, Plus, Trash2, Users } from 'lucide-react';
import {
  getRadiusRadarOptions,
  normalizeRadiusRadarOptions,
  resolveQuestionRulesConfig,
} from '../../config/gameConfig';
import type { QuestionRulesConfig, QuestionType } from '../../types/game';
import { PhysicsBottomSheet } from '../Common/PhysicsBottomSheet';
import type { LobbyRulePreviewTarget } from './HostQuestionRulesEditor';

export interface LobbyRulePreviewSheetProps {
  activeTarget: LobbyRulePreviewTarget;
  onChangeTarget: (target: LobbyRulePreviewTarget) => void;
  questionConfig?: Partial<QuestionRulesConfig> | null;
  selectedRadarMeters: number;
  onSelectRadarMeters: (r: number) => void;
  onChangeQuestionConfig: (nextConfig: QuestionRulesConfig) => void;
  onDone: () => void;
}

export function resolveLobbyPreviewQuestionType(
  target: LobbyRulePreviewTarget
): QuestionType {
  return target;
}

export const LobbyRulePreviewSheet: React.FC<LobbyRulePreviewSheetProps> = ({
  activeTarget,
  onChangeTarget,
  questionConfig,
  selectedRadarMeters,
  onSelectRadarMeters,
  onChangeQuestionConfig,
  onDone,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [newRadarInput, setNewRadarInput] = useState('350');

  const cfg = resolveQuestionRulesConfig(questionConfig);
  const transitDist = cfg.transitDistanceMeters ?? cfg.environmentDistanceMeters;
  const radarRadii = getRadiusRadarOptions(questionConfig);

  const patch = (partial: Partial<QuestionRulesConfig>) => {
    onChangeQuestionConfig(resolveQuestionRulesConfig({ ...cfg, ...partial }));
  };

  const titleText =
    activeTarget === 'OSM_TRANSIT'
      ? `Haltestellen-Umkreis (${transitDist} m)`
      : activeTarget === 'OSM_RECYCLING'
        ? `Wertstoffinsel-Umkreis (${cfg.environmentDistanceMeters} m)`
        : activeTarget === 'OSM_GREEN'
          ? 'Grünflächen & Parks'
          : activeTarget === 'DONUT_RING'
            ? `Donut-Ringbreite (${cfg.donutRingStepMeters} m)`
            : activeTarget === 'THERMOMETER'
              ? `Thermometer-Distanz (${cfg.thermometerDistanceMeters} m)`
              : `Radar-Distanzen (${selectedRadarMeters} m aktiv)`;

  const subtitleText =
    activeTarget === 'OSM_TRANSIT'
      ? 'Alle Haltestellen im Gebiet mit exaktem Prüf-Radius'
      : activeTarget === 'OSM_RECYCLING'
        ? 'Alle Wertstoffinseln im Gebiet mit exaktem Prüf-Radius'
        : activeTarget === 'OSM_GREEN'
          ? 'Alle erkannten Grünflächen & Parks im Spielgebiet'
          : activeTarget === 'THERMOMETER'
            ? 'Tippe auf die Karte, um Startpunkt A zu verschieben'
            : 'Tippe auf die Karte, um Mittelpunkt P zu verschieben';

  const renderCounterButtons = (opts: {
    value: number;
    min: number;
    max: number;
    testIdPrefix: string;
    onUpdate: (val: number) => void;
  }) => (
    <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-2xl bg-[var(--module-sub)] p-1.5">
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={opts.value <= opts.min}
          onClick={() => opts.onUpdate(Math.max(opts.min, opts.value - 50))}
          className="cmf-btn-secondary h-8 px-2.5 text-xs font-semibold disabled:opacity-35"
        >
          -50
        </button>
        <button
          type="button"
          disabled={opts.value <= opts.min}
          onClick={() => opts.onUpdate(Math.max(opts.min, opts.value - 10))}
          className="cmf-btn-secondary h-8 px-2 text-xs font-semibold disabled:opacity-35"
        >
          -10
        </button>
        <button
          type="button"
          disabled={opts.value <= opts.min}
          onClick={() => opts.onUpdate(Math.max(opts.min, opts.value - 1))}
          aria-label="1 Meter weniger"
          className="cmf-btn-secondary flex h-8 w-8 shrink-0 items-center justify-center disabled:opacity-35"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex items-center gap-1">
        <input
          type="number"
          data-testid={`${opts.testIdPrefix}-exact-input`}
          min={opts.min}
          max={opts.max}
          value={opts.value}
          onChange={(e) => {
            const parsed = Math.round(Number(e.target.value));
            if (Number.isFinite(parsed) && parsed >= opts.min) {
              opts.onUpdate(Math.min(opts.max, parsed));
            }
          }}
          className="cmf-input font-dot h-8 w-20 px-2 text-center text-sm font-bold"
        />
        <span className="text-xs font-semibold text-[var(--text-muted)]">m</span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={opts.value >= opts.max}
          onClick={() => opts.onUpdate(Math.min(opts.max, opts.value + 1))}
          aria-label="1 Meter mehr"
          className="cmf-btn-secondary flex h-8 w-8 shrink-0 items-center justify-center disabled:opacity-35"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={opts.value >= opts.max}
          onClick={() => opts.onUpdate(Math.min(opts.max, opts.value + 10))}
          className="cmf-btn-secondary h-8 px-2 text-xs font-semibold disabled:opacity-35"
        >
          +10
        </button>
        <button
          type="button"
          disabled={opts.value >= opts.max}
          onClick={() => opts.onUpdate(Math.min(opts.max, opts.value + 50))}
          className="cmf-btn-secondary h-8 px-2.5 text-xs font-semibold disabled:opacity-35"
        >
          +50
        </button>
      </div>
    </div>
  );

  const parsedNewRadar = Math.round(Number(newRadarInput));
  const validNewRadar = Number.isFinite(parsedNewRadar)
    ? Math.min(5000, Math.max(10, parsedNewRadar))
    : null;
  const canAddRadar = validNewRadar !== null && !radarRadii.includes(validNewRadar);

  return (
    <PhysicsBottomSheet
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      allowBodyDrag={false}
      scrollableBody
      maxWidthClass="max-w-lg"
      bodyClassName="max-h-[42dvh] overflow-y-auto p-3.5 pt-2.5 sm:p-4 sm:pt-3 space-y-3"
      header={
        <div
          data-testid="map-lobby-rule-preview-sheet"
          className="flex w-full items-center justify-between gap-2"
        >
          <div className="min-w-0 text-left">
            <span className="block truncate font-industrial text-sm font-bold text-[var(--text-main)]">
              {titleText}
            </span>
            <span className="block truncate text-[11px] text-[var(--text-muted)]">
              {subtitleText}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              data-testid="lobby-rule-preview-done-btn"
              onClick={(e) => {
                e.stopPropagation();
                onDone();
              }}
              className="cmf-btn-primary inline-flex min-h-[34px] items-center gap-1.5 px-3 py-1 text-xs font-semibold"
            >
              <Users className="h-3.5 w-3.5" />
              <span>Zur Lobby</span>
            </button>
            {collapsed ? (
              <ChevronUp className="h-4 w-4 text-[var(--text-muted)]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[var(--text-muted)]" />
            )}
          </div>
        </div>
      }
    >
      {/* Schnellwechsel zwischen allen 6 Kartenvorschauen */}
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-[var(--module-sub)] p-1 sm:grid-cols-6">
        {(
          [
            { id: 'OSM_TRANSIT', label: 'Haltestelle' },
            { id: 'OSM_RECYCLING', label: 'Wertstoff' },
            { id: 'OSM_GREEN', label: 'Grünfläche' },
            { id: 'DONUT_RING', label: 'Donut' },
            { id: 'THERMOMETER', label: 'Thermo' },
            { id: 'RADIUS_RADAR', label: 'Radar' },
          ] as const
        ).map((item) => {
          const active = activeTarget === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`preview-switch-${item.id}`}
              onClick={() => onChangeTarget(item.id)}
              className={`min-h-[32px] truncate rounded-xl px-1.5 py-1 text-[11px] font-semibold transition-colors ${
                active
                  ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {activeTarget === 'OSM_TRANSIT' &&
        renderCounterButtons({
          value: transitDist,
          min: 10,
          max: 1000,
          testIdPrefix: 'map-preview-transit',
          onUpdate: (nextVal) => patch({ transitDistanceMeters: nextVal }),
        })}

      {activeTarget === 'OSM_RECYCLING' &&
        renderCounterButtons({
          value: cfg.environmentDistanceMeters,
          min: 10,
          max: 1000,
          testIdPrefix: 'map-preview-env',
          onUpdate: (nextVal) => patch({ environmentDistanceMeters: nextVal }),
        })}

      {activeTarget === 'OSM_GREEN' && (
        <div className="cmf-well px-3 py-2.5 text-xs text-[var(--text-muted)]">
          Grün markiert sind alle Parks, Wälder und Grünanlagen im aktuellen Spielgebiet (bei der Frage gilt zusätzlich eine <strong>20 m Randtoleranz</strong>).
        </div>
      )}

      {activeTarget === 'DONUT_RING' && (
        <div className="space-y-2">
          <p className="text-[11px] text-[var(--text-muted)]">
            Ringe: 0–{cfg.donutRingStepMeters} m, {cfg.donutRingStepMeters}–
            {cfg.donutRingStepMeters * 2} m, {cfg.donutRingStepMeters * 2}–
            {cfg.donutRingStepMeters * 3} m …
          </p>
          {renderCounterButtons({
            value: cfg.donutRingStepMeters,
            min: 10,
            max: 2000,
            testIdPrefix: 'map-preview-donut',
            onUpdate: (nextVal) => patch({ donutRingStepMeters: nextVal }),
          })}
        </div>
      )}

      {activeTarget === 'THERMOMETER' &&
        renderCounterButtons({
          value: cfg.thermometerDistanceMeters,
          min: 10,
          max: 2000,
          testIdPrefix: 'map-preview-thermo',
          onUpdate: (nextVal) => patch({ thermometerDistanceMeters: nextVal }),
        })}

      {activeTarget === 'RADIUS_RADAR' && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {radarRadii.map((r) => {
              const isSelected = selectedRadarMeters === r;
              return (
                <div
                  key={r}
                  className={`inline-flex items-center gap-1 rounded-full py-1 pr-1.5 pl-3 text-xs font-semibold ${
                    isSelected ? 'cmf-btn-active !rounded-full' : 'cmf-well !rounded-full'
                  }`}
                >
                  <button
                    type="button"
                    data-testid={`map-radar-select-${r}`}
                    onClick={() => onSelectRadarMeters(r)}
                    className="font-dot cursor-pointer"
                  >
                    {r} m
                  </button>
                  {radarRadii.length > 1 && (
                    <button
                      type="button"
                      data-testid={`map-radar-remove-${r}`}
                      aria-label={`${r} m entfernen`}
                      onClick={() => {
                        const next = radarRadii.filter((item) => item !== r);
                        const nextSel =
                          selectedRadarMeters === r
                            ? (next[0] ?? 250)
                            : selectedRadarMeters;
                        onSelectRadarMeters(nextSel);
                        patch({
                          radiusRadarOptionsMeters: next,
                          radiusRadarDistanceMeters: nextSel,
                        });
                      }}
                      className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--cmf-orange)] hover:bg-black/10"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!canAddRadar || validNewRadar === null) return;
              const next = normalizeRadiusRadarOptions([
                ...radarRadii,
                validNewRadar,
              ]);
              onSelectRadarMeters(validNewRadar);
              patch({
                radiusRadarOptionsMeters: next,
                radiusRadarDistanceMeters: validNewRadar,
              });
            }}
            className="flex items-center gap-1.5"
          >
            <button
              type="button"
              onClick={() =>
                setNewRadarInput(
                  String(Math.max(10, (validNewRadar ?? 250) - 25))
                )
              }
              aria-label="25 Meter weniger"
              className="cmf-btn-secondary flex h-9 w-9 shrink-0 items-center justify-center"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <div className="relative flex-1">
              <input
                type="number"
                data-testid="map-radar-add-input"
                min={10}
                max={5000}
                step={5}
                value={newRadarInput}
                onChange={(e) => setNewRadarInput(e.target.value)}
                placeholder="Neue Distanz"
                className="cmf-input min-h-[36px] w-full pr-7 pl-3 text-center font-dot text-xs font-bold"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-[var(--text-muted)]">
                m
              </span>
            </div>
            <button
              type="button"
              onClick={() =>
                setNewRadarInput(
                  String(Math.min(5000, (validNewRadar ?? 250) + 25))
                )
              }
              aria-label="25 Meter mehr"
              className="cmf-btn-secondary flex h-9 w-9 shrink-0 items-center justify-center"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="submit"
              data-testid="map-radar-add-btn"
              disabled={!canAddRadar}
              className="cmf-btn-primary min-h-[36px] shrink-0 px-3.5 py-1 text-xs font-semibold"
            >
              + Distanz
            </button>
          </form>
        </div>
      )}
    </PhysicsBottomSheet>
  );
};
