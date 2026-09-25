import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMatchStore } from '../../stores/matchStore';
import * as api from '../../services/api';
import type { Match, Participant } from '../../types';

vi.mock('../../services/api', () => ({
  startMatch: vi.fn(),
  updateMatchScore: vi.fn(),
  getMatchEvents: vi.fn(),
  batchUpdateMatch: vi.fn(),
  undoLastEvent: vi.fn(),
  finishMatch: vi.fn(),
  getNextMatchInBracket: vi.fn(),
}));

describe('matchStore', () => {
  const blueFighter: Participant = { id: 1, fighter_id: 1, full_name: 'Иванов Иван Иванович', club_name: 'Клуб А' };
  const redFighter: Participant = { id: 2, fighter_id: 2, full_name: 'Петров Пётр Петрович', club_name: 'Клуб Б' };

  const baseMatch: Match = {
    id: 100,
    bracket_id: 1,
    round_number: 1,
    match_number: 0,
    participant1: blueFighter,
    participant2: redFighter,
    score_participant1: 0,
    score_participant2: 0,
    warnings_participant1: 0,
    warnings_participant2: 0,
    status: 'scheduled',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (api.getMatchEvents as any).mockResolvedValue([]);
    (api.batchUpdateMatch as any).mockResolvedValue([]);
    (api.getNextMatchInBracket as any).mockResolvedValue(null);
    useMatchStore.getState().cleanup();
  });

  it('initMatch loads fighters with correct color mapping (participant1=blue, participant2=red)', async () => {
    await useMatchStore.getState().initMatch(baseMatch, 300);

    const state = useMatchStore.getState();
    expect(state.blueFighter?.id).toBe(1);
    expect(state.redFighter?.id).toBe(2);
    expect(state.match?.id).toBe(100);
    expect(api.startMatch).toHaveBeenCalledWith(100);
  });

  it('addScore increments the correct color score and persists via batchUpdateMatch', async () => {
    await useMatchStore.getState().initMatch(baseMatch, 300);
    await useMatchStore.getState().addScore('red', 2, '+2');

    const state = useMatchStore.getState();
    expect(state.redScore).toBe(2);
    expect(state.blueScore).toBe(0);
    expect(api.batchUpdateMatch).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: 100, participant: 'red', points: 2 })
    );
  });

  it('addScore rolls back optimistic update on API failure', async () => {
    await useMatchStore.getState().initMatch(baseMatch, 300);
    (api.batchUpdateMatch as any).mockRejectedValueOnce(new Error('network error'));

    await expect(useMatchStore.getState().addScore('blue', 3, '+3')).rejects.toThrow('network error');

    expect(useMatchStore.getState().blueScore).toBe(0);
  });

  it('addWarning increments warnings and can exceed maxWarnings (disqualification handled by UI)', async () => {
    await useMatchStore.getState().initMatch(baseMatch, 300);

    await useMatchStore.getState().addWarning('red');
    await useMatchStore.getState().addWarning('red');
    await useMatchStore.getState().addWarning('red');
    await useMatchStore.getState().addWarning('red'); // 4th warning -> disqualification threshold

    expect(useMatchStore.getState().redWarnings).toBe(4);
  });

  it('removeWarning never goes below zero', async () => {
    await useMatchStore.getState().initMatch(baseMatch, 300);
    await useMatchStore.getState().removeWarning('blue');
    expect(useMatchStore.getState().blueWarnings).toBe(0);
  });

  it('undoLastAction recalculates scores from remaining events', async () => {
    await useMatchStore.getState().initMatch(baseMatch, 300);

    (api.batchUpdateMatch as any).mockResolvedValueOnce([
      { match_id: 100, event_type: 'score', participant: 'red', points: 2, timestamp: 1 },
    ]);
    await useMatchStore.getState().addScore('red', 2, '+2');
    expect(useMatchStore.getState().redScore).toBe(2);

    (api.undoLastEvent as any).mockResolvedValue(undefined);
    await useMatchStore.getState().undoLastAction();

    expect(useMatchStore.getState().redScore).toBe(0);
    expect(useMatchStore.getState().events).toHaveLength(0);
  });

  it('undoLastAction does nothing when there are no events', async () => {
    await useMatchStore.getState().initMatch(baseMatch, 300);
    await useMatchStore.getState().undoLastAction();
    expect(api.undoLastEvent).not.toHaveBeenCalled();
  });

  it('finishMatch determines winner by score when winnerId is not provided', async () => {
    await useMatchStore.getState().initMatch(baseMatch, 300);
    (api.batchUpdateMatch as any).mockResolvedValueOnce([]);
    await useMatchStore.getState().addScore('red', 5, '+5');

    (api.finishMatch as any).mockResolvedValue(undefined);
    (api.updateMatchScore as any).mockResolvedValue(undefined);

    await useMatchStore.getState().finishMatch('points');

    expect(api.finishMatch).toHaveBeenCalledWith(
      expect.objectContaining({ matchId: 100, winnerId: redFighter.id })
    );
    expect(useMatchStore.getState().match?.status).toBe('completed');
  });

  it('cleanup resets state to initial values', async () => {
    await useMatchStore.getState().initMatch(baseMatch, 300);
    useMatchStore.getState().cleanup();

    const state = useMatchStore.getState();
    expect(state.match).toBeNull();
    expect(state.redFighter).toBeNull();
    expect(state.blueFighter).toBeNull();
    expect(state.redScore).toBe(0);
    expect(state.blueScore).toBe(0);
  });
});
