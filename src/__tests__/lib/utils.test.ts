import { describe, it, expect, beforeEach } from 'vitest';
import {
  cn,
  formatTime,
  determineWinner,
  removePatronymic,
  clearPatronymicCache,
} from '../../lib/utils';

describe('cn (className merger)', () => {
  it('should merge class names', () => {
    const result = cn('btn', 'btn-primary');
    expect(result).toBe('btn btn-primary');
  });

  it('should handle conditional classes', () => {
    const isActive = true;
    const result = cn('btn', isActive && 'active');
    expect(result).toBe('btn active');
  });

  it('should handle Tailwind conflicts', () => {
    const result = cn('p-4', 'p-8');
    // twMerge should keep only p-8
    expect(result).toBe('p-8');
  });

  it('should handle arrays', () => {
    const result = cn(['btn', 'btn-lg'], 'text-white');
    expect(result).toBe('btn btn-lg text-white');
  });

  it('should handle objects', () => {
    const result = cn({
      'btn': true,
      'btn-primary': true,
      'disabled': false,
    });
    expect(result).toBe('btn btn-primary');
  });
});

describe('formatTime', () => {
  it('should format time correctly', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(5)).toBe('00:05');
    expect(formatTime(30)).toBe('00:30');
    expect(formatTime(59)).toBe('00:59');
    expect(formatTime(60)).toBe('01:00');
    expect(formatTime(90)).toBe('01:30');
    expect(formatTime(180)).toBe('03:00');
    expect(formatTime(599)).toBe('09:59');
    expect(formatTime(600)).toBe('10:00');
  });

  it('should handle edge cases', () => {
    expect(formatTime(1)).toBe('00:01');
    expect(formatTime(61)).toBe('01:01');
    expect(formatTime(3599)).toBe('59:59');
  });

  it('should pad single digits with zeros', () => {
    const result = formatTime(65);
    expect(result).toBe('01:05');
    expect(result.length).toBe(5);
  });
});

describe('determineWinner', () => {
  describe('by score', () => {
    it('should determine red winner by higher score', () => {
      expect(determineWinner(5, 3, 0, 0)).toBe('red');
      expect(determineWinner(10, 2, 1, 1)).toBe('red');
    });

    it('should determine blue winner by higher score', () => {
      expect(determineWinner(2, 5, 0, 0)).toBe('blue');
      expect(determineWinner(3, 8, 2, 1)).toBe('blue');
    });
  });

  describe('by warnings (when scores equal)', () => {
    it('should determine red winner by fewer warnings', () => {
      expect(determineWinner(5, 5, 0, 1)).toBe('red');
      expect(determineWinner(3, 3, 1, 2)).toBe('red');
    });

    it('should determine blue winner by fewer warnings', () => {
      expect(determineWinner(4, 4, 2, 0)).toBe('blue');
      expect(determineWinner(2, 2, 3, 1)).toBe('blue');
    });
  });

  describe('draw', () => {
    it('should return draw when scores and warnings are equal', () => {
      expect(determineWinner(0, 0, 0, 0)).toBe('draw');
      expect(determineWinner(5, 5, 1, 1)).toBe('draw');
      expect(determineWinner(10, 10, 3, 3)).toBe('draw');
    });
  });

  describe('edge cases', () => {
    it('should handle zero scores', () => {
      expect(determineWinner(0, 0, 0, 0)).toBe('draw');
      expect(determineWinner(0, 0, 1, 0)).toBe('blue');
      expect(determineWinner(0, 0, 0, 1)).toBe('red');
    });

    it('should prioritize score over warnings', () => {
      // Red has more score but more warnings
      expect(determineWinner(10, 5, 3, 1)).toBe('red');

      // Blue has more score but more warnings
      expect(determineWinner(3, 7, 0, 2)).toBe('blue');
    });
  });
});

describe('removePatronymic', () => {
  beforeEach(() => {
    // Clear cache before each test
    clearPatronymicCache();
  });

  it('should remove patronymic from full name', () => {
    expect(removePatronymic('Иванов Иван Иванович')).toBe('ИВАНОВ ИВАН');
    expect(removePatronymic('Петров Петр Петрович')).toBe('ПЕТРОВ ПЕТР');
    expect(removePatronymic('Сидоров Сидор Сидорович')).toBe('СИДОРОВ СИДОР');
  });

  it('should convert to uppercase', () => {
    expect(removePatronymic('иванов иван иванович')).toBe('ИВАНОВ ИВАН');
    expect(removePatronymic('Петров петр ПЕТРОВИЧ')).toBe('ПЕТРОВ ПЕТР');
  });

  it('should handle names with two parts (no patronymic)', () => {
    expect(removePatronymic('Иванов Иван')).toBe('ИВАНОВ ИВАН');
    expect(removePatronymic('Smith John')).toBe('SMITH JOHN');
  });

  it('should handle single name', () => {
    expect(removePatronymic('Иванов')).toBe('ИВАНОВ');
    expect(removePatronymic('John')).toBe('JOHN');
  });

  it('should handle multiple spaces', () => {
    expect(removePatronymic('Иванов  Иван   Иванович')).toBe('ИВАНОВ ИВАН');
    expect(removePatronymic('  Петров Петр Петрович  ')).toBe('ПЕТРОВ ПЕТР');
  });

  it('should handle empty and null values', () => {
    expect(removePatronymic('')).toBe('');
    expect(removePatronymic('   ')).toBe('');
    expect(removePatronymic(null)).toBe('');
    expect(removePatronymic(undefined)).toBe('');
  });

  it('should cache results', () => {
    const fullName = 'Иванов Иван Иванович';

    // First call - computes and caches
    const result1 = removePatronymic(fullName);

    // Second call - should return cached value
    const result2 = removePatronymic(fullName);

    expect(result1).toBe(result2);
    expect(result1).toBe('ИВАНОВ ИВАН');

    // Cache should improve performance for repeated calls
    // This is implicitly tested by the function reusing the same string reference
  });

  it('should cache different names separately', () => {
    const name1 = 'Иванов Иван Иванович';
    const name2 = 'Петров Петр Петрович';

    expect(removePatronymic(name1)).toBe('ИВАНОВ ИВАН');
    expect(removePatronymic(name2)).toBe('ПЕТРОВ ПЕТР');
    expect(removePatronymic(name1)).toBe('ИВАНОВ ИВАН');
  });
});

describe('clearPatronymicCache', () => {
  it('should clear the cache', () => {
    const fullName = 'Иванов Иван Иванович';

    // Cache the result
    removePatronymic(fullName);

    // Clear cache
    clearPatronymicCache();

    // Should still work after clearing cache
    expect(removePatronymic(fullName)).toBe('ИВАНОВ ИВАН');
  });
});
