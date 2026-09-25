import { describe, it, expect } from 'vitest';
import { buildCategoriesFromBrackets, filterBracketsByCategory } from '../../utils/categoryGrouping';
import type { Bracket } from '../../types';

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

describe('categoryGrouping', () => {
  it('builds a unique category list from brackets grouped by category_id', () => {
    const brackets: Bracket[] = [
      makeBracket({ id: 1, category_id: 10, category_name: 'Мужчины до 70 кг' }),
      makeBracket({ id: 2, category_id: 10, category_name: 'Мужчины до 70 кг' }),
      makeBracket({ id: 3, category_id: 20, category_name: 'Женщины до 60 кг' }),
    ];

    const categories = buildCategoriesFromBrackets(brackets);

    expect(categories).toHaveLength(2);
    expect(categories.map((c) => c.name).sort()).toEqual(['Женщины до 60 кг', 'Мужчины до 70 кг']);
  });

  it('falls back to grouping by category_name when category_id is missing', () => {
    const brackets: Bracket[] = [
      makeBracket({ id: 1, category_id: null, category_name: 'Без ID' }),
      makeBracket({ id: 2, category_id: null, category_name: 'Без ID' }),
    ];

    const categories = buildCategoriesFromBrackets(brackets);
    expect(categories).toHaveLength(1);
    expect(categories[0].name).toBe('Без ID');
  });

  it('filters brackets belonging to a given category by id', () => {
    const brackets: Bracket[] = [
      makeBracket({ id: 1, category_id: 10, category_name: 'A' }),
      makeBracket({ id: 2, category_id: 20, category_name: 'B' }),
    ];
    const categories = buildCategoriesFromBrackets(brackets);
    const categoryA = categories.find((c) => c.name === 'A')!;

    const filtered = filterBracketsByCategory(brackets, categoryA);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(1);
  });

  it('filters brackets belonging to a given category by name when id is null', () => {
    const brackets: Bracket[] = [
      makeBracket({ id: 1, category_id: null, category_name: 'Без категории' }),
      makeBracket({ id: 2, category_id: 20, category_name: 'B' }),
    ];
    const categories = buildCategoriesFromBrackets(brackets);
    const target = categories.find((c) => c.name === 'Без категории')!;

    const filtered = filterBracketsByCategory(brackets, target);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe(1);
  });

  it('returns an empty list for an empty bracket array', () => {
    expect(buildCategoriesFromBrackets([])).toEqual([]);
  });
});
