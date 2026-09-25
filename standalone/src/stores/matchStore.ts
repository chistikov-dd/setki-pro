import { create } from 'zustand';
import type { Match, MatchEvent, Participant } from '../types';
import {
  startMatch as apiStartMatch,
  updateMatchScore,
  getMatchEvents,
  batchUpdateMatch,
  undoLastEvent as apiUndoLastEvent,
  finishMatch as apiFinishMatch,
  getNextMatchInBracket,
} from '../services/api';
import { loadTimerDuration, saveTimerDuration } from '../utils/timerSettings';

interface MatchStoreState {
  // State
  match: Match | null;
  redFighter: Participant | null;
  blueFighter: Participant | null;
  redScore: number;
  blueScore: number;
  redWarnings: number;
  blueWarnings: number;
  initialTimerSeconds: number;
  events: MatchEvent[];
  isLoading: boolean;
  error: string | null;

  // Next match state
  nextMatch: Match | null;
  isLoadingNextMatch: boolean;

  // Actions
  initMatch: (match: Match, totalSeconds: number) => Promise<void>;
  resetAll: () => Promise<void>;
  addScore: (participant: 'red' | 'blue', points: number, actionName: string) => Promise<void>;
  addWarning: (participant: 'red' | 'blue') => Promise<void>;
  removeWarning: (participant: 'red' | 'blue') => Promise<void>;
  undoLastAction: () => Promise<void>;
  finishMatch: (resultType: 'points' | 'submission' | 'disqualification', winnerId?: number, elapsedSeconds?: number) => Promise<void>;
  setTimerDuration: (seconds: number) => void;
  loadNextMatch: () => Promise<void>;
  cleanup: () => void;
}

