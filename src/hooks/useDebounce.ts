import { useEffect, useState } from 'react';

/**
 * Hook для debounce значения (задержка обновления)
 * @param value - Значение для debounce
 * @param delay - Задержка в миллисекундах (по умолчанию 300ms)
 * @returns Debounced значение
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Установить таймер для обновления debounced значения
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    // Очистить таймер при изменении value или delay
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
