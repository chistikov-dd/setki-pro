// Базовые типы
export interface Tournament {
  id: number;
  title: string;
  sport_id: number;
  start_date: string;
  location: string;
  status: 'draft' | 'published' | 'registration_open' | 'registration_closed' | 'in_progress' | 'completed';
}

export interface Category {
  id: number;
  tournament_id: number;
  name: string;
  gender: 'male' | 'female' | 'mixed';
  min_age?: number;
  max_age?: number;
  min_weight?: number;
  max_weight?: number;
}

export interface Bracket {
  id: number;
  category_id: number;
  bracket_type: 'single_elimination' | 'double_elimination' | 'round_robin';
  total_rounds: number;
  current_round: number;
  status: 'not_started' | 'in_progress' | 'completed';
  category: Category;
  occupied_by_table?: number; // Номер стола, который занял сетку
  occupied_by_judge?: string; // Имя судьи
}

export interface Participant {
  id: number;
  fighter_id: number;
  full_name: string;
  club_name?: string;
  final_weight?: number;
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

// Конфигурация начисления баллов
export interface ScoringAction {
  name: string;
  points: number;
  color: string;
  key: string; // Горячая клавиша
}

export interface ScoringConfig {
  sport_id: number;
  actions: ScoringAction[];
  warnings: {
    enabled: boolean;
    max_count: number;
  };
}

// Сессия турнира (для desktop приложения)
export interface TournamentSession {
  id: number;
  tournament_id: number;
  pin_code: string;
  total_tables: number;
  admin_user_id: number;
  tournament: Tournament;
  brackets: Bracket[];
  scoring_config: ScoringConfig;
}

// Стол судьи
export interface JudgeTable {
  id: number;
  session_id: number;
  table_number: number;
  judge_name?: string;
  bracket_id?: number;
  is_occupied: boolean;
}

// События в поединке (для истории)
export interface MatchEvent {
  id?: number;
  match_id: number;
  event_type: 'score' | 'warning' | 'disqualify' | 'timer' | 'submission';
  participant: 'red' | 'blue';
  points?: number;
  action_name?: string;
  timestamp: number;
}

// Состояние поединка
export interface MatchState {
  match: Match;
  timer: {
    total_seconds: number;
    remaining_seconds: number;
    is_running: boolean;
  };
  red_fighter: Participant;
  blue_fighter: Participant;
  red_score: number;
  blue_score: number;
  red_warnings: number;
  blue_warnings: number;
  events: MatchEvent[];
}

// Тип завершения поединка
export type FinishType = 'time' | 'submission_red' | 'submission_blue' | 'disqualification';

export interface FinishMatchData {
  type: FinishType;
  winner_id?: number;
  disqualified_participant?: 'red' | 'blue';
}

// ============================================
// API Types (Backend Integration)
// ============================================

// Auth
export interface LoginRequest {
  login: string;
  password: string;
}

export interface PinLoginRequest {
  pin_code: string;
}

export interface AuthResponse {
  access_token: string;
  user_id: number;
  role: 'organizer' | 'referee' | 'admin';
  tournament_id?: number;
  judge_name?: string; // Имя судьи (только для referee)
  table_number?: number; // Номер стола (только для referee)
}

// Tournament API Responses
export interface TournamentBriefResponse {
  id: number;
  name: string;
  start_date?: string;
  end_date?: string;
  status: string;
  image_url?: string;
  organizer_id: number;
  brackets_count: number;
  created_at: string;
  updated_at: string;
}

export interface TournamentDetailResponse extends TournamentBriefResponse {
  description?: string;
  scoring_config?: ScoringConfig;
}

export interface TournamentPinResponse {
  id: number;
  tournament_id: number;
  pin_code: string;
  created_at: string;
  expires_at?: string;
  is_active: boolean;
}

// Bracket API Responses
export interface BracketResponse {
  id: number;
  category_id: number;
  category_name: string;
  bracket_type: 'single_elimination' | 'double_elimination' | 'round_robin';
  total_rounds?: number;
  current_round: number;
  status: 'not_started' | 'in_progress' | 'completed';
  is_published: boolean;
  split_criteria?: Record<string, unknown>;
  // Данные категории для фильтрации
  sport_id?: number;
  sport_name?: string;
  gender?: 'male' | 'female' | 'mixed';
  min_age?: number;
  max_age?: number;
  min_weight?: number;
  max_weight?: number;
  characteristic_filters?: Array<{ key: string; value: string }>;
  characteristics_schema?: Array<{
    key: string;
    label: string;
    type: string;
    use_as_category_tag?: boolean;
    options?: Array<{ value: string; label: string }>;
  }>;
  // Опциональные вложенные матчи (возвращаются локальным сервером)
  matches?: MatchResponse[];
}

// Match API Responses
export interface MatchResponse {
  id: number;
  bracket_id: number;
  round_number: number;
  match_number: number;
  participant1_id?: number;
  fighter1_name?: string;
  participant2_id?: number;
  fighter2_name?: string;
  winner_id?: number;
  status: 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
  score_participant1?: number;
  score_participant2?: number;
  result_type?: 'points' | 'submission' | 'advantages' | 'disqualification' | 'no_contest';
}

// Table API Responses
export interface CreateTableRequest {
  tournament_id: number;
  table_number: number;
}

export interface AssignTableRequest {
  bracket_id: number;
}

export interface TournamentTableResponse {
  id: number;
  tournament_id: number;
  table_number: number;
  bracket_id?: number;
  bracket_name?: string;
  assigned_user_id?: number;
  assigned_user_name?: string;
  assigned_at?: string;
}

// Sync API
export interface SyncMatchRequest {
  match_id: number;
  fighter1_score: number;
  fighter2_score: number;
  winner_id?: number;
  status: string;
}

export interface SyncHistoryRequest {
  match_id: number;
  action_type: string;
  fighter_id?: number;
  points: number;
  timestamp: string;
  details?: Record<string, unknown>;
}

export interface SyncChangesResponse {
  matches: MatchResponse[];
  last_sync_timestamp: string;
}

// WebSocket Messages
export type WSMessageType =
  | 'match_start'
  | 'match_end'
  | 'score_update'
  | 'timer_update'
  | 'round_change'
  | 'action_recorded'
  | 'participant_update'
  | 'error'
  | 'connected';

export interface WSMessage<T = unknown> {
  type: WSMessageType;
  match_id?: number;
  data?: T;
  timestamp?: string;
}

export interface WSScoreUpdateData {
  participant_id: number;
  action_type: string;
  points: number;
  round_number: number;
  timestamp?: string; // ISO 8601 timestamp для conflict resolution
  red_score?: number;
  blue_score?: number;
  red_warnings?: number;
  blue_warnings?: number;
  source_pin?: string; // PIN-код судьи-отправителя (для фильтрации собственных обновлений)
}

export interface WSTimerUpdateData {
  elapsed_seconds?: number;
  remaining_seconds?: number;
  is_running: boolean;
}

export interface WSMatchEndData {
  winner_id?: number;
  result_type?: 'points' | 'submission' | 'disqualification';
}

export interface WSParticipantUpdateData {
  match_id: number;
  participant_slot: number; // 1 или 2
  participant_id?: number | null;
  participant_name?: string | null;
  timestamp?: string;
}

// ============================================
// Bracket Filters Types
// ============================================

export interface BracketFilters {
  searchQuery: string;           // Поиск по имени участника
  gender: 'all' | 'male' | 'female' | 'mixed';  // Фильтр по полу
  sportId: number | 'all';      // Фильтр по виду спорта
  characteristics: Record<string, string | 'all'>;  // Динамические фильтры по характеристикам (key -> value)
}

export interface BracketSortConfig {
  enabled: boolean;
  // Сортировка: пол (М→Ж) → возраст (младшие→старшие) → вес (легкие→тяжелые)
}

// ============================================
// Admin Monitoring Types
// ============================================

export interface ActiveJudgeSession {
  judge_name: string;
  table_number: number;
  tournament_id: number | null;
  bracket_id: number | null;
  bracket_name: string | null;
  logged_in_at: string;
}

export interface ActiveMatch {
  match_id: number;
  bracket_id: number;
  bracket_name: string | null;
  fighter1_name: string | null;
  fighter2_name: string | null;
  score_participant1: number;
  score_participant2: number;
  warnings_participant1: number;
  warnings_participant2: number;
  status: string;
  judge_name: string | null;
  table_number: number | null;
}
