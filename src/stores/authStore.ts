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
  loginAsAdminOffline: (login: string, userId: number) => void;
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

      // Offline вход админа (используя сохраненный токен)
      loginAsAdminOffline: (login: string, userId: number) => {
        logger.info(LOG_CATEGORIES.AUTH, 'Admin offline login', { login, userId });

        // Создаем минимальный AuthResponse для offline режима
        const offlineUser: AuthResponse = {
          access_token: 'offline_token', // Токен уже в SQLite
          user_id: userId,
          role: 'admin',
          tournament_id: undefined,
          judge_name: undefined,
          table_number: undefined,
        };

        set({
          user: offlineUser,
          isAuthenticated: true,
          isLoading: false,
          error: null,
        });
      },

      // Login as judge (PIN code)
      loginAsJudge: async (pinCode: string, judgeName: string, tableNumber: number) => {
        set({ isLoading: true, error: null });
        logger.info(LOG_CATEGORIES.AUTH, 'Judge login attempt', { judgeName, tableNumber });

        console.log('[authStore] Начало входа судьи:', { pinCode, judgeName, tableNumber });

        // Получить serverUrl из serverModeStore если режим local-client
        const serverModeStore = (await import('./serverModeStore')).useServerModeStore.getState();
        logger.info(LOG_CATEGORIES.AUTH, 'Server mode state', {
          mode: serverModeStore.mode,
          serverUrl: serverModeStore.serverUrl
        });

        const serverUrl = serverModeStore.mode === 'local-client' ? serverModeStore.serverUrl : null;

        console.log('[authStore] Server mode:', serverModeStore.mode, 'Server URL:', serverUrl);
        logger.info(LOG_CATEGORIES.AUTH, 'Computed serverUrl for login', {
          mode: serverModeStore.mode,
          serverUrl: serverUrl
        });

        try {
          console.log('[authStore] Вызов loginByPin...');
          const response = await loginByPin({
            pin_code: pinCode,
            judge_name: judgeName,
            table_number: tableNumber
          }, serverUrl);
          console.log('[authStore] loginByPin успешно, ответ:', response);

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
          // Детальное логирование ошибки
          console.error('[authStore] Полная ошибка входа судьи:', error);
          console.error('[authStore] Тип ошибки:', typeof error);
          console.error('[authStore] Текст ошибки:', String(error));

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

        // Закрываем публичное табло при выходе судьи
        if (user?.role === 'referee') {
          try {
            const { closePublicDisplay } = await import('../utils/publicDisplay');
            await closePublicDisplay();
          } catch (error) {
            logger.warn(LOG_CATEGORIES.AUTH, 'Failed to close public display on logout', {}, error instanceof Error ? error : undefined);
          }
        }

        // Освободить номер стола если это судья
        if (user?.role === 'referee' && user?.tournament_id && user?.table_number && user?.judge_name) {
          // Проверяем режим работы - если local-client, то отправляем запрос на локальный сервер
          const serverModeStore = (await import('./serverModeStore')).useServerModeStore.getState();

          console.log('[authStore.logout] Server mode:', serverModeStore.mode, 'Server URL:', serverModeStore.serverUrl);
          logger.info(LOG_CATEGORIES.AUTH, 'Checking server mode for logout', {
            mode: serverModeStore.mode,
            serverUrl: serverModeStore.serverUrl,
          });

          if (serverModeStore.mode === 'local-client' && serverModeStore.serverUrl) {
            console.log('[authStore.logout] Sending logout request to local server...');
            // Отправляем запрос на локальный сервер для удаления сессии из БД админа
            try {
              // serverUrl уже содержит http://, поэтому не добавляем префикс
              const logoutUrl = serverModeStore.serverUrl.startsWith('http')
                ? `${serverModeStore.serverUrl}/api/v1/auth/logout`
                : `http://${serverModeStore.serverUrl}/api/v1/auth/logout`;

              console.log('[authStore.logout] Logout URL:', logoutUrl);

              const response = await fetch(logoutUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tournament_id: user.tournament_id,
                  table_number: user.table_number,
                  judge_name: user.judge_name,
                }),
              });

              if (response.ok) {
                logger.info(LOG_CATEGORIES.AUTH, 'Judge session removed from local server', {
                  tableNumber: user.table_number,
                });
              } else {
                logger.warn(LOG_CATEGORIES.AUTH, 'Failed to remove judge session from local server', {
                  status: response.status,
                });
              }
            } catch (error) {
              logger.error(
                LOG_CATEGORIES.AUTH,
                'Error removing judge session from local server',
                {},
                error instanceof Error ? error : undefined
              );
            }
          }

          // Также освобождаем стол в локальной БД
          let retries = 3;
          let released = false;

          while (retries > 0 && !released) {
            try {
              await releaseTableNumber(user.tournament_id, user.table_number);
              logger.info(LOG_CATEGORIES.AUTH, 'Released table number', {
                tournamentId: user.tournament_id,
                tableNumber: user.table_number,
              });
              released = true;
            } catch (err) {
              retries--;
              logger.warn(
                LOG_CATEGORIES.AUTH,
                `Failed to release table number (${3 - retries}/3 attempts)`,
                { tableNumber: user.table_number },
                err instanceof Error ? err : undefined
              );

              if (retries > 0) {
                // Пауза перед следующей попыткой (500ms)
                await new Promise(resolve => setTimeout(resolve, 500));
              } else {
                // Финальная ошибка после всех попыток
                logger.error(
                  LOG_CATEGORIES.AUTH,
                  'Failed to release table number after 3 attempts',
                  { tableNumber: user.table_number },
                  err instanceof Error ? err : undefined
                );
              }
            }
          }
        }

        // НЕ очищаем credentials при выходе - для автоматического входа при следующем запуске
        // Credentials остаются в SQLite для быстрого повторного входа

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
