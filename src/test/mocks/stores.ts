import { vi } from 'vitest';
import type { AuthState } from '@/stores/authStore';
import type { SessionState } from '@/stores/sessionStore';
import type { MatchState } from '@/stores/matchStore';

/**
 * Mock authStore with default values
 */
export const createMockAuthStore = (overrides?: Partial<AuthState>): AuthState => ({
  user: null,
  isAuthenticated: false,
  loginAsAdmin: vi.fn(),
  loginAsJudge: vi.fn(),
  logout: vi.fn(),
  ...overrides,
});

/**
 * Mock sessionStore with default values
 */
export const createMockSessionStore = (
  overrides?: Partial<SessionState>
): SessionState => ({
  tournaments: [],
  currentSession: null,
  isLoading: false,
  error: null,
  loadTournaments: vi.fn(),
  createSession: vi.fn(),
  clearSession: vi.fn(),
  setError: vi.fn(),
  ...overrides,
});

/**
 * Mock matchStore with default values
 */
export const createMockMatchStore = (
  overrides?: Partial<MatchState>
): MatchState => ({
  matchId: null,
  bracketId: null,
  redFighter: null,
  blueFighter: null,
  redScore: 0,
  blueScore: 0,
  redWarnings: 0,
  blueWarnings: 0,
  maxWarnings: 3,
  scoringActions: [],
  status: 'pending',
  lastUpdateTimestamp: null,
  initMatch: vi.fn(),
  addScore: vi.fn(),
  removeScore: vi.fn(),
  addWarning: vi.fn(),
  removeWarning: vi.fn(),
  startMatch: vi.fn(),
  finishMatch: vi.fn(),
  resetMatch: vi.fn(),
  resetAll: vi.fn(),
  applyRemoteUpdate: vi.fn(),
  ...overrides,
});

/**
 * Mock authenticated admin user
 */
export const mockAdminUser = {
  id: 1,
  login: 'admin',
  role: 'admin' as const,
};

/**
 * Mock authenticated judge user
 */
export const mockJudgeUser = {
  id: 2,
  login: 'judge_pin',
  role: 'judge' as const,
  judgeName: 'Иванов Иван',
};

/**
 * Mock tournament data
 */
export const mockTournament = {
  id: 1,
  name: 'Test Tournament',
  start_date: '2025-12-20',
  end_date: '2025-12-21',
  location: 'Test Location',
  status: 'upcoming' as const,
};

/**
 * Mock bracket data
 */
export const mockBracket = {
  id: 1,
  tournament_id: 1,
  name: 'Мужчины -70 кг',
  type: 'single_elimination' as const,
  is_occupied: false,
};

/**
 * Mock match data
 */
export const mockMatch = {
  id: 1,
  bracket_id: 1,
  red_participant: {
    id: 1,
    full_name: 'Иванов Иван Петрович',
  },
  blue_participant: {
    id: 2,
    full_name: 'Петров Петр Сергеевич',
  },
  red_score: 0,
  blue_score: 0,
  red_warnings: 0,
  blue_warnings: 0,
  status: 'pending' as const,
  duration: 180,
};

/**
 * Mock scoring config
 */
export const mockScoringConfig = {
  sport_id: 1,
  actions: [
    { id: 1, name: 'Бросок', points: 1, color: 'blue', key: '1' },
    { id: 2, name: 'Удержание', points: 2, color: 'blue', key: '2' },
    { id: 3, name: 'Болевой', points: 3, color: 'red', key: 'q' },
    { id: 4, name: 'Удушающий', points: 4, color: 'red', key: 'w' },
  ],
  warnings: {
    enabled: true,
    max_count: 3,
  },
};
