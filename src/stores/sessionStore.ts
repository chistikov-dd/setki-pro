import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TournamentSession, TournamentBriefResponse } from '../types';
import {
  getTournaments,
  getTournamentDetails,
} from '../services/api';

interface SessionState {
  // State
  tournaments: TournamentBriefResponse[];
  currentSession: TournamentSession | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadTournaments: () => Promise<void>;
  loadTournamentSession: (tournamentId: number) => Promise<TournamentSession>;
  clearSession: () => void;
  clearError: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      // Initial state
      tournaments: [],
      currentSession: null,
      isLoading: false,
      error: null,

  // Загрузить список турниров
  loadTournaments: async () => {
    set({ isLoading: true, error: null });

    try {
      const tournaments = await getTournaments();
      set({
        tournaments,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка загрузки турниров';
      set({
        tournaments: [],
        isLoading: false,
        error: message,
      });
      throw error;
    }
  },

  // Загрузить детали турнира (включая PIN и scoring config)
  loadTournamentSession: async (tournamentId: number) => {
    set({ isLoading: true, error: null });

    try {
      const session = await getTournamentDetails(tournamentId);
      set({
        currentSession: session,
        isLoading: false,
        error: null,
      });
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка загрузки турнира';
      set({
        currentSession: null,
        isLoading: false,
        error: message,
      });
      throw error;
    }
  },

      // Очистить сессию
      clearSession: () => {
        set({
          currentSession: null,
          error: null,
        });
      },

      // Очистить ошибку
      clearError: () => {
        set({ error: null });
      },
    }),
    {
      name: 'session-storage',
      partialize: (state) => ({
        currentSession: state.currentSession, // Сохраняем только сессию
      }),
    }
  )
);
