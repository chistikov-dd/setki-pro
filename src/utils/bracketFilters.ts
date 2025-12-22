import type { BracketResponse, BracketFilters } from '../types';

/**
 * Извлечь пол из названия категории
 */
function extractGenderFromName(categoryName: string): 'male' | 'female' | 'mixed' {
  const lower = categoryName.toLowerCase();
  if (lower.includes('мужч') || lower.includes('мальч')) return 'male';
  if (lower.includes('женщ') || lower.includes('девуш') || lower.includes('девоч')) return 'female';
  return 'mixed';
}

/**
 * Извлечь минимальный возраст из названия категории
 */
function extractMinAgeFromName(categoryName: string): number {
  // Ищем паттерны: "4 - 5 лет", "16-17 лет", "8 - 9 лет"
  const ageMatch = categoryName.match(/(\d+)\s*[-–]\s*\d+\s*лет/);
  if (ageMatch) return parseInt(ageMatch[1]);

  // Ищем "Взрослые"
  if (categoryName.toLowerCase().includes('взрослые')) return 18;

  return 999; // Неизвестный возраст - в конец
}

/**
 * Извлечь максимальный возраст из названия категории
 */
function extractMaxAgeFromName(categoryName: string): number {
  // Ищем паттерны: "4 - 5 лет", "16-17 лет", "8 - 9 лет"
  const ageMatch = categoryName.match(/\d+\s*[-–]\s*(\d+)\s*лет/);
  if (ageMatch) return parseInt(ageMatch[1]);

  return 999; // Неизвестный возраст - в конец
}

/**
 * Извлечь максимальный вес из названия категории
 */
function extractMaxWeightFromName(categoryName: string): number {
  // Ищем паттерны: "до 18 кг", "до 43 кг"
  const weightMatch = categoryName.match(/до\s+(\d+)\s*кг/);
  if (weightMatch) return parseInt(weightMatch[1]);

  return 999; // Неизвестный вес - в конец
}

/**
 * Обогатить данные сетки информацией из названия категории
 */
function enrichBracketData(bracket: BracketResponse): BracketResponse {
  if (!bracket.gender) {
    bracket.gender = extractGenderFromName(bracket.category_name);
  }
  if (!bracket.min_age) {
    bracket.min_age = extractMinAgeFromName(bracket.category_name);
  }
  if (!bracket.max_age) {
    bracket.max_age = extractMaxAgeFromName(bracket.category_name);
  }
  if (!bracket.max_weight) {
    bracket.max_weight = extractMaxWeightFromName(bracket.category_name);
  }
  return bracket;
}

/**
 * Функция сортировки сеток
 * Сортировка: пол (М→Ж) → возраст (младшие→старшие) → вес (легкие→тяжелые)
 */
export function sortBrackets(brackets: BracketResponse[]): BracketResponse[] {
  // Обогащаем данные перед сортировкой
  const enriched = brackets.map(enrichBracketData);

  return [...enriched].sort((a, b) => {
    // 1. Сортировка по полу: male (1) → female (2) → mixed (3)
    const genderOrder = { male: 1, female: 2, mixed: 3 };
    const genderA = genderOrder[a.gender || 'mixed'];
    const genderB = genderOrder[b.gender || 'mixed'];

    if (genderA !== genderB) {
      return genderA - genderB;
    }

    // 2. Сортировка по возрасту (по min_age, от младших к старшим)
    const ageA = a.min_age ?? 999;
    const ageB = b.min_age ?? 999;

    if (ageA !== ageB) {
      return ageA - ageB;
    }

    // 3. Сортировка по весу (по max_weight, от легких к тяжелым)
    const weightA = a.max_weight ?? 999;
    const weightB = b.max_weight ?? 999;

    if (weightA !== weightB) {
      return weightA - weightB;
    }

    // 4. Если все равны, сортировать по ID
    return a.id - b.id;
  });
}

/**
 * Функция фильтрации сеток
 */
export function filterBrackets(
  brackets: BracketResponse[],
  filters: BracketFilters,
  participantsByBracket?: Record<number, string[]>
): BracketResponse[] {
  // Обогащаем данные перед фильтрацией
  const enriched = brackets.map(enrichBracketData);

  return enriched.filter((bracket) => {
    // Фильтр по полу
    if (filters.gender !== 'all' && bracket.gender !== filters.gender) {
      return false;
    }

    // Фильтр по имени участника (поиск)
    if (filters.searchQuery.trim() !== '') {
      const query = filters.searchQuery.toLowerCase().trim();

      // Поиск в названии категории
      const categoryMatch = bracket.category_name.toLowerCase().includes(query);

      // Поиск в именах участников
      let participantMatch = false;
      if (participantsByBracket && participantsByBracket[bracket.id]) {
        participantMatch = participantsByBracket[bracket.id].some(name =>
          name.toLowerCase().includes(query)
        );
      }

      if (!categoryMatch && !participantMatch) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Применить сортировку и фильтрацию к сеткам
 */
export function applySortAndFilter(
  brackets: BracketResponse[],
  filters: BracketFilters,
  participantsByBracket?: Record<number, string[]>
): BracketResponse[] {
  // Сначала фильтруем, потом сортируем
  const filtered = filterBrackets(brackets, filters, participantsByBracket);
  return sortBrackets(filtered);
}

/**
 * Получить читабельное название пола
 */
export function getGenderLabel(gender: 'male' | 'female' | 'mixed' | undefined): string {
  switch (gender) {
    case 'male':
      return 'Мужчины';
    case 'female':
      return 'Женщины';
    case 'mixed':
      return 'Смешанные';
    default:
      return 'Не указан';
  }
}

/**
 * Получить форматированный диапазон возраста
 */
export function getAgeRangeLabel(minAge?: number, maxAge?: number): string {
  if (!minAge && !maxAge) return '';
  if (minAge && maxAge) return `${minAge}-${maxAge} лет`;
  if (minAge) return `от ${minAge} лет`;
  if (maxAge) return `до ${maxAge} лет`;
  return '';
}

/**
 * Получить форматированный диапазон веса
 */
export function getWeightRangeLabel(minWeight?: number, maxWeight?: number): string {
  if (!minWeight && !maxWeight) return '';
  if (minWeight && maxWeight) return `${minWeight}-${maxWeight} кг`;
  if (minWeight) return `от ${minWeight} кг`;
  if (maxWeight) return `до ${maxWeight} кг`;
  return '';
}
