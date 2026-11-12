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
      label: 'Spielleiter',
      icon: <Shield className="h-5 w-5" />,
      badge: joinRequestsBadgeCount,
    });
  }

  return (
    <nav
      aria-label="Hauptnavigation"
      className="z-30 border-t border-slate-800 bg-slate-950/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-xl items-stretch justify-around">
        {items.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-tab-${item.id}`}
              onClick={() => onSelectTab(item.id)}
              className={`relative flex min-h-[54px] flex-1 flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[11px] font-bold transition ${
                isActive
                  ? 'text-cyan-400'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {isActive && (
                <span className="absolute top-0 left-1/4 right-1/4 h-0.5 rounded-full bg-cyan-400" />
              )}
              <div className="relative">
                {item.icon}
                {Boolean(item.badge && item.badge > 0) && (
                  <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-black text-white">
                    {item.badge}
                  </span>
                )}
              </div>
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
