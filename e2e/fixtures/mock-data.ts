import type { Tournament, Bracket, Match, AuthResponse } from '../../src/types';

/**
 * Mock data for E2E tests
 */

export const mockAdminAuthResponse: AuthResponse = {
  access_token: 'mock-admin-token-123',
  user_id: 1,
  role: 'admin',
  tournament_id: 100,
};

export const mockJudgeAuthResponse: AuthResponse = {
  access_token: 'mock-judge-token-456',
  user_id: 2,
  role: 'judge',
  tournament_id: 100,
  judge_name: 'Иван Судейкин',
};

export const mockTournament: Tournament = {
  id: 100,
  name: 'Тестовый Турнир 2025',
  start_date: '2025-01-15',
  end_date: '2025-01-17',
  location: 'Москва, Спортивный комплекс',
  status: 'active',
  image_url: null,
  description: 'Турнир для E2E тестирования',
};

export const mockTournaments: Tournament[] = [
  mockTournament,
  {
    id: 101,
    name: 'Второй Турнир 2025',
    start_date: '2025-02-10',
    end_date: '2025-02-12',
    location: 'Санкт-Петербург',
    status: 'upcoming',
    image_url: null,
    description: null,
  },
];

export const mockBrackets: Bracket[] = [
  {
    id: 1,
    tournament_id: 100,
    name: 'Мужчины -60 кг',
    type: 'single_elimination',
    weight_category: '60',
    gender: 'male',
    age_group: 'adults',
    total_matches: 7,
    completed_matches: 0,
    is_occupied: false,
  },
  {
    id: 2,
    tournament_id: 100,
    name: 'Женщины -55 кг',
    type: 'single_elimination',
    weight_category: '55',
    gender: 'female',
    age_group: 'adults',
    total_matches: 3,
    completed_matches: 0,
    is_occupied: false,
  },
  {
    id: 3,
    tournament_id: 100,
    name: 'Мужчины -70 кг (занято)',
    type: 'double_elimination',
    weight_category: '70',
    gender: 'male',
    age_group: 'adults',
    total_matches: 15,
    completed_matches: 5,
    is_occupied: true,
  },
];

export const mockMatches: Match[] = [
  {
    id: 1001,
    bracket_id: 1,
    round: 1,
    match_number: 1,
    red_participant: {
      id: 501,
      full_name: 'Иванов Иван Иванович',
      weight: '58.5',
      team: 'Спартак',
    },
    blue_participant: {
      id: 502,
      full_name: 'Петров Петр Петрович',
      weight: '59.2',
      team: 'Динамо',
    },
    red_score: 0,
    blue_score: 0,
    red_warnings: 0,
    blue_warnings: 0,
    status: 'pending',
    duration: 180,
    winner_id: null,
    scheduled_time: null,
    actual_start_time: null,
    actual_end_time: null,
  },
  {
    id: 1002,
    bracket_id: 1,
    round: 1,
    match_number: 2,
    red_participant: {
      id: 503,
      full_name: 'Сидоров Сидор Сидорович',
      weight: '60.0',
      team: 'Торпедо',
    },
    blue_participant: {
      id: 504,
      full_name: 'Александров Александр Александрович',
      weight: '59.8',
      team: 'ЦСКА',
    },
    red_score: 0,
    blue_score: 0,
    red_warnings: 0,
    blue_warnings: 0,
    status: 'pending',
    duration: 180,
    winner_id: null,
    scheduled_time: null,
    actual_start_time: null,
    actual_end_time: null,
  },
];

export const mockSession = {
  tournament_id: 100,
  pin_code: '123456',
  created_at: new Date().toISOString(),
};

export const mockJudgeSessions = [
  {
    id: 1,
    judge_name: 'Иван Судейкин',
    pin_code: '123456',
    tournament_id: 100,
    login_time: new Date().toISOString(),
    bracket_id: 1,
    bracket_name: 'Мужчины -60 кг',
  },
  {
    id: 2,
    judge_name: 'Мария Арбитрова',
    pin_code: '123456',
    tournament_id: 100,
    login_time: new Date(Date.now() - 600000).toISOString(), // 10 минут назад
    bracket_id: null,
    bracket_name: null,
  },
];

export const mockActiveMatches = [
  {
    id: 1001,
    bracket_name: 'Мужчины -60 кг',
    judge_name: 'Иван Судейкин',
    red_fighter: 'Иванов Иван',
    blue_fighter: 'Петров Петр',
    red_score: 4,
    blue_score: 2,
    red_warnings: 1,
    blue_warnings: 0,
    status: 'in_progress',
  },
];
