import { describe, it, expect } from 'vitest';
import { parseAgeRangeFromCategoryName } from '../../utils/parseAgeFromCategoryName';

describe('parseAgeRangeFromCategoryName', () => {
  // Позитивные кейсы — реальные названия категорий из tournament_68_*.json
  // (все 89 сеток этого файла имеют min_age/max_age == null, но возраст закодирован
  // в самом названии в формате "N - M лет").
  it('parses "Девочки, 10 - 11 лет, до 27 кг [B]" as 10-11', () => {
    expect(parseAgeRangeFromCategoryName('Девочки, 10 - 11 лет, до 27 кг [B]')).toEqual({ min: 10, max: 11 });
  });

  it('parses "Мужчины, 20 - 30 лет, до 100 кг [B]" as 20-30', () => {
    expect(parseAgeRangeFromCategoryName('Мужчины, 20 - 30 лет, до 100 кг [B]')).toEqual({ min: 20, max: 30 });
  });

  it('parses "Юниоры, 18 - 20 лет, до 66 кг [B]" as 18-20', () => {
    expect(parseAgeRangeFromCategoryName('Юниоры, 18 - 20 лет, до 66 кг [B]')).toEqual({ min: 18, max: 20 });
  });

  it('parses age (16-17), not the weight range, from "Старшие юноши, 16 - 17 лет, 63-110 кг [A]"', () => {
    // Это название содержит ДВА похожих по форме диапазона: "16 - 17" (возраст, с пробелами
    // вокруг дефиса, за которым следует "лет") и "63-110" (вес, без пробелов, за которым
    // следует "кг", а не "лет"). Регулярка должна выбрать именно возрастной диапазон.
    expect(parseAgeRangeFromCategoryName('Старшие юноши, 16 - 17 лет, 63-110 кг [A]')).toEqual({ min: 16, max: 17 });
  });

  it('parses a hyphen with no surrounding spaces ("18-19 лет") too', () => {
    expect(parseAgeRangeFromCategoryName('Юниоры, 18-19 лет, до 62 кг [B]')).toEqual({ min: 18, max: 19 });
  });

  // Негативные кейсы

  it('returns null when the category name has no age at all', () => {
    expect(parseAgeRangeFromCategoryName('до 71 кг')).toBeNull();
  });

  it('returns null for a bare weight range without "лет" nearby ("63-110 кг")', () => {
    // Изолированный кейс без слова "лет" вообще рядом с диапазоном — не должен ложно
    // распознаваться как возраст.
    expect(parseAgeRangeFromCategoryName('63-110 кг')).toBeNull();
  });

  it('returns null for a non-standard/malformed category name instead of throwing', () => {
    expect(() => parseAgeRangeFromCategoryName('Абвгд ??? без формата')).not.toThrow();
    expect(parseAgeRangeFromCategoryName('Абвгд ??? без формата')).toBeNull();
  });

  it('returns null for empty, null or undefined input', () => {
    expect(parseAgeRangeFromCategoryName('')).toBeNull();
    expect(parseAgeRangeFromCategoryName(null)).toBeNull();
    expect(parseAgeRangeFromCategoryName(undefined)).toBeNull();
  });
});
