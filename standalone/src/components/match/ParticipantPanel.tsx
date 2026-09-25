import { memo } from 'react';
import type { Participant } from '../../types';
import { Button } from '../ui/Button';
import { removePatronymic } from '../../lib/utils';
import { useDisplayMode } from '../../hooks/useResponsive';

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
  const mode = useDisplayMode();

  const bgGradient = color === 'red'
    ? 'bg-gradient-to-b from-red-600/20 to-red-900/20'
    : 'bg-gradient-to-b from-blue-600/20 to-blue-900/20';

  const borderColor = color === 'red' ? 'border-red-500/50' : 'border-blue-500/50';
  const scoreColor = color === 'red' ? 'text-red-500' : 'text-blue-500';

  // Адаптивные размеры для HD и Full HD
  const textSizes = {
    hd: {
      name: 'text-xl sm:text-2xl md:text-3xl',       // Уменьшено с 4xl/5xl
      club: 'text-xs sm:text-sm',                    // Уменьшено с sm/base
      warningLabel: 'text-sm sm:text-base',          // Уменьшено с base/lg
      score: 'text-5xl sm:text-6xl md:text-7xl',     // Уменьшено с 9xl/12rem
      buttonPoints: 'text-base sm:text-lg',          // Уменьшено с lg/xl
      buttonHotkey: 'text-[10px] sm:text-xs',        // Уменьшено с xs/sm
    },
    fullhd: {
      name: 'text-xl sm:text-2xl md:text-3xl lg:text-4xl xl:text-5xl',
      club: 'text-sm sm:text-base lg:text-lg',
      warningLabel: 'text-base sm:text-lg md:text-xl',
      score: 'text-6xl sm:text-7xl md:text-8xl lg:text-9xl xl:text-[12rem]',
      buttonPoints: 'text-lg sm:text-xl md:text-2xl',
      buttonHotkey: 'text-xs sm:text-sm md:text-base',
    },
  };

  const sizes = textSizes[mode];

  // Адаптивные размеры кнопок
  const buttonHeights = {
    hd: 'h-8 sm:h-10 md:h-12',        // Уменьшено с h-10/h-12/h-14/h-16
    fullhd: 'h-10 sm:h-12 md:h-14 lg:h-16',
  };

  const buttonHeight = buttonHeights[mode];

  // Адаптивные отступы
  const paddings = {
    hd: 'p-1.5 sm:p-2',              // Уменьшено с p-2/p-3/p-4
    fullhd: 'p-2 sm:p-3 lg:p-4',
  };

  const padding = paddings[mode];

  // Обработка кликов по счёту: ЛКМ +1, ПКМ -1
  const handleScoreClick = (e: React.MouseEvent) => {
    if (import.meta.env.DEV) {
      console.log('[ParticipantPanel] Score clicked (+1):', { color, hasCallback: !!onAddScore });
    }
    e.preventDefault();
    e.stopPropagation();
    if (onAddScore) {
      if (import.meta.env.DEV) {
        console.log('[ParticipantPanel] Calling onAddScore(+1)...');
      }
      onAddScore(1, '+1');
    }
  };

  const handleScoreContextMenu = (e: React.MouseEvent) => {
    if (import.meta.env.DEV) {
      console.log('[ParticipantPanel] Score right-clicked (-1):', { color, hasCallback: !!onAddScore });
    }
    e.preventDefault();
    e.stopPropagation();
    if (onAddScore) {
      if (import.meta.env.DEV) {
        console.log('[ParticipantPanel] Calling onAddScore(-1)...');
      }
      onAddScore(-1, '-1');
    }
  };

  return (
    <div
      className={`${bgGradient} border ${borderColor} h-full w-full flex items-center ${padding} select-none`}
    >
      {/* Left: Name/Info + Warnings */}
      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className={`${sizes.name} font-bold text-gray-900 leading-tight mb-1 sm:mb-2 break-words`}>
          {participant?.full_name ? removePatronymic(participant.full_name) : 'УЧАСТНИК НЕ НАЗНАЧЕН'}
        </div>
        {participant?.club_name && (
          <div className={`${sizes.club} text-gray-800 truncate mb-2`}>
            {participant.club_name}
          </div>
        )}

        {/* Warnings */}
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <span className={`${sizes.warningLabel} font-semibold text-gray-900`}>Предупреждения:</span>
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
                if (import.meta.env.DEV) {
                  console.log('[ParticipantPanel] Warning (+) clicked:', { color, hasCallback: !!onAddWarning });
                }
                e.stopPropagation();
                if (onAddWarning) {
                  if (import.meta.env.DEV) {
                    console.log('[ParticipantPanel] Calling onAddWarning...');
                  }
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

      {/* Right: Scoring buttons + Score */}
      <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
        {/* Scoring buttons - горизонтальный ряд */}
        <div className="flex gap-1 sm:gap-2 flex-shrink-0">
          {[1, 2, 3, 4].map((points, index) => (
            <Button
              key={index}
              variant={color}
              size="lg"
              onClick={(e) => {
                if (import.meta.env.DEV) {
                  console.log('[ParticipantPanel] Button clicked:', { color, points, hasCallback: !!onAddScore });
                }
                e.stopPropagation();
                if (onAddScore) {
                  if (import.meta.env.DEV) {
                    console.log('[ParticipantPanel] Calling onAddScore...');
                  }
                  onAddScore(points, `+${points}`);
                  if (import.meta.env.DEV) {
                    console.log('[ParticipantPanel] onAddScore called');
                  }
                } else if (import.meta.env.DEV) {
                  console.error('[ParticipantPanel] onAddScore is undefined!');
                }
              }}
              className={`flex flex-col items-center justify-center py-2 px-3 sm:py-3 sm:px-4 ${buttonHeight} min-w-0`}
            >
              <span className={`${sizes.buttonPoints} font-bold leading-none`}>{points}</span>
              <span className={`${sizes.buttonHotkey} text-white font-semibold mt-0.5`}>({hotkeys[index]})</span>
            </Button>
          ))}
        </div>

        {/* Score - кликабельный */}
        <div
          className={`${sizes.score} font-bold ${scoreColor} flex-shrink-0 leading-none cursor-pointer select-none`}
          onClick={handleScoreClick}
          onContextMenu={handleScoreContextMenu}
        >
          {score}
        </div>
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
