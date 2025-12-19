import { invoke } from '@tauri-apps/api/core';
import type {
  AuthResponse,
  BracketResponse,
  TournamentBriefResponse,
  TournamentSession,
  TournamentTableResponse,
  MatchEvent,
  ActiveJudgeSession,
  ActiveMatch,
} from '../types';

/**
 * Установить токен аутентификации (больше не нужно - токен хранится в Rust/SQLite)
 */
export function setAuthToken(_token: string | null) {
  // Не используется - токен хранится в SQLite
}

/**
 * Получить текущий токен (больше не нужно)
 */
export function getAuthToken(): string | null {
  // Не используется - токен хранится в SQLite
  return null;
}

// ============================================
// AUTH API (через Tauri Commands)
// ============================================

/**
 * Вход администратора (логин/пароль)
 */
export async function loginAdmin(data: { login: string; password: string }): Promise<AuthResponse> {
  return await invoke<AuthResponse>('login_admin', {
    login: data.login,
    password: data.password,
  });
}

/**
 * Вход судьи (PIN-код + имя + номер стола)
 */
export async function loginByPin(data: { pin_code: string; judge_name: string; table_number: number }): Promise<AuthResponse> {
  return await invoke<AuthResponse>('login_by_pin', {
    pinCode: data.pin_code,
    judgeName: data.judge_name,
    tableNumber: data.table_number,
  });
}

/**
 * Освободить номер стола
 */
export async function releaseTableNumber(tournamentId: number, tableNumber: number): Promise<void> {
  return await invoke('release_table_number', { tournamentId, tableNumber });
}

/**
 * Выход (очистка токена)
 */
export function logout() {
  // TODO: Добавить Tauri command для очистки токена из SQLite
}

// ============================================
// OFFLINE/SYNC API (через Tauri Commands)
// ============================================

/**
 * Скачать данные турнира для offline режима
 */
export async function downloadTournament(tournamentId: number): Promise<void> {
  return await invoke('download_tournament', { tournamentId });
}

/**
 * Получить сетки из кэша (offline)
 */
export async function getCachedBrackets(tournamentId: number): Promise<BracketResponse[]> {
  return await invoke<BracketResponse[]>('get_cached_brackets', { tournamentId });
}

/**
 * Синхронизировать изменения с сервером (setki.pro)
 */
export async function syncChanges(): Promise<void> {
  return await invoke('sync_changes');
}

/**
 * Синхронизировать изменения с локальным сервером админа
 */
export async function syncToLocalServer(serverUrl: string): Promise<void> {
  return await invoke('sync_to_local_server', { serverUrl });
}

// ============================================
// TOURNAMENTS API (через Tauri Commands)
// ============================================

/**
 * Получить список турниров администратора
 */
export async function getTournaments(): Promise<TournamentBriefResponse[]> {
  return await invoke<TournamentBriefResponse[]>('get_tournaments');
}

/**
 * Получить детали турнира (включая PIN и scoring config)
 */
export async function getTournamentDetails(tournamentId: number): Promise<TournamentSession> {
  return await invoke<TournamentSession>('get_tournament_details', { tournamentId });
}

/**
 * Получить столы турнира
 */
export async function getTournamentTables(tournamentId: number): Promise<TournamentTableResponse[]> {
  return await invoke<TournamentTableResponse[]>('get_tournament_tables', { tournamentId });
}

/**
 * Проверить наличие кэшированного PIN-кода
 */
export async function checkCachedPin(pinCode: string): Promise<boolean> {
  return await invoke<boolean>('check_cached_pin', { pinCode });
}

// ============================================
// BRACKET RESERVATION API (через Tauri Commands)
// ============================================

/**
 * Зарезервировать сетку для судьи
 */
export async function reserveBracket(
  bracketId: number,
  judgeName: string,
  userId: number
): Promise<void> {
  return await invoke('reserve_bracket', { bracketId, judgeName, userId });
}

/**
 * Освободить сетку (отменить резервирование)
 */
export async function releaseBracket(bracketId: number): Promise<void> {
  return await invoke('release_bracket', { bracketId });
}

/**
 * Получить информацию о резервировании сетки
 */
export async function getBracketReservation(
  bracketId: number
): Promise<{ judgeName: string; userId: number } | null> {
  const result = await invoke<[string, number] | null>('get_bracket_reservation', { bracketId });
  if (result) {
    return { judgeName: result[0], userId: result[1] };
  }
  return null;
}

/**
 * Получить матчи сетки из кэша
 */
export async function getBracketMatches(bracketId: number): Promise<any[]> {
  return await invoke<any[]>('get_bracket_matches', { bracketId });
}

/**
 * Очистить все резервирования (для отладки)
 */
export async function clearAllReservations(): Promise<void> {
  return await invoke('clear_all_reservations');
}

// ====== Функции для работы с поединками ======

/**
 * Начать матч (изменить статус на in_progress)
 */
export async function startMatch(matchId: number): Promise<void> {
  return await invoke('start_match', { matchId });
}

/**
 * Обновить счет матча
 */
