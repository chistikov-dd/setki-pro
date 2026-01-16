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
 * Проверить наличие сохраненной авторизации
 */
export async function hasSavedAuth(): Promise<boolean> {
  return await invoke<boolean>('has_saved_auth');
}

/**
 * Получить сохраненные credentials админа для автоматического входа
 * Возвращает [login, password, user_id]
 */
export async function getSavedCredentials(): Promise<[string, string, number] | null> {
  return await invoke<[string, string, number] | null>('get_saved_credentials');
}

/**
 * Получить сохраненные credentials судьи для автоматического входа
 * Возвращает [pin_code, judge_name, table_number, tournament_id]
 */
export async function getSavedJudgeCredentials(): Promise<[string, string, number, number] | null> {
  return await invoke<[string, string, number, number] | null>('get_saved_judge_credentials');
}

/**
 * Очистить сохраненные credentials админа
 */
export async function clearSavedCredentials(): Promise<void> {
  return await invoke('clear_saved_credentials');
}

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
 * @param data - данные для входа
 * @param serverUrl - опциональный URL локального сервера (для режима local-client)
 */
export async function loginByPin(
  data: { pin_code: string; judge_name: string; table_number: number },
  serverUrl?: string | null
): Promise<AuthResponse> {
  console.log('[api.ts] loginByPin START');
  console.log('[api.ts]   pin_code:', data.pin_code);
  console.log('[api.ts]   judge_name:', data.judge_name);
  console.log('[api.ts]   table_number:', data.table_number);
  console.log('[api.ts]   serverUrl:', serverUrl);
  console.log('[api.ts] Calling Tauri command: login_by_pin');

  const result = await invoke<AuthResponse>('login_by_pin', {
    pinCode: data.pin_code,
    judgeName: data.judge_name,
    tableNumber: data.table_number,
    serverUrl: serverUrl || undefined,
  });

  console.log('[api.ts] loginByPin SUCCESS, response:', result);
  return result;
}

/**
 * Освободить номер стола
 */
export async function releaseTableNumber(tournamentId: number, tableNumber: number): Promise<void> {
  return await invoke('release_table_number', { tournamentId, tableNumber });
}

/**
 * Принудительное освобождение стола (для админа)
 */
export async function forceReleaseTable(tournamentId: number, tableNumber: number): Promise<void> {
  return await invoke('force_release_table', { tournamentId, tableNumber });
}

/**
 * Очистка всех резерваций столов для турнира
 */