export const useMatchStore = create<MatchStoreState>((set, get) => ({
  // Initial state
  match: null,
  redFighter: null,
  blueFighter: null,
  redScore: 0,
  blueScore: 0,
  redWarnings: 0,
  blueWarnings: 0,
  initialTimerSeconds: loadTimerDuration(),
  events: [],
  isLoading: false,
  error: null,

  nextMatch: null,
  isLoadingNextMatch: false,

  // Initialize match
  initMatch: async (match: Match, totalSeconds: number) => {
    set({ isLoading: true, error: null });

    try {
      await apiStartMatch(match.id);
      const events = await getMatchEvents(match.id);

      set({
        match,
        redFighter: match.participant2 || null, // participant2 = red
        blueFighter: match.participant1 || null, // participant1 = blue
        redScore: match.score_participant2 || 0,
        blueScore: match.score_participant1 || 0,
        redWarnings: match.warnings_participant2 || 0,
        blueWarnings: match.warnings_participant1 || 0,
        initialTimerSeconds: totalSeconds,
        events,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка инициализации матча';
      set({ isLoading: false, error: message });
      throw error;
    }
  },

  // Сбросить всё (баллы)
  resetAll: async () => {
    const { match } = get();

    set({
      redScore: 0,
      blueScore: 0,
      redWarnings: 0,
      blueWarnings: 0,
    });

    if (match) {
      try {
        await updateMatchScore({
          matchId: match.id,
          redScore: 0,
          blueScore: 0,
          redWarnings: 0,
          blueWarnings: 0,
          status: 'in_progress',
        });
      } catch (error) {
        console.error('Failed to reset match in database:', error);
      }
    }
  },

  // Add score
  addScore: async (participant: 'red' | 'blue', points: number, actionName: string) => {
    const state = get();
    const { match } = state;

    if (!match) {
      console.error('[matchStore.addScore] ABORT - no match loaded');
      return;
    }

    let newRedScore = 0;
    let newBlueScore = 0;

    set((state) => {
      newRedScore = participant === 'red' ? state.redScore + points : state.redScore;
      newBlueScore = participant === 'blue' ? state.blueScore + points : state.blueScore;
      return {
        redScore: newRedScore,
        blueScore: newBlueScore,
      };
    });

    const currentState = get();
    const redWarnings = currentState.redWarnings;
    const blueWarnings = currentState.blueWarnings;
    const oldRedScore = state.redScore;
    const oldBlueScore = state.blueScore;

    try {
      const events = await batchUpdateMatch({
        matchId: match.id,
        eventType: 'score',
        participant,
        points,
        actionName,
        timestamp: Date.now(),
        redScore: newRedScore,
        blueScore: newBlueScore,
        redWarnings,
        blueWarnings,
        status: 'in_progress',
      });

      set({ events });
    } catch (error) {
      console.error('[matchStore.addScore] ERROR, rolling back:', error);

      set({
        redScore: oldRedScore,
        blueScore: oldBlueScore,
      });

      throw error;
    }
  },

  // Add warning
  addWarning: async (participant: 'red' | 'blue') => {
    const state = get();
    const { match } = state;

    if (!match) {
      console.error('[matchStore.addWarning] ABORT - no match loaded');
      return;
    }

    let newRedWarnings = 0;
    let newBlueWarnings = 0;

    set((state) => {
      newRedWarnings = participant === 'red' ? state.redWarnings + 1 : state.redWarnings;
      newBlueWarnings = participant === 'blue' ? state.blueWarnings + 1 : state.blueWarnings;

      return {
        redWarnings: newRedWarnings,
        blueWarnings: newBlueWarnings,
      };
    });

    const currentState = get();
    const redScore = currentState.redScore;
    const blueScore = currentState.blueScore;
    const oldRedWarnings = state.redWarnings;
    const oldBlueWarnings = state.blueWarnings;

    try {
      const events = await batchUpdateMatch({
        matchId: match.id,
        eventType: 'warning',
        participant,
        timestamp: Date.now(),
        redScore,
        blueScore,
        redWarnings: newRedWarnings,
        blueWarnings: newBlueWarnings,
        status: 'in_progress',
      });

      set({ events });
    } catch (error) {
      console.error('[matchStore.addWarning] ERROR, rolling back:', error);

      set({
        redWarnings: oldRedWarnings,
        blueWarnings: oldBlueWarnings,
      });

      throw error;
    }
  },

  // Remove warning
  removeWarning: async (participant: 'red' | 'blue') => {
    const state = get();
    const { match } = state;
    if (!match) return;

    let newRedWarnings = 0;
    let newBlueWarnings = 0;

    set((state) => {
      newRedWarnings = participant === 'red' ? Math.max(0, state.redWarnings - 1) : state.redWarnings;
      newBlueWarnings = participant === 'blue' ? Math.max(0, state.blueWarnings - 1) : state.blueWarnings;
      return {
        redWarnings: newRedWarnings,
        blueWarnings: newBlueWarnings,
      };
    });

    const currentState = get();
    const redScore = currentState.redScore;
    const blueScore = currentState.blueScore;
    const oldRedWarnings = state.redWarnings;
    const oldBlueWarnings = state.blueWarnings;

    try {
      await updateMatchScore({
        matchId: match.id,
        redScore,
        blueScore,
        redWarnings: newRedWarnings,
        blueWarnings: newBlueWarnings,
        status: 'in_progress',
      });
    } catch (error) {
      console.error('Failed to remove warning:', error);
      set({
        redWarnings: oldRedWarnings,
        blueWarnings: oldBlueWarnings,
      });
    }
  },

  // Undo last action
  undoLastAction: async () => {
    const { match, events } = get();
    if (!match || events.length === 0) return;

    const oldState = {
      redScore: get().redScore,
      blueScore: get().blueScore,
      redWarnings: get().redWarnings,
      blueWarnings: get().blueWarnings,
      events: [...events],
    };

    try {
      await apiUndoLastEvent(match.id);

      const remainingEvents = events.slice(0, -1);
      let redScore = 0;
      let blueScore = 0;
      let redWarnings = 0;
      let blueWarnings = 0;

      remainingEvents.forEach((event) => {
        if (!event.participant || (event.participant !== 'red' && event.participant !== 'blue')) {
          return;
        }

        if (event.event_type === 'score') {
          const points = event.points || 0;
          if (event.participant === 'red') {
            redScore += points;
          } else {
            blueScore += points;
          }
        } else if (event.event_type === 'warning') {
          if (event.participant === 'red') {
            redWarnings++;
          } else {
            blueWarnings++;
          }
        }
      });

      await updateMatchScore({
        matchId: match.id,
        redScore,
        blueScore,
        redWarnings,
        blueWarnings,
        status: 'in_progress',
      });

      set({
        redScore,
        blueScore,
        redWarnings,
        blueWarnings,
        events: remainingEvents,
      });
    } catch (error) {
      console.error('[matchStore.undoLastAction] Failed, rolling back:', error);
      set(oldState);
      throw error;
    }
  },

  // Finish match
  finishMatch: async (
    resultType: 'points' | 'submission' | 'disqualification',
    winnerId?: number,
    elapsedSeconds?: number
  ) => {
    const { match, redScore, blueScore, redFighter, blueFighter } = get();
    if (!match) return;

    try {
      let finalWinnerId = winnerId;
      if (!finalWinnerId && resultType === 'points') {
        if (redScore > blueScore) {
          finalWinnerId = redFighter?.id;
        } else if (blueScore > redScore) {
          finalWinnerId = blueFighter?.id;
        }
      }

      await apiFinishMatch({
        matchId: match.id,
        winnerId: finalWinnerId,
        resultType,
        finalRedScore: redScore,
        finalBlueScore: blueScore,
      });

      // Записать окончательный счёт/статус (duration тоже сохраняем)
      await updateMatchScore({
        matchId: match.id,
        redScore,
        blueScore,
        redWarnings: get().redWarnings,
        blueWarnings: get().blueWarnings,
        status: 'completed',
      });
      void elapsedSeconds; // Длительность матча пока не персистится отдельно (не требуется UI)

      set((state) => ({
        match: state.match ? { ...state.match, status: 'completed', winner_id: finalWinnerId } : null,
      }));
    } catch (error) {
      console.error('[matchStore.finishMatch] ERROR:', error);
      throw error;
    }
  },

  setTimerDuration: (seconds: number) => {
    saveTimerDuration(seconds);
    set({ initialTimerSeconds: seconds });
  },

  loadNextMatch: async () => {
    const { match } = get();
    if (!match) {
      return;
    }

    set({ isLoadingNextMatch: true });

    try {
      const nextMatchData = await getNextMatchInBracket(match.bracket_id, match.id);

      if (nextMatchData) {
        const nextMatch: Match = {
          id: nextMatchData.id,
          bracket_id: nextMatchData.bracket_id,
          participant1: nextMatchData.participant1,
          participant2: nextMatchData.participant2,
          winner_id: nextMatchData.winner_id,
          round_number: nextMatchData.round_number,
          match_number: nextMatchData.match_number,
          status: nextMatchData.status,
          score_participant1: nextMatchData.score_participant1 || 0,
          score_participant2: nextMatchData.score_participant2 || 0,
          warnings_participant1: nextMatchData.warnings_participant1 || 0,
          warnings_participant2: nextMatchData.warnings_participant2 || 0,
          result_type: nextMatchData.result_type,
        };

        set({ nextMatch, isLoadingNextMatch: false });
      } else {
        set({ nextMatch: null, isLoadingNextMatch: false });
      }
    } catch (error) {
      console.error('[matchStore] Failed to load next match:', error);
      set({ nextMatch: null, isLoadingNextMatch: false });
    }
  },

  cleanup: () => {
    set({
      match: null,
      redFighter: null,
      blueFighter: null,
      redScore: 0,
      blueScore: 0,
      redWarnings: 0,
      blueWarnings: 0,
      initialTimerSeconds: loadTimerDuration(),
      events: [],
      isLoading: false,
      error: null,
      nextMatch: null,
      isLoadingNextMatch: false,
    });
  },
}));

/**
 * Zustand селекторы для оптимизации подписок
 */
export const matchStoreSelectors = {
  fighters: (state: MatchStoreState) => ({
    redFighter: state.redFighter,
    blueFighter: state.blueFighter,
  }),
  scores: (state: MatchStoreState) => ({
    redScore: state.redScore,
    blueScore: state.blueScore,
  }),
  warnings: (state: MatchStoreState) => ({
    redWarnings: state.redWarnings,
    blueWarnings: state.blueWarnings,
  }),
  actions: (state: MatchStoreState) => ({
    initMatch: state.initMatch,
    resetAll: state.resetAll,
    addScore: state.addScore,
    addWarning: state.addWarning,
    removeWarning: state.removeWarning,
    undoLastAction: state.undoLastAction,
    finishMatch: state.finishMatch,
    setTimerDuration: state.setTimerDuration,
    loadNextMatch: state.loadNextMatch,
    cleanup: state.cleanup,
  }),
  match: (state: MatchStoreState) => state.match,
  nextMatch: (state: MatchStoreState) => ({
    nextMatch: state.nextMatch,
    isLoadingNextMatch: state.isLoadingNextMatch,
  }),
  initialTimerSeconds: (state: MatchStoreState) => state.initialTimerSeconds,
  events: (state: MatchStoreState) => state.events,
};
