import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSessionStore } from '../../stores/sessionStore';
import * as api from '../../services/api';
import type { TournamentBriefResponse, TournamentSession } from '../../types';

// Mock API
vi.mock('../../services/api', () => ({
  getTournaments: vi.fn(),
  getTournamentDetails: vi.fn(),
}));

describe('sessionStore', () => {
  const mockTournaments: TournamentBriefResponse[] = [
    {
      id: 100,
      name: 'Турнир 1',
      start_date: '2025-01-15',
      end_date: '2025-01-17',
      location: 'Москва',
      status: 'active',
      image_url: null,
    },
    {
      id: 101,
      name: 'Турнир 2',
      start_date: '2025-02-10',
      end_date: '2025-02-12',
      location: 'СПб',
      status: 'upcoming',
      image_url: null,
    },
  ];

  const mockSession: TournamentSession = {
    tournament_id: 100,
    pin_code: '123456',
    scoring_config: {
      sport_id: 1,
      actions: [
        { name: 'Takedown', points: 2, color: 'blue', key: '1' },
        { name: 'Guard Pass', points: 3, color: 'green', key: '2' },
      ],
      warnings: {
        enabled: true,
        max_count: 3,
      },
    },
  };

  beforeEach(() => {
    // Reset store state
    useSessionStore.setState({
      tournaments: [],
      currentSession: null,
      isLoading: false,
      error: null,
    });

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('initial state', () => {
    it('should have correct initial values', () => {
      const state = useSessionStore.getState();

      expect(state.tournaments).toEqual([]);
      expect(state.currentSession).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('loadTournaments', () => {
    it('should load tournaments successfully', async () => {
      vi.mocked(api.getTournaments).mockResolvedValue(mockTournaments);

      const { loadTournaments } = useSessionStore.getState();

      await loadTournaments();

      const state = useSessionStore.getState();

      expect(state.tournaments).toEqual(mockTournaments);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should set loading state during load', async () => {
      vi.mocked(api.getTournaments).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockTournaments), 100);
          })
      );

      const { loadTournaments } = useSessionStore.getState();

      const loadPromise = loadTournaments();

      // Check loading state immediately
      expect(useSessionStore.getState().isLoading).toBe(true);

      await loadPromise;

      // Loading should be false after completion
      expect(useSessionStore.getState().isLoading).toBe(false);
    });

    it('should handle load failure', async () => {
      const error = new Error('Network error');
      vi.mocked(api.getTournaments).mockRejectedValue(error);

      const { loadTournaments } = useSessionStore.getState();

      await expect(loadTournaments()).rejects.toThrow();

      const state = useSessionStore.getState();

      expect(state.tournaments).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeTruthy();
    });

    it('should call API getTournaments', async () => {
      vi.mocked(api.getTournaments).mockResolvedValue(mockTournaments);

      const { loadTournaments } = useSessionStore.getState();

      await loadTournaments();

      expect(api.getTournaments).toHaveBeenCalled();
    });

    it('should clear previous error on new load attempt', async () => {
      // Set initial error state
      useSessionStore.setState({ error: 'Previous error' });

      vi.mocked(api.getTournaments).mockResolvedValue(mockTournaments);

      const { loadTournaments } = useSessionStore.getState();

      await loadTournaments();

      expect(useSessionStore.getState().error).toBeNull();
    });
  });

  describe('loadTournamentSession', () => {
    it('should load tournament session successfully', async () => {
      vi.mocked(api.getTournamentDetails).mockResolvedValue(mockSession);

      const { loadTournamentSession } = useSessionStore.getState();

      const result = await loadTournamentSession(100);

      expect(result).toEqual(mockSession);

      const state = useSessionStore.getState();

      expect(state.currentSession).toEqual(mockSession);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should set loading state during load', async () => {
      vi.mocked(api.getTournamentDetails).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockSession), 100);
          })
      );

      const { loadTournamentSession } = useSessionStore.getState();

      const loadPromise = loadTournamentSession(100);

      // Check loading state immediately
      expect(useSessionStore.getState().isLoading).toBe(true);

      await loadPromise;

      // Loading should be false after completion
      expect(useSessionStore.getState().isLoading).toBe(false);
    });

    it('should handle session load failure', async () => {
      const error = new Error('Tournament not found');
      vi.mocked(api.getTournamentDetails).mockRejectedValue(error);

      const { loadTournamentSession } = useSessionStore.getState();

      await expect(loadTournamentSession(999)).rejects.toThrow();

      const state = useSessionStore.getState();

      expect(state.currentSession).toBeNull();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeTruthy();
    });

    it('should call API with correct tournament ID', async () => {
      vi.mocked(api.getTournamentDetails).mockResolvedValue(mockSession);

      const { loadTournamentSession } = useSessionStore.getState();

      await loadTournamentSession(100);

      expect(api.getTournamentDetails).toHaveBeenCalledWith(100);
    });

    it('should return session data', async () => {
      vi.mocked(api.getTournamentDetails).mockResolvedValue(mockSession);

      const { loadTournamentSession } = useSessionStore.getState();

      const result = await loadTournamentSession(100);

      expect(result).toEqual(mockSession);
      expect(result.pin_code).toBe('123456');
      expect(result.scoring_config).toBeDefined();
    });
  });

  describe('clearSession', () => {
    it('should clear current session', () => {
      // Set session
      useSessionStore.setState({
        currentSession: mockSession,
      });

      const { clearSession } = useSessionStore.getState();

      clearSession();

      const state = useSessionStore.getState();

      expect(state.currentSession).toBeNull();
      expect(state.error).toBeNull();
    });

    it('should not affect tournaments list', () => {
      useSessionStore.setState({
        tournaments: mockTournaments,
        currentSession: mockSession,
      });

      const { clearSession } = useSessionStore.getState();

      clearSession();

      const state = useSessionStore.getState();

      expect(state.tournaments).toEqual(mockTournaments);
      expect(state.currentSession).toBeNull();
    });

    it('should work even when session is null', () => {
      const { clearSession } = useSessionStore.getState();

      expect(() => clearSession()).not.toThrow();

      expect(useSessionStore.getState().currentSession).toBeNull();
    });
  });

  describe('clearError', () => {
    it('should clear error state', () => {
      useSessionStore.setState({ error: 'Some error message' });

      const { clearError } = useSessionStore.getState();

      clearError();

      expect(useSessionStore.getState().error).toBeNull();
    });

    it('should not affect other state', () => {
      useSessionStore.setState({
        tournaments: mockTournaments,
        currentSession: mockSession,
        error: 'Error message',
      });

      const { clearError } = useSessionStore.getState();

      clearError();

      const state = useSessionStore.getState();

      expect(state.tournaments).toEqual(mockTournaments);
      expect(state.currentSession).toEqual(mockSession);
      expect(state.error).toBeNull();
    });
  });

  describe('persistence', () => {
    it('should persist currentSession to localStorage', async () => {
      vi.mocked(api.getTournamentDetails).mockResolvedValue(mockSession);

      const { loadTournamentSession } = useSessionStore.getState();

      await loadTournamentSession(100);

      // Check localStorage
      const stored = localStorage.getItem('session-storage');
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        expect(parsed.state.currentSession).toEqual(mockSession);
      }
    });

    it('should not persist tournaments list', async () => {
      vi.mocked(api.getTournaments).mockResolvedValue(mockTournaments);

      const { loadTournaments } = useSessionStore.getState();

      await loadTournaments();

      const stored = localStorage.getItem('session-storage');
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        // Only currentSession should be persisted
        expect(parsed.state.currentSession).toBeDefined();
        expect(parsed.state.tournaments).toBeUndefined();
      }
    });

    it('should not persist isLoading or error', async () => {
      vi.mocked(api.getTournamentDetails).mockResolvedValue(mockSession);

      const { loadTournamentSession } = useSessionStore.getState();

      await loadTournamentSession(100);

      const stored = localStorage.getItem('session-storage');
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        expect(parsed.state.isLoading).toBeUndefined();
        expect(parsed.state.error).toBeUndefined();
      }
    });
  });

  describe('scoring config', () => {
    it('should load scoring config with session', async () => {
      vi.mocked(api.getTournamentDetails).mockResolvedValue(mockSession);

      const { loadTournamentSession } = useSessionStore.getState();

      await loadTournamentSession(100);

      const state = useSessionStore.getState();

      expect(state.currentSession?.scoring_config).toBeDefined();
      expect(state.currentSession?.scoring_config.actions).toHaveLength(2);
      expect(state.currentSession?.scoring_config.warnings.enabled).toBe(true);
      expect(state.currentSession?.scoring_config.warnings.max_count).toBe(3);
    });
  });
});
