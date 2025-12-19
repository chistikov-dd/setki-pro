import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import type { Match } from '../../types';
import { useState, memo } from 'react';
import { removePatronymic } from '../../lib/utils';

interface MatchCardProps {
  match: Match;
  width?: number;
  onStartMatch?: (matchId: number) => void;
}

// Базовый компонент MatchCard
function MatchCardBase({ match, width = 180, onStartMatch }: MatchCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const participant1Name = match.participant1?.full_name
    ? removePatronymic(match.participant1.full_name)
    : '';
  const participant2Name = match.participant2?.full_name
    ? removePatronymic(match.participant2.full_name)
    : '';
  const club1 = match.participant1?.club_name;
  const club2 = match.participant2?.club_name;

  const canStart =
    match.status === 'scheduled' &&
    match.participant1 &&
    match.participant2;

  const isCompleted = match.status === 'completed';
  const isInProgress = match.status === 'in_progress';

  // Показывать кнопку только на матчах с участниками
  const showButton = match.participant1 && match.participant2 && onStartMatch;

  // Определение победителя для каждого участника
  const isParticipant1Winner = match.winner_id === match.participant1?.id;
  const isParticipant2Winner = match.winner_id === match.participant2?.id;

  // Текст кнопки в зависимости от статуса
  const getButtonText = () => {
    if (canStart) return 'Начать';
    if (isInProgress) return 'Продолжить';
    if (isCompleted) return 'Открыть';
    return 'Открыть';
  };

  // Цвет кнопки в зависимости от статуса
  const getButtonColor = () => {
    if (canStart) return 'bg-blue-500 hover:bg-blue-600';
    if (isInProgress) return 'bg-yellow-500 hover:bg-yellow-600';
    if (isCompleted) return 'bg-gray-500 hover:bg-gray-600';
    return 'bg-blue-500 hover:bg-blue-600';
  };

  return (
    <Card
      className={`
        p-0 transition-all duration-200 border-2 relative
        ${isInProgress ? 'border-orange-500 shadow-orange-200' : 'border-gray-700'}
        ${isCompleted ? 'opacity-90' : ''}
        ${isHovered ? 'shadow-xl' : 'shadow-md'}
      `}
      style={{
        width: `${width}px`,
        height: '160px',
        backgroundColor: 'white'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <CardContent className="p-0 h-full flex flex-col relative">
        {/* Участник 1 (Синий) */}
        <div className={`
          py-1.5 px-2 flex-1 flex items-center border-l-[6px] border-blue-700
          ${isParticipant1Winner ? 'bg-green-50' : ''}
        `}>
          <div className="flex flex-col w-full min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`font-semibold flex-1 min-w-0 text-gray-900 text-lg leading-tight
                  ${isParticipant1Winner ? 'font-bold' : ''}
                `}
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word'
                }}
                title={participant1Name}
              >
                {participant1Name}
              </span>
              {(match.score_participant1 !== undefined && match.score_participant1 >= 0) && (
                <span className={`text-sm font-bold flex-shrink-0 ${isParticipant1Winner ? 'text-green-600' : 'text-blue-700'}`}>
                  {match.score_participant1}
                </span>
              )}
            </div>
            {club1 && (
              <span className="text-[9px] text-gray-600 truncate mt-0.5" title={club1}>
                {club1}
              </span>
            )}
          </div>
        </div>

        {/* Разделитель - толстая линия */}
        <div className="h-0.5 bg-gray-800" />

        {/* Участник 2 (Красный) */}
        <div className={`
          py-1.5 px-2 flex-1 flex items-center border-l-[6px] border-red-700
          ${isParticipant2Winner ? 'bg-green-50' : ''}
        `}>
          <div className="flex flex-col w-full min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`font-semibold flex-1 min-w-0 text-gray-900 text-lg leading-tight
                  ${isParticipant2Winner ? 'font-bold' : ''}
                `}
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word'
                }}
                title={participant2Name}
              >
                {participant2Name}
              </span>
              {(match.score_participant2 !== undefined && match.score_participant2 >= 0) && (
                <span className={`text-sm font-bold flex-shrink-0 ${isParticipant2Winner ? 'text-green-600' : 'text-red-700'}`}>
                  {match.score_participant2}
                </span>
              )}
            </div>
            {club2 && (
              <span className="text-[9px] text-gray-600 truncate mt-0.5" title={club2}>
                {club2}
              </span>
            )}
          </div>
        </div>

        {/* Кнопка при наведении (по центру карточки, ~50% высоты) */}
        {showButton && isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <Button
              size="lg"
              className={`${getButtonColor()} text-white font-bold text-base px-8 py-4 shadow-lg`}
              onClick={() => onStartMatch(match.id)}
            >
              {getButtonText()}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Мемоизированная версия компонента с кастомным comparator
// Оптимизация: предотвращает ре-рендер при hover на других карточках
export const MatchCard = memo(MatchCardBase, (prevProps, nextProps) => {
  // Сравниваем width
  if (prevProps.width !== nextProps.width) return false;

  // Сравниваем ключевые поля match объекта
  const prevMatch = prevProps.match;
  const nextMatch = nextProps.match;

  if (prevMatch.id !== nextMatch.id) return false;
  if (prevMatch.status !== nextMatch.status) return false;
  if (prevMatch.winner_id !== nextMatch.winner_id) return false;
  if (prevMatch.score_participant1 !== nextMatch.score_participant1) return false;
  if (prevMatch.score_participant2 !== nextMatch.score_participant2) return false;

  // Сравниваем участников
  if (prevMatch.participant1?.id !== nextMatch.participant1?.id) return false;
  if (prevMatch.participant1?.full_name !== nextMatch.participant1?.full_name) return false;
  if (prevMatch.participant1?.club_name !== nextMatch.participant1?.club_name) return false;

  if (prevMatch.participant2?.id !== nextMatch.participant2?.id) return false;
  if (prevMatch.participant2?.full_name !== nextMatch.participant2?.full_name) return false;
  if (prevMatch.participant2?.club_name !== nextMatch.participant2?.club_name) return false;

  // Callback onStartMatch не сравниваем - должен быть стабильным через useCallback
  return true; // Пропсы равны, ре-рендер не нужен
});
