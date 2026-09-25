import type { Bracket } from '../types';

export type BracketStatusFilter = 'all' | 'not_started' | 'in_progress' | 'completed';

export interface BracketListFilters {
  searchQuery: string;
  sportId: number | 'all';
  gender: string | 'all';
  status: BracketStatusFilter;
}

export const DEFAULT_BRACKET_FILTERS: BracketListFilters = {
  searchQuery: '',
  sportId: 'all',
  gender: 'all',
  status: 'all',
};

/**
 * Отфильтровать список сеток турнира по тексту поиска (название категории ИЛИ
 * имя участника во вложенных матчах), виду спорта и полу.
 *
 * В standalone-версии участники приходят прямо во вложенных bracket.matches
 * (без отдельного кэша participantsByBracket, как в основном проекте) — поэтому
 * поиск по участнику делается напрямую по match.participant1/2.full_name.
 */
export function filterBrackets(brackets: Bracket[], filters: BracketListFilters): Bracket[] {
  return brackets.filter((bracket) => {
    if (filters.sportId !== 'all' && bracket.sport_id !== filters.sportId) {
      return false;
    }

    if (filters.gender !== 'all' && (bracket.gender || '') !== filters.gender) {
      return false;
    }

    if (filters.status !== 'all' && bracket.status !== filters.status) {
      return false;
    }

    if (filters.searchQuery.trim() !== '') {
      const query = filters.searchQuery.toLowerCase().trim();
      const categoryMatch = bracket.category_name.toLowerCase().includes(query);
      const participantMatch = bracket.matches?.some(
        (m) =>
          m.participant1?.full_name?.toLowerCase().includes(query) ||
          m.participant2?.full_name?.toLowerCase().includes(query)
      );
      if (!categoryMatch && !participantMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Получить уникальные виды спорта из списка сеток (id -> название).
 */
export function getUniqueSports(brackets: Bracket[]): Array<{ id: number; name: string }> {
  const sportsMap = new Map<number, string>();
  for (const bracket of brackets) {
    if (bracket.sport_id != null && bracket.sport_name) {
      sportsMap.set(bracket.sport_id, bracket.sport_name);
    }
  }
  return Array.from(sportsMap.entries()).map(([id, name]) => ({ id, name }));
}

/**
 * Получить уникальные значения пола из списка сеток.
 */
export function getUniqueGenders(brackets: Bracket[]): string[] {
  const genders = new Set<string>();
  for (const bracket of brackets) {
    if (bracket.gender) {
      genders.add(bracket.gender);
    }
  }
  return Array.from(genders);
}

export function getGenderLabel(gender: string): string {
  switch (gender) {
    case 'male':
      return 'Мужчины';
    case 'female':
      return 'Женщины';
    case 'mixed':
      return 'Смешанные';
    default:
      return gender;
  }
}

/**
 * Человекочитаемая метка для значения фильтра по статусу сетки (включая 'all').
 */
export function getStatusFilterLabel(status: BracketStatusFilter): string {
  switch (status) {
    case 'all':
      return 'Все';
    case 'not_started':
      return 'Не начатые';
    case 'in_progress':
      return 'В процессе';
    case 'completed':
      return 'Завершённые';
    default:
      return status;
  }
}
