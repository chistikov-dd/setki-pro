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
    ? 'text-red-500'
    : isRunning
    ? 'text-green-400'
    : 'text-gray-800';

  return (
    <div className="h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-100 flex flex-col p-4 sm:p-6 lg:p-8">
      {/* Таймер */}
      <div className="flex-1 flex items-center justify-center mb-4 sm:mb-6 lg:mb-8">
        <div className={`text-[100px] sm:text-[140px] md:text-[180px] lg:text-[220px] xl:text-[260px] 2xl:text-[300px] font-mono font-bold ${timerColor} transition-colors leading-none`}>
          {formatTime(remainingSeconds)}
        </div>
      </div>

      {/* Участники и счет */}
      <div className="grid grid-cols-2 gap-4 sm:gap-6 lg:gap-8 h-[40vh]">
        {/* Красный угол (левый) */}
        <div className="bg-gradient-to-br from-red-600/20 to-red-900/30 border-2 sm:border-3 lg:border-4 border-red-500/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 flex flex-col justify-between">
          <div>
            <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-white leading-none mb-2 sm:mb-3 lg:mb-4">
              {redFighter?.full_name ? formatName(redFighter.full_name) : 'УЧАСТНИК НЕ НАЗНАЧЕН'}
            </div>
            {redFighter?.club_name && (
              <div className="text-lg sm:text-xl md:text-2xl lg:text-3xl text-gray-800 truncate">
                {redFighter.club_name}
              </div>
            )}
          </div>
          <div className="text-[60px] sm:text-[80px] md:text-[120px] lg:text-[160px] xl:text-[200px] font-bold text-red-500 leading-none text-right">
            {redScore}
          </div>
        </div>

        {/* Синий угол (правый) */}
        <div className="bg-gradient-to-br from-blue-600/20 to-blue-900/30 border-2 sm:border-3 lg:border-4 border-blue-500/50 rounded-2xl sm:rounded-3xl p-4 sm:p-6 lg:p-8 flex flex-col justify-between">
          <div>
            <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-white leading-none mb-2 sm:mb-3 lg:mb-4">
              {blueFighter?.full_name ? formatName(blueFighter.full_name) : 'УЧАСТНИК НЕ НАЗНАЧЕН'}
            </div>
            {blueFighter?.club_name && (
              <div className="text-lg sm:text-xl md:text-2xl lg:text-3xl text-gray-800 truncate">
                {blueFighter.club_name}
              </div>
            )}
          </div>
          <div className="text-[60px] sm:text-[80px] md:text-[120px] lg:text-[160px] xl:text-[200px] font-bold text-blue-500 leading-none text-right">
            {blueScore}
          </div>
        </div>
      </div>
    </div>
  );
}