export async function clearAllTableReservations(tournamentId: number): Promise<number> {
  return await invoke('clear_all_table_reservations', { tournamentId });
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
 * Проверить, загружен ли турнир в кэш
 */
export async function isTournamentDownloaded(tournamentId: number): Promise<boolean> {
  return await invoke<boolean>('is_tournament_downloaded', { tournamentId });
}

/**
 * Получить сетки из кэша (offline)
 */
export async function getCachedBrackets(tournamentId: number, serverUrl?: string | null): Promise<BracketResponse[]> {
  return await invoke<BracketResponse[]>('get_cached_brackets', {
    tournamentId,
    serverUrl: serverUrl || null
  });
}

/**
 * Получить сетки из кэша с матчами (для админа)
 */
export async function getCachedBracketsWithMatches(tournamentId: number): Promise<BracketResponse[]> {
  return await invoke<BracketResponse[]>('get_cached_brackets_with_matches', {
    tournamentId
  });
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

/**
 * Проверить количество несинхронизированных записей
 * Возвращает количество записей в sync_queue с synced=0
 */
export async function checkUnsyncedCount(): Promise<number> {
  return await invoke<number>('check_unsynced_count');
}

// ============================================
// BRACKET RESERVATION API (через Tauri Commands)
// ============================================

/**
 * Зарезервировать сетку для судьи
 */
export async function reserveBracket(
  bracketId: number,
  tournamentId: number,
  judgeName: string,
  tableNumber: number,
  userId: number
): Promise<void> {
  return await invoke('reserve_bracket', { bracketId, tournamentId, judgeName, tableNumber, userId });
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
 * Получить матчи сетки из кэша (или с локального сервера если serverUrl указан)
 */
export async function getBracketMatches(bracketId: number, serverUrl?: string | null): Promise<any[]> {
  return await invoke<any[]>('get_bracket_matches', {
    bracketId,
    serverUrl: serverUrl || null
  });
}

/**
 * Получить следующий незавершенный матч в сетке
 * @param bracketId - ID сетки
 * @param currentMatchId - ID текущего матча
 * @param serverUrl - опциональный URL локального сервера
 * @returns следующий матч или null если не найден
 */
export async function getNextMatchInBracket(
  bracketId: number,
  currentMatchId: number,
  serverUrl?: string | null
): Promise<any | null> {
  return await invoke<any | null>('get_next_match_in_bracket', {
    bracketId,
    currentMatchId,
    serverUrl: serverUrl || null
  });
}

/**
 * Очистить все резервирования (для отладки)
 */
export async function clearAllReservations(): Promise<void> {
  return await invoke('clear_all_reservations');
}

/**
 * Освободить все резервации конкретного судьи
 */
export async function releaseJudgeBrackets(judgeName: string): Promise<void> {
  return await invoke('release_judge_brackets', { judgeName });
}

/**
 * Создать пустую сетку
 */
export async function createEmptyBracket(
  data: {
    tournamentId: number;
    bracketName: string;
    participantCount: number;
    sportId: number;
    gender: 'male' | 'female' | 'mixed';
    characteristicValues: Record<string, string>;
    minAge?: number;
    maxAge?: number;
    minWeight?: number;
    maxWeight?: number;
  },
  serverUrl?: string | null
): Promise<number> {
  console.log('[api.ts] createEmptyBracket called with:', data);

  // Tauri автоматически конвертирует camelCase -> snake_case
  const result = await invoke<number>('create_empty_bracket', {
    tournamentId: data.tournamentId,
    bracketName: data.bracketName,
    participantCount: data.participantCount,
    sportId: data.sportId,
    gender: data.gender,
    characteristicValues: JSON.stringify(data.characteristicValues),
    minAge: data.minAge,
    maxAge: data.maxAge,
    minWeight: data.minWeight,
    maxWeight: data.maxWeight,
    serverUrl: serverUrl || null,
  });

  console.log('[api.ts] create_empty_bracket returned:', result);
  return result;
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
}, serverUrl?: string | null): Promise<MatchEvent[]> {
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
    serverUrl: serverUrl || null, // Передаем server_url для local-client режима
  });
}

/**
 * Отменить последнее событие (undo)
 */
export async function undoLastEvent(matchId: number): Promise<void> {
  return await invoke('undo_last_event', { matchId });
}

/**
 * Создать временного участника (с отрицательным ID)
 * Используется при добавлении участника вручную через редактор сетки
 */
export async function createTempParticipant(data: {
  bracketId: number;
  fullName: string;
  clubName?: string;
}, serverUrl?: string | null): Promise<number> {
  console.log('[API] createTempParticipant вызван:', { ...data, serverUrl });
  try {
    const result = await invoke('create_temp_participant', {
      bracketId: data.bracketId,
      fullName: data.fullName,
      clubName: data.clubName,
      serverUrl: serverUrl || null,
    });
    console.log('[API] createTempParticipant успешно, temp_id:', result);
    return result as number;
  } catch (error) {
    console.error('[API] createTempParticipant ошибка:', error);
    throw error;
  }
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
}, serverUrl?: string | null): Promise<void> {
  return await invoke('finish_match', {
    matchId: data.matchId,
    winnerId: data.winnerId,
    resultType: data.resultType,
    finalRedScore: data.finalRedScore,
    finalBlueScore: data.finalBlueScore,
    serverUrl: serverUrl || null,
  });
}

