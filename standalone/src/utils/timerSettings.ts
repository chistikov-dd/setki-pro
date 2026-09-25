/**
 * Утилиты для работы с настройками таймера
 * Сохраняет введённое судьёй время таймера между матчами
 */

const TIMER_SETTINGS_KEY = 'setki_timer_duration';
const DEFAULT_TIMER_SECONDS = 300; // 5 минут по умолчанию

/**
 * Сохранить время таймера в localStorage
 * @param seconds - время в секундах
 */
export function saveTimerDuration(seconds: number): void {
  try {
    localStorage.setItem(TIMER_SETTINGS_KEY, seconds.toString());
  } catch (error) {
    console.error('[timerSettings] Failed to save timer duration:', error);
  }
}

/**
 * Загрузить сохранённое время таймера из localStorage
 * @returns время в секундах (по умолчанию 300 секунд = 5 минут)
 */
export function loadTimerDuration(): number {
  try {
    const saved = localStorage.getItem(TIMER_SETTINGS_KEY);
    if (saved) {
      const parsed = parseInt(saved, 10);
      // Валидация: проверяем что значение разумное (от 1 до 3600 секунд = 1 час)
      if (!isNaN(parsed) && parsed > 0 && parsed <= 3600) {
        return parsed;
      }
    }
  } catch (error) {
    console.error('[timerSettings] Failed to load timer duration:', error);
  }
  return DEFAULT_TIMER_SECONDS;
}

/**
 * Очистить сохранённое время таймера
 */
export function clearTimerDuration(): void {
  try {
    localStorage.removeItem(TIMER_SETTINGS_KEY);
  } catch (error) {
    console.error('[timerSettings] Failed to clear timer duration:', error);
  }
}
