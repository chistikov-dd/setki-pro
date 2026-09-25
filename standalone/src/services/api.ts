import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { Bracket, LoadedTournamentFile, MatchEvent, ScoringConfig } from '../types';

/**
 * Открыть системный диалог выбора файла и загрузить турнир из локального JSON.
 * Судья заранее получает файл турнира (выгруженный веб-приложением) и передаёт
 * его в программу вручную — никакой сети, никакого автопоиска.
 *
 * Возвращает null если пользователь отменил выбор файла.
 */
export async function pickAndLoadTournamentFile(): Promise<LoadedTournamentFile | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'Турнир (JSON)', extensions: ['json'] }],
    title: 'Выберите файл турнира',
  });

  if (!selected || Array.isArray(selected)) {
    return null;
  }

  return await invoke<LoadedTournamentFile>('load_tournament_file', { path: selected });
}

/**
 * Получить сетки текущего загруженного турнира из локального SQLite кэша.
 */
export async function getCachedBrackets(): Promise<Bracket[]> {
  return await invoke<Bracket[]>('get_cached_brackets');
}

/**
 * Получить матчи конкретной сетки.
 */
export async function getBracketMatches(bracketId: number): Promise<any[]> {
  return await invoke<any[]>('get_bracket_matches', { bracketId });
}

/**
 * Проверить, загружен ли уже турнир (есть ли данные в кэше при старте программы).
 */
export async function hasLoadedTournament(): Promise<boolean> {
  return await invoke<boolean>('has_loaded_tournament');
}

/**
 * Получить метаданные загруженного турнира (имя турнира, опциональное имя судьи,
 * а также scoring_config — нужна для восстановления сессии после F5/Ctrl+R, когда
 * React-состояние обнуляется, но SQLite-кэш в Tauri-процессе остаётся загруженным).
 */
export async function getTournamentMeta(): Promise<{
  tournament_id: number | null;
  tournament_name: string | null;
  judge_name: string | null;
  scoring_config: ScoringConfig;
} | null> {
  return await invoke('get_tournament_meta');
}

/**
 * Сохранить (опциональное) имя судьи — используется только для подписи PDF-отчётов.
 */
export async function setJudgeName(judgeName: string): Promise<void> {
  return await invoke('set_judge_name', { judgeName });
}

// ====== Матчи ======

export async function startMatch(matchId: number): Promise<void> {
  return await invoke('start_match', { matchId });
}

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

export async function getMatchEvents(matchId: number): Promise<MatchEvent[]> {
  return await invoke<MatchEvent[]>('get_match_events', { matchId });
}

/**
 * Batch update: записать событие + обновить счёт + вернуть историю (1 вызов вместо 3).
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

export async function undoLastEvent(matchId: number): Promise<void> {
  return await invoke('undo_last_event', { matchId });
}

/**
 * Завершить матч. Победитель автоматически продвигается в следующий раунд сетки
 * (single elimination), напрямую в локальный SQLite — без sync_queue.
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
 * Отменить завершённый матч (откатить результаты и продвижение победителя).
 */
export async function undoFinishedMatch(matchId: number): Promise<void> {
  return await invoke('undo_finished_match', { matchId });
}

export async function cancelMatch(matchId: number): Promise<void> {
  return await invoke('cancel_match', { matchId });
}

export async function getNextMatchInBracket(bracketId: number, currentMatchId: number): Promise<any | null> {
  return await invoke<any | null>('get_next_match_in_bracket', { bracketId, currentMatchId });
}

// ====== Редактирование сетки (offline, без ролей/истории) ======

/**
 * Установить участника в слот матча (slot: 1 | 2). Работает только для
 * матчей со статусом 'scheduled'. Используется и для добавления в пустой
 * слот, и для замены существующего участника.
 */
export async function setMatchParticipant(
  matchId: number,
  slot: 1 | 2,
  fullName: string,
  clubName?: string
): Promise<void> {
  return await invoke('edit_match_participant', {
    matchId,
    slot,
    action: 'set',
    fullName,
    clubName: clubName || null,
  });
}

/**
 * Очистить слот участника (сделать TBD). Работает только для матчей
 * со статусом 'scheduled'.
 */
export async function clearMatchParticipant(matchId: number, slot: 1 | 2): Promise<void> {
  return await invoke('edit_match_participant', {
    matchId,
    slot,
    action: 'clear',
    fullName: null,
    clubName: null,
  });
}

/**
 * Поменять местами (или переместить, если целевой слот пуст) участников
 * между двумя слотами — в одном матче или в разных. Оба матча должны
 * иметь статус 'scheduled'.
 */
export async function swapMatchParticipants(
  matchIdA: number,
  slotA: 1 | 2,
  matchIdB: number,
  slotB: 1 | 2
): Promise<void> {
  return await invoke('swap_match_participants', {
    matchIdA,
    slotA,
    matchIdB,
    slotB,
  });
}
