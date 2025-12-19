/**
 * Mock для Tauri API в E2E тестах
 *
 * Используется для тестирования UI логики без реального Tauri backend
 */

export interface TauriInvokeResponse {
  [key: string]: any;
}

/**
 * Мок-данные для различных Tauri команд
 */
const mockResponses: Record<string, TauriInvokeResponse> = {
  // Auth
  login_admin: {
    id: 1,
    username: 'admin',
    role: 'admin',
    token: 'mock-token-123',
  },
  login_by_pin: {
    id: 2,
    tournament_id: 100,
    tournament_name: 'Тестовый турнир',
    pin_code: '123456',
    user_id: 10,
    judge_name: 'Тестовый Судья',
    table_number: 1,
  },

  // Tournaments
  get_tournaments: [
    {
      id: 100,
      name: 'Тестовый турнир 2025',
      date: '2025-12-19',
      location: 'Москва',
      cached_at: '2025-12-19T12:00:00Z',
    },
  ],

  // Brackets
  get_cached_brackets: [
    {
      id: 1,
      name: 'Мужчины до 70 кг',
      tournament_id: 100,
      matches_count: 8,
    },
    {
      id: 2,
      name: 'Женщины до 60 кг',
      tournament_id: 100,
      matches_count: 4,
    },
  ],

  // Matches
  start_match: {
    id: 1,
    status: 'in_progress',
    red_participant: {
      id: 1,
      name: 'Иванов Иван',
      team: 'Команда А',
    },
    blue_participant: {
      id: 2,
      name: 'Петров Петр',
      team: 'Команда Б',
    },
  },

  update_match_score: undefined,
  finish_match: undefined,

  // Server
  is_local_server_running: false,
  get_local_server_health: {
    status: 'healthy',
    uptime: 3600,
  },
};

/**
 * Создать mock для window.__TAURI__
 */
export function createTauriMock() {
  return {
    core: {
      invoke: async (cmd: string, args?: any) => {
        console.log(`[TAURI MOCK] invoke(${cmd})`, args);

        // Эмуляция задержки сети
        await new Promise((resolve) => setTimeout(resolve, 100));

        // Возвращаем мок-данные
        if (mockResponses[cmd] !== undefined) {
          return mockResponses[cmd];
        }

        // Для неизвестных команд возвращаем успех
        return { success: true };
      },
    },
    event: {
      listen: async (event: string, handler: (payload: any) => void) => {
        console.log(`[TAURI MOCK] listen(${event})`);
        return () => {}; // unlisten function
      },
      emit: async (event: string, payload?: any) => {
        console.log(`[TAURI MOCK] emit(${event})`, payload);
      },
    },
    window: {
      getCurrent: () => ({
        label: 'main',
        close: async () => {},
        minimize: async () => {},
        maximize: async () => {},
      }),
      WebviewWindow: class {
        constructor(label: string, options?: any) {
          console.log(`[TAURI MOCK] new WebviewWindow(${label})`, options);
        }
        async show() {}
        async hide() {}
        async close() {}
        async emit(event: string, payload?: any) {}
        async listen(event: string, handler: (payload: any) => void) {
          return () => {};
        }
      },
    },
  };
}

/**
 * Установить мок-ответ для команды
 */
export function setMockResponse(cmd: string, response: any) {
  mockResponses[cmd] = response;
}

/**
 * Очистить все мок-ответы
 */
export function clearMockResponses() {
  Object.keys(mockResponses).forEach((key) => {
    delete mockResponses[key];
  });
}
