import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { GameHubScreen } from '../src/components/Lobby/GameHubScreen';
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
});
