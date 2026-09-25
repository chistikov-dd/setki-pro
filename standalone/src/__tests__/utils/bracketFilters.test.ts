import { describe, it, expect } from 'vitest';
import { filterBrackets, getUniqueSports, getUniqueGenders, getGenderLabel, DEFAULT_BRACKET_FILTERS } from '../../utils/bracketFilters';
import type { Bracket, Match } from '../../types';

function makeMatch(overrides: Partial<Match>): Match {
  return {
    id: 1,
    bracket_id: 1,
    round_number: 1,
    match_number: 0,
    status: 'scheduled',
    score_participant1: 0,
    score_participant2: 0,
    warnings_participant1: 0,
    warnings_participant2: 0,
    ...overrides,
  };
}

function makeBracket(overrides: Partial<Bracket>): Bracket {
  return {
    id: 1,
    category_id: 1,
    category_name: 'Категория',
    bracket_type: 'single_elimination',
    total_rounds: 2,
    status: 'not_started',
    ...overrides,
  };
}

describe('bracketFilters', () => {
  describe('filterBrackets', () => {
    it('returns all brackets when filters are default', () => {
      const brackets = [makeBracket({ id: 1 }), makeBracket({ id: 2 })];
      expect(filterBrackets(brackets, DEFAULT_BRACKET_FILTERS)).toHaveLength(2);
    });

    it('filters by category name search (case-insensitive)', () => {
      const brackets = [
        makeBracket({ id: 1, category_name: 'Мальчики, 12-13 лет, до 55 кг' }),
        makeBracket({ id: 2, category_name: 'Девочки, 10-11 лет' }),
      ];
      const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, searchQuery: 'мальчики' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('filters by participant name in nested matches', () => {
      const brackets = [
        makeBracket({
          id: 1,
          category_name: 'Категория A',
          matches: [
            makeMatch({
              id: 10,
              participant1: { id: 1, fighter_id: 1, full_name: 'Иванов Иван' },
              participant2: { id: 2, fighter_id: 2, full_name: 'Петров Пётр' },
            }),
          ],
        }),
        makeBracket({
          id: 2,
          category_name: 'Категория B',
          matches: [
            makeMatch({
              id: 20,
              participant1: { id: 3, fighter_id: 3, full_name: 'Сидоров Сидор' },
            }),
          ],
        }),
      ];

      const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, searchQuery: 'петров' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('returns empty array when search matches nothing', () => {
      const brackets = [makeBracket({ id: 1, category_name: 'Категория A' })];
      const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, searchQuery: 'несуществующий' });
      expect(result).toHaveLength(0);
    });

    it('filters by sportId', () => {
      const brackets = [
        makeBracket({ id: 1, sport_id: 1 }),
        makeBracket({ id: 2, sport_id: 2 }),
      ];
      const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, sportId: 2 });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });

    it('filters by gender', () => {
      const brackets = [
        makeBracket({ id: 1, gender: 'male' }),
        makeBracket({ id: 2, gender: 'female' }),
      ];
      const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, gender: 'female' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });

    it('combines search, sport and gender filters', () => {
      const brackets = [
        makeBracket({ id: 1, category_name: 'Мужчины до 70 кг', sport_id: 1, gender: 'male' }),
        makeBracket({ id: 2, category_name: 'Мужчины до 80 кг', sport_id: 2, gender: 'male' }),
        makeBracket({ id: 3, category_name: 'Женщины до 60 кг', sport_id: 1, gender: 'female' }),
      ];
      const result = filterBrackets(brackets, { searchQuery: 'мужчины', sportId: 1, gender: 'male' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });
  });

  describe('getUniqueSports', () => {
    it('returns unique sports with id and name', () => {
      const brackets = [
        makeBracket({ id: 1, sport_id: 1, sport_name: 'Грэпплинг' }),
        makeBracket({ id: 2, sport_id: 1, sport_name: 'Грэпплинг' }),
        makeBracket({ id: 3, sport_id: 2, sport_name: 'Дзюдо' }),
      ];
      const sports = getUniqueSports(brackets);
      expect(sports).toHaveLength(2);
      expect(sports.map((s) => s.name).sort()).toEqual(['Грэпплинг', 'Дзюдо']);
    });

    it('returns empty array when no sport info present', () => {
      const brackets = [makeBracket({ id: 1 })];
      expect(getUniqueSports(brackets)).toEqual([]);
    });
  });

  describe('getUniqueGenders', () => {
    it('returns unique genders present in brackets', () => {
      const brackets = [
        makeBracket({ id: 1, gender: 'male' }),
        makeBracket({ id: 2, gender: 'male' }),
        makeBracket({ id: 3, gender: 'female' }),
      ];
      expect(getUniqueGenders(brackets).sort()).toEqual(['female', 'male']);
    });
  });

  describe('getGenderLabel', () => {
    it('translates known genders', () => {
      expect(getGenderLabel('male')).toBe('Мужчины');
      expect(getGenderLabel('female')).toBe('Женщины');
      expect(getGenderLabel('mixed')).toBe('Смешанные');
    });

    it('returns the raw value for unknown genders', () => {
      expect(getGenderLabel('other')).toBe('other');
    });
  });
});
