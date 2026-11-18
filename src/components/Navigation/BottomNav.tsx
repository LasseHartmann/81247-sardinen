import React from 'react';
import { Compass, HelpCircle, QrCode, Shield, Trophy, User, Users } from 'lucide-react';
import type { BottomNavTab } from '../../types/game';

export interface BottomNavProps {
  activeTab: BottomNavTab;
  onSelectTab: (tab: BottomNavTab) => void;
  showLobbyTab?: boolean;
  inLobbyMode?: boolean;
  showHostTab: boolean;
  hostTabLabel?: string;
  qrTabLabel?: string;
  hideQuestionsTab?: boolean;
  hasActiveEmergency?: boolean;
  pendingQuestionsBadgeCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onSelectTab,
  showLobbyTab = false,
  inLobbyMode = false,
  showHostTab,
  hostTabLabel = 'Admin',
  qrTabLabel = 'Gefunden!',
  hideQuestionsTab = false,
  hasActiveEmergency = false,
  pendingQuestionsBadgeCount = 0,
}) => {
  const items: Array<{
    id: BottomNavTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
  }> = [
    ...(showLobbyTab
      ? [
          {
            id: 'LOBBY' as BottomNavTab,
            label: 'Lobby',
            icon: <Users className="h-5 w-5" />,
          },
        ]
      : []),
    {
      id: 'MAP',
      label: 'Karte',
      icon: <Compass className="h-5 w-5" />,
    },
    ...(hideQuestionsTab || inLobbyMode
      ? []
      : [
          {
            id: 'QUESTIONS' as BottomNavTab,
            label: 'Tipps',
            icon: <HelpCircle className="h-5 w-5" />,
            badge: pendingQuestionsBadgeCount,
          },
        ]),
    ...(inLobbyMode
      ? []
      : [
          {
            id: 'QR' as BottomNavTab,
            label: qrTabLabel,
            icon: <QrCode className="h-5 w-5" />,
          },
        ]),
    {
      id: 'LEADERBOARD',
      label: 'Rangliste',
      icon: <Trophy className="h-5 w-5" />,
    },
    {
      id: 'PROFILE',
      label: 'Profil',
      icon: <User className="h-5 w-5" />,
    },
  ];

  if (showHostTab) {
    items.push({
      id: 'HOST',
      label: hostTabLabel,
      icon: <Shield className="h-5 w-5" />,
    });
  }

  return (
    <nav
      aria-label="Hauptnavigation"
      data-emergency-active={hasActiveEmergency ? 'true' : 'false'}
      className={`z-30 border-t pt-1 pr-[max(0.5rem,env(safe-area-inset-right))] pb-[max(0.45rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] transition-colors duration-200 ${
        hasActiveEmergency
          ? 'border-[#FCA5A5] bg-[#B91C1C] text-white'
          : 'border-[var(--shell-border)] bg-[var(--shell-bg)]'
      }`}
    >
      <div
        className="relative mx-auto grid max-w-xl items-center gap-0.5"
        style={{
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        }}
      >
        {items.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-tab-${item.id}`}
              onClick={() => onSelectTab(item.id)}
              className={`relative flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-lg px-1.5 py-1 text-[11px] font-medium transition-colors ${
                isActive
                  ? hasActiveEmergency
                    ? 'bg-white/20 font-semibold text-white'
                    : 'bg-[var(--module-sub)] font-semibold text-[var(--text-main)]'
                  : hasActiveEmergency
                    ? 'text-[#FEE2E2] hover:text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
              }`}
            >
              <div
                className={`relative ${
                  isActive && !hasActiveEmergency
                    ? 'text-[var(--cmf-orange)]'
                    : ''
                }`}
              >
                {item.icon}
                {Boolean(item.badge && item.badge > 0) && (
                  <span
                    key={item.badge}
                    className="absolute -top-1.5 -right-3 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--cmf-orange)] px-1 text-[9px] font-bold text-white"
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
