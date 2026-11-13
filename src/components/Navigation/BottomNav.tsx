import React from 'react';
import { Compass, HelpCircle, QrCode, Shield, Trophy } from 'lucide-react';
import type { BottomNavTab } from '../../types/game';

export interface BottomNavProps {
  activeTab: BottomNavTab;
  onSelectTab: (tab: BottomNavTab) => void;
  showHostTab: boolean;
  pendingQuestionsBadgeCount?: number;
  joinRequestsBadgeCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  showHostTab,
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

  return (
    <nav
      aria-label="Hauptnavigation"
      className="z-30 border-t-[1.5px] border-[var(--shell-border)] bg-[var(--shell-bg)] pt-1.5 pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.45rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] shadow-[0_-12px_32px_rgba(20,25,30,0.08),inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-[18px]"
    >
      <div className="mx-auto flex max-w-xl items-center justify-around gap-1">
        {items.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-tab-${item.id}`}
              onClick={() => onSelectTab(item.id)}
              className={`relative flex min-h-[50px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1.5 py-1.5 font-tech text-[10px] font-bold tracking-wide uppercase transition ${
                isActive
                  ? 'bg-[#14171A] text-white shadow-sm'
                  : 'text-[var(--text-muted)] hover:bg-[var(--module-sub)] hover:text-[var(--text-main)]'
              }`}
            >
              {isActive && (
                <span className="absolute top-1.5 right-2 h-1.5 w-1.5 rounded-full bg-[var(--cmf-orange)]" />
              )}
              <div className="relative">
                {item.icon}
                {Boolean(item.badge && item.badge > 0) && (
                  <span className="absolute -top-1.5 -right-3 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--cmf-orange)] px-1 font-tech text-[9px] font-bold text-white shadow">
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
