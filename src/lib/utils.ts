import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Форматирование времени для таймера
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Определение победителя по очкам
export function determineWinner(
  redScore: number,
  blueScore: number,
  redWarnings: number,
  blueWarnings: number
): 'red' | 'blue' | 'draw' {
  if (redScore > blueScore) return 'red';
  if (blueScore > redScore) return 'blue';

  // При равенстве очков - по предупреждениям (меньше = лучше)
  if (redWarnings < blueWarnings) return 'red';
  if (blueWarnings < redWarnings) return 'blue';

  return 'draw';
}

/**
 * Кэш для removePatronymic функции
 * Оптимизация: 254 парсинга строк → 0 при рендере TournamentBracket
 */
const removePatronymicCache = new Map<string, string>();

/**
 * Удаление отчества с кэшированием результата
 * "Иванов Иван Иванович" → "ИВАНОВ ИВАН"
 *
 * Производительность:
 * - Без кэша: 254 вызова split() + slice() + join() на каждом рендере
 * - С кэшем: O(1) lookup для всех повторных вызовов
 *
 * @param fullName - полное ФИО участника
 * @returns Фамилия Имя в верхнем регистре, без отчества
 */
export function removePatronymic(fullName: string | undefined | null): string {
  if (!fullName) return '';

  // Проверяем кэш
  const cached = removePatronymicCache.get(fullName);
  if (cached !== undefined) {
    return cached;
  }

  // Вычисляем результат
  const parts = fullName.trim().split(/\s+/);
  const result = parts.slice(0, 2).join(' ').toUpperCase();

  // Сохраняем в кэш
  removePatronymicCache.set(fullName, result);

  return result;
}

/**
 * Очистка кэша removePatronymic (для тестов или смены турнира)
 */
export function clearPatronymicCache(): void {
  removePatronymicCache.clear();
}
