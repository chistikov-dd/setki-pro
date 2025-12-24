import { create } from 'zustand';
import type { Match, MatchEvent, Participant } from '../types';
import {
  startMatch as apiStartMatch,
  updateMatchScore,
  updateMatchScoreUniversal,
  getMatchEvents,
  batchUpdateMatch,
  undoLastEvent as apiUndoLastEvent,
  finishMatch as apiFinishMatch,
} from '../services/api';
import { useSessionStore } from './sessionStore';
import { useServerModeStore } from './serverModeStore';

interface MatchStoreState {
  // State
  match: Match | null;
  redFighter: Participant | null;
  blueFighter: Participant | null;
  redScore: number;
  blueScore: number;
  redWarnings: number;
  blueWarnings: number;
  initialTimerSeconds: number; // For passing to useMatchTimer hook
  events: MatchEvent[];
  isLoading: boolean;
  error: string | null;
  lastUpdateTimestamp: string | null; // Timestamp последнего обновления для conflict resolution

  // Actions
  initMatch: (match: Match, totalSeconds: number) => Promise<void>;
  resetAll: () => Promise<void>;
  addScore: (participant: 'red' | 'blue', points: number, actionName: string) => Promise<void>;
  addWarning: (participant: 'red' | 'blue') => Promise<void>;
  removeWarning: (participant: 'red' | 'blue') => Promise<void>;
  undoLastAction: () => Promise<void>;
  finishMatch: (resultType: 'points' | 'submission' | 'disqualification', winnerId?: number) => Promise<void>;
  applyRemoteUpdate: (data: RemoteUpdateData, timestamp: string) => boolean;
  cleanup: () => void;
}

// Тип для удалённых обновлений
export interface RemoteUpdateData {
  participant_id: number;
  action_type: string;
  points?: number;
  red_score?: number;
  blue_score?: number;
  red_warnings?: number;
  blue_warnings?: number;
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
  initialTimerSeconds: 300, // 5 minutes default
  events: [],
  isLoading: false,
  error: null,
  lastUpdateTimestamp: null,

