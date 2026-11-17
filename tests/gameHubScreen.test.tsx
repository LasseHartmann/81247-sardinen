import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GameHubScreen } from '../src/components/Lobby/GameHubScreen';
import { HostQuestionRulesEditor } from '../src/components/Lobby/HostQuestionRulesEditor';
import { HiderMediaResponseModal } from '../src/components/Questions/HiderMediaResponseModal';
import {
  DEFAULT_QUESTION_RULES_CONFIG,
  getQuestionPenaltyMs,
} from '../src/config/gameConfig';
import { createDemoStore } from '../src/demo/demoStore';
import { classifyDonutBand } from '../src/geo/clueGeometry';
import type { QuestionRulesConfig } from '../src/types/game';

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

  it('bietet bei Foto-Fragen im HiderMediaResponseModal eine Kamera-Blitz-Steuerung an', () => {
    const store = createDemoStore();
    render(
      <HiderMediaResponseModal
        adapter={store.adapter}
        openRequests={[
          {
            id: 'req-photo-1',
            teamId: 'team-alpha',
            requestedByUid: 'seeker1',
            sessionId: 'sess-1',
            questionType: 'MEDIA_SKY',
            category: 4,
            params: {},
            status: 'AWAITING_HIDER_MEDIA',
            penaltyMs: 180_000,
            penaltyApplied: true,
            refundedMs: 0,
            createdAt: Date.now(),
            requesterSnapshotLocation: {
              lat: 48.1632,
              lng: 11.4569,
              accuracy: 8,
            },
          },
        ]}
        teamsPublic={{}}
        teamLocations={{}}
        anchorPoint={{
          lat: 48.1632,
          lng: 11.4569,
          accuracy: 8,
          lockedAt: Date.now(),
          lockedByUid: 'hider1',
        }}
        publicState={{
          phase: 'OPEN_SEARCH',
          classicSearchDurationMs: 60 * 60_000,
        } as never}
        netElapsedMs={15 * 60_000}
        sardineGroupMemberNames={['Anna']}
      />
    );

    const flashToggle = screen.getByTestId('hider-camera-flash-toggle');
    expect(flashToggle.textContent).toContain('Blitz: AUS');

    fireEvent.click(flashToggle);
    expect(flashToggle.textContent).toContain('Blitz: AN');
    expect(screen.getByTestId('open-hider-camera-btn')).toBeTruthy();
  });

  it('erlaubt dem Host das Bearbeiten der Preise und Distanzen jeder Frage-Kategorie', () => {
    let currentCfg: QuestionRulesConfig = { ...DEFAULT_QUESTION_RULES_CONFIG };
    const { rerender } = render(
      <HostQuestionRulesEditor
        questionConfig={currentCfg}
        onChange={(next) => {
          currentCfg = next;
        }}
      />
    );

    expect(screen.getByTestId('question-rule-direction-price').textContent).toBe(
      '+15 Min.'
    );
    expect(screen.getByTestId('question-rule-thermo-distance').textContent).toBe(
      '250 m'
    );
    expect(screen.getByTestId('question-rule-donut-distance').textContent).toBe(
      '200 m'
    );
    expect(screen.getByTestId('question-rule-env-distance').textContent).toBe(
      '150 m'
    );

    // Ändere Preise & Distanzen aller Kategorien
    fireEvent.click(screen.getByTestId('question-rule-direction-price-minus'));
    rerender(
      <HostQuestionRulesEditor
        questionConfig={currentCfg}
        onChange={(next) => {
          currentCfg = next;
        }}
      />
    );
    expect(currentCfg.directionPriceMinutes).toBe(14);
    expect(getQuestionPenaltyMs('SPLIT_NS', 60 * 60_000, currentCfg)).toBe(
      14 * 60_000
    );

    fireEvent.click(screen.getByTestId('question-rule-thermo-distance-plus'));
    expect(currentCfg.thermometerDistanceMeters).toBe(275);

    fireEvent.click(screen.getByTestId('question-rule-donut-distance-minus'));
    expect(currentCfg.donutRingStepMeters).toBe(175);
    expect(classifyDonutBand(300, currentCfg.donutRingStepMeters).label).toBe(
      '175–350 m'
    );

    fireEvent.click(screen.getByTestId('question-rule-env-distance-plus'));
    expect(currentCfg.environmentDistanceMeters).toBe(175);

    fireEvent.click(screen.getByTestId('question-rule-photo-price-plus'));
    expect(currentCfg.photoPriceMinutes).toBe(6);
    expect(getQuestionPenaltyMs('MEDIA_SKY', 45 * 60_000, currentCfg)).toBe(
      6 * 60_000
    );
  });
});
