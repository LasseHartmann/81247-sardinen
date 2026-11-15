import React from 'react';
import { AVATAR_LOGO_ID } from '../../services/playerPreferencesService';

export interface PlayerAvatarProps {
  avatar?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  avatar,
  size = 'sm',
  className = '',
}) => {
  if (!avatar) return null;

  const sizeMap = {
    xs: 'h-3.5 w-3.5 text-[11px]',
    sm: 'h-4 w-4 text-xs',
    md: 'h-6 w-6 text-base',
    lg: 'h-10 w-10 text-2xl',
  };

  if (avatar === AVATAR_LOGO_ID) {
    return (
      <img
        src="/logo.png"
        alt="81247 Sardinen Logo"
        className={`inline-block shrink-0 rounded bg-black object-contain ${sizeMap[size]} ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center leading-none ${sizeMap[size]} ${className}`}
    >
      {avatar}
    </span>
  );
};