  // Initialize match
  initMatch: async (match: Match, totalSeconds: number) => {
    set({ isLoading: true, error: null });

    try {
      // Start match (update status to in_progress)
      await apiStartMatch(match.id);

      // Load events history
      const events = await getMatchEvents(match.id);

      set({
        match,
        redFighter: match.participant2 || null,  // participant2 = red
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
  // Note: Timer is now managed by useMatchTimer hook in MatchScreen
  resetAll: async () => {
    const { match } = get();

    // Update local state
    set({
      redScore: 0,
      blueScore: 0,
      redWarnings: 0,
      blueWarnings: 0,
    });

    // Update database (universal function handles routing)
    if (match) {
      try {
        const serverMode = useServerModeStore.getState();
        await updateMatchScoreUniversal({
          matchId: match.id,
          redScore: 0,
          blueScore: 0,
          redWarnings: 0,
          blueWarnings: 0,
          status: 'in_progress',
        }, serverMode);
      } catch (error) {
        console.error('Failed to reset match in database:', error);
      }
    }
  },

  // Add score
  addScore: async (participant: 'red' | 'blue', points: number, actionName: string) => {
    const { match, redScore, blueScore, redWarnings, blueWarnings } = get();

    console.log('[matchStore.addScore] START:', {
      participant,
      points,
      actionName,
      matchId: match?.id,
      currentScores: { redScore, blueScore },
      hasMatch: !!match,
    });

    if (!match) {
      console.error('[matchStore.addScore] ABORT - no match loaded');
      return;
    }

    const newRedScore = participant === 'red' ? redScore + points : redScore;
    const newBlueScore = participant === 'blue' ? blueScore + points : blueScore;
    const timestamp = new Date().toISOString(); // ISO 8601 для timestamp comparison

    try {
      console.log('[matchStore.addScore] Step 1: Calling batchUpdateMatch...');

      // 1️⃣ Локальное сохранение (резервная копия в БД судьи)
      // Batch update: record event + update score + get events (3 вызова → 1)
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

      console.log('[matchStore.addScore] Step 1 complete, events count:', events.length);

      // 2️⃣ КРИТИЧНО: Отправка на сервер админа (в LAN режиме)
      // Это гарантирует что данные сохранятся в БД админа
      console.log('[matchStore.addScore] Step 2: Calling updateMatchScoreUniversal...');
      const serverMode = useServerModeStore.getState();
      console.log('[matchStore.addScore] Server mode:', serverMode);

      await updateMatchScoreUniversal({
        matchId: match.id,
        redScore: newRedScore,
        blueScore: newBlueScore,
        redWarnings,
        blueWarnings,
        status: 'in_progress',
      }, serverMode);

      console.log('[matchStore.addScore] Step 2 complete');

      // Update local state with timestamp
      set({
        redScore: newRedScore,
        blueScore: newBlueScore,
        events,
        lastUpdateTimestamp: timestamp,
      });

      console.log('[matchStore.addScore] SUCCESS - state updated');
    } catch (error) {
      console.error('[matchStore.addScore] ERROR:', error);
      console.error('[matchStore.addScore] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  },

  // Add warning
  addWarning: async (participant: 'red' | 'blue') => {
    const { match, redScore, blueScore, redWarnings, blueWarnings } = get();

    console.log('[matchStore.addWarning] START:', {
      participant,
      matchId: match?.id,
      currentWarnings: { redWarnings, blueWarnings },
      hasMatch: !!match,
    });

    if (!match) {
      console.error('[matchStore.addWarning] ABORT - no match loaded');
      return;
    }

    const newRedWarnings = participant === 'red' ? redWarnings + 1 : redWarnings;
    const newBlueWarnings = participant === 'blue' ? blueWarnings + 1 : blueWarnings;
    const timestamp = new Date().toISOString();

    // Get max warnings from config
    const { currentSession } = useSessionStore.getState();
    const maxWarnings = currentSession?.scoring_config.warnings.max_count || 3;

    console.log('[matchStore.addWarning] Debug:', {
      participant,
      currentWarnings: participant === 'red' ? redWarnings : blueWarnings,
      newWarnings: participant === 'red' ? newRedWarnings : newBlueWarnings,
      maxWarnings,
      shouldDisqualify: (participant === 'red' ? newRedWarnings : newBlueWarnings) > maxWarnings,
    });

    // Check for disqualification (disqualify when reaching 4th warning with max=3)
    // При достижении максимума просто записываем предупреждение
    // MatchScreen автоматически откроет диалог завершения матча

    try {
      console.log('[matchStore.addWarning] Step 1: Calling batchUpdateMatch...');

      // 1️⃣ Локальное сохранение (резервная копия в БД судьи)
      // Batch update: record event + update score + get events (3 вызова → 1)
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

      console.log('[matchStore.addWarning] Step 1 complete, events count:', events.length);

      // 2️⃣ КРИТИЧНО: Отправка на сервер админа (в LAN режиме)
      // Это гарантирует что данные сохранятся в БД админа
      console.log('[matchStore.addWarning] Step 2: Calling updateMatchScoreUniversal...');
      const serverMode = useServerModeStore.getState();
      console.log('[matchStore.addWarning] Server mode:', serverMode);

      await updateMatchScoreUniversal({
        matchId: match.id,
        redScore,
        blueScore,
        redWarnings: newRedWarnings,
        blueWarnings: newBlueWarnings,
        status: 'in_progress',
      }, serverMode);

      console.log('[matchStore.addWarning] Step 2 complete');

      // Update local state with timestamp
      set({
        redWarnings: newRedWarnings,
        blueWarnings: newBlueWarnings,
        lastUpdateTimestamp: timestamp,
        events,
      });

      console.log('[matchStore.addWarning] SUCCESS - state updated');
    } catch (error) {
      console.error('[matchStore.addWarning] ERROR:', error);
      console.error('[matchStore.addWarning] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  },

  // Remove warning
  removeWarning: async (participant: 'red' | 'blue') => {
    const { match, redScore, blueScore, redWarnings, blueWarnings } = get();
    if (!match) return;

    const newRedWarnings = participant === 'red' ? Math.max(0, redWarnings - 1) : redWarnings;
    const newBlueWarnings = participant === 'blue' ? Math.max(0, blueWarnings - 1) : blueWarnings;

    try {
      // Update match
      await updateMatchScore({
        matchId: match.id,
        redScore,
        blueScore,
        redWarnings: newRedWarnings,
        blueWarnings: newBlueWarnings,
        status: 'in_progress',
      });

      // Update local state
      set({
        redWarnings: newRedWarnings,
        blueWarnings: newBlueWarnings,
      });
    } catch (error) {
      console.error('Failed to remove warning:', error);
    }
  },

  // Undo last action
  undoLastAction: async () => {
    const { match, events } = get();
    if (!match || events.length === 0) return;

    try {
      // Remove event from database
      await apiUndoLastEvent(match.id);

      // Recalculate scores
      const remainingEvents = events.slice(0, -1);
      let redScore = 0;
      let blueScore = 0;
      let redWarnings = 0;
      let blueWarnings = 0;

      remainingEvents.forEach((event) => {
        if (event.event_type === 'score') {
          if (event.participant === 'red') {
            redScore += event.points || 0;
          } else {
            blueScore += event.points || 0;
          }
        } else if (event.event_type === 'warning') {
          if (event.participant === 'red') {
            redWarnings++;
          } else {
            blueWarnings++;
          }
        }
      });

      // Update match
      await updateMatchScore({
        matchId: match.id,
        redScore,
        blueScore,
        redWarnings,
        blueWarnings,
        status: 'in_progress',
      });

      // Update local state
      set({
        redScore,
        blueScore,
        redWarnings,
        blueWarnings,
        events: remainingEvents,
      });
    } catch (error) {
      console.error('Failed to undo:', error);
    }
  },

  // Finish match
  // Note: Timer is now managed by useMatchTimer hook in MatchScreen
  finishMatch: async (
    resultType: 'points' | 'submission' | 'disqualification',
    winnerId?: number
  ) => {
    const { match, redScore, blueScore, redFighter, blueFighter } = get();
    if (!match) return;

    console.log('[finishMatch] Called with:', {
      resultType,
      winnerId,
      match: match.id,
      redFighter: redFighter?.id,
      blueFighter: blueFighter?.id,
      redScore,
      blueScore,
    });

    try {
      // Determine winner if not provided
      let finalWinnerId = winnerId;
      if (!finalWinnerId && resultType === 'points') {
        if (redScore > blueScore) {
          finalWinnerId = redFighter?.id;
        } else if (blueScore > redScore) {
          finalWinnerId = blueFighter?.id;
        }
      }

      console.log('[matchStore.finishMatch] Step 1: Saving to local DB...', { finalWinnerId, resultType });

      // 1️⃣ Локальное сохранение (резервная копия в БД судьи)
      // Finish match
      await apiFinishMatch({
        matchId: match.id,
        winnerId: finalWinnerId,
        resultType,
        finalRedScore: redScore,
        finalBlueScore: blueScore,
      });

      console.log('[matchStore.finishMatch] Step 1 complete');

      // 2️⃣ КРИТИЧНО: Отправка финального счета на сервер админа (в LAN режиме)
      // Это гарантирует что финальные данные сохранятся в БД админа
      console.log('[matchStore.finishMatch] Step 2: Sending to admin server...');
      const serverMode = useServerModeStore.getState();
      console.log('[matchStore.finishMatch] Server mode:', serverMode);

      await updateMatchScoreUniversal({
        matchId: match.id,
        redScore,
        blueScore,
        redWarnings: get().redWarnings,
        blueWarnings: get().blueWarnings,
        status: 'completed',
        winnerId: finalWinnerId,
      }, serverMode);

      console.log('[matchStore.finishMatch] Step 2 complete');

      // Update local state
      set((state) => ({
        match: state.match ? { ...state.match, status: 'completed', winner_id: finalWinnerId } : null,
      }));

      console.log('[matchStore.finishMatch] SUCCESS - match completed');
    } catch (error) {
      console.error('[matchStore.finishMatch] ERROR:', error);
      console.error('[matchStore.finishMatch] Error details:', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  },

  /**
   * Применить удалённое обновление с проверкой timestamp
   * Возвращает true если обновление было применено, false если отклонено
   */
  applyRemoteUpdate: (data: RemoteUpdateData, timestamp: string) => {
    const { lastUpdateTimestamp, redFighter, blueFighter } = get();

    // Проверяем timestamp: применяем только если новый timestamp позже текущего
    if (lastUpdateTimestamp && timestamp <= lastUpdateTimestamp) {
      console.log('[MatchStore] Ignoring remote update (older timestamp):', {
        remote: timestamp,
        local: lastUpdateTimestamp,
      });
      return false;
    }

    console.log('[MatchStore] Applying remote update:', data);

    // Определяем какой участник (red/blue) на основе participant_id
    const isRedFighter = redFighter?.id === data.participant_id;
    const isBlueFighter = blueFighter?.id === data.participant_id;

    if (!isRedFighter && !isBlueFighter) {
      console.warn('[MatchStore] Unknown participant_id in remote update:', data.participant_id);
      return false;
    }

    // Применяем обновление в зависимости от типа действия
    if (data.action_type === 'warning') {
      // Предупреждение
      if (isRedFighter && data.red_warnings !== undefined) {
        set({ redWarnings: data.red_warnings, lastUpdateTimestamp: timestamp });
      } else if (isBlueFighter && data.blue_warnings !== undefined) {
        set({ blueWarnings: data.blue_warnings, lastUpdateTimestamp: timestamp });
      }
    } else if (data.red_score !== undefined && data.blue_score !== undefined) {
      // Полное обновление счёта (например, после undo или reset)
      // Проверяем СНАЧАЛА, чтобы приоритет был у полного обновления
      set({
        redScore: data.red_score,
        blueScore: data.blue_score,
        redWarnings: data.red_warnings ?? get().redWarnings,
        blueWarnings: data.blue_warnings ?? get().blueWarnings,
        lastUpdateTimestamp: timestamp,
      });
    } else if (data.points !== undefined && data.points > 0) {
      // Добавление баллов (только ОДНОГО счета)
      if (isRedFighter && data.red_score !== undefined) {
        set({ redScore: data.red_score, lastUpdateTimestamp: timestamp });
      } else if (isBlueFighter && data.blue_score !== undefined) {
        set({ blueScore: data.blue_score, lastUpdateTimestamp: timestamp });
      }
    }

    return true;
  },

  // Cleanup on unmount
  // Note: Timer is now managed by useMatchTimer hook in MatchScreen
  cleanup: () => {
    set({
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
  },
}));

/**
 * Zustand селекторы для оптимизации подписок
 * Используйте с useShallow для предотвращения лишних ре-рендеров
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
    applyRemoteUpdate: state.applyRemoteUpdate,
    cleanup: state.cleanup,
  }),
  match: (state: MatchStoreState) => state.match,
  initialTimerSeconds: (state: MatchStoreState) => state.initialTimerSeconds,
  events: (state: MatchStoreState) => state.events,
};
