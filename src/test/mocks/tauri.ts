import { vi } from 'vitest';

/**
 * Mock implementation of Tauri's invoke function
 * Usage in tests:
 *
 * import { mockInvoke } from '@/test/mocks/tauri';
 *
 * mockInvoke.mockResolvedValue({ success: true });
 */
export const mockInvoke = vi.fn();

/**
 * Mock implementation of Tauri's event listen
 */
export const mockListen = vi.fn();

/**
 * Mock implementation of Tauri's event emit
 */
export const mockEmit = vi.fn();

/**
 * Reset all Tauri mocks
 * Call this in beforeEach or afterEach
 */
export const resetTauriMocks = () => {
  mockInvoke.mockReset();
  mockListen.mockReset();
  mockEmit.mockReset();
};

/**
 * Setup Tauri mock responses for common commands
 */
export const setupTauriMocks = () => {
  // Auth commands
  mockInvoke.mockImplementation((cmd: string, args?: any) => {
    switch (cmd) {
      case 'login_admin':
        return Promise.resolve({
          access_token: 'mock_token',
          user_id: 1,
          role: 'admin',
        });

      case 'login_by_pin':
        return Promise.resolve({
          access_token: 'mock_token',
          user_id: 2,
          role: 'judge',
          tournament_id: 1,
          judge_name: args.judge_name,
        });

      case 'check_cached_pin':
        return Promise.resolve({
          tournament_id: 1,
          pin_code: args.pin_code,
        });

      // Tournament commands
      case 'get_tournaments':
        return Promise.resolve([
          {
            id: 1,
            name: 'Test Tournament',
            start_date: '2025-12-20',
            end_date: '2025-12-21',
            location: 'Test Location',
            status: 'upcoming',
          },
        ]);

      case 'download_tournament':
        return Promise.resolve({ success: true });

      case 'get_cached_brackets':
        return Promise.resolve([
          {
            id: 1,
            name: 'Bracket 1',
            type: 'single_elimination',
            is_occupied: false,
          },
        ]);

      // Match commands
      case 'get_bracket_matches':
        return Promise.resolve([
          {
            id: 1,
            bracket_id: 1,
            red_participant: { id: 1, full_name: 'Иванов Иван' },
            blue_participant: { id: 2, full_name: 'Петров Петр' },
            red_score: 0,
            blue_score: 0,
            status: 'pending',
          },
        ]);

      case 'start_match':
      case 'update_match_score':
      case 'finish_match':
      case 'batch_update_match':
        return Promise.resolve({ success: true });

      case 'record_match_event':
        return Promise.resolve({ id: 1 });

      case 'get_match_events':
        return Promise.resolve([]);

      // Sync commands
      case 'sync_changes':
        return Promise.resolve({ synced_count: 0 });

      // Local server commands
      case 'start_local_server':
      case 'stop_local_server':
        return Promise.resolve({ success: true });

      case 'is_local_server_running':
        return Promise.resolve(false);

      case 'get_available_monitors':
        return Promise.resolve([
          { id: 0, name: 'Primary', width: 1920, height: 1080, x: 0, y: 0 },
        ]);

      default:
        return Promise.reject(new Error(`Unknown command: ${cmd}`));
    }
  });
};
