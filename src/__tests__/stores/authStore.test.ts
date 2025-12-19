import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAuthStore } from '../../stores/authStore';
import * as api from '../../services/api';
import type { AuthResponse } from '../../types';

// Mock API
vi.mock('../../services/api', () => ({
  loginAdmin: vi.fn(),
  loginByPin: vi.fn(),
  logout: vi.fn(),
  clearAllReservations: vi.fn(),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  LOG_CATEGORIES: {
    AUTH: 'AUTH',
  },
}));

describe('authStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAuthStore.setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });

    // Clear all mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clear localStorage
    localStorage.clear();
  });

  describe('initial state', () => {
    it('should have correct initial values', () => {
      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe('loginAsAdmin', () => {
    const mockAdminResponse: AuthResponse = {
      access_token: 'admin-token-123',
      user_id: 1,
      role: 'admin',
      tournament_id: 100,
    };

    it('should successfully login as admin', async () => {
      vi.mocked(api.loginAdmin).mockResolvedValue(mockAdminResponse);

      const { loginAsAdmin } = useAuthStore.getState();

      await loginAsAdmin('admin', 'password123');

      const state = useAuthStore.getState();

      expect(state.user).toEqual(mockAdminResponse);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should set loading state during login', async () => {
      vi.mocked(api.loginAdmin).mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockAdminResponse), 100);
          })
      );

      const { loginAsAdmin } = useAuthStore.getState();

      const loginPromise = loginAsAdmin('admin', 'password123');

      // Check loading state immediately
      expect(useAuthStore.getState().isLoading).toBe(true);

      await loginPromise;

      // Loading should be false after completion
      expect(useAuthStore.getState().isLoading).toBe(false);
    });

    it('should handle login failure', async () => {
      const error = new Error('Invalid credentials');
      vi.mocked(api.loginAdmin).mockRejectedValue(error);

      const { loginAsAdmin } = useAuthStore.getState();

      await expect(loginAsAdmin('admin', 'wrong')).rejects.toThrow();

      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeTruthy();
    });

    it('should call API with correct parameters', async () => {
      vi.mocked(api.loginAdmin).mockResolvedValue(mockAdminResponse);

      const { loginAsAdmin } = useAuthStore.getState();

      await loginAsAdmin('testuser', 'testpass');

      expect(api.loginAdmin).toHaveBeenCalledWith({
        login: 'testuser',
        password: 'testpass',
      });
    });

    it('should clear previous error on new login attempt', async () => {
      // Set initial error state
      useAuthStore.setState({ error: 'Previous error' });

      vi.mocked(api.loginAdmin).mockResolvedValue(mockAdminResponse);

      const { loginAsAdmin } = useAuthStore.getState();

      await loginAsAdmin('admin', 'password');

      expect(useAuthStore.getState().error).toBeNull();
    });
  });

  describe('loginAsJudge', () => {
    const mockJudgeResponse: AuthResponse = {
      access_token: 'judge-token-456',
      user_id: 2,
      role: 'judge',
      tournament_id: 100,
      judge_name: 'Иван Судейкин',
    };

    it('should successfully login as judge', async () => {
      vi.mocked(api.loginByPin).mockResolvedValue(mockJudgeResponse);
      vi.mocked(api.clearAllReservations).mockResolvedValue(undefined);

      const { loginAsJudge } = useAuthStore.getState();

      await loginAsJudge('123456', 'Иван Судейкин');

      const state = useAuthStore.getState();

      expect(state.user).toEqual(mockJudgeResponse);
      expect(state.isAuthenticated).toBe(true);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should call clearAllReservations on judge login', async () => {
      vi.mocked(api.loginByPin).mockResolvedValue(mockJudgeResponse);
      vi.mocked(api.clearAllReservations).mockResolvedValue(undefined);

      const { loginAsJudge } = useAuthStore.getState();

      await loginAsJudge('123456', 'Иван Судейкин');

      expect(api.clearAllReservations).toHaveBeenCalled();
    });

    it('should handle clearAllReservations failure gracefully', async () => {
      vi.mocked(api.loginByPin).mockResolvedValue(mockJudgeResponse);
      vi.mocked(api.clearAllReservations).mockRejectedValue(
        new Error('Failed to clear')
      );

      const { loginAsJudge } = useAuthStore.getState();

      // Should not throw even if clearAllReservations fails
      await expect(loginAsJudge('123456', 'Иван Судейкин')).resolves.not.toThrow();

      // Login should still succeed
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('should handle judge login failure', async () => {
      const error = new Error('Invalid PIN');
      vi.mocked(api.loginByPin).mockRejectedValue(error);

      const { loginAsJudge } = useAuthStore.getState();

      await expect(loginAsJudge('000000', 'Test Judge')).rejects.toThrow();

      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeTruthy();
    });

    it('should call API with correct parameters', async () => {
      vi.mocked(api.loginByPin).mockResolvedValue(mockJudgeResponse);
      vi.mocked(api.clearAllReservations).mockResolvedValue(undefined);

      const { loginAsJudge } = useAuthStore.getState();

      await loginAsJudge('654321', 'Петр Судейкин');

      expect(api.loginByPin).toHaveBeenCalledWith({
        pin_code: '654321',
        judge_name: 'Петр Судейкин',
      });
    });
  });

  describe('logout', () => {
    it('should clear user state on logout', () => {
      // Set authenticated state
      useAuthStore.setState({
        user: {
          access_token: 'token',
          user_id: 1,
          role: 'admin',
        },
        isAuthenticated: true,
      });

      const { logout } = useAuthStore.getState();

      logout();

      const state = useAuthStore.getState();

      expect(state.user).toBeNull();
      expect(state.isAuthenticated).toBe(false);
      expect(state.error).toBeNull();
    });

    it('should call API logout', () => {
      useAuthStore.setState({
        user: {
          access_token: 'token',
          user_id: 1,
          role: 'admin',
        },
        isAuthenticated: true,
      });

      const { logout } = useAuthStore.getState();

      logout();

      expect(api.logout).toHaveBeenCalled();
    });

    it('should work even when not authenticated', () => {
      const { logout } = useAuthStore.getState();

      expect(() => logout()).not.toThrow();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('clearError', () => {
    it('should clear error state', () => {
      useAuthStore.setState({ error: 'Some error message' });

      const { clearError } = useAuthStore.getState();

      clearError();

      expect(useAuthStore.getState().error).toBeNull();
    });

    it('should not affect other state', () => {
      const initialUser = {
        access_token: 'token',
        user_id: 1,
        role: 'admin' as const,
      };

      useAuthStore.setState({
        user: initialUser,
        isAuthenticated: true,
        error: 'Error message',
      });

      const { clearError } = useAuthStore.getState();

      clearError();

      const state = useAuthStore.getState();

      expect(state.user).toEqual(initialUser);
      expect(state.isAuthenticated).toBe(true);
      expect(state.error).toBeNull();
    });
  });

  describe('restoreSession', () => {
    it('should restore authenticated state if user has token', () => {
      useAuthStore.setState({
        user: {
          access_token: 'existing-token',
          user_id: 1,
          role: 'admin',
        },
        isAuthenticated: false,
      });

      const { restoreSession } = useAuthStore.getState();

      restoreSession();

      expect(useAuthStore.getState().isAuthenticated).toBe(true);
    });

    it('should not restore if no user', () => {
      useAuthStore.setState({
        user: null,
        isAuthenticated: false,
      });

      const { restoreSession } = useAuthStore.getState();

      restoreSession();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    it('should not restore if user has no token', () => {
      useAuthStore.setState({
        user: {
          access_token: '',
          user_id: 1,
          role: 'admin',
        },
        isAuthenticated: false,
      });

      const { restoreSession } = useAuthStore.getState();

      restoreSession();

      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });
  });

  describe('persistence', () => {
    it('should persist user to localStorage', async () => {
      const mockUser: AuthResponse = {
        access_token: 'token-123',
        user_id: 1,
        role: 'admin',
        tournament_id: 100,
      };

      vi.mocked(api.loginAdmin).mockResolvedValue(mockUser);

      const { loginAsAdmin } = useAuthStore.getState();

      await loginAsAdmin('admin', 'password');

      // Check localStorage
      const stored = localStorage.getItem('auth-storage');
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        expect(parsed.state.user).toEqual(mockUser);
      }
    });

    it('should not persist isAuthenticated or isLoading', async () => {
      const mockUser: AuthResponse = {
        access_token: 'token-123',
        user_id: 1,
        role: 'admin',
      };

      vi.mocked(api.loginAdmin).mockResolvedValue(mockUser);

      const { loginAsAdmin } = useAuthStore.getState();

      await loginAsAdmin('admin', 'password');

      const stored = localStorage.getItem('auth-storage');
      expect(stored).toBeTruthy();

      if (stored) {
        const parsed = JSON.parse(stored);
        // Only user should be persisted
        expect(parsed.state.user).toBeDefined();
        expect(parsed.state.isAuthenticated).toBeUndefined();
        expect(parsed.state.isLoading).toBeUndefined();
      }
    });
  });
});
