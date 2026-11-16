import React, { useMemo } from 'react';
import {
  parseSardineAvatar,
  renderSardineSvgMarkup,
  sanitizeSardineAvatarForPlayer,
  type PlayerIdentityInput,
  type SardineAvatarConfig,
} from '../../config/sardineAvatar';

export interface PlayerAvatarProps {
  avatar?: string | null;
  config?: SardineAvatarConfig | null;
  playerId?: PlayerIdentityInput;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  avatar,
  config = null,
  playerId,
  size = 'sm',
  className = '',
}) => {
  const resolvedConfig = useMemo(
    () =>
      config
        ? sanitizeSardineAvatarForPlayer(config, playerId)
        : parseSardineAvatar(avatar, playerId),
    [avatar, config, playerId]
  );

  const { viewBox, innerHtml } = useMemo(
    () => renderSardineSvgMarkup(resolvedConfig),
    [resolvedConfig]
  );

  const sizeMap: Record<NonNullable<PlayerAvatarProps['size']>, string> = {
    xs: 'h-5 w-5',
    sm: 'h-6 w-6',
    md: 'h-9 w-9',
    lg: 'h-12 w-12',
    xl: 'h-24 w-24',
  };

  return (
    <span
      aria-hidden="true"
      data-testid="player-sardine-avatar"
      className={`inline-flex shrink-0 items-center justify-center leading-none ${sizeMap[size]} ${className}`}
    >
      <svg
        viewBox={viewBox}
        className="h-full w-full overflow-visible"
        dangerouslySetInnerHTML={{ __html: innerHtml }}
      />
    </span>
  );
};
