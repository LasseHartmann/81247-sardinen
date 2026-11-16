import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GameHubScreen } from '../src/components/Lobby/GameHubScreen';
import { ShrinkingBorderPreview } from '../src/components/Lobby/ShrinkingBorderPreview';
import {
  buildCustomCirclePlayAreaState,
  buildRadarScheduleForHidingMinutes,
} from '../src/config/gameConfig';
import { createDemoStore } from '../src/demo/demoStore';

describe('GameHubScreen: Lobby-Auswahl ohne Schnellauswahl', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('rendert Host- und Code-Beitritt ohne Schnellauswahl oder Hauptraum-Button', () => {
    const store = createDemoStore();
    render(
      <GameHubScreen
        adapter={store.adapter}
        account={{
          playerId: 'anna',
          name: 'Anna',
        }}
        firebaseAvailable={false}
        recentRooms={[
          {
            roomCode: 'AB12CD',
            hostName: 'Ben',
            joinedAt: Date.now(),
          },
        ]}
        busy={false}
        roomError={null}
        onClearError={() => {}}
        onHostNewGame={async () => {}}
        onJoinByCode={async () => {}}
        onLogout={async () => {}}
      />
    );

    expect(screen.getByTestId('hub-host-game-btn')).toBeTruthy();
    expect(screen.getByTestId('hub-join-code-input')).toBeTruthy();
    expect(screen.queryByText(/Schnellauswahl/i)).toBeNull();
    expect(screen.queryByText(/Hauptraum/i)).toBeNull();
    expect(screen.queryByTestId('hub-quickjoin-81247-btn')).toBeNull();
  });

  it('zeigt einem Spieler alle aktuell von ihm gehosteten Lobbys an und erlaubt deren Löschung', async () => {
    const store = createDemoStore();
    const roomA = await store.adapter.createHostedRoom({
      hostPlayerId: 'anna',
      hostName: 'Anna',
    });
    const roomB = await store.adapter.createHostedRoom({
      hostPlayerId: 'anna',
      hostName: 'Anna',
    });
    const otherRoom = await store.adapter.createHostedRoom({
      hostPlayerId: 'ben',
      hostName: 'Ben',
    });

    render(
      <GameHubScreen
        adapter={store.adapter}
        account={{
          playerId: 'anna',
          name: 'Anna',
        }}
        firebaseAvailable={false}
        recentRooms={[]}
        busy={false}
        roomError={null}
        onClearError={() => {}}
        onHostNewGame={async () => {}}
        onJoinByCode={async () => {}}
        onLogout={async () => {}}
      />
    );

    expect(screen.getByTestId('player-hosted-lobbies-section')).toBeTruthy();
    expect(
      screen.getByTestId(`hosted-lobby-card-${roomA.roomCode}`)
    ).toBeTruthy();
    expect(
      screen.getByTestId(`hosted-lobby-card-${roomB.roomCode}`)
    ).toBeTruthy();
    expect(
      screen.queryByTestId(`hosted-lobby-card-${otherRoom.roomCode}`)
    ).toBeNull();

    // Lösche roomA über den Löschen-Button
    fireEvent.click(
      screen.getByTestId(`hosted-lobby-delete-btn-${roomA.roomCode}`)
    );
    fireEvent.click(
      screen.getByTestId(`hosted-lobby-confirm-delete-btn-${roomA.roomCode}`)
    );

    expect(store.getSnapshot().rooms?.[roomA.roomCode]).toBeUndefined();
    expect(store.getSnapshot().rooms?.[roomB.roomCode]).toBeDefined();
  });

  it('rendert die interaktive Schrumpf-Grenzen-Vorschau (ShrinkingBorderPreview) mit allen 5 Stufen und Animation', () => {
    const circleArea = buildCustomCirclePlayAreaState({
      center: { lat: 48.1632, lng: 11.4569 },
      radiusMeters: 800,
      postalCodes: ['81247'],
      confirmedByUid: 'host',
      nowMs: 1000,
    });
    const schedule = buildRadarScheduleForHidingMinutes(15, 60);

    render(
      <ShrinkingBorderPreview
        playArea={circleArea}
        gameMode="CLASSIC"
        radarSchedule={schedule}
      />
    );

    expect(screen.getByTestId('shrinking-border-preview')).toBeTruthy();
    expect(screen.getByTestId('shrink-preview-radius-1').textContent).toBe(
      '800 m'
    );
    expect(screen.getByTestId('shrink-preview-radius-5').textContent).toBe(
      '25 m'
    );

    fireEvent.click(screen.getByTestId('shrink-preview-stage-3'));
    expect(screen.getByText(/Stufe 3: Radius/i)).toBeTruthy();

    fireEvent.click(screen.getByTestId('shrink-preview-play-btn'));
    expect(screen.getByText(/Stopp/i)).toBeTruthy();
  });
});
