import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlayerAvatar } from '../src/components/Common/PlayerAvatar';
import { AdminAccountManager } from '../src/components/Lobby/AdminAccountManager';
import {
  createTeamMemberFishIcon,
  renderTeamMemberFishPopupHtml,
} from '../src/components/Map/CustomMarkers';
import {
  canPlayerUseExclusiveTier,
  isMatrixAdminIdentity,
  parseSardineAvatar,
  serializeSardineAvatar,
  type SardineAvatarConfig,
} from '../src/config/sardineAvatar';
import { createDemoStore } from '../src/demo/demoStore';
import { resolveVisibleTeamMemberMarkers } from '../src/services/databaseAdapter';

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

  it('zeigt statt eines Team-Logos jedes Teammitglied als eigenen Fisch mit Team an (20-Min.-Fenster + Letzte-Position-Garantie)', () => {
    const lasseAvatar = serializeSardineAvatar({
      color: 'gold',
      hat: 'crown',
      glasses: 'monocle',
      extra: 'mustache',
    });

    const icon = createTeamMemberFishIcon({
      playerId: 'lasse',
      playerName: 'Lasse',
      avatar: lasseAvatar,
      teamName: 'Team 1 (Bernstein)',
      teamColor: '#f59e0b',
      isOnlineNow: true,
      offsetPxX: 0,
      offsetPxY: 0,
    });
    const html = String(icon.options.html ?? '');
    expect(html).toContain('Lasse');
    expect(html).toContain('TEAM 1');
    expect(html).not.toContain('in der Dose');
    expect(html).toContain('<svg ');

    const t0 = 1_700_000_000_000;
    const popupHtml = renderTeamMemberFishPopupHtml({
      playerId: 'lasse',
      playerName: 'Lasse',
      avatar: lasseAvatar,
      teamName: 'Team 1 (Bernstein)',
      teamColor: '#f59e0b',
      accuracyMeters: 8,
      isOnlineNow: false,
      lastOnlineAt: t0 - 5 * 60_000,
      nowMs: t0,
    });
    expect(popupHtml).toContain('Lasse');
    expect(popupHtml).toContain('Team 1 (Bernstein)');
    expect(popupHtml).toContain('vor 5 Min.');

    // 3 Teammitglieder: Lasse (Fix bei t0), Linus (Fix bei t0 + 10m), Thomas (Fix bei t0 + 15m)
    const members = {
      u_lasse: {
        uid: 'u_lasse',
        playerId: 'lasse',
        name: 'Lasse',
        avatar: lasseAvatar,
        isHost: false,
        enabled: true,
        side: 'SEEKER' as const,
        teamId: 'team-1',
      },
      u_linus: {
        uid: 'u_linus',
        playerId: 'linus',
        name: 'Linus',
        isHost: false,
        enabled: true,
        side: 'SEEKER' as const,
        teamId: 'team-1',
      },
      u_thomas: {
        uid: 'u_thomas',
        playerId: 'thomas',
        name: 'Thomas',
        isHost: false,
        enabled: true,
        side: 'SEEKER' as const,
        teamId: 'team-1',
      },
    };
    const teamsPublic = {
      'team-1': {
        id: 'team-1',
        name: 'Team 1 (Bernstein)',
        color: '#f59e0b',
        memberPlayerIds: ['lasse', 'linus', 'thomas'],
        beaconPlayerId: 'lasse',
        status: 'ACTIVE' as const,
        penaltyMs: 0,
        catchTimestampMs: null,
        clueCount: 0,
      },
    };
    const baseTeamLoc = {
      lat: 48.165,
      lng: 11.465,
      accuracy: 8,
      timestamp: t0 + 15 * 60_000,
      updatedByUid: 'u_thomas',
      memberFixes: {
        lasse: { lat: 48.16, lng: 11.46, accuracy: 8, timestamp: t0 },
        linus: {
          lat: 48.165,
          lng: 11.465,
          accuracy: 8,
          timestamp: t0 + 10 * 60_000,
        },
        thomas: {
          lat: 48.17,
          lng: 11.47,
          accuracy: 8,
          timestamp: t0 + 15 * 60_000,
        },
      },
    };
    const offlinePresence = {
      u_lasse: { tab1: { online: false, lastSeen: t0 } },
      u_linus: { tab1: { online: false, lastSeen: t0 + 10 * 60_000 } },
      u_thomas: { tab1: { online: false, lastSeen: t0 + 15 * 60_000 } },
    };

    // 1. Bei t0 + 18 Min.: alle 3 waren in den letzten 20 Min. online -> alle 3 sichtbar
    const at18m = resolveVisibleTeamMemberMarkers({
      visibleTeamLocations: { 'team-1': baseTeamLoc },
      teamsPublic,
      members,
      presence: offlinePresence,
      nowMs: t0 + 18 * 60_000,
    });
    expect(at18m.map((m) => m.playerId)).toEqual(['lasse', 'linus', 'thomas']);

    // 2. Bei t0 + 25 Min.: Lasse (>20 Min. offline) fällt weg, Linus & Thomas bleiben sichtbar
    const at25m = resolveVisibleTeamMemberMarkers({
      visibleTeamLocations: { 'team-1': baseTeamLoc },
      teamsPublic,
      members,
      presence: offlinePresence,
      nowMs: t0 + 25 * 60_000,
    });
    expect(at25m.map((m) => m.playerId)).toEqual(['linus', 'thomas']);

    // 3. Bei t0 + 32 Min.: auch Linus (>20 Min.) fällt weg -> nur noch 1 Position übrig (Thomas)
    const at32m = resolveVisibleTeamMemberMarkers({
      visibleTeamLocations: { 'team-1': baseTeamLoc },
      teamsPublic,
      members,
      presence: offlinePresence,
      nowMs: t0 + 32 * 60_000,
    });
    expect(at32m.map((m) => m.playerId)).toEqual(['thomas']);

    // 4. Bei t0 + 50 Min. (alle >20 Min. offline): die letzte verbleibende Position (Thomas) bleibt sichtbar!
    const at50m = resolveVisibleTeamMemberMarkers({
      visibleTeamLocations: { 'team-1': baseTeamLoc },
      teamsPublic,
      members,
      presence: offlinePresence,
      nowMs: t0 + 50 * 60_000,
    });
    expect(at50m.map((m) => m.playerId)).toEqual(['thomas']);
    expect(at50m[0].lat).toBe(48.17);

    // 5. Sobald eine neue Position aus dem Team eintrifft (Lasse bei t0 + 52 Min.), wird diese neue gezeigt
    const updatedLoc = {
      ...baseTeamLoc,
      timestamp: t0 + 52 * 60_000,
      updatedByUid: 'u_lasse',
      memberFixes: {
        ...baseTeamLoc.memberFixes,
        lasse: {
          lat: 48.175,
          lng: 11.475,
          accuracy: 6,
          timestamp: t0 + 52 * 60_000,
        },
      },
    };
    const at52m = resolveVisibleTeamMemberMarkers({
      visibleTeamLocations: { 'team-1': updatedLoc },
      teamsPublic,
      members,
      presence: offlinePresence,
      nowMs: t0 + 52 * 60_000,
    });
    expect(at52m.map((m) => m.playerId)).toEqual(['lasse']);
    expect(at52m[0].lat).toBe(48.175);
  });

  it('erzwingt für das Admin-Konto das Matrix-Cyber-Icon und ermöglicht dem Admin das Verwalten von Konten (Passwort-Reset, Sperren & Löschen)', async () => {
    // 1. Matrix-Icon ist für admin erzwungen (unabhängig vom gespeicherten Avatar-String)
    expect(isMatrixAdminIdentity('admin')).toBe(true);
    expect(isMatrixAdminIdentity({ playerId: 'admin', name: 'Admin' })).toBe(
      true
    );
    expect(isMatrixAdminIdentity('lasse')).toBe(false);

    const { unmount } = render(
      <PlayerAvatar
        avatar={serializeSardineAvatar({
          color: 'coral',
          hat: 'party',
          glasses: 'diving',
          extra: 'bowtie',
        })}
        playerId="admin"
        size="lg"
      />
    );
    const adminSvgHtml =
      screen.getByTestId('player-sardine-avatar').innerHTML;
    expect(adminSvgHtml).toContain('#00FF41');
    expect(adminSvgHtml).toContain('#020804');
    unmount();

    // 2. Konto-Verwaltung durch Admin (Passwort zurücksetzen, Sperren/Freigeben, Löschen)
    const store = createDemoStore();
    await store.adapter.registerAccount({
      name: 'Marco',
      password: 'oldPassword123',
    });

    // Passwort-Reset durch Admin
    await store.adapter.resetAccountPasswordByAdmin('marco', 'newSecret99');
    await expect(
      store.adapter.loginWithAccount({
        name: 'Marco',
        password: 'oldPassword123',
      })
    ).rejects.toThrow(/Passwort/i);

    const relogin = await store.adapter.loginWithAccount({
      name: 'Marco',
      password: 'newSecret99',
    });
    expect(relogin.member.playerId).toBe('marco');

    // Konto sperren -> Login & Raumbeitritt werden blockiert, Admin selbst kann nicht gesperrt werden
    await expect(
      store.adapter.setAccountBlockedByAdmin('admin', true)
    ).rejects.toThrow(/Admin-Konto/i);

    await store.adapter.setAccountBlockedByAdmin('marco', true);
    expect(store.getSnapshot().accounts?.['marco']?.blocked).toBe(true);

    await expect(
      store.adapter.loginWithAccount({
        name: 'Marco',
        password: 'newSecret99',
      })
    ).rejects.toThrow(/gesperrt/i);

    // Konto wieder freigeben -> Login funktioniert wieder
    await store.adapter.setAccountBlockedByAdmin('marco', false);
    expect(store.getSnapshot().accounts?.['marco']?.blocked).toBeUndefined();
    const afterUnblock = await store.adapter.loginWithAccount({
      name: 'Marco',
      password: 'newSecret99',
    });
    expect(afterUnblock.member.playerId).toBe('marco');

    // AdminAccountManager UI rendert Konten und erlaubt Löschen
    render(<AdminAccountManager adapter={store.adapter} />);
    expect(screen.getByTestId('admin-account-manager')).toBeTruthy();
    expect(screen.getByTestId('admin-account-card-marco')).toBeTruthy();

    fireEvent.click(screen.getByTestId('admin-acct-delete-btn-marco'));
    fireEvent.click(screen.getByTestId('admin-acct-confirm-delete-btn-marco'));

    expect(store.getSnapshot().accounts?.['marco']).toBeUndefined();
  });
});