export async function updateMatchScore(data: {
  matchId: number;
  redScore: number;
  blueScore: number;
  redWarnings: number;
  blueWarnings: number;
  status: string;
}): Promise<void> {
  return await invoke('update_match_score', {
    matchId: data.matchId,
    redScore: data.redScore,
    blueScore: data.blueScore,
    redWarnings: data.redWarnings,
    blueWarnings: data.blueWarnings,
    status: data.status,
  });
}

/**
 * Записать событие в историю
 */
export async function recordMatchEvent(event: {
  matchId: number;
  eventType: 'score' | 'warning' | 'disqualify' | 'timer' | 'submission';
  participant: 'red' | 'blue';
  points?: number;
  actionName?: string;
  timestamp: number;
}): Promise<number> {
  return await invoke<number>('record_match_event', {
    matchId: event.matchId,
    eventType: event.eventType,
    participant: event.participant,
    points: event.points,
    actionName: event.actionName,
    timestamp: event.timestamp,
  });
}

/**
 * Получить историю событий матча
 */
export async function getMatchEvents(matchId: number): Promise<MatchEvent[]> {
  return await invoke<MatchEvent[]>('get_match_events', { matchId });
}

/**
 * Batch update: record event + update score + get events (3 вызова → 1)
 * Оптимизация для слабых компьютеров: все операции в одной SQLite транзакции
 */
export async function batchUpdateMatch(data: {
  matchId: number;
  eventType: 'score' | 'warning' | 'disqualify' | 'timer' | 'submission';
  participant: 'red' | 'blue';
  points?: number;
  actionName?: string;
  timestamp: number;
  redScore: number;
  blueScore: number;
  redWarnings: number;
  blueWarnings: number;
  status: string;
}): Promise<MatchEvent[]> {
  return await invoke<MatchEvent[]>('batch_update_match', {
    matchId: data.matchId,
    eventType: data.eventType,
    participant: data.participant,
    points: data.points,
    actionName: data.actionName,
    timestamp: data.timestamp,
    redScore: data.redScore,
    blueScore: data.blueScore,
    redWarnings: data.redWarnings,
    blueWarnings: data.blueWarnings,
    status: data.status,
  });
}

/**
 * Отменить последнее событие (undo)
 */
export async function undoLastEvent(matchId: number): Promise<void> {
  return await invoke('undo_last_event', { matchId });
}

/**
 * Завершить матч
 */
export async function finishMatch(data: {
  matchId: number;
  winnerId?: number;
  resultType: 'points' | 'submission' | 'disqualification';
  finalRedScore: number;
  finalBlueScore: number;
}): Promise<void> {
  return await invoke('finish_match', {
    matchId: data.matchId,
    winnerId: data.winnerId,
    resultType: data.resultType,
    finalRedScore: data.finalRedScore,
    finalBlueScore: data.finalBlueScore,
  });
}

/**
 * Отправить обновление матча на локальный сервер админа
 * Используется в режиме local-client для централизованного хранения данных
 */
export async function updateMatchOnLocalServer(
  serverUrl: string,
  data: {
    matchId: number;
    redScore: number;
    blueScore: number;
    redWarnings: number;
    blueWarnings: number;
    status: string;
    duration?: number;
    winnerId?: number;
  }
): Promise<void> {
  const response = await fetch(`${serverUrl}/api/v1/desktop/matches/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      match_id: data.matchId,
      red_score: data.redScore,
      blue_score: data.blueScore,
      red_warnings: data.redWarnings,
      blue_warnings: data.blueWarnings,
      status: data.status,
      duration: data.duration,
      winner_id: data.winnerId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update match on local server: ${response.status} ${errorText}`);
  }
}

/**
 * Универсальная функция обновления счета матча
 * Автоматически определяет куда отправлять данные (локальная БД или сервер админа)
 */
export async function updateMatchScoreUniversal(
  data: {
    matchId: number;
    redScore: number;
    blueScore: number;
    redWarnings: number;
    blueWarnings: number;
    status: string;
    duration?: number;
    winnerId?: number;
  },
  serverMode: { mode: 'online' | 'local-server' | 'local-client'; serverUrl: string | null }
): Promise<void> {
  // Если режим local-client и есть serverUrl - отправляем на сервер админа
  if (serverMode.mode === 'local-client' && serverMode.serverUrl) {
    try {
      await updateMatchOnLocalServer(serverMode.serverUrl, data);
    } catch (error) {
      // Fallback на локальную БД при ошибке
      console.warn('Failed to update on local server, falling back to local DB:', error);
      await updateMatchScore(data);
    }
  } else {
    // Иначе сохраняем в локальную БД (online/local-server/offline)
    await updateMatchScore(data);
  }
}

// ============================================
// ADMIN MONITORING API (через Tauri Commands)
// ============================================

/**
 * Получить список активных судейских сессий
 */
export async function getActiveJudgeSessions(tournamentId: number): Promise<ActiveJudgeSession[]> {
  return await invoke<ActiveJudgeSession[]>('get_active_judge_sessions', { tournamentId });
}

/**
 * Получить список активных поединков
 */
export async function getActiveMatches(tournamentId: number): Promise<ActiveMatch[]> {
  return await invoke<ActiveMatch[]>('get_active_matches', { tournamentId });
}
