import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import type { Match } from '../../types';
import { useState, memo } from 'react';
import { removePatronymic } from '../../lib/utils';
import { logger } from '../../lib/logger';

interface MatchCardProps {
  match: Match;
  width?: number;
  onStartMatch?: (matchId: number) => void;
  isEditMode?: boolean;
  onDragStart?: (matchId: number, slot: 'participant1' | 'participant2', participantName: string, participantId?: number) => void;
  onDragEnd?: () => void;
  onDrop?: (matchId: number, slot: 'participant1' | 'participant2') => void;
  isDragging?: boolean;
  onAddParticipant?: (matchId: number, slot: 'participant1' | 'participant2') => void;
  onRemoveParticipant?: (matchId: number, slot: 'participant1' | 'participant2') => void;
}

// Базовый компонент MatchCard
function MatchCardBase({
  match,
  width = 180,
  onStartMatch,
  isEditMode = false,
  onDragStart,
  onDragEnd,
  onDrop,
  isDragging: _isDragging = false,
  onAddParticipant,
  onRemoveParticipant
}: MatchCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [dragOverSlot, setDragOverSlot] = useState<'participant1' | 'participant2' | null>(null);

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

  // Запретить редактирование начатых/завершённых матчей
  const canEdit = isEditMode && match.status === 'scheduled';

  // Показывать кнопку только на матчах с участниками и НЕ в режиме редактирования
  const showButton = match.participant1 && match.participant2 && onStartMatch && !isEditMode;

  // Определение победителя для каждого участника
  const isParticipant1Winner = match.winner_id === match.participant1?.id;
  const isParticipant2Winner = match.winner_id === match.participant2?.id;

  // Определение проигравшего (если матч завершен и есть победитель)
  const isParticipant1Loser = isCompleted && match.winner_id && !isParticipant1Winner && match.participant1;
  const isParticipant2Loser = isCompleted && match.winner_id && !isParticipant2Winner && match.participant2;

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
        ${isEditMode && !canEdit ? 'opacity-60' : ''}
      `}
      style={{
        width: `${width}px`,
        height: '160px',
        backgroundColor: 'white'
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={isEditMode && !canEdit ? 'Редактирование недоступно: матч уже начат или завершён' : ''}
    >
      <CardContent className="p-0 h-full flex flex-col relative">
        {/* Участник 1 (Синий) */}
        <div
          className={`
            py-1.5 px-2 flex-1 flex items-center border-l-[6px] border-blue-700 relative select-none
            ${isParticipant1Winner ? 'bg-green-50' : ''}
            ${isParticipant1Loser ? 'bg-gray-200 opacity-60' : ''}
            ${canEdit && participant1Name ? 'cursor-move hover:bg-blue-50' : ''}
            ${dragOverSlot === 'participant1' ? 'bg-blue-100 ring-2 ring-blue-500' : ''}
          `}
          draggable={canEdit && !!participant1Name}
          style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
          onDragStart={(e) => {
            const logData = `matchId=${match.id}, participant1Name=${participant1Name}, canEdit=${canEdit}, isEditMode=${isEditMode}, matchStatus=${match.status}`;
            logger.info(`[MatchCard] DragStart participant1: ${logData}`);
            if (!canEdit || !participant1Name) {
              e.preventDefault();
              logger.warn(`[MatchCard] DragStart CANCELLED: ${logData}`);
              return;
            }

            // Устанавливаем данные для drag
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', participant1Name);

            // Создаем ghost image (опционально)
            const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
            dragImage.style.opacity = '0.5';
            document.body.appendChild(dragImage);
            e.dataTransfer.setDragImage(dragImage, 0, 0);
            setTimeout(() => document.body.removeChild(dragImage), 0);

            onDragStart?.(match.id, 'participant1', participant1Name, match.participant1?.id);
          }}
          onDragEnd={(e) => {
            console.log('[MatchCard] DragEnd, dropEffect:', e.dataTransfer.dropEffect);
            // НЕ вызываем onDragEnd() если был успешный drop (dropEffect === 'move')
            // Store сам очистит draggedParticipant после обработки drop
            if (e.dataTransfer.dropEffect === 'none') {
              console.log('[MatchCard] Drop не произошёл, очищаем draggedParticipant');
              onDragEnd?.();
            }
          }}
          onDragOver={(e) => {
            if (canEdit) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              setDragOverSlot('participant1');
            }
          }}
          onDragLeave={() => {
            console.log('[MatchCard] DragLeave participant1');
            setDragOverSlot(null);
          }}
          onDrop={(e) => {
            e.preventDefault(); // КРИТИЧНО!
            e.stopPropagation();
            const logData = `matchId=${match.id}, canEdit=${canEdit}, isEditMode=${isEditMode}, matchStatus=${match.status}`;
            logger.info(`[MatchCard] DROP participant1: ${logData}`);
            if (canEdit) {
              onDrop?.(match.id, 'participant1');
              setDragOverSlot(null);
            } else {
              logger.error(`[MatchCard] DROP ОТКЛОНЁН! ${logData}`);
            }
          }}
        >
          <div className={`flex flex-col w-full min-w-0 flex-1 ${canEdit ? 'pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span
                className={`font-semibold flex-1 min-w-0 text-gray-900 text-lg leading-tight
                  ${isParticipant1Winner ? 'font-bold' : ''}
                  ${isParticipant1Loser ? 'line-through' : ''}
                `}
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word'
                }}
                title={participant1Name || ''}
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
              <span className="text-xs text-gray-600 truncate mt-0.5" title={club1}>
                {club1}
              </span>
            )}
          </div>
          {canEdit && (
            <div className="flex flex-col gap-1 ml-2 pointer-events-auto">
              {!participant1Name ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddParticipant?.(match.id, 'participant1');
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="p-1.5 bg-green-500 hover:bg-green-600 rounded text-white shadow-sm"
                  title="Добавить"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveParticipant?.(match.id, 'participant1');
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="p-1.5 bg-red-500 hover:bg-red-600 rounded text-white shadow-sm"
                  title="Удалить"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Разделитель - толстая линия */}
        <div className="h-0.5 bg-gray-800" />

        {/* Участник 2 (Красный) */}
        <div
          className={`
            py-1.5 px-2 flex-1 flex items-center border-l-[6px] border-red-700 relative select-none
            ${isParticipant2Winner ? 'bg-green-50' : ''}
            ${isParticipant2Loser ? 'bg-gray-200 opacity-60' : ''}
            ${canEdit && participant2Name ? 'cursor-move hover:bg-red-50' : ''}
            ${dragOverSlot === 'participant2' ? 'bg-red-100 ring-2 ring-red-500' : ''}
          `}
          draggable={canEdit && !!participant2Name}
          style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
          onDragStart={(e) => {
            console.log('[MatchCard] DragStart participant2:', match.id, participant2Name, 'canEdit:', canEdit);
            if (!canEdit || !participant2Name) {
              e.preventDefault();
              console.log('[MatchCard] DragStart cancelled - canEdit or participant2Name is false');
              return;
            }

            // Устанавливаем данные для drag
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', participant2Name);

            // Создаем ghost image (опционально)
            const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
            dragImage.style.opacity = '0.5';
            document.body.appendChild(dragImage);
            e.dataTransfer.setDragImage(dragImage, 0, 0);
            setTimeout(() => document.body.removeChild(dragImage), 0);

            onDragStart?.(match.id, 'participant2', participant2Name, match.participant2?.id);
          }}
          onDragEnd={(e) => {
            console.log('[MatchCard] DragEnd, dropEffect:', e.dataTransfer.dropEffect);
            // НЕ вызываем onDragEnd() если был успешный drop (dropEffect === 'move')
            // Store сам очистит draggedParticipant после обработки drop
            if (e.dataTransfer.dropEffect === 'none') {
              console.log('[MatchCard] Drop не произошёл, очищаем draggedParticipant');
              onDragEnd?.();
            }
          }}
          onDragOver={(e) => {
            if (canEdit) {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              console.log('[MatchCard] DragOver participant2:', match.id);
              setDragOverSlot('participant2');
            }
          }}
          onDragLeave={() => {
            console.log('[MatchCard] DragLeave participant2');
            setDragOverSlot(null);
          }}
          onDrop={(e) => {
            e.preventDefault(); // КРИТИЧНО!
            e.stopPropagation();
            console.log('[MatchCard] Drop participant2:', match.id, 'canEdit:', canEdit);
            if (canEdit) {
              onDrop?.(match.id, 'participant2');
              setDragOverSlot(null);
            }
          }}
        >
          <div className={`flex flex-col w-full min-w-0 flex-1 ${canEdit ? 'pointer-events-none' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span
                className={`font-semibold flex-1 min-w-0 text-gray-900 text-lg leading-tight
                  ${isParticipant2Winner ? 'font-bold' : ''}
                  ${isParticipant2Loser ? 'line-through' : ''}
                `}
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word'
                }}
                title={participant2Name || ''}
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
              <span className="text-xs text-gray-600 truncate mt-0.5" title={club2}>
                {club2}
              </span>
            )}
          </div>
          {canEdit && (
            <div className="flex flex-col gap-1 ml-2 pointer-events-auto">
              {!participant2Name ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddParticipant?.(match.id, 'participant2');
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="p-1.5 bg-green-500 hover:bg-green-600 rounded text-white shadow-sm"
                  title="Добавить"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveParticipant?.(match.id, 'participant2');
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="p-1.5 bg-red-500 hover:bg-red-600 rounded text-white shadow-sm"
                  title="Удалить"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          )}
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

  // Сравниваем режим редактирования
  if (prevProps.isEditMode !== nextProps.isEditMode) return false;

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
