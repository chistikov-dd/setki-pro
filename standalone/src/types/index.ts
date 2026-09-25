// Базовые типы (адаптировано из основного проекта desktop_setki/src/types/index.ts,
// урезано: убраны все типы, завязанные на логин/PIN/сетевую сессию)

export interface Tournament {
  id: number;
  title: string;
  sport_id?: number;
  start_date?: string;
  location?: string;
}

export interface Category {
  id: number | null;
  name: string;
}

export interface Bracket {
  id: number;
  category_id: number | null;
  category_name: string;
  bracket_type: 'single_elimination' | 'double_elimination' | 'round_robin';
  total_rounds: number;
  status: 'not_started' | 'in_progress' | 'completed';
  gender?: string;
  sport_name?: string;
  min_weight?: number;
  max_weight?: number;
  is_published?: boolean;
}

export interface Participant {
  id: number;
  fighter_id: number;
  full_name: string;
  club_name?: string;
  final_weight?: number;
  is_confirmed?: boolean;
}

export interface Match {
  id: number;
  bracket_id: number;
  participant1?: Participant;
  participant2?: Participant;
  winner_id?: number;
  round_number: number;
  match_number: number;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  score_participant1: number;
  score_participant2: number;
  warnings_participant1: number;
  warnings_participant2: number;
  result_type?: 'points' | 'submission' | 'disqualification';
}

// Информация о следующем матче для судьи
export interface NextMatch {
  match: Match;
  roundName: string;
}

// Конфигурация начисления баллов
export interface ScoringAction {
  name: string;
  points: number;
  color: string;
  key: string;
}

export interface ScoringConfig {
  sport_id: number;
  actions: ScoringAction[];
  warnings: {
    enabled: boolean;
    max_count: number;
  };
}

// Загруженный локально файл турнира (замена сетевой TournamentSession)
export interface LoadedTournamentFile {
  tournament: Tournament;
  brackets: Bracket[];
  scoring_config: ScoringConfig;
  judge_name?: string; // опционально, только для подписи PDF-отчётов
}

// События в поединке (для истории/undo)
export interface MatchEvent {
  id?: number;
  match_id: number;
  event_type: 'score' | 'warning' | 'disqualify' | 'timer' | 'submission';
  participant: 'red' | 'blue';
  points?: number;
  action_name?: string;
  timestamp: number;
}

// Тип завершения поединка
export type FinishType = 'time' | 'submission_red' | 'submission_blue' | 'disqualification';

export interface FinishMatchData {
  type: FinishType;
  winner_id?: number;
  disqualified_participant?: 'red' | 'blue';
}

// Дефолтная конфигурация начисления баллов, используется если JSON турнира
// не содержит явную scoring_config (текущий продовый JSON её не отдаёт).
export const DEFAULT_SCORING_CONFIG: ScoringConfig = {
  sport_id: 0,
  actions: [
    { name: '+1', points: 1, color: 'gray', key: 'Q/1' },
    { name: '+2', points: 2, color: 'gray', key: 'W/2' },
    { name: '+3', points: 3, color: 'gray', key: 'E/3' },
    { name: '+4', points: 4, color: 'gray', key: 'R/4' },
  ],
  warnings: {
    enabled: true,
    max_count: 3,
  },
};
