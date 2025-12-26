import { describe, it, expect } from 'vitest';
import {
  filterBrackets,
  sortBrackets,
  applySortAndFilter,
  getGenderLabel,
  getAgeRangeLabel,
  getWeightRangeLabel,
  getEnhancedCategoryName,
} from '../../utils/bracketFilters';
import type { BracketResponse, BracketFilters } from '../../types';

describe('bracketFilters', () => {
  const mockBracket1: BracketResponse = {
    id: 1,
    category_id: 101,
    category_name: 'Мужчины, 18-30 лет, до 70 кг',
    bracket_type: 'single_elimination',
    current_round: 1,
    status: 'not_started',
    is_published: true,
    gender: 'male',
    min_age: 18,
    max_age: 30,
    max_weight: 70,
  };

  const mockBracket2: BracketResponse = {
    id: 2,
    category_id: 102,
    category_name: 'Женщины, 16-20 лет, до 55 кг',
    bracket_type: 'single_elimination',
    current_round: 1,
    status: 'in_progress',
    is_published: true,
    gender: 'female',
    min_age: 16,
    max_age: 20,
    max_weight: 55,
  };

  const mockBracket3: BracketResponse = {
    id: 3,
    category_id: 103,
    category_name: 'Грэпплинг - Мужчины, 25-35 лет',
    bracket_type: 'single_elimination',
    current_round: 1,
    status: 'not_started',
    is_published: true,
    sport_id: 1,
    sport_name: 'Грэпплинг',
    gender: 'male',
    min_age: 25,
    max_age: 35,
    characteristic_filters: [
      { key: 'uroven', value: 'a' },
      { key: 'discipline', value: 'gi' },
    ],
    characteristics_schema: [
      {
        key: 'uroven',
        label: 'Уровень',
        type: 'select',
        use_as_category_tag: true,
        options: [
          { value: 'a', label: 'Уровень A' },
          { value: 'b', label: 'Уровень B' },
        ],
      },
      {
        key: 'discipline',
        label: 'Дисциплина',
        type: 'select',
        use_as_category_tag: true,
        options: [
          { value: 'gi', label: 'С кимоно' },
          { value: 'no_gi', label: 'Без кимоно' },
        ],
      },
    ],
  };

  const mockBracket4: BracketResponse = {
    id: 4,
    category_id: 104,
    category_name: 'Джиу-джитсу - Женщины, 20-30 лет',
    bracket_type: 'single_elimination',
    current_round: 1,
    status: 'completed',
    is_published: true,
    sport_id: 2,
    sport_name: 'Джиу-джитсу',
    gender: 'female',
    min_age: 20,
    max_age: 30,
    characteristic_filters: [
      { key: 'uroven', value: 'b' },
      { key: 'discipline', value: 'no_gi' },
    ],
    characteristics_schema: [
      {
        key: 'uroven',
        label: 'Уровень',
        type: 'select',
        use_as_category_tag: true,
        options: [
          { value: 'a', label: 'Уровень A' },
          { value: 'b', label: 'Уровень B' },
        ],
      },
      {
        key: 'discipline',
        label: 'Дисциплина',
        type: 'select',
        use_as_category_tag: true,
        options: [
          { value: 'gi', label: 'С кимоно' },
          { value: 'no_gi', label: 'Без кимоно' },
        ],
      },
    ],
  };

  describe('filterBrackets', () => {
    it('should return all brackets when no filters applied', () => {
      const filters: BracketFilters = {
        searchQuery: '',
        gender: 'all',
        sportId: 'all',
        characteristics: {},
      };

      const result = filterBrackets([mockBracket1, mockBracket2], filters);
      expect(result).toHaveLength(2);
    });

    it('should filter by gender', () => {
      const filters: BracketFilters = {
        searchQuery: '',
        gender: 'male',
        sportId: 'all',
        characteristics: {},
      };

      const result = filterBrackets([mockBracket1, mockBracket2], filters);
      expect(result).toHaveLength(1);
      expect(result[0].gender).toBe('male');
    });

    it('should filter by sport ID', () => {
      const filters: BracketFilters = {
        searchQuery: '',
        gender: 'all',
        sportId: 1,
        characteristics: {},
      };

      const result = filterBrackets([mockBracket3, mockBracket4], filters);
      expect(result).toHaveLength(1);
      expect(result[0].sport_id).toBe(1);
    });

    it('should filter by search query in category name', () => {
      const filters: BracketFilters = {
        searchQuery: 'Грэпплинг',
        gender: 'all',
        sportId: 'all',
        characteristics: {},
      };

      const result = filterBrackets([mockBracket3, mockBracket4], filters);
      expect(result).toHaveLength(1);
      expect(result[0].category_name).toContain('Грэпплинг');
    });

    it('should filter by search query in participant names', () => {
      const filters: BracketFilters = {
        searchQuery: 'Иванов',
        gender: 'all',
        sportId: 'all',
        characteristics: {},
      };

      const participantsByBracket = {
        1: ['Иванов Иван', 'Петров Петр'],
        2: ['Сидорова Мария'],
      };

      const result = filterBrackets([mockBracket1, mockBracket2], filters, participantsByBracket);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('should combine multiple filters', () => {
      const filters: BracketFilters = {
        searchQuery: '',
        gender: 'male',
        sportId: 1,
        characteristics: {},
      };

      const result = filterBrackets([mockBracket1, mockBracket2, mockBracket3, mockBracket4], filters);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(3);
    });

    it('should filter by single characteristic', () => {
      const filters: BracketFilters = {
        searchQuery: '',
        gender: 'all',
        sportId: 'all',
        characteristics: {
          uroven: 'a',
        },
      };

      const result = filterBrackets([mockBracket3, mockBracket4], filters);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(3); // Only mockBracket3 has uroven: 'a'
    });

    it('should filter by multiple characteristics', () => {
      const filters: BracketFilters = {
        searchQuery: '',
        gender: 'all',
        sportId: 'all',
        characteristics: {
          uroven: 'a',
          discipline: 'gi',
        },
      };

      const result = filterBrackets([mockBracket3, mockBracket4], filters);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(3); // Only mockBracket3 has both uroven: 'a' AND discipline: 'gi'
    });

    it('should ignore characteristic filter with "all" value', () => {
      const filters: BracketFilters = {
        searchQuery: '',
        gender: 'all',
        sportId: 'all',
        characteristics: {
          uroven: 'all',
          discipline: 'gi',
        },
      };

      const result = filterBrackets([mockBracket3, mockBracket4], filters);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(3); // Should only filter by discipline: 'gi', ignore uroven: 'all'
    });

    it('should return empty array when no brackets match characteristic filter', () => {
      const filters: BracketFilters = {
        searchQuery: '',
        gender: 'all',
        sportId: 'all',
        characteristics: {
          uroven: 'c', // No bracket has uroven: 'c'
        },
      };

      const result = filterBrackets([mockBracket3, mockBracket4], filters);
      expect(result).toHaveLength(0);
    });

    it('should work with brackets without characteristic_filters', () => {
      const filters: BracketFilters = {
        searchQuery: '',
        gender: 'all',
        sportId: 'all',
        characteristics: {
          uroven: 'a',
        },
      };

      // mockBracket1 and mockBracket2 don't have characteristic_filters
      const result = filterBrackets([mockBracket1, mockBracket2, mockBracket3], filters);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(3); // Only mockBracket3 matches
    });
  });

  describe('sortBrackets', () => {
    it('should sort by gender (male first, then female)', () => {
      const result = sortBrackets([mockBracket2, mockBracket1]);
      expect(result[0].gender).toBe('male');
      expect(result[1].gender).toBe('female');
    });

    it('should sort by age within same gender', () => {
      const bracket1 = { ...mockBracket1, min_age: 25 };
      const bracket2 = { ...mockBracket1, id: 5, min_age: 18 };

      const result = sortBrackets([bracket1, bracket2]);
      expect(result[0].min_age).toBe(18);
      expect(result[1].min_age).toBe(25);
    });

    it('should sort by weight within same gender and age', () => {
      const bracket1 = { ...mockBracket1, max_weight: 80 };
      const bracket2 = { ...mockBracket1, id: 5, max_weight: 70 };

      const result = sortBrackets([bracket1, bracket2]);
      expect(result[0].max_weight).toBe(70);
      expect(result[1].max_weight).toBe(80);
    });
  });

  describe('applySortAndFilter', () => {
    it('should filter and then sort brackets', () => {
      const filters: BracketFilters = {
        searchQuery: '',
        gender: 'all',
        sportId: 'all',
        characteristics: {},
      };

      const result = applySortAndFilter([mockBracket2, mockBracket1], filters);
      expect(result).toHaveLength(2);
      expect(result[0].gender).toBe('male');
      expect(result[1].gender).toBe('female');
    });
  });

  describe('getGenderLabel', () => {
    it('should return correct label for male', () => {
      expect(getGenderLabel('male')).toBe('Мужчины');
    });

    it('should return correct label for female', () => {
      expect(getGenderLabel('female')).toBe('Женщины');
    });

    it('should return correct label for mixed', () => {
      expect(getGenderLabel('mixed')).toBe('Смешанные');
    });

    it('should return default label for undefined', () => {
      expect(getGenderLabel(undefined)).toBe('Не указан');
    });
  });

  describe('getAgeRangeLabel', () => {
    it('should format range with both min and max', () => {
      expect(getAgeRangeLabel(18, 30)).toBe('18-30 лет');
    });

    it('should format with only min age', () => {
      expect(getAgeRangeLabel(18, undefined)).toBe('от 18 лет');
    });

    it('should format with only max age', () => {
      expect(getAgeRangeLabel(undefined, 30)).toBe('до 30 лет');
    });

    it('should return empty string when no ages', () => {
      expect(getAgeRangeLabel(undefined, undefined)).toBe('');
    });
  });

  describe('getWeightRangeLabel', () => {
    it('should format range with both min and max', () => {
      expect(getWeightRangeLabel(60, 70)).toBe('60-70 кг');
    });

    it('should format with only min weight', () => {
      expect(getWeightRangeLabel(60, undefined)).toBe('от 60 кг');
    });

    it('should format with only max weight', () => {
      expect(getWeightRangeLabel(undefined, 70)).toBe('до 70 кг');
    });

    it('should return empty string when no weights', () => {
      expect(getWeightRangeLabel(undefined, undefined)).toBe('');
    });
  });

  describe('getEnhancedCategoryName', () => {
    it('should return basic category name without extras', () => {
      const result = getEnhancedCategoryName(mockBracket1);
      expect(result).toBe('Мужчины, 18-30 лет, до 70 кг');
    });

    it('should include sport name when present', () => {
      const result = getEnhancedCategoryName(mockBracket3);
      expect(result).toContain('Грэпплинг');
      expect(result).toContain('Мужчины, 25-35 лет');
    });

    it('should include characteristics from characteristic_filters', () => {
      const result = getEnhancedCategoryName(mockBracket3);
      expect(result).toContain('[Уровень A, С кимоно]');
    });

    it('should use label from schema for gi discipline', () => {
      const result = getEnhancedCategoryName(mockBracket3);
      expect(result).toContain('С кимоно');
    });

    it('should use label from schema for no_gi discipline', () => {
      const result = getEnhancedCategoryName(mockBracket4);
      expect(result).toContain('Без кимоно');
    });

    it('should use label from schema for level', () => {
      const result = getEnhancedCategoryName(mockBracket3);
      expect(result).toContain('Уровень A');
    });

    it('should combine sport name, category name, and characteristics with labels', () => {
      const result = getEnhancedCategoryName(mockBracket3);
      expect(result).toBe('Грэпплинг - Мужчины, 25-35 лет [Уровень A, С кимоно]');
    });
  });
});
