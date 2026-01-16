import { useState } from 'react';
import type { Match } from '../../types';
import { ChevronDown, ChevronUp, Swords } from 'lucide-react';

interface NextMatchCardProps {
  nextMatch: Match | null;
  bracketName?: string;
  isLoading?: boolean;
}

/**
 * Плавающая карточка со следующим матчем для судьи
 * Показывается в правом нижнем углу MatchScreen (не заходит на красную область)
 */
export function NextMatchCard({ nextMatch, isLoading }: NextMatchCardProps) {
  const [isMinimized, setIsMinimized] = useState(false);

  // Если нет следующего матча и не загружается, не показываем карточку
  if (!nextMatch && !isLoading) {
    return null;
  }

  // Извлечь фамилию и имя из full_name
  const getFirstLastName = (fullName: string): string => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0]} ${parts[1]}`; // Фамилия Имя
    }
    return fullName;
  };

  // Свернутая версия
  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-slide-in-right">
        <button
          onClick={() => setIsMinimized(false)}
          className="bg-white/95 backdrop-blur-sm border-2 border-blue-500 rounded-lg px-4 py-2 shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105 flex items-center gap-2 text-sm font-medium text-gray-900"
        >
          <Swords size={16} className="text-blue-600" />
          <span>Следующий бой</span>
          <ChevronUp size={16} className="text-blue-600" />
        </button>
      </div>
    );
  }

  // Развернутая версия - размещается выше красной зоны
  return (
    <div className="fixed bottom-[52%] right-4 z-50 w-72 animate-slide-in-right">
      <div className="bg-white/95 backdrop-blur-sm border-2 border-blue-500 rounded-lg shadow-xl overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-3 py-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Swords size={16} className="text-white" />
            <span className="text-white font-semibold text-sm">Следующий бой</span>
          </div>
          <button
            onClick={() => setIsMinimized(true)}
            className="text-white/80 hover:text-white transition-colors"
            title="Свернуть"
          >
            <ChevronDown size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-3 space-y-2.5">
          {isLoading ? (
            <div className="text-center py-4 text-gray-500">
              <div className="animate-pulse text-sm">Загрузка...</div>
            </div>
          ) : nextMatch ? (
            <>
              {/* Синий участник (вверху) */}
              <div className="space-y-1">
                <div className="text-xs font-semibold text-blue-600 uppercase">Синий</div>
                {nextMatch.participant1 ? (
                  <div className="font-medium text-gray-900 text-sm">
                    {getFirstLastName(nextMatch.participant1.full_name)}
                  </div>
                ) : (
                  <div className="text-gray-400 italic text-sm">TBD</div>
                )}
              </div>

              {/* Разделитель */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-gray-300"></div>
                <span className="text-xs font-semibold text-gray-500">VS</span>
                <div className="flex-1 h-px bg-gray-300"></div>
              </div>

              {/* Красный участник (внизу) */}
              <div className="space-y-1">
                <div className="text-xs font-semibold text-red-600 uppercase">Красный</div>
                {nextMatch.participant2 ? (
                  <div className="font-medium text-gray-900 text-sm">
                    {getFirstLastName(nextMatch.participant2.full_name)}
                  </div>
                ) : (
                  <div className="text-gray-400 italic text-sm">TBD</div>
                )}
              </div>

              {/* Предупреждение если участники не определены */}
              {!nextMatch.participant1 || !nextMatch.participant2 ? (
                <div className="bg-yellow-50 border border-yellow-200 rounded px-2.5 py-2 text-xs text-yellow-800 mt-2">
                  ⏳ Участники будут определены после завершения других матчей
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-center py-4 text-gray-500 text-sm">
              Нет следующего матча в этой сетке
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
