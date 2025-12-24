import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMatchStore, type RemoteUpdateData } from '../../stores/matchStore';
import * as api from '../../services/api';
import type { Match, Participant, MatchEvent } from '../../types';

// Mock API
vi.mock('../../services/api', () => ({
  startMatch: vi.fn(),
  updateMatchScore: vi.fn(),
  updateMatchScoreUniversal: vi.fn(),
  getMatchEvents: vi.fn(),
  batchUpdateMatch: vi.fn(),
  undoLastEvent: vi.fn(),
  finishMatch: vi.fn(),
}));

// Mock sessionStore
vi.mock('../../stores/sessionStore', () => ({
  useSessionStore: {
    getState: () => ({
      currentSession: {
        scoring_config: {
          warnings: {
            max_count: 3,
          },
        },
      },
    }),
  },
}));

describe('matchStore', () => {
  const mockRedFighter: Participant = {
    id: 1,
    full_name: 'Иванов Иван Иванович',
    weight: '70',
    team: 'Спартак',
  };

  const mockBlueFighter: Participant = {
    id: 2,
    full_name: 'Петров Петр Петрович',
    weight: '70',
    team: 'Динамо',
  };

  const mockMatch: Match = {
    id: 100,
    bracket_id: 1,
    round: 1,
    match_number: 1,
    participant1: mockBlueFighter, // Blue
    participant2: mockRedFighter,  // Red
    score_participant1: 0,
    score_participant2: 0,
    warnings_participant1: 0,
    warnings_participant2: 0,
    status: 'pending',
    duration: 180,
    winner_id: null,
    scheduled_time: null,
    actual_start_time: null,
    actual_end_time: null,
  };

  beforeEach(() => {
    // Reset store state
    useMatchStore.getState().cleanup();

    // Clear all mocks
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have correct initial values', () => {
      const state = useMatchStore.getState();

      expect(state.match).toBeNull();
      expect(state.redFighter).toBeNull();
      expect(state.blueFighter).toBeNull();
      expect(state.redScore).toBe(0);
      expect(state.blueScore).toBe(0);
      expect(state.redWarnings).toBe(0);
      expect(state.blueWarnings).toBe(0);
      expect(state.initialTimerSeconds).toBe(300);
      expect(state.events).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.lastUpdateTimestamp).toBeNull();
    });
  });

  describe('initMatch', () => {
    it('should initialize match with correct data', async () => {
      const mockEvents: MatchEvent[] = [];

      vi.mocked(api.startMatch).mockResolvedValue(undefined);
      vi.mocked(api.getMatchEvents).mockResolvedValue(mockEvents);

      const { initMatch } = useMatchStore.getState();

      await initMatch(mockMatch, 180);

      const state = useMatchStore.getState();

      expect(state.match).toEqual(mockMatch);
      expect(state.redFighter).toEqual(mockRedFighter);
      expect(state.blueFighter).toEqual(mockBlueFighter);
      expect(state.redScore).toBe(0);
      expect(state.blueScore).toBe(0);
      expect(state.initialTimerSeconds).toBe(180);
      expect(state.events).toEqual(mockEvents);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should call API to start match and load events', async () => {
      vi.mocked(api.startMatch).mockResolvedValue(undefined);
      vi.mocked(api.getMatchEvents).mockResolvedValue([]);

      const { initMatch } = useMatchStore.getState();

      await initMatch(mockMatch, 180);

      expect(api.startMatch).toHaveBeenCalledWith(mockMatch.id);
      expect(api.getMatchEvents).toHaveBeenCalledWith(mockMatch.id);
    });

    it('should handle initialization error', async () => {
      const error = new Error('Failed to start match');
      vi.mocked(api.startMatch).mockRejectedValue(error);

      const { initMatch } = useMatchStore.getState();

      await expect(initMatch(mockMatch, 180)).rejects.toThrow();

      const state = useMatchStore.getState();

      expect(state.isLoading).toBe(false);
      expect(state.error).toBeTruthy();
    });
  });

  describe('resetAll', () => {
    it('should reset all scores and warnings', async () => {
      // Set some initial values
      useMatchStore.setState({
        match: mockMatch,
        redScore: 10,
        blueScore: 5,
        redWarnings: 2,
        blueWarnings: 1,
      });

      vi.mocked(api.updateMatchScore).mockResolvedValue(undefined);

      const { resetAll } = useMatchStore.getState();

      await resetAll();

      const state = useMatchStore.getState();

      expect(state.redScore).toBe(0);
      expect(state.blueScore).toBe(0);
      expect(state.redWarnings).toBe(0);
      expect(state.blueWarnings).toBe(0);
    });

    it('should update database with reset values', async () => {
      useMatchStore.setState({ match: mockMatch });

      vi.mocked(api.updateMatchScoreUniversal).mockResolvedValue(undefined);

      const { resetAll } = useMatchStore.getState();

      await resetAll();

      expect(api.updateMatchScoreUniversal).toHaveBeenCalledWith(
        {
          matchId: mockMatch.id,
          redScore: 0,
          blueScore: 0,
          redWarnings: 0,
          blueWarnings: 0,
          status: 'in_progress',
        },
        expect.objectContaining({
          mode: expect.any(String),
        })
      );
    });
  });

  describe('addScore', () => {
    it('should add score to red fighter', async () => {
      useMatchStore.setState({
        match: mockMatch,
        redFighter: mockRedFighter,
        blueFighter: mockBlueFighter,
        redScore: 0,
        blueScore: 0,
      });

      const mockEvents: MatchEvent[] = [];
      vi.mocked(api.batchUpdateMatch).mockResolvedValue(mockEvents);

      const { addScore } = useMatchStore.getState();

      await addScore('red', 2, 'Takedown');

      const state = useMatchStore.getState();

      expect(state.redScore).toBe(2);
      expect(state.blueScore).toBe(0);
    });

    it('should add score to blue fighter', async () => {
      useMatchStore.setState({
        match: mockMatch,
        redFighter: mockRedFighter,
        blueFighter: mockBlueFighter,
        redScore: 0,
        blueScore: 0,
      });

      const mockEvents: MatchEvent[] = [];
      vi.mocked(api.batchUpdateMatch).mockResolvedValue(mockEvents);

      const { addScore } = useMatchStore.getState();

      await addScore('blue', 4, 'Submission Attempt');

      const state = useMatchStore.getState();

      expect(state.redScore).toBe(0);
      expect(state.blueScore).toBe(4);
    });

    it('should update timestamp', async () => {
      useMatchStore.setState({
        match: mockMatch,
        redFighter: mockRedFighter,
        blueFighter: mockBlueFighter,
      });

      vi.mocked(api.batchUpdateMatch).mockResolvedValue([]);

      const { addScore } = useMatchStore.getState();

      await addScore('red', 1, 'Strike');

      const state = useMatchStore.getState();

      expect(state.lastUpdateTimestamp).toBeTruthy();
    });

    it('should call batchUpdateMatch API', async () => {
      useMatchStore.setState({
        match: mockMatch,
        redFighter: mockRedFighter,
        blueFighter: mockBlueFighter,
        redScore: 2,
        blueScore: 3,
      });

      vi.mocked(api.batchUpdateMatch).mockResolvedValue([]);

      const { addScore } = useMatchStore.getState();

      await addScore('red', 2, 'Takedown');

      expect(api.batchUpdateMatch).toHaveBeenCalledWith(
        expect.objectContaining({
          matchId: mockMatch.id,
          eventType: 'score',
          participant: 'red',
          points: 2,
          actionName: 'Takedown',
          redScore: 4, // 2 + 2
          blueScore: 3,
          status: 'in_progress',
        }),
        null // serverUrl
      );
    });
  });

  describe('addWarning', () => {
    it('should add warning to red fighter', async () => {
      useMatchStore.setState({
        match: mockMatch,
        redFighter: mockRedFighter,
        blueFighter: mockBlueFighter,
        redWarnings: 0,
        blueWarnings: 0,
      });

      vi.mocked(api.batchUpdateMatch).mockResolvedValue([]);

      const { addWarning } = useMatchStore.getState();

      await addWarning('red');

      const state = useMatchStore.getState();

      expect(state.redWarnings).toBe(1);
      expect(state.blueWarnings).toBe(0);
    });

    it('should add warning to blue fighter', async () => {
      useMatchStore.setState({
        match: mockMatch,
        redFighter: mockRedFighter,
        blueFighter: mockBlueFighter,
        redWarnings: 0,
        blueWarnings: 0,
      });

      vi.mocked(api.batchUpdateMatch).mockResolvedValue([]);

      const { addWarning } = useMatchStore.getState();

      await addWarning('blue');

      const state = useMatchStore.getState();

      expect(state.redWarnings).toBe(0);
      expect(state.blueWarnings).toBe(1);
    });

    it('should allow 4th warning (max=3) without auto-disqualifying', async () => {
      useMatchStore.setState({
        match: mockMatch,
        redFighter: mockRedFighter,
        blueFighter: mockBlueFighter,
        redWarnings: 3, // Already 3 warnings
        blueWarnings: 0,
      });

      vi.mocked(api.batchUpdateMatch).mockResolvedValue([]);

      const { addWarning } = useMatchStore.getState();

      await addWarning('red');

      const state = useMatchStore.getState();

      // Should increment warnings (MatchScreen handles disqualification dialog)
      expect(state.redWarnings).toBe(4);
      expect(state.blueWarnings).toBe(0);

      // Should NOT auto-finish match - MatchScreen handles disqualification
      expect(api.finishMatch).not.toHaveBeenCalled();
    });
  });

  describe('removeWarning', () => {
    it('should remove warning from fighter', async () => {
      useMatchStore.setState({
        match: mockMatch,
        redWarnings: 2,
        blueWarnings: 1,
      });

      vi.mocked(api.updateMatchScore).mockResolvedValue(undefined);

      const { removeWarning } = useMatchStore.getState();

      await removeWarning('red');

      const state = useMatchStore.getState();

      expect(state.redWarnings).toBe(1);
    });

    it('should not go below zero', async () => {
      useMatchStore.setState({
        match: mockMatch,
        redWarnings: 0,
        blueWarnings: 0,
      });

      vi.mocked(api.updateMatchScore).mockResolvedValue(undefined);

      const { removeWarning } = useMatchStore.getState();

      await removeWarning('red');

      const state = useMatchStore.getState();

      expect(state.redWarnings).toBe(0);
    });
  });

  describe('undoLastAction', () => {
    it('should undo last score action', async () => {
      const mockEvents: MatchEvent[] = [
        {
          id: 1,
          match_id: mockMatch.id,
          event_type: 'score',
          participant: 'red',
          points: 2,
          timestamp: '2025-01-01T12:00:00Z',
        },
        {
          id: 2,
          match_id: mockMatch.id,
          event_type: 'score',
          participant: 'blue',
          points: 4,
          timestamp: '2025-01-01T12:00:05Z',
        },
      ];

      useMatchStore.setState({
        match: mockMatch,
        redScore: 2,
        blueScore: 4,
        events: mockEvents,
      });

      vi.mocked(api.undoLastEvent).mockResolvedValue(undefined);
      vi.mocked(api.updateMatchScore).mockResolvedValue(undefined);

      const { undoLastAction } = useMatchStore.getState();

      await undoLastAction();

      const state = useMatchStore.getState();

      // Should remove last event (blue +4) and recalculate
      expect(state.redScore).toBe(2);
      expect(state.blueScore).toBe(0);
      expect(state.events).toHaveLength(1);
    });

    it('should undo last warning action', async () => {
      const mockEvents: MatchEvent[] = [
        {
          id: 1,
          match_id: mockMatch.id,
          event_type: 'warning',
          participant: 'red',
          timestamp: '2025-01-01T12:00:00Z',
        },
      ];

      useMatchStore.setState({
        match: mockMatch,
        redWarnings: 1,
        blueWarnings: 0,
        events: mockEvents,
      });

      vi.mocked(api.undoLastEvent).mockResolvedValue(undefined);
      vi.mocked(api.updateMatchScore).mockResolvedValue(undefined);

      const { undoLastAction } = useMatchStore.getState();

      await undoLastAction();

      const state = useMatchStore.getState();

      expect(state.redWarnings).toBe(0);
      expect(state.events).toHaveLength(0);
    });

    it('should do nothing if no events', async () => {
      useMatchStore.setState({
        match: mockMatch,
        events: [],
      });

      const { undoLastAction } = useMatchStore.getState();

      await undoLastAction();

      expect(api.undoLastEvent).not.toHaveBeenCalled();
    });
  });

  describe('finishMatch', () => {
    it('should finish match by points with red winner', async () => {
      useMatchStore.setState({
        match: mockMatch,
        redFighter: mockRedFighter,
        blueFighter: mockBlueFighter,
        redScore: 10,
        blueScore: 5,
      });

      vi.mocked(api.finishMatch).mockResolvedValue(undefined);

      const { finishMatch } = useMatchStore.getState();

      await finishMatch('points');

      expect(api.finishMatch).toHaveBeenCalledWith({
        matchId: mockMatch.id,
        winnerId: mockRedFighter.id,
        resultType: 'points',
        finalRedScore: 10,
        finalBlueScore: 5,
      });
    });

    it('should finish match by submission', async () => {
      useMatchStore.setState({
        match: mockMatch,
        redFighter: mockRedFighter,
        blueFighter: mockBlueFighter,
        redScore: 3,
        blueScore: 2,
      });

      vi.mocked(api.finishMatch).mockResolvedValue(undefined);

      const { finishMatch } = useMatchStore.getState();

      await finishMatch('submission', mockBlueFighter.id);

      expect(api.finishMatch).toHaveBeenCalledWith({
        matchId: mockMatch.id,
        winnerId: mockBlueFighter.id,
        resultType: 'submission',
        finalRedScore: 3,
        finalBlueScore: 2,
      });
    });

    it('should update match status to completed', async () => {
      useMatchStore.setState({
        match: mockMatch,
        redFighter: mockRedFighter,
        blueFighter: mockBlueFighter,
        redScore: 8,
        blueScore: 3,
      });

      vi.mocked(api.finishMatch).mockResolvedValue(undefined);

      const { finishMatch } = useMatchStore.getState();

      await finishMatch('points');

      const state = useMatchStore.getState();

      expect(state.match?.status).toBe('completed');
      expect(state.match?.winner_id).toBe(mockRedFighter.id);
    });
  });

  describe('applyRemoteUpdate', () => {
    beforeEach(() => {
      useMatchStore.setState({
        redFighter: mockRedFighter,
        blueFighter: mockBlueFighter,
        redScore: 0,
        blueScore: 0,
        lastUpdateTimestamp: null,
      });
    });

    it('should apply remote score update', () => {
      const remoteData: RemoteUpdateData = {
        participant_id: mockRedFighter.id,
        action_type: 'score',
        points: 2,
        red_score: 2,
        blue_score: 0,
      };

      const { applyRemoteUpdate } = useMatchStore.getState();

      const applied = applyRemoteUpdate(remoteData, '2025-01-01T12:00:00Z');

      expect(applied).toBe(true);

      const state = useMatchStore.getState();

      expect(state.redScore).toBe(2);
      expect(state.lastUpdateTimestamp).toBe('2025-01-01T12:00:00Z');
    });

    it('should apply remote warning update', () => {
      const remoteData: RemoteUpdateData = {
        participant_id: mockBlueFighter.id,
        action_type: 'warning',
        blue_warnings: 1,
      };

      const { applyRemoteUpdate } = useMatchStore.getState();

      const applied = applyRemoteUpdate(remoteData, '2025-01-01T12:00:00Z');

      expect(applied).toBe(true);

      const state = useMatchStore.getState();

      expect(state.blueWarnings).toBe(1);
    });

    it('should reject older timestamps', () => {
      useMatchStore.setState({
        lastUpdateTimestamp: '2025-01-01T12:00:10Z',
      });

      const remoteData: RemoteUpdateData = {
        participant_id: mockRedFighter.id,
        action_type: 'score',
        points: 2,
        red_score: 2,
        blue_score: 0,
      };

      const { applyRemoteUpdate } = useMatchStore.getState();

      const applied = applyRemoteUpdate(remoteData, '2025-01-01T12:00:05Z');

      expect(applied).toBe(false);

      // State should not change
      expect(useMatchStore.getState().redScore).toBe(0);
    });

    it('should apply full score update', () => {
      const remoteData: RemoteUpdateData = {
        participant_id: mockRedFighter.id,
        action_type: 'reset',
        red_score: 5,
        blue_score: 3,
        red_warnings: 1,
        blue_warnings: 0,
      };

      const { applyRemoteUpdate } = useMatchStore.getState();

      const applied = applyRemoteUpdate(remoteData, '2025-01-01T12:00:00Z');

      expect(applied).toBe(true);

      const state = useMatchStore.getState();

      expect(state.redScore).toBe(5);
      expect(state.blueScore).toBe(3);
      expect(state.redWarnings).toBe(1);
      expect(state.blueWarnings).toBe(0);
    });

    it('should reject unknown participant', () => {
      const remoteData: RemoteUpdateData = {
        participant_id: 999, // Unknown
        action_type: 'score',
        points: 2,
        red_score: 2,
        blue_score: 0,
      };

      const { applyRemoteUpdate } = useMatchStore.getState();

      const applied = applyRemoteUpdate(remoteData, '2025-01-01T12:00:00Z');

      expect(applied).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should reset all state to initial values', () => {
      useMatchStore.setState({
        match: mockMatch,
        redFighter: mockRedFighter,
        blueFighter: mockBlueFighter,
        redScore: 10,
        blueScore: 5,
        redWarnings: 2,
        blueWarnings: 1,
        events: [{ id: 1, match_id: 100, event_type: 'score', participant: 'red', points: 2, timestamp: '2025-01-01' }],
        lastUpdateTimestamp: '2025-01-01T12:00:00Z',
      });

      const { cleanup } = useMatchStore.getState();

      cleanup();

      const state = useMatchStore.getState();

      expect(state.match).toBeNull();
      expect(state.redFighter).toBeNull();
      expect(state.blueFighter).toBeNull();
      expect(state.redScore).toBe(0);
      expect(state.blueScore).toBe(0);
      expect(state.redWarnings).toBe(0);
      expect(state.blueWarnings).toBe(0);
      expect(state.events).toEqual([]);
      expect(state.lastUpdateTimestamp).toBeNull();
    });
  });
});
