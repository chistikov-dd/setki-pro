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
      {/* Таймер */}
      <div className="flex-1 flex items-center justify-center min-h-0">
        <div className={`text-[100px] sm:text-[130px] md:text-[160px] lg:text-[190px] xl:text-[220px] 2xl:text-[250px] font-mono font-bold ${timerColor} transition-colors leading-none`}>
          {formatTime(remainingSeconds)}
        </div>
      </div>

      {/* Участники и счет */}
      <div className="grid grid-cols-2 gap-6 lg:gap-8 flex-none" style={{ height: '42vh' }}>
        {/* Синий угол (левый) */}
        <div className="bg-gradient-to-br from-blue-100 to-blue-200 border-4 border-blue-500 rounded-3xl p-4 lg:p-6 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col justify-start pb-2">
            <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-black leading-tight mb-1 lg:mb-2 break-words">
              {blueFighter?.full_name ? formatName(blueFighter.full_name) : 'УЧАСТНИК НЕ НАЗНАЧЕН'}
            </div>
            {blueFighter?.club_name && (
              <div className="text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl text-gray-700 break-words">
                {blueFighter.club_name}
              </div>
            )}
          </div>
          <div className="flex-shrink-0 text-[80px] sm:text-[100px] md:text-[130px] lg:text-[160px] xl:text-[200px] font-bold text-blue-600 leading-none text-right">
            {blueScore}
          </div>
        </div>

        {/* Красный угол (правый) */}
        <div className="bg-gradient-to-br from-red-100 to-red-200 border-4 border-red-500 rounded-3xl p-4 lg:p-6 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 flex flex-col justify-start pb-2">
            <div className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl font-bold text-black leading-tight mb-1 lg:mb-2 break-words">
              {redFighter?.full_name ? formatName(redFighter.full_name) : 'УЧАСТНИК НЕ НАЗНАЧЕН'}
            </div>
            {redFighter?.club_name && (
              <div className="text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl text-gray-700 break-words">
                {redFighter.club_name}
              </div>
            )}
          </div>
          <div className="flex-shrink-0 text-[80px] sm:text-[100px] md:text-[130px] lg:text-[160px] xl:text-[200px] font-bold text-red-600 leading-none text-right">
            {redScore}
          </div>
        </div>
      </div>
    </div>
  );
}