/**
 * Отменить завершённый матч (откатить результаты)
 * Доступно только судье, работающему с данной сеткой
 */
export async function undoFinishedMatch(
  matchId: number,
  pinCode: string,
  serverUrl?: string | null
): Promise<void> {
  return await invoke('undo_finished_match', {
    matchId,
    pinCode,
    serverUrl: serverUrl || null,
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
  // КРИТИЧНО: Получаем токен для авторизации на локальном сервере
  const token = await invoke<string>('get_token');
  if (!token) {
    throw new Error('Token not found (authorization required)');
  }

  const response = await fetch(`${serverUrl}/api/v1/desktop/matches/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
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
 * Универсальная функция обновления счета матча с retry логикой
 * Автоматически определяет куда отправлять данные (локальная БД или сервер админа)
 *
 * ВАЖНО: Эта функция вызывается ПОСЛЕ batchUpdateMatch(), который уже сохранил данные в sync_queue!
 * Поэтому НЕ нужно дублировать запись в sync_queue.
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
  console.log('[updateMatchScoreUniversal] START:', {
    matchId: data.matchId,
    mode: serverMode.mode,
    serverUrl: serverMode.serverUrl,
    willSendToServer: serverMode.mode === 'local-client' && !!serverMode.serverUrl
  });

  // Если режим local-client и есть serverUrl - отправляем на сервер админа
  if (serverMode.mode === 'local-client' && serverMode.serverUrl) {
    console.log('[updateMatchScoreUniversal] Отправка на локальный сервер админа...');
    // Retry логика: 5 попыток с экспоненциальной задержкой
    const maxRetries = 5;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await updateMatchOnLocalServer(serverMode.serverUrl, data);
        // Успех - выходим
        if (attempt > 0) {
          console.log(`[updateMatchScoreUniversal] ✅ Успешно отправлено на попытке ${attempt + 1}/${maxRetries}`);
        }
        return;
      } catch (error) {
        lastError = error as Error;
        const errorText = error instanceof Error ? error.message : String(error);

        // Проверяем тип ошибки
        const isConflict = errorText.includes('409') || errorText.includes('Conflict');
        const isNetworkError = errorText.includes('fetch') || errorText.includes('network') || errorText.includes('ECONNREFUSED');

        console.error(`[updateMatchScoreUniversal] ❌ Попытка ${attempt + 1}/${maxRetries} не удалась:`, {
          error: errorText,
          isConflict,
          isNetworkError
        });

        // Если это последняя попытка - не ждём
        if (attempt < maxRetries - 1) {
          let delay: number;

          if (isConflict) {
            // Для conflicts: короткие задержки с jitter (50ms, 100ms, 200ms, 400ms)
            delay = 50 * Math.pow(2, attempt) + Math.random() * 50;
            console.warn(`[updateMatchScoreUniversal] ⚠️ Optimistic lock conflict - retry через ${Math.round(delay)}ms...`);
          } else if (isNetworkError) {
            // Для сетевых ошибок: длинные задержки (1s, 2s, 4s, 8s)
            delay = Math.pow(2, attempt) * 1000;
            console.warn(`[updateMatchScoreUniversal] ⏳ Сетевая ошибка - повтор через ${delay}ms...`);
          } else {
            // Для остальных: средние задержки (500ms, 1s, 2s, 4s)
            delay = Math.pow(2, attempt) * 500;
            console.warn(`[updateMatchScoreUniversal] ⏳ Повторная попытка через ${delay}ms...`);
          }

          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // Все попытки исчерпаны
    console.error(`[updateMatchScoreUniversal] ❌ КРИТИЧЕСКАЯ ОШИБКА: Не удалось отправить на локальный сервер после ${maxRetries} попыток:`, lastError);
    console.warn('[updateMatchScoreUniversal] ⚠️ Данные сохранены локально в sync_queue и будут отправлены при восстановлении связи');
    // Данные уже сохранены через batchUpdateMatch() в sync_queue
  }
  // Для online/local-server режимов: ничего не делаем
  // Данные уже сохранены через batchUpdateMatch() в sync_queue
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

/**
 * Получить информацию о том, какие сетки заняты какими столами
 * Возвращает массив объектов { bracket_id, table_number, judge_name }
 */
export interface BracketTableAssignment {
  bracket_id: number;
  table_number: number;
  judge_name: string;
}

export async function getBracketTableAssignments(
  tournamentId: number,
  serverUrl?: string | null
): Promise<BracketTableAssignment[]> {
  return await invoke<BracketTableAssignment[]>('get_bracket_table_assignments', {
    tournamentId,
    serverUrl: serverUrl || null,
  });
}

/**
 * Получить сетки, зарезервированные за судейским столом
 */
export async function getMyBracketAssignments(
  tournamentId: number,
  tableNumber: number,
  serverUrl?: string | null
): Promise<BracketResponse[]> {
  return await invoke<BracketResponse[]>('get_my_bracket_assignments', {
    tournamentId,
    tableNumber,
    serverUrl: serverUrl || null,
  });
}

// ============================================
// BRACKET EDITING API (через Tauri Commands)
// ============================================

export interface ParticipantEditRequest {
  bracket_id: number;
  match_id: number;
  participant_slot: 'participant1' | 'participant2';
  fighter_id?: number;
  fighter_name?: string;
  club_name?: string;
  weight?: number;
  operation_type: 'add' | 'update' | 'remove';
}

/**
 * Обновить участника в матче сетки
 */
export async function updateBracketParticipant(
  request: ParticipantEditRequest,
  judgeName?: string,
  adminId?: number,
  serverUrl?: string | null
): Promise<void> {
  console.log('[API] updateBracketParticipant вызван:', { request, judgeName, adminId, serverUrl });
  try {
    await invoke('update_bracket_participant', {
      request,
      judgeName,
      adminId,
      serverUrl: serverUrl || null,
    });
    console.log('[API] updateBracketParticipant успешно');
  } catch (error) {
    console.error('[API] updateBracketParticipant ошибка:', error);
    throw error;
  }
}

export interface SwapParticipantsRequest {
  bracket_id: number;
  match1_id: number;
  match1_slot: 'participant1' | 'participant2';
  match2_id: number;
  match2_slot: 'participant1' | 'participant2';
}

/**
 * Поменять местами двух участников в разных матчах
 */
export async function swapBracketParticipants(
  request: SwapParticipantsRequest,
  judgeName?: string,
  adminId?: number,
  serverUrl?: string | null
): Promise<void> {
  await invoke('swap_bracket_participants', {
    request,
    judgeName,
    adminId,
    serverUrl: serverUrl || null,
  });
}

export interface BracketEditHistoryItem {
  id: number;
  match_id: number;
  participant_slot: string;
  fighter_name?: string;
  operation_type: string;
  edited_by_judge?: string;
  edited_by_admin?: number;
  created_at: string;
}

/**
 * Получить историю редактирований сетки
 */
export async function getBracketEditHistory(bracketId: number): Promise<BracketEditHistoryItem[]> {
  return await invoke<BracketEditHistoryItem[]>('get_bracket_edit_history', { bracketId });
}

/**
 * Очистить кеш турнира (сетки, матчи, очередь синхронизации)
 */
export async function clearTournamentCache(tournamentId: number): Promise<void> {
  return await invoke('clear_tournament_cache', { tournamentId });
}

/**
 * Очистить синхронизированные записи из sync_queue
 * Удаляет записи старше 7 дней, которые уже успешно синхронизированы с сервером
 * @returns Количество удалённых записей
 */
export async function cleanupSyncQueue(): Promise<number> {
  return await invoke('cleanup_sync_queue');
}
