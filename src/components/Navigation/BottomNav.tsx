import React from 'react';
import { Compass, HelpCircle, QrCode, Shield, Trophy } from 'lucide-react';
import type { BottomNavTab } from '../../types/game';

export interface BottomNavProps {
  activeTab: BottomNavTab;
  onSelectTab: (tab: BottomNavTab) => void;
  showHostTab: boolean;
  hasActiveEmergency?: boolean;
  pendingQuestionsBadgeCount?: number;
  joinRequestsBadgeCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  showHostTab,
  hasActiveEmergency = false,
  pendingQuestionsBadgeCount = 0,
  joinRequestsBadgeCount = 0,
}) => {
  const items: Array<{
    id: BottomNavTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    {
      id: 'MAP',
      label: 'Karte',
      icon: <Compass className="h-5 w-5" />,
    },
    {
      id: 'QUESTIONS',
      label: 'Hinweise',
      icon: <HelpCircle className="h-5 w-5" />,
      badge: pendingQuestionsBadgeCount,
    },
    {
      id: 'QR',
      label: 'QR / Catch',
      icon: <QrCode className="h-5 w-5" />,
    },
    {
      id: 'LEADERBOARD',
      label: 'Rangliste',
      icon: <Trophy className="h-5 w-5" />,
    },
  ];

  if (showHostTab) {
    items.push({
      id: 'HOST',
      label: 'Admin',
      icon: <Shield className="h-5 w-5" />,
      badge: joinRequestsBadgeCount,
    });
  }

  const activeIndex = Math.max(
    0,
    items.findIndex((i) => i.id === activeTab)
  );

  return (
    <nav
      aria-label="Hauptnavigation"
      data-emergency-active={hasActiveEmergency ? 'true' : 'false'}
      className={`z-30 border-t-[1.5px] pt-1.5 pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.45rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] backdrop-blur-[18px] transition-colors duration-300 ${
        hasActiveEmergency
          ? 'border-[#FCA5A5] bg-[#B91C1C] text-white shadow-[0_-12px_32px_rgba(220,38,38,0.45)]'
          : 'border-[var(--shell-border)] bg-[var(--shell-bg)] shadow-[0_-12px_32px_rgba(20,25,30,0.08),inset_0_1px_0_rgba(255,255,255,0.75)]'
      }`}
    >
      <div
        className="relative mx-auto grid max-w-xl items-center"
        style={{
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        }}
      >
        {/* Gleitender Hardware-Auswahlschlitten (Spring-Animation beim Tabwechsel) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 left-0 px-0.5 transition-transform duration-250 ease-[var(--ease-spring)]"
          style={{
            width: `${100 / items.length}%`,
            transform: `translate3d(${activeIndex * 100}%, 0, 0)`,
          }}
        >
          <div
            className={`h-full w-full rounded-xl shadow-sm transition-colors duration-250 ${
              hasActiveEmergency
                ? 'bg-[#450A0A] ring-1 ring-[#FCA5A5]'
                : 'bg-[#14171A]'
            }`}
          />
        </div>

        {items.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-tab-${item.id}`}
              onClick={() => onSelectTab(item.id)}
              className={`relative z-10 flex min-h-[50px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1.5 font-tech text-[10px] font-bold tracking-wide uppercase transition-all duration-200 active:scale-95 ${
                isActive
                  ? 'text-white'
                  : hasActiveEmergency
                    ? 'text-[#FEE2E2] hover:text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              {isActive && (
                <span className="cmf-pop-in absolute top-1.5 right-2.5 h-1.5 w-1.5 rounded-full bg-[var(--cmf-orange)]" />
              )}
              <div
                className={`relative transition-transform duration-200 ease-[var(--ease-detent)] ${
                  isActive ? '-translate-y-0.5 scale-105' : ''
                }`}
              >
                {item.icon}
                {Boolean(item.badge && item.badge > 0) && (
                  <span
                    key={item.badge}
                    className="cmf-pop-in absolute -top-1.5 -right-3 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--cmf-orange)] px-1 font-tech text-[9px] font-bold text-white shadow"
                  >
                    {item.badge}
                  </span>
                )}
              </div>
              <span className="max-w-full truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
