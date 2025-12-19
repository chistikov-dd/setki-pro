import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMatchStore } from './matchStore';
import { mockInvoke, resetTauriMocks } from '@/test/mocks/tauri';

/**
 * Integration тесты для conflict resolution в matchStore
 *
 * Критичные сценарии:
 * 1. Timestamp-based conflict resolution
 * 2. Последний update побеждает
 * 3. Игнорирование старых updates
 */

// Helper to create mock match
const createMockMatch = (overrides = {}) => ({
  id: 1,
  bracket_id: 1,
  participant1: { id: 2, full_name: 'Blue Fighter' }, // participant1 = blue
  participant2: { id: 1, full_name: 'Red Fighter' },  // participant2 = red
  score_participant1: 0,
  score_participant2: 0,
  warnings_participant1: 0,
  warnings_participant2: 0,
  status: 'pending' as const,
  ...overrides,
});

describe('Match Store - Conflict Resolution', () => {
  beforeEach(() => {
    // Reset store
    useMatchStore.setState({
      match: null,
      redFighter: null,
      blueFighter: null,
      redScore: 0,
      blueScore: 0,
      redWarnings: 0,
      blueWarnings: 0,
      initialTimerSeconds: 300,
      events: [],
      isLoading: false,
      error: null,
      lastUpdateTimestamp: null,
    });

    resetTauriMocks();
    mockInvoke.mockResolvedValue({ success: true });
  });

  it('should apply remote update with newer timestamp', () => {
    // Setup: manually set state (skip initMatch API call)
    const mockMatch = createMockMatch();
    useMatchStore.setState({
      match: mockMatch,
      redFighter: mockMatch.participant2,
      blueFighter: mockMatch.participant1,
      redScore: 2,
      blueScore: 0,
      lastUpdateTimestamp: '2025-01-01T12:00:00Z',
    });

    const store = useMatchStore.getState();

    // Remote update with newer timestamp
    const applied = store.applyRemoteUpdate(
      {
        participant_id: 1,
        action_type: 'score',
        points: 3,
        red_score: 3,
        blue_score: 0,
      },
      '2025-01-01T12:00:05Z' // Newer
    );

    expect(applied).toBe(true);
    expect(useMatchStore.getState().redScore).toBe(3);
  });

  it('should reject remote update with older timestamp', () => {
    const mockMatch = createMockMatch();
    useMatchStore.setState({
      match: mockMatch,
      redFighter: mockMatch.participant2,
      blueFighter: mockMatch.participant1,
      redScore: 2,
      blueScore: 0,
      lastUpdateTimestamp: '2025-01-01T12:00:10Z', // Newer local
    });

    const store = useMatchStore.getState();

    // Remote update with older timestamp
    const applied = store.applyRemoteUpdate(
      {
        participant_id: 1,
        action_type: 'score',
        points: 3,
        red_score: 3,
        blue_score: 0,
      },
      '2025-01-01T12:00:05Z' // Older
    );

    expect(applied).toBe(false);
    expect(useMatchStore.getState().redScore).toBe(2); // Unchanged
  });

  it('should apply remote update when no local timestamp exists', () => {
    const mockMatch = createMockMatch();
    useMatchStore.setState({
      match: mockMatch,
      redFighter: mockMatch.participant2,
      blueFighter: mockMatch.participant1,
      lastUpdateTimestamp: null, // No local timestamp
    });

    const store = useMatchStore.getState();

    const applied = store.applyRemoteUpdate(
      {
        participant_id: 2,
        action_type: 'score',
        points: 1,
        red_score: 0,
        blue_score: 1,
      },
      new Date().toISOString()
    );

    expect(applied).toBe(true);
    expect(useMatchStore.getState().blueScore).toBe(1);
  });

  it('should handle warning updates from remote', () => {
    const mockMatch = createMockMatch();
    useMatchStore.setState({
      match: mockMatch,
      redFighter: mockMatch.participant2,
      blueFighter: mockMatch.participant1,
    });

    const store = useMatchStore.getState();

    const applied = store.applyRemoteUpdate(
      {
        participant_id: 2,
        action_type: 'warning',
        blue_warnings: 1,
      },
      new Date().toISOString()
    );

    expect(applied).toBe(true);
    expect(useMatchStore.getState().blueWarnings).toBe(1);
  });

  it('should handle full score reset from remote', () => {
    const mockMatch = createMockMatch();
    useMatchStore.setState({
      match: mockMatch,
      redFighter: mockMatch.participant2,
      blueFighter: mockMatch.participant1,
      redScore: 5,
      blueScore: 3,
      redWarnings: 2,
      blueWarnings: 1,
    });

    const store = useMatchStore.getState();

    const applied = store.applyRemoteUpdate(
      {
        participant_id: 1,
        action_type: 'reset',
        red_score: 0,
        blue_score: 0,
        red_warnings: 0,
        blue_warnings: 0,
      },
      new Date().toISOString()
    );

    expect(applied).toBe(true);
    expect(useMatchStore.getState().redScore).toBe(0);
    expect(useMatchStore.getState().blueScore).toBe(0);
    expect(useMatchStore.getState().redWarnings).toBe(0);
    expect(useMatchStore.getState().blueWarnings).toBe(0);
  });

  it('should reject remote update with invalid participant_id', () => {
    const mockMatch = createMockMatch();
    useMatchStore.setState({
      match: mockMatch,
      redFighter: mockMatch.participant2,
      blueFighter: mockMatch.participant1,
    });

    const store = useMatchStore.getState();

    const applied = store.applyRemoteUpdate(
      {
        participant_id: 999, // Invalid
        action_type: 'score',
        points: 2,
        red_score: 2,
        blue_score: 0,
      },
      new Date().toISOString()
    );

    expect(applied).toBe(false);
  });

  it('should handle concurrent updates with equal timestamps', () => {
    const mockMatch = createMockMatch();
    const sameTime = '2025-01-01T12:00:00Z';

    useMatchStore.setState({
      match: mockMatch,
      redFighter: mockMatch.participant2,
      blueFighter: mockMatch.participant1,
      lastUpdateTimestamp: sameTime,
      redScore: 2,
    });

    const store = useMatchStore.getState();

    // Update with same timestamp should be rejected
    const applied = store.applyRemoteUpdate(
      {
        participant_id: 1,
        action_type: 'score',
        points: 3,
        red_score: 3,
        blue_score: 0,
      },
      sameTime
    );

    expect(applied).toBe(false);
    expect(useMatchStore.getState().redScore).toBe(2);
  });

  it('should apply remote updates for both participants', () => {
    const mockMatch = createMockMatch();
    useMatchStore.setState({
      match: mockMatch,
      redFighter: mockMatch.participant2,
      blueFighter: mockMatch.participant1,
    });

    const store = useMatchStore.getState();

    // Update red
    store.applyRemoteUpdate(
      {
        participant_id: 1,
        action_type: 'score',
        points: 2,
        red_score: 2,
        blue_score: 0,
      },
      '2025-01-01T12:00:01Z'
    );

    // Update blue (newer timestamp)
    store.applyRemoteUpdate(
      {
        participant_id: 2,
        action_type: 'score',
        points: 3,
        red_score: 2,
        blue_score: 3,
      },
      '2025-01-01T12:00:02Z'
    );

    expect(useMatchStore.getState().redScore).toBe(2);
    expect(useMatchStore.getState().blueScore).toBe(3);
  });

  it('should maintain score consistency during conflict resolution', () => {
    const mockMatch = createMockMatch();
    useMatchStore.setState({
      match: mockMatch,
      redFighter: mockMatch.participant2,
      blueFighter: mockMatch.participant1,
      redScore: 2,
      blueScore: 0,
      lastUpdateTimestamp: '2025-01-01T12:00:00Z',
    });

    const store = useMatchStore.getState();

    // Remote (newer): Red = 1, Blue = 3
    store.applyRemoteUpdate(
      {
        participant_id: 2,
        action_type: 'score',
        points: 3,
        red_score: 1,
        blue_score: 3,
      },
      '2025-01-01T12:00:05Z'
    );

    expect(useMatchStore.getState().redScore).toBe(1);
    expect(useMatchStore.getState().blueScore).toBe(3);
  });
});

