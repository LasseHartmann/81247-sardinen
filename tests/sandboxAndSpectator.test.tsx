import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AdminAccountManager } from '../src/components/Lobby/AdminAccountManager';
import { executeControllerTick, lockHiderAnchorAndGenerateRadar } from '../src/hooks/useControllerEngine';
import { createDemoStore } from '../src/demo/demoStore';
import {
  hasAnyOnlineTabInRoom,
} from '../src/services/databaseAdapter';
import {
  clearAllSandboxCharacters,
  moveSandboxTargetToPoint,
  spawnDefaultSandboxPreset,
  triggerSandboxTeamCatch,
  triggerSandboxTeamClue,
  updateSandboxCharacter,
} from '../src/services/sandboxService';

describe('Admin-Zuschauer-Unsichtbarkeit & Test-Server-Sandbox', () => {
  afterEach(() => {
    cleanup();
  });

  it('hält admin und overview vollständig unsichtbar (weder in subscribeAllMembers noch in Konto-Listen oder Online-Zählungen)', async () => {
    const store = createDemoStore({ inMemoryOnly: true });
    await store.adapter.registerAccount({
      name: 'Anna',
      password: 'pw1234',
    });
    const hosted = await store.adapter.createHostedRoom({
      hostPlayerId: 'anna',
      hostName: 'Anna',
    });

    // Admin tritt Annas Raum bei
    await store.adapter.joinRoomByCode({
      roomCode: hosted.roomCode,
      playerId: 'admin',
      playerName: 'Admin',
    });

    // Auch ein legacy "overview"-Eintrag darf niemals in subscribeAllMembers auftauchen
    await store.adapter.registerSelfMemberIfMissing({
      uid: 'uid_overview_test',
      playerId: 'overview',
      name: 'Overview',
      isHost: false,
      enabled: true,
      side: 'UNASSIGNED',
      teamId: null,
    });

    let receivedMembers: Record<string, { playerId: string; name: string }> = {};
    const unsub = store.adapter.subscribeAllMembers((m) => {
      receivedMembers = m;
    });

    const visibleIds = Object.values(receivedMembers).map((m) => m.playerId);
    expect(visibleIds).toContain('anna');
    expect(visibleIds).not.toContain('admin');
    expect(visibleIds).not.toContain('overview');
    unsub();

    // Admin-Tab-Präsenz allein zählt NICHT als aktiver Online-Spieler im Raum
    const rawRoom = store.getSnapshot().rooms?.[hosted.roomCode]!;
    const fakePresenceWithOnlyAdmin = {
      demo_uid_admin: {
        tab1: { online: true, lastSeen: Date.now() },
      },
    };
    expect(
      hasAnyOnlineTabInRoom(rawRoom.members, fakePresenceWithOnlyAdmin)
    ).toBe(false);

    // Auch in der Konto-Verwaltung taucht das Admin-Konto niemals als Spielerkonto auf
    render(<AdminAccountManager adapter={store.adapter} />);
    expect(screen.getByTestId('admin-account-card-anna')).toBeTruthy();
    expect(screen.queryByTestId('admin-account-card-admin')).toBeNull();
  });

  it('spawnt, individualisiert und bewegt Sandbox-Charaktere & Teams inkl. echter Hinweis- und Catch-Auswertung', async () => {
    const t0 = 1_701_000_000_000;
    const store = createDemoStore({ inMemoryOnly: true, initialNowMs: t0 });
    const { adapter } = store;

    const sandboxRoom = await adapter.createHostedRoom({
      hostPlayerId: 'admin',
      hostName: 'Admin',
    });
    adapter.setRoomCode(sandboxRoom.roomCode);

    const getRoom = () => store.getSnapshot().rooms?.[sandboxRoom.roomCode]!;

    // 1. Standard-Testgruppe spawnen (1 Verstecker + 2 Sucher-Teams)
    const spawned = await spawnDefaultSandboxPreset({
      adapter,
      publicState: getRoom().state.public,
      teamsPublic: Object.fromEntries(
        Object.entries(getRoom().teams).map(([id, t]) => [id, t.public])
      ),
    });
    expect(spawned.length).toBe(4);

    const hiderBot = spawned.find((b) => b.side === 'HIDER')!;
    const seekerBot = spawned.find((b) => b.teamId === 'team-1')!;
    expect(hiderBot).toBeDefined();
    expect(seekerBot).toBeDefined();

    // 2. Test-Charakter anpassen (neuer Look & Name)
    await updateSandboxCharacter({
      adapter,
      member: seekerBot,
      publicState: getRoom().state.public,
      teamsPublic: Object.fromEntries(
        Object.entries(getRoom().teams).map(([id, t]) => [id, t.public])
      ),
      teamLocations: Object.fromEntries(
        Object.entries(getRoom().teams).map(([id, t]) => [id, t.location])
      ),
      patch: {
        name: 'Captain Sardine',
        avatarConfig: {
          color: 'gold',
          hat: 'crown',
          glasses: 'monocle',
          extra: 'cape',
        },
      },
    });
    expect(getRoom().members[seekerBot.uid]?.name).toBe('Captain Sardine');
    expect(getRoom().members[seekerBot.uid]?.avatar).toBe(
      'sardine:v1:gold:crown:monocle:cape'
    );

    // 3. Verstecker-Bot & Team-1-Sardinenbüchse per Kartenklick bewegen
    const newHiderSpot = { lat: 48.1655, lng: 11.4615 };
    await moveSandboxTargetToPoint({
      adapter,
      target: { kind: 'MEMBER', uid: hiderBot.uid },
      point: newHiderSpot,
      members: getRoom().members,
      presence: getRoom().presence,
      teamLocations: Object.fromEntries(
        Object.entries(getRoom().teams).map(([id, t]) => [id, t.location])
      ),
      hiderPrivate: getRoom().state.hiderPrivate,
    });
    expect(
      getRoom().state.hiderPrivate.hiderLocations?.[hiderBot.uid]?.lat
    ).toBeCloseTo(newHiderSpot.lat, 4);

    const newTeamSpot = { lat: 48.1612, lng: 11.4552 };
    await moveSandboxTargetToPoint({
      adapter,
      target: { kind: 'TEAM', teamId: 'team-1' },
      point: newTeamSpot,
      members: getRoom().members,
      presence: getRoom().presence,
      teamLocations: Object.fromEntries(
        Object.entries(getRoom().teams).map(([id, t]) => [id, t.location])
      ),
      hiderPrivate: getRoom().state.hiderPrivate,
    });
    expect(getRoom().teams['team-1']?.location?.lat).toBeCloseTo(
      newTeamSpot.lat,
      4
    );

    // 4. Runde starten, HQ fixieren, Hinweis & QR-Catch für Team 1 über Sandbox auslösen
    await adapter.savePublicStateByHost({
      ...getRoom().state.public,
      status: 'RUNNING',
      currentPhase: 'OPEN_SEARCH',
      gameStartTimestamp: t0,
      searchStartTimestamp: t0,
      activeTeamIds: ['team-1', 'team-2'],
    });

    await lockHiderAnchorAndGenerateRadar({
      adapter,
      uid: hiderBot.uid,
      targetLocation: newHiderSpot,
      accuracy: 6,
      serverNowMs: t0 + 1000,
      publicState: getRoom().state.public,
      currentHiderPrivate: getRoom().state.hiderPrivate,
      startSearchImmediately: false,
    });

    await triggerSandboxTeamClue({
      adapter,
      publicState: getRoom().state.public,
      teamId: 'team-1',
      questionType: 'SPLIT_NS',
      teamLocation: getRoom().teams['team-1'].location,
      members: getRoom().members,
    });

    await executeControllerTick({
      adapter,
      controllerUid: 'demo_uid_admin',
      serverNowMs: t0 + 5000,
      publicState: getRoom().state.public,
      hiderPrivate: getRoom().state.hiderPrivate,
      teamsPublic: Object.fromEntries(
        Object.entries(getRoom().teams).map(([id, t]) => [id, t.public])
      ),
      teamLocations: Object.fromEntries(
        Object.entries(getRoom().teams).map(([id, t]) => [id, t.location])
      ),
      requestsByTeam: getRoom().requests,
      catchRequests: getRoom().catchRequests,
    });

    expect(Object.keys(getRoom().clues['team-1'] ?? {}).length).toBe(1);

    await triggerSandboxTeamCatch({
      adapter,
      publicState: getRoom().state.public,
      hiderPrivate: getRoom().state.hiderPrivate,
      teamId: 'team-1',
      members: getRoom().members,
    });

    await executeControllerTick({
      adapter,
      controllerUid: 'demo_uid_admin',
      serverNowMs: t0 + 10_000,
      publicState: getRoom().state.public,
      hiderPrivate: getRoom().state.hiderPrivate,
      teamsPublic: Object.fromEntries(
        Object.entries(getRoom().teams).map(([id, t]) => [id, t.public])
      ),
      teamLocations: Object.fromEntries(
        Object.entries(getRoom().teams).map(([id, t]) => [id, t.location])
      ),
      requestsByTeam: getRoom().requests,
      catchRequests: getRoom().catchRequests,
    });

    expect(getRoom().teams['team-1'].public.status).toBe('JOINED_SARDINES');
    expect(getRoom().leaderboard['team-1']).toBeDefined();

    // 5. Alle Bots bereinigen
    await clearAllSandboxCharacters({
      adapter,
      members: getRoom().members,
    });
    const remainingBots = Object.values(getRoom().members).filter((m) =>
      m.playerId.startsWith('sim_')
    );
    expect(remainingBots.length).toBe(0);
  });
});
