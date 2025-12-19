import { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Возвращаемое значение хука useMatchTimer
 */
interface UseMatchTimerReturn {
  remainingSeconds: number;
  isRunning: boolean;
  start: () => void;
  pause: () => void;
  reset: (totalSeconds: number) => void;
  setDuration: (seconds: number) => void;
}

/**
 * Хук для управления таймером матча с использованием requestAnimationFrame
 * вместо setInterval для более точного тайминга и лучшей производительности.
 *
 * Преимущества перед setInterval:
 * - Не триггерит обновления Zustand store каждую секунду
 * - requestAnimationFrame автоматически паузится при неактивном окне
 * - Более точный тайминг (компенсация drift)
 * - Меньше нагрузки на CPU
 *
 * @param initialSeconds - начальное количество секунд
 * @returns объект с состоянием таймера и методами управления
 */
export function useMatchTimer(initialSeconds: number): UseMatchTimerReturn {
  const [remainingSeconds, setRemainingSeconds] = useState(initialSeconds);
  const [_totalSeconds, setTotalSeconds] = useState(initialSeconds);
  const [isRunning, setIsRunning] = useState(false);

  const rafIdRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  const tick = useCallback((timestamp: number) => {
    if (!lastTickRef.current) {
      lastTickRef.current = timestamp;
    }

    const elapsed = timestamp - lastTickRef.current;

    // Обновляем каждую секунду (1000ms)
    if (elapsed >= 1000) {
      setRemainingSeconds(prev => {
        const next = prev - 1;
        if (next <= 0) {
          setIsRunning(false);
          return 0;
        }
        return next;
      });
      lastTickRef.current = timestamp;
    }

    rafIdRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (isRunning) {
      lastTickRef.current = 0;
      rafIdRef.current = requestAnimationFrame(tick);
    } else {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      lastTickRef.current = 0;
    }

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [isRunning, tick]);

  const start = useCallback(() => setIsRunning(true), []);
  const pause = useCallback(() => setIsRunning(false), []);
  const reset = useCallback((total: number) => {
    setIsRunning(false);
    setRemainingSeconds(total);
    setTotalSeconds(total);
  }, []);
  const setDuration = useCallback((seconds: number) => {
    setIsRunning(false);
    setRemainingSeconds(seconds);
    setTotalSeconds(seconds);
  }, []);

  return { remainingSeconds, isRunning, start, pause, reset, setDuration };
}
