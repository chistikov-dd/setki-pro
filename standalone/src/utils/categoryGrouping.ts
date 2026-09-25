import type { Bracket, Category } from '../types';

/**
 * Построить список уникальных категорий из списка сеток турнира.
 * В standalone-версии категория = группа сеток с одинаковым category_id
 * (или category_name, если category_id отсутствует).
 */
export function buildCategoriesFromBrackets(brackets: Bracket[]): Category[] {
  const seen = new Map<string, Category>();

  for (const bracket of brackets) {
    const key = bracket.category_id != null ? `id:${bracket.category_id}` : `name:${bracket.category_name}`;
    if (!seen.has(key)) {
      seen.set(key, {
        id: bracket.category_id ?? null,
        name: bracket.category_name || 'Без категории',
      });
    }
  }

  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

/**
 * Отфильтровать сетки, принадлежащие конкретной категории.
 */
export function filterBracketsByCategory(brackets: Bracket[], category: Category): Bracket[] {
  return brackets.filter((bracket) => {
    if (category.id != null) {
      return bracket.category_id === category.id;
    }
    return (bracket.category_name || 'Без категории') === category.name;
  });
}
