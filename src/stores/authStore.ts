import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthResponse } from '../types';
import { loginAdmin, loginByPin, logout as apiLogout, clearAllReservations, releaseTableNumber } from '../services/api';
import { ErrorFactory } from '../utils/errorHandler';
import { logger, LOG_CATEGORIES } from '../utils/logger';

interface AuthState {
  // State
  user: AuthResponse | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  loginAsAdmin: (login: string, password: string) => Promise<void>;
  loginAsJudge: (pinCode: string, judgeName: string, tableNumber: number) => Promise<void>;
  logout: () => void;
  clearError: () => void;
  restoreSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      // Login as admin (login/password)
      loginAsAdmin: async (login: string, password: string) => {
        set({ isLoading: true, error: null });
        logger.info(LOG_CATEGORIES.AUTH, 'Admin login attempt', { login });

        try {
          const response = await loginAdmin({ login, password });

          logger.info(LOG_CATEGORIES.AUTH, 'Admin login successful', {
            userId: response.user_id,
            role: response.role,
          });

          set({
            user: response,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (error) {
          const appError = ErrorFactory.fromTauriError(error, { login });
          logger.error(LOG_CATEGORIES.AUTH, 'Admin login failed', { login }, appError);

          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: appError.userMessage,
          });
          throw appError;
        }
      },

      // Login as judge (PIN code)
      loginAsJudge: async (pinCode: string, judgeName: string, tableNumber: number) => {
        set({ isLoading: true, error: null });
        logger.info(LOG_CATEGORIES.AUTH, 'Judge login attempt', { judgeName, tableNumber });

        try {
          const response = await loginByPin({
            pin_code: pinCode,
            judge_name: judgeName,
            table_number: tableNumber
          });

          logger.info(LOG_CATEGORIES.AUTH, 'Judge login successful', {
            judgeName,
            tableNumber,
            tournamentId: response.tournament_id,
          });

          // Очистить старые резервирования при логине
          try {
            await clearAllReservations();
            logger.debug(LOG_CATEGORIES.AUTH, 'Cleared bracket reservations');
          } catch (err) {
            logger.warn(
              LOG_CATEGORIES.AUTH,
              'Failed to clear bracket reservations',
              {},
              err instanceof Error ? err : undefined
            );
          }

          // Имя уже включено в response от backend
          set({
            user: response,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        } catch (error) {
          const appError = ErrorFactory.fromTauriError(error, { judgeName });
          logger.error(LOG_CATEGORIES.AUTH, 'Judge login failed', { judgeName }, appError);

          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: appError.userMessage,
          });
          throw appError;
        }
      },

      // Logout
      logout: async () => {
        const { user } = get();
        logger.info(LOG_CATEGORIES.AUTH, 'User logout', {
          userId: user?.user_id,
          role: user?.role,
        });

        // Освободить номер стола если это судья
        if (user?.role === 'referee' && user?.tournament_id && user?.table_number) {
          try {
            await releaseTableNumber(user.tournament_id, user.table_number);
            logger.info(LOG_CATEGORIES.AUTH, 'Released table number', {
              tournamentId: user.tournament_id,
              tableNumber: user.table_number,
            });
          } catch (err) {
            logger.error(
              LOG_CATEGORIES.AUTH,
              'Failed to release table number',
              { tableNumber: user.table_number },
              err instanceof Error ? err : undefined
            );
          }
        }

        apiLogout();
        set({
          user: null,
          isAuthenticated: false,
          error: null,
        });
      },

      // Clear error
      clearError: () => {
        set({ error: null });
      },

      // Restore session from localStorage
      restoreSession: () => {
        const { user } = get();
        if (user && user.access_token) {
          // Токен теперь хранится в SQLite через Rust
          set({ isAuthenticated: true });
        }
      },
    }),
    {
      name: 'auth-storage', // LocalStorage key
      partialize: (state) => ({ user: state.user }), // Сохраняем только user
    }
  )
);

// Восстановить сессию при загрузке
useAuthStore.getState().restoreSession();
