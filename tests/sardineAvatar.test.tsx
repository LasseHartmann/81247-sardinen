import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PlayerAvatar } from '../src/components/Common/PlayerAvatar';
import {
  createTeamBeaconIcon,
  renderTeamTinPopupHtml,
} from '../src/components/Map/CustomMarkers';
import {
  canPlayerUseExclusiveTier,
  parseSardineAvatar,
  serializeSardineAvatar,
  type SardineAvatarConfig,
} from '../src/config/sardineAvatar';

describe('Sardinen-Avatar, Exklusiv-Stufen & Karten-Sardinenbüchse', () => {
  afterEach(() => {
    cleanup();
  });

  it('erzwingt Owner-, Developer- und Runde-1-Exklusivität exakt für die vorgesehenen Konten', () => {
    // 1. Owner-Exklusiv: nur Lasse
    expect(canPlayerUseExclusiveTier('OWNER', 'Lasse')).toBe(true);
    expect(canPlayerUseExclusiveTier('OWNER', 'Linus')).toBe(false);
    expect(canPlayerUseExclusiveTier('OWNER', 'Thomas')).toBe(false);
    expect(canPlayerUseExclusiveTier('OWNER', 'Anna')).toBe(false);

    // 2. Developer-Exklusiv: Lasse & Linus
    expect(canPlayerUseExclusiveTier('DEVELOPER', 'Lasse')).toBe(true);
    expect(canPlayerUseExclusiveTier('DEVELOPER', 'Linus')).toBe(true);
    expect(canPlayerUseExclusiveTier('DEVELOPER', 'Thomas')).toBe(false);
    expect(canPlayerUseExclusiveTier('DEVELOPER', 'Anna')).toBe(false);

    // 3. Runde-1-Exklusiv: alle 12 OG-Spieler
    const firstRoundPlayers = [
      'Lasse',
      'Linus',
      'Thomas',
      'Nick',
      'Robert',
      'Eric',
      'Jonah',
      'Lorenzo',
      'Louis',
      'Max',
      'Roman',
      'Theo',
    ];
    for (const name of firstRoundPlayers) {
      expect(canPlayerUseExclusiveTier('FIRST_ROUND', name)).toBe(true);
    }
    expect(canPlayerUseExclusiveTier('FIRST_ROUND', 'Anna')).toBe(false);
    expect(canPlayerUseExclusiveTier('FIRST_ROUND', 'Sophie')).toBe(false);

    // 4. Sanitization für Owner-Items (Gold, Krone, Monokel, Schnurrbart)
    const ownerLoadout: SardineAvatarConfig = {
      color: 'gold',
      hat: 'crown',
      glasses: 'monocle',
      extra: 'mustache',
    };
    const ownerSerialized = serializeSardineAvatar(ownerLoadout);
    expect(parseSardineAvatar(ownerSerialized, 'lasse')).toEqual(ownerLoadout);
    expect(parseSardineAvatar(ownerSerialized, 'linus')).toEqual({
      color: 'silver',
      hat: 'none',
      glasses: 'none',
      extra: 'none',
    });

    // 5. Sanitization für Developer-Items (Mitternacht, Ninja-Band, Sonnenbrille, Goldkette)
    const devLoadout: SardineAvatarConfig = {
      color: 'midnight',
      hat: 'ninja',
      glasses: 'shades',
      extra: 'chain',
    };
    const devSerialized = serializeSardineAvatar(devLoadout);
    expect(parseSardineAvatar(devSerialized, 'lasse')).toEqual(devLoadout);
    expect(parseSardineAvatar(devSerialized, 'linus')).toEqual(devLoadout);
    expect(parseSardineAvatar(devSerialized, 'thomas')).toEqual({
      color: 'silver',
      hat: 'none',
      glasses: 'none',
      extra: 'none',
    });

    // 6. Sanitization für Runde-1-Items (CMF-Orange, Kapitän, Tactical Goggles, Superhelden-Cape)
    const firstRoundLoadout: SardineAvatarConfig = {
      color: 'orange',
      hat: 'captain',
      glasses: 'goggles',
      extra: 'cape',
    };
    const frSerialized = serializeSardineAvatar(firstRoundLoadout);
    expect(parseSardineAvatar(frSerialized, 'theo')).toEqual(firstRoundLoadout);
    expect(parseSardineAvatar(frSerialized, 'lorenzo')).toEqual(
      firstRoundLoadout
    );
    expect(parseSardineAvatar(frSerialized, 'anna')).toEqual({
      color: 'silver',
      hat: 'none',
      glasses: 'none',
      extra: 'none',
    });
  });

  it('rendert PlayerAvatar immer als SVG-Sardine (auch bei leerem oder altem Emoji-Avatar)', () => {
    render(<PlayerAvatar avatar="🦈" playerId="anna" size="md" />);
    const el = screen.getByTestId('player-sardine-avatar');
    expect(el.querySelector('svg')).not.toBeNull();
  });

  it('baut die Karten-Sardinenbüchse (createTeamBeaconIcon) mit allen Online-Teammitgliedern im Inneren', () => {
    const members = [
      {
        playerId: 'lasse',
        name: 'Lasse',
        avatar: serializeSardineAvatar({
          color: 'gold',
          hat: 'crown',
          glasses: 'monocle',
          extra: 'mustache',
        }),
      },
      {
        playerId: 'linus',
        name: 'Linus',
        avatar: serializeSardineAvatar({
          color: 'midnight',
          hat: 'ninja',
          glasses: 'shades',
          extra: 'chain',
        }),
      },
      {
        playerId: 'thomas',
        name: 'Thomas',
        avatar: serializeSardineAvatar({
          color: 'orange',
          hat: 'captain',
          glasses: 'goggles',
          extra: 'cape',
        }),
      },
    ];

    const icon = createTeamBeaconIcon('Team 1 (Bernstein)', '#f59e0b', members);
    const html = String(icon.options.html ?? '');
    expect(html).toContain('TEAM 1');
    expect(html).toContain('• 3');
    expect(html).toContain('title="Lasse"');
    expect(html).toContain('title="Linus"');
    expect(html).toContain('title="Thomas"');
    // Aufreißlasche + 3 Sardinen = mindestens 4 eingebettete SVGs
    expect((html.match(/<svg /g) ?? []).length).toBeGreaterThanOrEqual(4);

    // Bei 5+ Online-Spielern werden 4 Sardinen + "+1" Überlauf-Badge angezeigt
    const iconFive = createTeamBeaconIcon('Team 2', '#a855f7', [
      ...members,
      { playerId: 'nick', name: 'Nick' },
      { playerId: 'max', name: 'Max' },
    ]);
    expect(String(iconFive.options.html ?? '')).toContain('+1');

    const popupHtml = renderTeamTinPopupHtml({
      teamName: 'Team 1',
      color: '#f59e0b',
      accuracyMeters: 8,
      onlineMembers: members,
      activeContributorCount: 3,
    });
    expect(popupHtml).toContain('3 in der Dose');
    expect(popupHtml).toContain('Lasse');
    expect(popupHtml).toContain('Linus');
    expect(popupHtml).toContain('Thomas');
  });
});