describe('Match Store - Edge Cases', () => {
  beforeEach(() => {
    useMatchStore.setState({
      match: null,
      redFighter: null,
      blueFighter: null,
      redScore: 0,
      blueScore: 0,
      redWarnings: 0,
      blueWarnings: 0,
      initialTimerSeconds: 300,
      events: [],
      isLoading: false,
      error: null,
      lastUpdateTimestamp: null,
    });
  });

  it('should handle remote update with missing optional fields', () => {
    const mockMatch = createMockMatch();
    useMatchStore.setState({
      match: mockMatch,
      redFighter: mockMatch.participant2,
      blueFighter: mockMatch.participant1,
    });

    const store = useMatchStore.getState();

    const applied = store.applyRemoteUpdate(
      {
        participant_id: 1,
        action_type: 'score',
        red_score: 2,
        blue_score: 0,
      },
      new Date().toISOString()
    );

    expect(applied).toBe(true);
    expect(useMatchStore.getState().redScore).toBe(2);
  });

  it('should handle remote update with reset action', () => {
    const mockMatch = createMockMatch();
    useMatchStore.setState({
      match: mockMatch,
      redFighter: mockMatch.participant2,
      blueFighter: mockMatch.participant1,
      redScore: 5,
      blueScore: 3,
    });

    const store = useMatchStore.getState();

    const applied = store.applyRemoteUpdate(
      {
        participant_id: 1,
        action_type: 'reset',
        red_score: 0,
        blue_score: 0,
      },
      new Date().toISOString()
    );

    expect(applied).toBe(true);
    expect(useMatchStore.getState().redScore).toBe(0);
    expect(useMatchStore.getState().blueScore).toBe(0);
  });
});
