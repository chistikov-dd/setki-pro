import { formatTime } from '../../lib/utils';
import type { Participant } from '../../types';

interface PublicDisplayProps {
  redFighter: Participant | null;
  blueFighter: Participant | null;
  redScore: number;
  blueScore: number;
  remainingSeconds: number;
  isRunning: boolean;
}

// Функция для форматирования имени без отчества
function formatName(fullName: string): string {
  if (!fullName) return '';
  const parts = fullName.trim().split(/\s+/);
  return parts.slice(0, 2).join(' ').toUpperCase();
}

export function PublicDisplay({
  redFighter,
  blueFighter,
  redScore,
  blueScore,
  remainingSeconds,
  isRunning,
}: PublicDisplayProps) {
  const timerColor = remainingSeconds === 0
    ? 'text-red-600'
    : isRunning
    ? 'text-green-600'
    : 'text-black';

  return (
    <div className="h-screen w-screen bg-white flex flex-col overflow-hidden p-6 lg:p-8">
      {/* Участники и счет */}
      <div className="grid grid-cols-2 gap-6 lg:gap-8 flex-none" style={{ height: '50vh' }}>
        {/* Синий угол (левый) */}
        <div className="bg-gradient-to-br from-blue-100 to-blue-200 border-4 border-blue-500 rounded-3xl p-4 lg:p-6 grid grid-rows-[1fr_auto] gap-2 overflow-hidden">
          {/* Информация об участнике */}
          <div className="flex flex-col justify-start min-h-0">
            <div className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl 2xl:text-7xl font-bold text-black leading-tight mb-2 lg:mb-3 break-words">
              {blueFighter?.full_name ? formatName(blueFighter.full_name) : 'УЧАСТНИК НЕ НАЗНАЧЕН'}
            </div>
            {blueFighter?.club_name && (
              <div className="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl 2xl:text-5xl text-gray-700 break-words">
                {blueFighter.club_name}
              </div>
            )}
          </div>
          {/* Баллы */}
          <div className="flex justify-end items-end">
            <div className="text-[150px] sm:text-[180px] md:text-[210px] lg:text-[240px] xl:text-[270px] 2xl:text-[300px] font-bold text-blue-600 leading-none">
              {blueScore}
            </div>
          </div>
        </div>

        {/* Красный угол (правый) */}
        <div className="bg-gradient-to-br from-red-100 to-red-200 border-4 border-red-500 rounded-3xl p-4 lg:p-6 grid grid-rows-[1fr_auto] gap-2 overflow-hidden">
          {/* Информация об участнике */}
          <div className="flex flex-col justify-start min-h-0">
            <div className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl 2xl:text-7xl font-bold text-black leading-tight mb-2 lg:mb-3 break-words">
              {redFighter?.full_name ? formatName(redFighter.full_name) : 'УЧАСТНИК НЕ НАЗНАЧЕН'}
            </div>
            {redFighter?.club_name && (
              <div className="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl 2xl:text-5xl text-gray-700 break-words">
                {redFighter.club_name}
              </div>
            )}
          </div>
          {/* Баллы */}
          <div className="flex justify-end items-end">
            <div className="text-[150px] sm:text-[180px] md:text-[210px] lg:text-[240px] xl:text-[270px] 2xl:text-[300px] font-bold text-red-600 leading-none">
              {redScore}
            </div>
          </div>
        </div>
      </div>

      {/* Таймер */}
      <div className="flex-1 flex items-center justify-center min-h-0">
        <div className={`text-[140px] sm:text-[180px] md:text-[220px] lg:text-[260px] xl:text-[300px] 2xl:text-[350px] font-mono font-bold ${timerColor} transition-colors leading-none`}>
          {formatTime(remainingSeconds)}
        </div>
      </div>
    </div>
  );
}
