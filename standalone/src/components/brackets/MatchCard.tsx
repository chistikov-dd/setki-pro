import { memo, useState } from 'react';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import type { Match } from '../../types';
import { removePatronymic } from '../../lib/utils';
import { useDisplayMode } from '../../hooks/useResponsive';

interface MatchCardProps {
  match: Match;
  width?: number;
  onOpenMatch?: (matchId: number) => void;
}

function MatchCardBase({ match, width: propWidth = 220, onOpenMatch }: MatchCardProps) {
  const mode = useDisplayMode();
  const [isHovered, setIsHovered] = useState(false);

  const cardSizes = {
    hd: {
      width: Math.round(propWidth * 0.85),
      height: Math.round(160 * 0.85),
      nameSize: 'text-base',
      clubSize: 'text-[10px]',
      scoreSize: 'text-xs',
      buttonSize: 'text-sm px-6 py-2',
      borderWidth: '4px',
    },
    fullhd: {
      width: propWidth,
      height: 160,
      nameSize: 'text-lg',
      clubSize: 'text-xs',
      scoreSize: 'text-sm',
      buttonSize: 'text-base px-8 py-4',
      borderWidth: '6px',
    },
  };

  const cardSize = cardSizes[mode];
  const width = cardSize.width;

  const participant1Name = match.participant1?.full_name
    ? removePatronymic(match.participant1.full_name)
    : '';
  const participant2Name = match.participant2?.full_name
    ? removePatronymic(match.participant2.full_name)
    : '';
  const club1 = match.participant1?.club_name;
  const club2 = match.participant2?.club_name;

  const canStart = match.status === 'scheduled' && match.participant1 && match.participant2;
  const isCompleted = match.status === 'completed';
  const isInProgress = match.status === 'in_progress';
  const showButton = match.participant1 && match.participant2 && onOpenMatch;

  const isParticipant1Winner = match.winner_id === match.participant1?.id;
  const isParticipant2Winner = match.winner_id === match.participant2?.id;
  const isParticipant1Loser = isCompleted && !!match.winner_id && !isParticipant1Winner && !!match.participant1;
  const isParticipant2Loser = isCompleted && !!match.winner_id && !isParticipant2Winner && !!match.participant2;

  const isParticipant1NotConfirmed = match.participant1 && match.participant1.is_confirmed === false;
  const isParticipant2NotConfirmed = match.participant2 && match.participant2.is_confirmed === false;

  const getButtonText = () => {
    if (canStart) return 'Начать';
    if (isInProgress) return 'Продолжить';
    if (isCompleted) return 'Открыть';
    return 'Открыть';
  };

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
      style={{ width: `${width}px`, height: `${cardSize.height}px`, backgroundColor: 'white' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <CardContent className="p-0 h-full flex flex-col relative">
        {isHovered && (
          <div className="absolute top-1 right-1 z-10">
            <span className="bg-gray-200 text-gray-500 text-[9px] font-mono px-1 py-0.5 rounded opacity-60">
              #{match.id}
            </span>
          </div>
        )}

        {/* Участник 1 (Синий) */}
        <div
          className={`
            py-1.5 px-2 flex-1 flex items-center relative select-none
            ${isParticipant1Winner ? 'bg-green-50' : ''}
            ${isParticipant1Loser ? 'bg-gray-200 opacity-60' : ''}
            ${isParticipant1NotConfirmed && !isParticipant1Winner && !isParticipant1Loser ? 'bg-red-50' : ''}
          `}
          style={{ borderLeftWidth: cardSize.borderWidth, borderLeftColor: '#1d4ed8' }}
        >
          <div className="flex flex-col w-full min-w-0 flex-1">
            <span
              className={`font-semibold text-gray-900 ${cardSize.nameSize} leading-tight truncate
                ${isParticipant1Winner ? 'font-bold' : ''}
                ${isParticipant1Loser ? 'line-through' : ''}
              `}
            >
              {participant1Name || 'TBD'}
            </span>
            {club1 && <span className={`${cardSize.clubSize} text-gray-500 truncate`}>{club1}</span>}
          </div>
          {isCompleted && (
            <span className={`${cardSize.scoreSize} font-bold text-gray-700 ml-2`}>
              {match.score_participant1}
            </span>
          )}
        </div>

        {/* Участник 2 (Красный) */}
        <div
          className={`
            py-1.5 px-2 flex-1 flex items-center relative select-none border-t border-gray-200
            ${isParticipant2Winner ? 'bg-green-50' : ''}
            ${isParticipant2Loser ? 'bg-gray-200 opacity-60' : ''}
            ${isParticipant2NotConfirmed && !isParticipant2Winner && !isParticipant2Loser ? 'bg-red-50' : ''}
          `}
          style={{ borderLeftWidth: cardSize.borderWidth, borderLeftColor: '#b91c1c' }}
        >
          <div className="flex flex-col w-full min-w-0 flex-1">
            <span
              className={`font-semibold text-gray-900 ${cardSize.nameSize} leading-tight truncate
                ${isParticipant2Winner ? 'font-bold' : ''}
                ${isParticipant2Loser ? 'line-through' : ''}
              `}
            >
              {participant2Name || 'TBD'}
            </span>
            {club2 && <span className={`${cardSize.clubSize} text-gray-500 truncate`}>{club2}</span>}
          </div>
          {isCompleted && (
            <span className={`${cardSize.scoreSize} font-bold text-gray-700 ml-2`}>
              {match.score_participant2}
            </span>
          )}
        </div>

        {showButton && (
          <div className="p-1 flex justify-center border-t border-gray-100">
            <Button
              className={`${getButtonColor()} text-white ${cardSize.buttonSize} rounded`}
              onClick={() => onOpenMatch?.(match.id)}
            >
              {getButtonText()}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const MatchCard = memo(MatchCardBase);
