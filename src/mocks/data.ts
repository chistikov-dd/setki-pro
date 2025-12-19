import type {
  Tournament,
  Category,
  Bracket,
  Participant,
  Match,
  ScoringConfig,
  TournamentSession
} from '../types';

// Конфигурация баллов для BJJ
export const mockScoringConfig: ScoringConfig = {
  sport_id: 1,
  actions: [
    { name: 'Takedown', points: 2, color: '#3b82f6', key: '1' },
    { name: 'Guard Pass', points: 3, color: '#8b5cf6', key: '2' },
    { name: 'Mount', points: 4, color: '#ec4899', key: '3' },
    { name: 'Back Control', points: 4, color: '#f59e0b', key: '4' },
  ],
  warnings: {
    enabled: true,
    max_count: 3,
  }
};

// Турнир
export const mockTournament: Tournament = {
  id: 1,
  title: 'Открытый турнир по БЖЖ 2025',
  sport_id: 1,
  start_date: '2025-01-15',
  location: 'Москва, СК "Олимпийский"',
  status: 'in_progress',
};

// Категории
export const mockCategories: Category[] = [
  {
    id: 1,
    tournament_id: 1,
    name: 'Мужчины 18-29 лет, до 77 кг, Gi',
    gender: 'male',
    min_age: 18,
    max_age: 29,
    min_weight: 70,
    max_weight: 77,
  },
  {
    id: 2,
    tournament_id: 1,
    name: 'Женщины 18-29 лет, до 62 кг, No-Gi',
    gender: 'female',
    min_age: 18,
    max_age: 29,
    min_weight: 55,
    max_weight: 62,
  },
  {
    id: 3,
    tournament_id: 1,
    name: 'Мужчины 30-39 лет, до 85 кг, Gi',
    gender: 'male',
    min_age: 30,
    max_age: 39,
    min_weight: 77,
    max_weight: 85,
  },
];

// Участники
export const mockParticipants: Participant[] = [
  {
    id: 1,
    fighter_id: 101,
    full_name: 'Иванов Петр Сергеевич',
    club_name: 'Клуб А',
    final_weight: 75.5,
  },
  {
    id: 2,
    fighter_id: 102,
    full_name: 'Сидоров Алексей Иванович',
    club_name: 'Клуб Б',
    final_weight: 76.2,
  },
  {
    id: 3,
    fighter_id: 103,
    full_name: 'Петрова Анна Владимировна',
    club_name: 'Клуб В',
    final_weight: 60.8,
  },
  {
    id: 4,
    fighter_id: 104,
    full_name: 'Смирнова Екатерина Дмитриевна',
    club_name: 'Клуб Г',
    final_weight: 61.5,
  },
];

// Сетки
export const mockBrackets: Bracket[] = [
  {
    id: 1,
    category_id: 1,
    bracket_type: 'single_elimination',
    total_rounds: 3,
    current_round: 2,
    status: 'in_progress',
    category: mockCategories[0],
    occupied_by_table: undefined,
    occupied_by_judge: undefined,
  },
  {
    id: 2,
    category_id: 2,
    bracket_type: 'single_elimination',
    total_rounds: 2,
    current_round: 1,
    status: 'in_progress',
    category: mockCategories[1],
    occupied_by_table: 2,
    occupied_by_judge: 'Смирнов А.А.',
  },
  {
    id: 3,
    category_id: 3,
    bracket_type: 'single_elimination',
    total_rounds: 3,
    current_round: 1,
    status: 'not_started',
    category: mockCategories[2],
    occupied_by_table: undefined,
    occupied_by_judge: undefined,
  },
];

// Поединок
export const mockMatch: Match = {
  id: 1,
  bracket_id: 1,
  participant1: mockParticipants[0],
  participant2: mockParticipants[1],
  winner_id: undefined,
  round_number: 2,
  match_number: 1,
  status: 'in_progress',
  score_participant1: 12,
  score_participant2: 8,
  warnings_participant1: 1,
  warnings_participant2: 0,
  result_type: undefined,
};

// Сессия турнира
export const mockSession: TournamentSession = {
  id: 1,
  tournament_id: 1,
  pin_code: '123456',
  total_tables: 5,
  admin_user_id: 1,
  tournament: mockTournament,
  brackets: mockBrackets,
  scoring_config: mockScoringConfig,
};
