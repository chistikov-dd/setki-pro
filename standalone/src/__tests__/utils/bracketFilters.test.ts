import { describe, it, expect } from 'vitest';
import {
  filterBrackets,
  getUniqueSports,
  getUniqueGenders,
  getGenderLabel,
  getStatusFilterLabel,
  hasAnyAgeData,
  getAvailableCharacteristics,
  getCharacteristicValues,
  getBracketCurrentStage,
  getStageFilterLabel,
  DEFAULT_BRACKET_FILTERS,
} from '../../utils/bracketFilters';
import type { Bracket, CharacteristicSchemaField, Match } from '../../types';

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
      const result = filterBrackets(brackets, {
        ...DEFAULT_BRACKET_FILTERS,
        searchQuery: 'мужчины',
        sportId: 1,
        gender: 'male',
      });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('filters by status', () => {
      const brackets = [
        makeBracket({ id: 1, status: 'not_started' }),
        makeBracket({ id: 2, status: 'in_progress' }),
        makeBracket({ id: 3, status: 'completed' }),
      ];

      expect(filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, status: 'not_started' }).map((b) => b.id)).toEqual([1]);
      expect(filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, status: 'in_progress' }).map((b) => b.id)).toEqual([2]);
      expect(filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, status: 'completed' }).map((b) => b.id)).toEqual([3]);
      expect(filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, status: 'all' })).toHaveLength(3);
    });

    it('combines status filter with search', () => {
      const brackets = [
        makeBracket({ id: 1, category_name: 'Мужчины до 70 кг', status: 'in_progress' }),
        makeBracket({ id: 2, category_name: 'Мужчины до 80 кг', status: 'not_started' }),
      ];
      const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, searchQuery: 'мужчины', status: 'in_progress' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    describe('age range filter', () => {
      it('returns all brackets when age filter is not set', () => {
        const brackets = [
          makeBracket({ id: 1, min_age: 10, max_age: 12 }),
          makeBracket({ id: 2, min_age: 18, max_age: 35 }),
          makeBracket({ id: 3 }), // без возрастных данных
        ];
        expect(filterBrackets(brackets, DEFAULT_BRACKET_FILTERS)).toHaveLength(3);
      });

      it('includes brackets whose age range intersects the filter range', () => {
        const brackets = [
          makeBracket({ id: 1, min_age: 10, max_age: 12 }),
          makeBracket({ id: 2, min_age: 12, max_age: 14 }), // касается границы (12) -> пересечение
          makeBracket({ id: 3, min_age: 18, max_age: 35 }),
        ];
        const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, ageFrom: 11, ageTo: 13 });
        expect(result.map((b) => b.id).sort()).toEqual([1, 2]);
      });

      it('excludes brackets fully outside the filter range', () => {
        const brackets = [
          makeBracket({ id: 1, min_age: 10, max_age: 12 }),
          makeBracket({ id: 2, min_age: 18, max_age: 35 }),
        ];
        const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, ageFrom: 18, ageTo: 40 });
        expect(result.map((b) => b.id)).toEqual([2]);
      });

      it('treats an open-ended filter (only ageFrom) as no upper bound', () => {
        const brackets = [
          makeBracket({ id: 1, min_age: 10, max_age: 12 }),
          makeBracket({ id: 2, min_age: 18, max_age: 35 }),
        ];
        const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, ageFrom: 15, ageTo: null });
        expect(result.map((b) => b.id)).toEqual([2]);
      });

      it('treats an open-ended filter (only ageTo) as no lower bound', () => {
        const brackets = [
          makeBracket({ id: 1, min_age: 10, max_age: 12 }),
          makeBracket({ id: 2, min_age: 18, max_age: 35 }),
        ];
        const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, ageFrom: null, ageTo: 15 });
        expect(result.map((b) => b.id)).toEqual([1]);
      });

      it('does not exclude brackets with no age data, even when the age filter is active', () => {
        const brackets = [
          makeBracket({ id: 1, min_age: 10, max_age: 12 }),
          makeBracket({ id: 2 }), // нет min_age/max_age вообще
        ];
        const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, ageFrom: 20, ageTo: 30 });
        // Сетка id=1 не пересекается с [20,30] -> исключена.
        // Сетка id=2 без данных -> не исключаем её (снисходительны к отсутствию данных).
        expect(result.map((b) => b.id)).toEqual([2]);
      });
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

  describe('hasAnyAgeData', () => {
    it('returns true when at least one bracket has min_age or max_age', () => {
      const brackets = [makeBracket({ id: 1 }), makeBracket({ id: 2, min_age: 18, max_age: 35 })];
      expect(hasAnyAgeData(brackets)).toBe(true);
    });

    it('returns false when no bracket has age data', () => {
      const brackets = [makeBracket({ id: 1 }), makeBracket({ id: 2 })];
      expect(hasAnyAgeData(brackets)).toBe(false);
    });

    it('returns true when a bracket has no explicit min_age/max_age but the age is recognizable in category_name', () => {
      // Реальный сценарий tournament_68_*.json: min_age/max_age == null для ВСЕХ сеток,
      // но возраст закодирован в названии категории ("N - M лет").
      const brackets = [
        makeBracket({ id: 1, category_name: 'Девочки, 10 - 11 лет, до 27 кг [B]', min_age: undefined, max_age: undefined }),
      ];
      expect(hasAnyAgeData(brackets)).toBe(true);
    });

    it('returns false when category_name has no recognizable age and no explicit fields either', () => {
      const brackets = [makeBracket({ id: 1, category_name: 'Мужчины, до 100 кг' })];
      expect(hasAnyAgeData(brackets)).toBe(false);
    });
  });

  describe('age range filter — fallback parsing from category_name', () => {
    // Реалистичные фикстуры на основе реальных названий из tournament_68_*.json, где
    // min_age/max_age всегда null, а возраст присутствует только в названии категории.
    const girls1011 = makeBracket({
      id: 1,
      category_name: 'Девочки, 10 - 11 лет, до 27 кг [B]',
      min_age: undefined,
      max_age: undefined,
    });
    const boys1213 = makeBracket({
      id: 2,
      category_name: 'Мальчики, 12 - 13 лет, до 38 кг [C]',
      min_age: undefined,
      max_age: undefined,
    });
    const men2030 = makeBracket({
      id: 3,
      category_name: 'Мужчины, 20 - 30 лет, до 100 кг [B]',
      min_age: undefined,
      max_age: undefined,
    });
    const seniorBoys1617 = makeBracket({
      id: 4,
      // Содержит похожий на возраст диапазон веса ("63-110 кг") без пробелов и без "лет" —
      // не должен быть перепутан с возрастом при фильтрации.
      category_name: 'Старшие юноши, 16 - 17 лет, 63-110 кг [A]',
      min_age: undefined,
      max_age: undefined,
    });
    const noAgeAtAll = makeBracket({
      id: 5,
      category_name: 'Мужчины, до 100 кг',
      min_age: undefined,
      max_age: undefined,
    });

    it('filters correctly by an age range that only exists in category_name (10-11 vs 20-30)', () => {
      const brackets = [girls1011, boys1213, men2030, seniorBoys1617, noAgeAtAll];
      const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, ageFrom: 10, ageTo: 11 });
      // girls1011 (10-11) пересекается; boys1213 (12-13), men2030 (20-30), seniorBoys1617
      // (16-17) — не пересекаются; noAgeAtAll — без данных вообще, не исключаем.
      expect(result.map((b) => b.id).sort()).toEqual([1, 5]);
    });

    it('does not confuse the weight range "63-110 кг" with an age range when filtering', () => {
      const brackets = [men2030, seniorBoys1617];
      // Если бы парсер ошибочно распознал "63-110" как возраст, seniorBoys1617 (id=4)
      // попал бы в диапазон [16,17], а не в [63,110] — и оба теста ниже провалились бы.
      const resultTeens = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, ageFrom: 16, ageTo: 17 });
      expect(resultTeens.map((b) => b.id)).toEqual([4]);

      const resultAdults = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, ageFrom: 20, ageTo: 30 });
      expect(resultAdults.map((b) => b.id)).toEqual([3]);
    });

    it('does not exclude a bracket with no age data anywhere (neither fields nor category_name)', () => {
      const brackets = [men2030, noAgeAtAll];
      const result = filterBrackets(brackets, { ...DEFAULT_BRACKET_FILTERS, ageFrom: 5, ageTo: 12 });
      // men2030 (20-30) не пересекается с [5,12] -> исключён.
      // noAgeAtAll — нет данных вообще -> не исключаем.
      expect(result.map((b) => b.id)).toEqual([5]);
    });

    it('prefers explicit min_age/max_age over category_name parsing when both are present', () => {
      const bracketWithExplicitFields = makeBracket({
        id: 6,
        category_name: 'Девочки, 10 - 11 лет, до 27 кг [B]', // название говорит 10-11
        min_age: 30, // но явные поля говорят 30-40 — они должны иметь приоритет
        max_age: 40,
      });
      const result = filterBrackets([bracketWithExplicitFields], {
        ...DEFAULT_BRACKET_FILTERS,
        ageFrom: 10,
        ageTo: 11,
      });
      // Если бы фильтр использовал распарсенное значение из названия (10-11), сетка
      // прошла бы фильтр. С приоритетом явных полей (30-40) она не пересекается с [10,11].
      expect(result).toHaveLength(0);
    });
  });

  describe('getStatusFilterLabel', () => {
    it('translates known statuses', () => {
      expect(getStatusFilterLabel('all')).toBe('Все');
      expect(getStatusFilterLabel('not_started')).toBe('Не начатые');
      expect(getStatusFilterLabel('in_progress')).toBe('В процессе');
      expect(getStatusFilterLabel('completed')).toBe('Завершённые');
    });
  });

  // ===== Динамический фильтр по характеристикам турнира (уровень A/B/C и т.п.) =====

  const LEVEL_SCHEMA: CharacteristicSchemaField[] = [
    { key: 'level', label: 'Уровень', use_as_category_tag: true, options: ['A', 'B', 'C'] },
  ];
  // Характеристика без use_as_category_tag — не должна попадать в availableCharacteristics.
  const HIDDEN_SCHEMA: CharacteristicSchemaField[] = [
    { key: 'internal_note', label: 'Служебная пометка', use_as_category_tag: false, options: ['x'] },
  ];

  describe('getAvailableCharacteristics', () => {
    it('returns empty array when there are no brackets', () => {
      expect(getAvailableCharacteristics([])).toEqual([]);
    });

    it('returns empty array when the first bracket has no characteristics_schema', () => {
      const brackets = [makeBracket({ id: 1 })];
      expect(getAvailableCharacteristics(brackets)).toEqual([]);
    });

    it('returns only fields with use_as_category_tag=true and options, from the first bracket', () => {
      const brackets = [
        makeBracket({
          id: 1,
          characteristics_schema: [...LEVEL_SCHEMA, ...HIDDEN_SCHEMA],
        }),
        makeBracket({ id: 2 }),
      ];
      const result = getAvailableCharacteristics(brackets);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('level');
    });

    it('deduplicates fields by key', () => {
      const brackets = [
        makeBracket({
          id: 1,
          characteristics_schema: [
            { key: 'level', label: 'Уровень', use_as_category_tag: true, options: ['A', 'B'] },
            { key: 'level', label: 'Уровень (дубликат)', use_as_category_tag: true, options: ['A', 'B'] },
          ],
        }),
      ];
      expect(getAvailableCharacteristics(brackets)).toHaveLength(1);
    });
  });

  describe('getCharacteristicValues', () => {
    it('collects unique trimmed values for a given key across all brackets', () => {
      const brackets = [
        makeBracket({ id: 1, characteristic_filters: [{ key: 'level', value: 'A' }] }),
        makeBracket({ id: 2, characteristic_filters: [{ key: 'level', value: ' B ' }] }),
        makeBracket({ id: 3, characteristic_filters: [{ key: 'level', value: 'A' }] }),
        makeBracket({ id: 4 }), // без characteristic_filters вообще
      ];
      expect(getCharacteristicValues(brackets, 'level').sort()).toEqual(['A', 'B']);
    });

    it('returns empty array when no bracket has that key', () => {
      const brackets = [makeBracket({ id: 1, characteristic_filters: [{ key: 'other', value: 'X' }] })];
      expect(getCharacteristicValues(brackets, 'level')).toEqual([]);
    });
  });

  describe('filterBrackets by characteristics', () => {
    it('returns all brackets when characteristics filter is empty (default)', () => {
      const brackets = [
        makeBracket({ id: 1, characteristic_filters: [{ key: 'level', value: 'A' }] }),
        makeBracket({ id: 2, characteristic_filters: [{ key: 'level', value: 'B' }] }),
      ];
      expect(filterBrackets(brackets, DEFAULT_BRACKET_FILTERS)).toHaveLength(2);
    });

    it('filters brackets whose characteristic_filters contain matching key/value', () => {
      const brackets = [
        makeBracket({ id: 1, characteristic_filters: [{ key: 'level', value: 'A' }] }),
        makeBracket({ id: 2, characteristic_filters: [{ key: 'level', value: 'B' }] }),
        makeBracket({ id: 3, characteristic_filters: [{ key: 'level', value: 'A' }] }),
      ];
      const result = filterBrackets(brackets, {
        ...DEFAULT_BRACKET_FILTERS,
        characteristics: { level: 'A' },
      });
      expect(result.map((b) => b.id).sort()).toEqual([1, 3]);
    });

    it('treats "all" for a characteristic key as no filter on that key', () => {
      const brackets = [
        makeBracket({ id: 1, characteristic_filters: [{ key: 'level', value: 'A' }] }),
        makeBracket({ id: 2, characteristic_filters: [{ key: 'level', value: 'B' }] }),
      ];
      const result = filterBrackets(brackets, {
        ...DEFAULT_BRACKET_FILTERS,
        characteristics: { level: 'all' },
      });
      expect(result).toHaveLength(2);
    });

    it('excludes brackets missing the characteristic_filters entry entirely', () => {
      const brackets = [
        makeBracket({ id: 1, characteristic_filters: [{ key: 'level', value: 'A' }] }),
        makeBracket({ id: 2 }), // нет characteristic_filters вообще
      ];
      const result = filterBrackets(brackets, {
        ...DEFAULT_BRACKET_FILTERS,
        characteristics: { level: 'A' },
      });
      expect(result.map((b) => b.id)).toEqual([1]);
    });

    it('combines multiple characteristic keys with AND semantics', () => {
      const brackets = [
        makeBracket({
          id: 1,
          characteristic_filters: [
            { key: 'level', value: 'A' },
            { key: 'belt', value: 'blue' },
          ],
        }),
        makeBracket({
          id: 2,
          characteristic_filters: [
            { key: 'level', value: 'A' },
            { key: 'belt', value: 'white' },
          ],
        }),
      ];
      const result = filterBrackets(brackets, {
        ...DEFAULT_BRACKET_FILTERS,
        characteristics: { level: 'A', belt: 'blue' },
      });
      expect(result.map((b) => b.id)).toEqual([1]);
    });
  });

  // ===== Фильтр по стадии сетки (Полуфиналы / Финалы) =====

  describe('getBracketCurrentStage', () => {
    it('returns null when the bracket has no matches', () => {
      expect(getBracketCurrentStage(makeBracket({ id: 1 }))).toBeNull();
    });

    it('returns null when the bracket is fully at the start (next unplayed match is far from final)', () => {
      // 8 участников -> 3 раунда (1/4 финала = round 1, полуфинал = round 2, финал = round 3).
      // Ничего не сыграно -> следующий несыгранный матч в round 1 -> roundsFromEnd = 2.
      const bracket = makeBracket({
        id: 1,
        matches: [
          makeMatch({ id: 1, round_number: 1, match_number: 0, status: 'scheduled' }),
          makeMatch({ id: 2, round_number: 1, match_number: 1, status: 'scheduled' }),
          makeMatch({ id: 3, round_number: 1, match_number: 2, status: 'scheduled' }),
          makeMatch({ id: 4, round_number: 1, match_number: 3, status: 'scheduled' }),
          makeMatch({ id: 5, round_number: 2, match_number: 0, status: 'scheduled' }),
          makeMatch({ id: 6, round_number: 2, match_number: 1, status: 'scheduled' }),
          makeMatch({ id: 7, round_number: 3, match_number: 0, status: 'scheduled' }),
        ],
      });
      expect(getBracketCurrentStage(bracket)).toBeNull();
    });

    it('returns "final" when every round except the final is completed', () => {
      const bracket = makeBracket({
        id: 1,
        matches: [
          makeMatch({ id: 1, round_number: 1, match_number: 0, status: 'completed' }),
          makeMatch({ id: 2, round_number: 1, match_number: 1, status: 'completed' }),
          makeMatch({ id: 3, round_number: 2, match_number: 0, status: 'completed' }),
          makeMatch({
            id: 4,
            round_number: 3,
            match_number: 0,
            status: 'scheduled',
            participant1: { id: 1, fighter_id: 1, full_name: 'Финалист 1' },
            participant2: { id: 2, fighter_id: 2, full_name: 'Финалист 2' },
          }),
        ],
      });
      expect(getBracketCurrentStage(bracket)).toBe('final');
    });

    it('returns "final" when the final match is in_progress (not just scheduled)', () => {
      const bracket = makeBracket({
        id: 1,
        matches: [
          makeMatch({ id: 1, round_number: 1, match_number: 0, status: 'completed' }),
          makeMatch({
            id: 2,
            round_number: 2,
            match_number: 0,
            status: 'in_progress',
            participant1: { id: 1, fighter_id: 1, full_name: 'Финалист 1' },
            participant2: { id: 2, fighter_id: 2, full_name: 'Финалист 2' },
          }),
        ],
      });
      expect(getBracketCurrentStage(bracket)).toBe('final');
    });

    it('returns "semifinal" when every round before the semifinal is completed but a semifinal match is not', () => {
      // 8 участников: round 1 (1/4 финала) сыгран полностью, round 2 (полуфинал) — один
      // матч ещё не сыгран, round 3 (финал) полностью TBD (ждём победителей полуфиналов).
      const bracket = makeBracket({
        id: 1,
        matches: [
          makeMatch({ id: 1, round_number: 1, match_number: 0, status: 'completed' }),
          makeMatch({ id: 2, round_number: 1, match_number: 1, status: 'completed' }),
          makeMatch({ id: 3, round_number: 1, match_number: 2, status: 'completed' }),
          makeMatch({ id: 4, round_number: 1, match_number: 3, status: 'completed' }),
          makeMatch({
            id: 5,
            round_number: 2,
            match_number: 0,
            status: 'scheduled',
            participant1: { id: 1, fighter_id: 1, full_name: 'Победитель 1' },
            participant2: { id: 2, fighter_id: 2, full_name: 'Победитель 2' },
          }),
          makeMatch({
            id: 6,
            round_number: 2,
            match_number: 1,
            status: 'scheduled',
            participant1: { id: 3, fighter_id: 3, full_name: 'Победитель 3' },
            participant2: { id: 4, fighter_id: 4, full_name: 'Победитель 4' },
          }),
          // Финал ещё полностью TBD (оба участника не определены) — не должен считаться
          // "следующим несыгранным матчем" сам по себе.
          makeMatch({ id: 7, round_number: 3, match_number: 0, status: 'scheduled' }),
        ],
      });
      expect(getBracketCurrentStage(bracket)).toBe('semifinal');
    });

    it('skips fully-TBD future matches and finds the real next match (mixed byes scenario)', () => {
      // Сценарий из ТЗ: сетка на 8 слотов, реально сыграно только 5 участников (3 bye).
      // Раунд 1 частично реален (2 реальных матча) / частично bye (пропущен, поэтому его
      // "матчей" в данных нет — как будто сразу прошли в раунд 2). Раунд 2 (полуфинал) —
      // один матч уже имеет обоих реальных участников (из bye) и завершён, второй ещё не
      // сыгран (ждём победителя реального матча 1 раунда). Раунд 3 (финал) — полностью TBD.
      const bracket = makeBracket({
        id: 1,
        matches: [
          makeMatch({
            id: 1,
            round_number: 1,
            match_number: 0,
            status: 'completed',
            participant1: { id: 1, fighter_id: 1, full_name: 'Иванов' },
            participant2: { id: 2, fighter_id: 2, full_name: 'Петров' },
          }),
          // Полуфинал 1: один участник уже определён победителем матча 1 раунда,
          // второй слот пока TBD (ждём результата второго "виртуального" пути) —
          // это НЕ чистая TBD-заглушка (есть хотя бы один участник), поэтому это
          // и есть "следующий реальный несыгранный матч".
          makeMatch({
            id: 2,
            round_number: 2,
            match_number: 0,
            status: 'scheduled',
            participant1: { id: 1, fighter_id: 1, full_name: 'Иванов' },
          }),
          // Полуфинал 2: byes уже дали обоих участников, матч сыгран.
          makeMatch({
            id: 3,
            round_number: 2,
            match_number: 1,
            status: 'completed',
            participant1: { id: 5, fighter_id: 5, full_name: 'Сидоров' },
            participant2: { id: 6, fighter_id: 6, full_name: 'Кузнецов' },
          }),
          // Финал полностью TBD — не должен "залипать" как следующий матч.
          makeMatch({ id: 4, round_number: 3, match_number: 0, status: 'scheduled' }),
        ],
      });
      // maxRound=3, следующий реальный несыгранный матч — полуфинал (round 2) -> roundsFromEnd=1.
      expect(getBracketCurrentStage(bracket)).toBe('semifinal');
    });

    it('returns null for a fully completed bracket (no active stage)', () => {
      const bracket = makeBracket({
        id: 1,
        matches: [
          makeMatch({ id: 1, round_number: 1, match_number: 0, status: 'completed' }),
          makeMatch({ id: 2, round_number: 1, match_number: 1, status: 'completed' }),
          makeMatch({ id: 3, round_number: 2, match_number: 0, status: 'completed' }),
        ],
      });
      expect(getBracketCurrentStage(bracket)).toBeNull();
    });
  });

  describe('filterBrackets by stage', () => {
    it('returns all brackets when stage filter is "all"', () => {
      const finalBracket = makeBracket({
        id: 1,
        matches: [makeMatch({ id: 1, round_number: 1, match_number: 0, status: 'scheduled' })],
      });
      const untouchedBracket = makeBracket({ id: 2 });
      expect(filterBrackets([finalBracket, untouchedBracket], DEFAULT_BRACKET_FILTERS)).toHaveLength(2);
    });

    it('filters to only brackets currently in the final stage', () => {
      const inFinal = makeBracket({
        id: 1,
        matches: [
          makeMatch({ id: 1, round_number: 1, match_number: 0, status: 'completed' }),
          makeMatch({
            id: 2,
            round_number: 2,
            match_number: 0,
            status: 'scheduled',
            participant1: { id: 1, fighter_id: 1, full_name: 'A' },
            participant2: { id: 2, fighter_id: 2, full_name: 'B' },
          }),
        ],
      });
      const inSemifinal = makeBracket({
        id: 2,
        matches: [
          makeMatch({ id: 3, round_number: 1, match_number: 0, status: 'scheduled' }),
          makeMatch({ id: 4, round_number: 2, match_number: 0, status: 'scheduled' }),
        ],
      });
      const result = filterBrackets([inFinal, inSemifinal], { ...DEFAULT_BRACKET_FILTERS, stage: 'final' });
      expect(result.map((b) => b.id)).toEqual([1]);
    });

    it('filters to only brackets currently in the semifinal stage', () => {
      const inFinal = makeBracket({
        id: 1,
        matches: [
          makeMatch({ id: 1, round_number: 1, match_number: 0, status: 'completed' }),
          makeMatch({
            id: 2,
            round_number: 2,
            match_number: 0,
            status: 'scheduled',
            participant1: { id: 1, fighter_id: 1, full_name: 'A' },
            participant2: { id: 2, fighter_id: 2, full_name: 'B' },
          }),
        ],
      });
      const inSemifinal = makeBracket({
        id: 2,
        matches: [
          makeMatch({ id: 3, round_number: 1, match_number: 0, status: 'completed' }),
          makeMatch({ id: 4, round_number: 1, match_number: 1, status: 'completed' }),
          makeMatch({
            id: 5,
            round_number: 2,
            match_number: 0,
            status: 'scheduled',
            participant1: { id: 1, fighter_id: 1, full_name: 'A' },
            participant2: { id: 2, fighter_id: 2, full_name: 'B' },
          }),
          makeMatch({ id: 6, round_number: 3, match_number: 0, status: 'scheduled' }),
        ],
      });
      const result = filterBrackets([inFinal, inSemifinal], { ...DEFAULT_BRACKET_FILTERS, stage: 'semifinal' });
      expect(result.map((b) => b.id)).toEqual([2]);
    });

    it('excludes fully completed brackets from both semifinal and final stage filters', () => {
      const completed = makeBracket({
        id: 1,
        matches: [
          makeMatch({ id: 1, round_number: 1, match_number: 0, status: 'completed' }),
          makeMatch({ id: 2, round_number: 2, match_number: 0, status: 'completed' }),
        ],
      });
      expect(filterBrackets([completed], { ...DEFAULT_BRACKET_FILTERS, stage: 'final' })).toHaveLength(0);
      expect(filterBrackets([completed], { ...DEFAULT_BRACKET_FILTERS, stage: 'semifinal' })).toHaveLength(0);
    });
  });

  describe('getStageFilterLabel', () => {
    it('translates known stages', () => {
      expect(getStageFilterLabel('all')).toBe('Все стадии');
      expect(getStageFilterLabel('semifinal')).toBe('Полуфиналы');
      expect(getStageFilterLabel('final')).toBe('Финалы');
    });
  });
});
