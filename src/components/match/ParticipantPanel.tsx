import { memo } from 'react';
import type { Participant } from '../../types';
import { Button } from '../ui/Button';
import { removePatronymic } from '../../lib/utils';

interface ParticipantPanelProps {
  participant: Participant | null;
  score: number;
  warnings: number;
  color: 'red' | 'blue';
  onAddScore?: (points: number, actionName: string) => void;
  onAddWarning?: () => void;
  onRemoveWarning?: () => void;
  hotkeys?: string[];
  maxWarnings?: number;
}

// Базовый компонент ParticipantPanel
function ParticipantPanelBase({
  participant,
  score,
  warnings,
  color,
  onAddScore,
  onAddWarning,
  onRemoveWarning,
  hotkeys = [],
  maxWarnings = 3,
}: ParticipantPanelProps) {
  const bgGradient = color === 'red'
    ? 'bg-gradient-to-b from-red-600/20 to-red-900/20'
    : 'bg-gradient-to-b from-blue-600/20 to-blue-900/20';

  const borderColor = color === 'red' ? 'border-red-500/50' : 'border-blue-500/50';
  const scoreColor = color === 'red' ? 'text-red-500' : 'text-blue-500';

  // Обработка кликов по счёту: ЛКМ +1, ПКМ -1
  const handleScoreClick = (e: React.MouseEvent) => {
    console.log('[ParticipantPanel] Score clicked (+1):', { color, hasCallback: !!onAddScore });
    e.preventDefault();
    e.stopPropagation();
    if (onAddScore) {
      console.log('[ParticipantPanel] Calling onAddScore(+1)...');
      onAddScore(1, '+1');
    }
  };

  const handleScoreContextMenu = (e: React.MouseEvent) => {
    console.log('[ParticipantPanel] Score right-clicked (-1):', { color, hasCallback: !!onAddScore });
    e.preventDefault();
    e.stopPropagation();
    if (onAddScore) {
      console.log('[ParticipantPanel] Calling onAddScore(-1)...');
      onAddScore(-1, '-1');
    }
  };

  return (
    <div
      className={`${bgGradient} border ${borderColor} h-full w-full flex flex-col p-2 sm:p-3 lg:p-4 select-none overflow-hidden`}
    >
      {/* Main info area */}
      <div className="flex-1 flex items-center justify-between gap-2 mb-1 sm:mb-2 min-w-0">
        {/* Participant Info */}
        <div className="flex-1 min-w-0 overflow-hidden pr-2">
          <div className="text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl font-bold text-gray-900 leading-none mb-1 sm:mb-2 break-words">
            {participant?.full_name ? removePatronymic(participant.full_name) : 'УЧАСТНИК НЕ НАЗНАЧЕН'}
          </div>
          {participant?.club_name && (
            <div className="text-sm sm:text-base lg:text-lg text-gray-800 truncate">
              {participant.club_name}
            </div>
          )}

          {/* Warnings */}
          <div className="flex items-center gap-3 mt-2">
            <span className="text-base sm:text-lg md:text-xl font-semibold text-gray-900">Предупреждения:</span>
            <div className="flex gap-2">
              {Array.from({ length: maxWarnings }).map((_, i) => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full border-2 ${
                    i < warnings
                      ? `${borderColor} ${bgGradient}`
                      : 'border-gray-400 bg-white'
                  }`}
                />
              ))}
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  console.log('[ParticipantPanel] Warning (+) clicked:', { color, hasCallback: !!onAddWarning });
                  e.stopPropagation();
                  if (onAddWarning) {
                    console.log('[ParticipantPanel] Calling onAddWarning...');
                    onAddWarning();
                  }
                }}
                className="w-6 h-6 p-0 text-xs"
              >
                +
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveWarning && onRemoveWarning();
                }}
                disabled={warnings === 0}
                className="w-6 h-6 p-0 text-xs"
              >
                −
              </Button>
            </div>
          </div>
        </div>

        {/* Score - кликабельный */}
        <div
          className={`text-4xl sm:text-5xl md:text-6xl lg:text-7xl xl:text-8xl font-bold ${scoreColor} flex-shrink-0 leading-none cursor-pointer select-none`}
          onClick={handleScoreClick}
          onContextMenu={handleScoreContextMenu}
        >
          {score}
        </div>
      </div>

      {/* Scoring buttons */}
      <div className="grid grid-cols-4 gap-1 sm:gap-1.5 flex-shrink-0 mt-auto w-full">
        {[1, 2, 3, 4].map((points, index) => (
          <Button
            key={index}
            variant={color}
            size="lg"
            onClick={(e) => {
              console.log('[ParticipantPanel] Button clicked:', { color, points, hasCallback: !!onAddScore });
              e.stopPropagation(); // Предотвращаем срабатывание клика по панели
              if (onAddScore) {
                console.log('[ParticipantPanel] Calling onAddScore...');
                onAddScore(points, `+${points}`);
                console.log('[ParticipantPanel] onAddScore called');
              } else {
                console.error('[ParticipantPanel] onAddScore is undefined!');
              }
            }}
            className="flex flex-col items-center justify-center py-1 sm:py-2 px-1 h-10 sm:h-12 md:h-14 lg:h-16 min-w-0"
          >
            <span className="text-lg sm:text-xl md:text-2xl font-bold leading-none">{points}</span>
            <span className="text-xs sm:text-sm md:text-base text-white font-semibold mt-0.5">({hotkeys[index]})</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

// Мемоизированная версия компонента с кастомным comparator
// Оптимизация: предотвращает ре-рендер при изменении callback функций
export const ParticipantPanel = memo(ParticipantPanelBase, (prevProps, nextProps) => {
  // Сравниваем примитивы
  if (prevProps.score !== nextProps.score) return false;
  if (prevProps.warnings !== nextProps.warnings) return false;
  if (prevProps.color !== nextProps.color) return false;
  if (prevProps.maxWarnings !== nextProps.maxWarnings) return false;

  // Сравниваем participant по id и full_name
  if (prevProps.participant?.id !== nextProps.participant?.id) return false;
  if (prevProps.participant?.full_name !== nextProps.participant?.full_name) return false;
  if (prevProps.participant?.club_name !== nextProps.participant?.club_name) return false;

  // Сравниваем hotkeys массив
  if (prevProps.hotkeys?.length !== nextProps.hotkeys?.length) return false;
  if (prevProps.hotkeys && nextProps.hotkeys) {
    for (let i = 0; i < prevProps.hotkeys.length; i++) {
      if (prevProps.hotkeys[i] !== nextProps.hotkeys[i]) return false;
    }
  }

  // Callback функции НЕ сравниваем - они должны быть стабильны через useCallback в родителе
  return true; // Пропсы равны, ре-рендер не нужен
});
