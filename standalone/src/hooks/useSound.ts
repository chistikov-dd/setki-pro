import { useRef, useCallback } from 'react';

/**
 * Типы звуков для судейского приложения
 */
export type SoundType = 'score' | 'warning' | 'start' | 'end' | 'timer';

/**
 * Hook для проигрывания звуковых эффектов через Web Audio API
 * Генерирует звуки программно без необходимости аудиофайлов
 *
 * @example
 * const { playSound } = useSound();
 * playSound('score', 1); // Проиграть звук за 1 балл
 * playSound('warning'); // Проиграть звук предупреждения
 */
export function useSound() {
  const audioContextRef = useRef<AudioContext | null>(null);

  // Получить или создать AudioContext
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  /**
   * Проиграть звук
   * @param type - тип звука
   * @param points - количество баллов (только для type='score')
   */
  const playSound = useCallback((type: SoundType, points?: number) => {
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    switch (type) {
      case 'score': {
        // Разные частоты для разных баллов
        const frequencies = [523.25, 587.33, 659.25, 698.46]; // C5, D5, E5, F5
        const frequency = frequencies[(points || 1) - 1] || frequencies[0];

        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;

        // Envelope: плавное появление и затухание
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.3, now + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

        oscillator.start(now);
        oscillator.stop(now + 0.15);
        break;
      }

      case 'warning': {
        // Низкий предупреждающий звук
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sawtooth';
        oscillator.frequency.value = 220; // A3 - низкий тон

        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.2, now + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

        oscillator.start(now);
        oscillator.stop(now + 0.4);
        break;
      }

      case 'start': {
        // Восходящий тон для начала матча
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(440, now); // A4
        oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.3); // A5

        gainNode.gain.setValueAtTime(0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

        oscillator.start(now);
        oscillator.stop(now + 0.3);
        break;
      }

      case 'end': {
        // Нисходящий тон для конца матча
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(880, now); // A5
        oscillator.frequency.exponentialRampToValueAtTime(440, now + 0.5); // A4

        gainNode.gain.setValueAtTime(0.3, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

        oscillator.start(now);
        oscillator.stop(now + 0.5);
        break;
      }

      case 'timer': {
        // Короткий beep для последних секунд таймера
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'square';
        oscillator.frequency.value = 1000; // 1kHz

        gainNode.gain.setValueAtTime(0.15, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);

        oscillator.start(now);
        oscillator.stop(now + 0.1);
        break;
      }
    }
  }, [getAudioContext]);

  return { playSound };
}
