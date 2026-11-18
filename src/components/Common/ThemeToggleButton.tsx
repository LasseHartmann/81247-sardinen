import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

export interface ThemeToggleButtonProps {
  compact?: boolean;
  className?: string;
}

export const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({
  compact = false,
  className = '',
}) => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      data-testid="theme-toggle-btn"
      onClick={toggleTheme}
      aria-label={isDark ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren'}
      title={isDark ? 'Zu Light Mode wechseln' : 'Zu Dark Mode wechseln'}
      className={`cmf-btn-secondary inline-flex shrink-0 items-center justify-center gap-1.5 ${
        compact ? 'h-9 w-9 p-0' : 'h-9 px-3 text-xs font-medium'
      } ${className}`}
    >
      {isDark ? (
        <Sun className="h-4 w-4 shrink-0" />
      ) : (
        <Moon className="h-4 w-4 shrink-0" />
      )}
      {!compact && <span>{isDark ? 'Hell' : 'Dunkel'}</span>}
    </button>
  );
};
