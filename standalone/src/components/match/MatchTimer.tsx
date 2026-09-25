import { memo, useMemo } from 'react';
import { formatTime } from '../../lib/utils';

interface MatchTimerProps {
  remainingSeconds: number;
  isRunning: boolean;
  onStart?: () => void;
  onPause?: () => void;
  onReset?: () => void;
  onClick?: () => void;
}

// Базовый компонент MatchTimer
function MatchTimerBase({
  remainingSeconds,
  isRunning,
  onClick,
}: MatchTimerProps) {
  // Мемоизируем цвет таймера для избежания пересчета при каждом рендере
  const timerColor = useMemo(() => {
    if (remainingSeconds === 0) return 'text-red-500';
    if (remainingSeconds <= 10) return 'text-red-500';
    if (!isRunning) return 'text-gray-800';
    return 'text-green-400';
  }, [remainingSeconds, isRunning]);

  return (
    <div className="h-full flex items-center justify-center select-none">
      {/* Timer Display - адаптивный размер */}
      <div
        className={`text-[60px] sm:text-[80px] md:text-[100px] lg:text-[140px] xl:text-[180px] 2xl:text-[200px] font-mono font-bold ${timerColor} transition-colors leading-none select-none ${onClick && !isRunning ? 'cursor-pointer hover:opacity-80' : ''}`}
        onClick={onClick}
      >
        {formatTime(remainingSeconds)}
      </div>
    </div>
  );
}

// Мемоизированная версия компонента
// Оптимизация: ре-рендер только при изменении remainingSeconds или isRunning
export const MatchTimer = memo(MatchTimerBase, (prevProps, nextProps) => {
  // Сравниваем только значимые пропсы
  if (prevProps.remainingSeconds !== nextProps.remainingSeconds) return false;
  if (prevProps.isRunning !== nextProps.isRunning) return false;
  // onClick callback не сравниваем - должен быть стабильным через useCallback
  return true; // Пропсы равны, ре-рендер не нужен
});
