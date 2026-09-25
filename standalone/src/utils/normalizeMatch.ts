import type { Match } from '../types';

/**
 * Привести сырой JSON матча (как отдают get_bracket_matches / load_tournament_file)
 * к типу Match, подставив дефолты для необязательных числовых полей. Вынесено в
 * отдельный модуль, чтобы использовать одну и ту же логику и при обычной загрузке
 * сетки (BracketScreen), и при восстановлении сессии после F5 (App.tsx).
 */
export function normalizeMatch(raw: any): Match {
  return {
    id: raw.id,
    bracket_id: raw.bracket_id,
    participant1: raw.participant1 ?? undefined,
    participant2: raw.participant2 ?? undefined,
    winner_id: raw.winner_id ?? undefined,
    round_number: raw.round_number,
    match_number: raw.match_number,
    status: raw.status,
    score_participant1: raw.score_participant1 ?? 0,
    score_participant2: raw.score_participant2 ?? 0,
    warnings_participant1: raw.warnings_participant1 ?? 0,
    warnings_participant2: raw.warnings_participant2 ?? 0,
    result_type: raw.result_type ?? undefined,
  };
}
