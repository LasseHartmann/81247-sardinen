import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  FastForward,
  Navigation,
  RefreshCw,
  Users,
} from 'lucide-react';
import { getBrowserDemoStore } from '../../demo/demoStore';
import type { DemoRoleId } from '../../types/game';

export interface DemoToolbarProps {
  visible: boolean;
  onAfterAction?: () => void;
}

const ROLE_BUTTONS: Array<{ id: DemoRoleId; label: string; badgeColor: string }> = [
  { id: 'HOST', label: 'Spielleiter (Host)', badgeColor: 'border-emerald-400 text-emerald-300' },
  { id: 'HIDER', label: 'Verstecker (Sardinen)', badgeColor: 'border-cyan-400 text-cyan-300' },
  { id: 'TEAM_1', label: 'Sucher Team 1', badgeColor: 'border-amber-400 text-amber-300' },
  { id: 'TEAM_2', label: 'Sucher Team 2', badgeColor: 'border-purple-400 text-purple-300' },
  { id: 'TEAM_3', label: 'Sucher Team 3', badgeColor: 'border-blue-400 text-blue-300' },
  { id: 'TEAM_4', label: 'Sucher Team 4', badgeColor: 'border-pink-400 text-pink-300' },
];

export const DemoToolbar: React.FC<DemoToolbarProps> = ({
  visible,
  onAfterAction,
}) => {
  const [expanded, setExpanded] = useState(false);
  const store = getBrowserDemoStore();
  const [role, setRole] = useState<DemoRoleId>(() => store.getCurrentRole());
  const [gpsSim, setGpsSim] = useState<boolean>(() =>
    store.isGpsSimulationEnabled()
  );

  useEffect(() => {
    if (!visible || !gpsSim) return;
    const id = setInterval(() => {
      store.stepGpsSimulation();
    }, 3500);
    return () => clearInterval(id);
  }, [visible, gpsSim, store]);

  if (!visible) return null;

  const handleRoleSwitch = (nextRole: DemoRoleId) => {
    store.switchRole(nextRole);
    setRole(nextRole);
    onAfterAction?.();
  };

  return (
    <div className="border-b border-slate-800 bg-slate-950/95 px-3 py-1.5 text-xs text-slate-200 shadow-md">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-2">
        <div className="flex items-center gap-2 overflow-x-auto">
          <span className="inline-flex items-center gap-1 font-bold text-cyan-300">
            <Users className="h-3.5 w-3.5" /> Rolle:
          </span>
          <span className="rounded bg-slate-800 px-2 py-0.5 font-bold text-white">
            {ROLE_BUTTONS.find((r) => r.id === role)?.label ?? role}
          </span>
        </div>

        <button
          type="button"
          data-testid="toggle-demo-toolbar"
          onClick={() => setExpanded((e) => !e)}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-950/50 px-2.5 py-1 text-[11px] font-bold text-cyan-200 hover:bg-cyan-900/60"
        >
          Simulations-Steuerung
          {expanded ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="mx-auto mt-2.5 max-w-4xl space-y-2.5 border-t border-slate-800 pt-2.5">
          <div>
            <p className="mb-1 text-[11px] font-semibold text-slate-400">
              1-Klick-Rollenwechsel (synchronisiert über Browser-Tabs):
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_BUTTONS.map((btn) => (
                <button
                  key={btn.id}
                  type="button"
                  data-testid={`demo-role-${btn.id}`}
                  onClick={() => handleRoleSwitch(btn.id)}
                  className={`min-h-[38px] rounded-lg border px-2.5 py-1 text-xs font-bold transition ${
                    role === btn.id
                      ? `${btn.badgeColor} bg-slate-800 shadow`
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400">
              <FastForward className="h-3.5 w-3.5" /> Zeitsprung:
            </span>
            <button
              type="button"
              data-testid="demo-jump-1m"
              onClick={() => store.advanceSimulatedTime(60_000)}
              className="min-h-[38px] rounded-lg bg-slate-800 px-2.5 py-1 font-semibold text-slate-100 hover:bg-slate-700"
            >
              +1 Min.
            </button>
            <button
              type="button"
              data-testid="demo-jump-5m"
              onClick={() => store.advanceSimulatedTime(5 * 60_000)}
              className="min-h-[38px] rounded-lg bg-slate-800 px-2.5 py-1 font-semibold text-slate-100 hover:bg-slate-700"
            >
              +5 Min.
            </button>
            <button
              type="button"
              data-testid="demo-jump-10m"
              onClick={() => store.jumpToNetMinute(10)}
              className="min-h-[38px] rounded-lg bg-cyan-900/60 border border-cyan-500/40 px-2.5 py-1 font-semibold text-cyan-200 hover:bg-cyan-800/60"
            >
              Zu Phase 10:00 (Suche)
            </button>
            <button
              type="button"
              data-testid="demo-jump-25m"
              onClick={() => store.jumpToNetMinute(25)}
              className="min-h-[38px] rounded-lg bg-rose-900/60 border border-rose-500/40 px-2.5 py-1 font-semibold text-rose-200 hover:bg-rose-800/60"
            >
              Zu Phase 25:00 (800m-Radar)
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                const next = !gpsSim;
                store.setGpsSimulationEnabled(next);
                setGpsSim(next);
                if (next) store.stepGpsSimulation();
              }}
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-3 py-1 font-semibold ${
                gpsSim
                  ? 'border-emerald-400 bg-emerald-950/60 text-emerald-200'
                  : 'border-slate-700 bg-slate-900 text-slate-300'
              }`}
            >
              <Navigation className="h-3.5 w-3.5" />
              {gpsSim
                ? 'GPS-Bewegungssimulation in 81247: AKTIV'
                : 'GPS-Bewegungen in 81247 simulieren'}
            </button>

            <button
              type="button"
              onClick={() => {
                store.resetEntireDemoStore();
                onAfterAction?.();
              }}
              className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-400 hover:text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Demo komplett zurücksetzen
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
