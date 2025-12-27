import { useRef, useMemo, useState, useCallback, useEffect, memo } from 'react';
import { MatchCard } from './MatchCard';
import { AddParticipantModal } from './AddParticipantModal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useBracketEditorStore } from '../../stores/bracketEditorStore';
import { useAuthStore } from '../../stores/authStore';
import { useToast } from '../../hooks/useToast';
import { useBracketClickEditing } from '../../hooks/useBracketClickEditing';
import { useDisplayMode } from '../../hooks/useResponsive';
import type { Match } from '../../types';

interface Round {
  name: string;
  matches: Match[];
}

interface TournamentBracketProps {
  matches: Match[];
  onStartMatch: (matchId: number) => void;
  onUndoMatch?: (matchId: number) => void;
  categoryName?: string;
  bracketId?: number;
  onMatchesReload?: () => void;
  onBracketEdited?: () => void; // Callback для уведомления о редактировании сетки
}

// Мемоизированный компонент для названия раунда
const RoundHeader = memo(({ name, x, cardWidth }: { name: string; x: number; cardWidth: number }) => (
  <div
    className="absolute text-center text-sm font-semibold text-gray-800"
    style={{
      left: `${x}px`,
      top: '20px',
      width: `${cardWidth}px`
    }}
  >
    {name}
  </div>
));
RoundHeader.displayName = 'RoundHeader';

// Базовый компонент без мемоизации
function TournamentBracketBase({ matches, onStartMatch, onUndoMatch, categoryName, bracketId, onMatchesReload, onBracketEdited }: TournamentBracketProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mode = useDisplayMode();
  const { user } = useAuthStore();
  const { showToast } = useToast();
  const {
    isEditMode,
    setEditMode,
    startDrag,
    endDrag,
    dropParticipant,
    openAddParticipantModal,
    removeParticipant,
  } = useBracketEditorStore();

  // Получаем draggedParticipant отдельно, чтобы он обновлялся при каждом рендере
  const draggedParticipant = useBracketEditorStore(state => state.draggedParticipant);

  const [confirmRemove, setConfirmRemove] = useState<{
    matchId: number;
    slot: 'participant1' | 'participant2';
  } | null>(null);

  // Hook для click-to-place режима
  const handleSwapParticipants = useCallback(async (
    sourceMatchId: number,
    sourceSlot: 'participant1' | 'participant2',
    targetMatchId: number,
    targetSlot: 'participant1' | 'participant2'
  ) => {
    if (!bracketId) return;

    try {
      // Сначала устанавливаем draggedParticipant в store для совместимости с существующим dropParticipant
      startDrag({
        matchId: sourceMatchId,
        slot: sourceSlot,
        fighterName: '', // Не важно для swap
        fighterId: undefined,
      });

      // Используем существующий dropParticipant из store
      await dropParticipant(
        targetMatchId,
        targetSlot,
        bracketId,
        user?.role === 'referee' ? user.judge_name : undefined,
        user?.role === 'admin' ? user.user_id : undefined
      );

      showToast('Участник перемещён', 'success');
      onMatchesReload?.();
      onBracketEdited?.();
    } catch (error) {
      console.error('[TournamentBracket] Ошибка при swap:', error);
      showToast(error instanceof Error ? error.message : 'Ошибка перемещения', 'error');
      throw error;
    }
  }, [bracketId, user, showToast, onMatchesReload, onBracketEdited, startDrag, dropParticipant]);

  const {
    selectedParticipant,
    selectParticipant,
    placeParticipant,
    cancelSelection,
    isSelected,
    isTargetSlot,
  } = useBracketClickEditing(handleSwapParticipants);

  // Обработка Escape для отмены выбора
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        cancelSelection();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [cancelSelection]);

  // Мемоизация группировки матчей по раундам
  // Оптимизация: O(n*m) операций → пересчет только при изменении matches
  const handleDragStart = (matchId: number, slot: 'participant1' | 'participant2', fighterName: string, fighterId?: number) => {
    console.log('[TournamentBracket] handleDragStart вызван:', { matchId, slot, fighterName, fighterId });
    startDrag({
      matchId,
      slot,
      fighterName,
      fighterId,
    });
    console.log('[TournamentBracket] startDrag выполнен');
  };

  const handleDrop = async (targetMatchId: number, targetSlot: 'participant1' | 'participant2') => {
    // ВАЖНО: Получаем актуальное значение draggedParticipant ВНУТРИ функции
    const currentDraggedParticipant = useBracketEditorStore.getState().draggedParticipant;

    console.log('[TournamentBracket] handleDrop вызван:', {
      targetMatchId,
      targetSlot,
      currentDraggedParticipant,
      bracketId,
      user: user?.role
    });

    if (!currentDraggedParticipant) {
      console.warn('[TournamentBracket] handleDrop отменён: нет draggedParticipant');
      return;
    }

    if (!bracketId) {
      console.warn('[TournamentBracket] handleDrop отменён: нет bracketId');
      return;
    }

    try {
      console.log('[TournamentBracket] Вызов dropParticipant...');
      await dropParticipant(
        targetMatchId,
        targetSlot,
        bracketId,
        user?.role === 'referee' ? user.judge_name : undefined,
        user?.role === 'admin' ? user.user_id : undefined
      );

      console.log('[TournamentBracket] dropParticipant успешно выполнен');

      // Перезагрузить матчи
      onMatchesReload?.();
      // Уведомить о редактировании для обновления BracketSelection
      onBracketEdited?.();
    } catch (error) {
      console.error('[TournamentBracket] Ошибка в handleDrop:', error);
    }
  };

  const handleAddParticipant = (matchId: number, slot: 'participant1' | 'participant2') => {
    const match = matches.find(m => m.id === matchId);
    if (match) {
      openAddParticipantModal(match, slot);
    }
  };

  const handleRemoveParticipant = (matchId: number, slot: 'participant1' | 'participant2') => {
    setConfirmRemove({ matchId, slot });
  };

  const confirmRemoveParticipant = async () => {
    if (!confirmRemove || !bracketId) return;

    console.log('[TournamentBracket] Начало удаления участника:', {
      bracketId,
      matchId: confirmRemove.matchId,
      slot: confirmRemove.slot,
      user: user?.role,
    });

    try {
      await removeParticipant(
        bracketId,
        confirmRemove.matchId,
        confirmRemove.slot,
        user?.role === 'referee' ? user.judge_name : undefined,
        user?.role === 'admin' ? user.user_id : undefined
      );

      console.log('[TournamentBracket] Участник успешно удалён');
      showToast('Участник удалён', 'success');
      setConfirmRemove(null);
      onMatchesReload?.();
      // Уведомить о редактировании для обновления BracketSelection
      onBracketEdited?.();
    } catch (error) {
      console.error('[TournamentBracket] Ошибка удаления участника:', error);
      showToast(error instanceof Error ? error.message : 'Ошибка удаления участника', 'error');
    }
  };

  // Обработчик клика по участнику (click-to-place режим)
  const handleParticipantClick = useCallback((
    match: Match,
    slot: 'participant1' | 'participant2'
  ) => {
    // Только для режима редактирования
    if (!isEditMode) return;
    if (match.status !== 'scheduled') return;

    const participant = slot === 'participant1' ? match.participant1 : match.participant2;

    // Если уже есть выбранный участник - это клик для размещения
    if (selectedParticipant) {
      placeParticipant(match.id, slot);
      return;
    }

    // Иначе - выбор участника (если он существует)
    if (participant) {
      selectParticipant({
        matchId: match.id,
        slot,
        fighterName: participant.full_name,
        fighterId: participant.id,
        clubName: participant.club_name,
      });
    }
  }, [isEditMode, selectedParticipant, placeParticipant, selectParticipant]);

  const rounds = useMemo(() => {
    const groupedRounds: Round[] = [];
    const maxRound = Math.max(...matches.map(m => m.round_number));

    for (let roundNum = 1; roundNum <= maxRound; roundNum++) {
      const roundMatches = matches
        .filter(m => m.round_number === roundNum)
        .sort((a, b) => a.match_number - b.match_number);

      if (roundMatches.length > 0) {
        groupedRounds.push({
          name: getRoundName(roundNum, maxRound),
          matches: roundMatches
        });
      }
    }

    return groupedRounds;
  }, [matches]);

  // Адаптивные размеры карточек и отступов
  const layoutSizes = useMemo(() => {
    const scaleFactor = mode === 'hd' ? 0.85 : 1.0;

    return {
      cardWidth: Math.round(264 * scaleFactor),      // 264px → ~224px для HD
      cardHeight: Math.round(160 * scaleFactor),     // 160px → ~136px для HD
      horizontalGap: Math.round(100 * scaleFactor),  // 100px → ~85px для HD
      verticalGap: Math.round(40 * scaleFactor),     // 40px → ~34px для HD
      padding: Math.round(32 * scaleFactor),         // 32px → ~27px для HD
    };
  }, [mode]);

  const CARD_WIDTH = layoutSizes.cardWidth;
  const CARD_HEIGHT = layoutSizes.cardHeight;
  const HORIZONTAL_GAP = layoutSizes.horizontalGap;
  const VERTICAL_GAP = layoutSizes.verticalGap;
  const DIVIDER_OFFSET = Math.floor(CARD_HEIGHT * 0.53);
  const PADDING = layoutSizes.padding;

  // Мемоизация размеров контейнера
  // Оптимизация: пересчет только при изменении rounds
  const { totalWidth, totalHeight, maxMatchesInRound: _maxMatchesInRound } = useMemo(() => {
    const width = rounds.length * (CARD_WIDTH + HORIZONTAL_GAP) - HORIZONTAL_GAP + PADDING * 2;

    let maxMatches = 0;
    rounds.forEach((round) => {
      if (round.matches.length > maxMatches) {
        maxMatches = round.matches.length;
      }
    });

    const height = maxMatches * (CARD_HEIGHT + VERTICAL_GAP) - VERTICAL_GAP + PADDING * 2 + 60;

    return { totalWidth: width, totalHeight: height, maxMatchesInRound: maxMatches };
  }, [rounds]);

  // Мемоизация генерации SVG линий между матчами
  // Оптимизация: дорогой расчет всех path элементов → пересчет только при изменении rounds
  const svgLines = useMemo(() => {
    const lines: React.ReactElement[] = [];

    for (let roundIndex = 0; roundIndex < rounds.length - 1; roundIndex++) {
      const currentRound = rounds[roundIndex];
      const nextRound = rounds[roundIndex + 1];

      const currentX = roundIndex * (CARD_WIDTH + HORIZONTAL_GAP);
      const nextX = (roundIndex + 1) * (CARD_WIDTH + HORIZONTAL_GAP);

      nextRound.matches.forEach((_, nextMatchIndex) => {
        const match1Index = nextMatchIndex * 2;
        const match2Index = nextMatchIndex * 2 + 1;

        if (match1Index >= currentRound.matches.length) return;

        // Вычисляем вертикальные позиции
        const verticalMultiplierCurrent = Math.pow(2, roundIndex);
        const offsetCurrent = ((verticalMultiplierCurrent - 1) * (CARD_HEIGHT + VERTICAL_GAP)) / 2;

        const y1 = 60 + offsetCurrent + match1Index * verticalMultiplierCurrent * (CARD_HEIGHT + VERTICAL_GAP) + DIVIDER_OFFSET;
        const y2 = match2Index < currentRound.matches.length
          ? 60 + offsetCurrent + match2Index * verticalMultiplierCurrent * (CARD_HEIGHT + VERTICAL_GAP) + DIVIDER_OFFSET
          : y1;

        const verticalMultiplierNext = Math.pow(2, roundIndex + 1);
        const offsetNext = ((verticalMultiplierNext - 1) * (CARD_HEIGHT + VERTICAL_GAP)) / 2;
        const yNext = 60 + offsetNext + nextMatchIndex * verticalMultiplierNext * (CARD_HEIGHT + VERTICAL_GAP) + DIVIDER_OFFSET;

        // SVG путь: соединяет два матча текущего раунда с одним матчем следующего
        const startX = currentX + CARD_WIDTH;
        const endX = nextX;
        const midX = startX + HORIZONTAL_GAP / 2;

        const path = match2Index < currentRound.matches.length
          ? `M ${startX},${y1} H ${midX} V ${y2} H ${startX} M ${midX},${yNext} H ${endX}`
          : `M ${startX},${y1} H ${midX} V ${yNext} H ${endX}`;

        lines.push(
          <path
            key={`line-${roundIndex}-${nextMatchIndex}`}
            d={path}
            stroke="#4b5563"
            strokeWidth="3"
            fill="none"
            opacity="0.8"
          />
        );
      });
    }

    return lines;
  }, [rounds]);

  if (matches.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-800">Нет матчей в сетке</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full bg-gradient-to-br from-gray-50 via-white to-gray-100 rounded-lg overflow-auto p-8"
    >
      {/* Категория турнирной сетки */}
      {categoryName && (
        <div className="mb-6 pb-4 border-b-2 border-gray-300">
          <div className="flex items-center justify-between">
            <h3 className="text-2xl font-bold text-gray-900">
              Категория: {categoryName}
            </h3>
            {bracketId && user && (
              <button
                onClick={() => setEditMode(!isEditMode, bracketId)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  isEditMode
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : 'bg-blue-500 text-white hover:bg-blue-600'
                }`}
                title={isEditMode ? 'Выключить режим редактирования' : 'Включить режим редактирования'}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={isEditMode
                      ? "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      : "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    }
                  />
                </svg>
                {isEditMode ? 'Готово' : 'Редактировать'}
              </button>
            )}
          </div>
          {isEditMode && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
              <strong>Режим редактирования:</strong> Перетаскивайте участников между матчами или используйте кнопки + и × для добавления/удаления
            </div>
          )}
        </div>
      )}
      {bracketId && (
        <AddParticipantModal
          bracketId={bracketId}
          onParticipantAdded={() => {
            onMatchesReload?.();
            onBracketEdited?.();
          }}
        />
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Удаление участника"
          message="Удалить участника из матча?"
          onConfirm={confirmRemoveParticipant}
          onCancel={() => setConfirmRemove(null)}
        />
      )}

      <div
        className="relative"
        style={{
          width: `${totalWidth}px`,
          height: `${totalHeight}px`,
          minHeight: '400px'
        }}
      >
        {/* SVG слой с линиями */}
        <svg
          className="absolute top-0 left-0 pointer-events-none"
          style={{
            width: '100%',
            height: '100%',
            overflow: 'visible'
          }}
        >
          {svgLines}
        </svg>

        {/* Раунды и матчи */}
        {rounds.map((round, roundIndex) => {
          const x = roundIndex * (CARD_WIDTH + HORIZONTAL_GAP);

          return (
            <div key={roundIndex}>
              {/* Название раунда */}
              <RoundHeader name={round.name} x={x} cardWidth={CARD_WIDTH} />

              {/* Матчи раунда */}
              {round.matches.map((match, matchIndex) => {
                const verticalMultiplier = Math.pow(2, roundIndex);
                const offset = ((verticalMultiplier - 1) * (CARD_HEIGHT + VERTICAL_GAP)) / 2;
                const y = 60 + offset + matchIndex * verticalMultiplier * (CARD_HEIGHT + VERTICAL_GAP);

                return (
                  <div
                    key={match.id}
                    className="absolute transition-all duration-200"
                    style={{
                      left: `${x}px`,
                      top: `${y}px`
                    }}
                  >
                    <MatchCard
                      match={match}
                      width={CARD_WIDTH}
                      onStartMatch={onStartMatch}
                      onUndoMatch={onUndoMatch}
                      isEditMode={isEditMode}
                      onDragStart={handleDragStart}
                      onDragEnd={endDrag}
                      onDrop={handleDrop}
                      isDragging={draggedParticipant?.matchId === match.id}
                      onAddParticipant={handleAddParticipant}
                      onRemoveParticipant={handleRemoveParticipant}
                      onParticipantClick={handleParticipantClick}
                      selectedParticipant={selectedParticipant}
                      isSelected={isSelected}
                      isTargetSlot={isTargetSlot}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Вспомогательная функция для названия раунда с кэшированием
const roundNameCache = new Map<string, string>();
function getRoundName(roundNum: number, maxRound: number): string {
  const key = `${roundNum}-${maxRound}`;
  const cached = roundNameCache.get(key);
  if (cached) return cached;

  const roundsFromEnd = maxRound - roundNum;
  let name: string;

  switch (roundsFromEnd) {
    case 0:
      name = 'Финал';
      break;
    case 1:
      name = 'Полуфинал';
      break;
    case 2:
      name = '1/4 финала';
      break;
    case 3:
      name = '1/8 финала';
      break;
    case 4:
      name = '1/16 финала';
      break;
    default:
      name = `Раунд ${roundNum}`;
  }

  roundNameCache.set(key, name);
  return name;
}

// Мемоизированный экспорт с умным сравнением для производительности
export const TournamentBracket = memo(TournamentBracketBase, (prevProps, nextProps) => {
  // Быстрая проверка: разное количество матчей = точно изменилось
  if (prevProps.matches.length !== nextProps.matches.length) return false;

  // Сравниваем categoryName и bracketId
  if (prevProps.categoryName !== nextProps.categoryName) return false;
  if (prevProps.bracketId !== nextProps.bracketId) return false;

  // Оптимизация: сравниваем только первые 5 матчей для быстрой проверки
  // Если хотя бы один изменился - нужен ре-рендер
  const compareDepth = Math.min(5, prevProps.matches.length);
  for (let i = 0; i < compareDepth; i++) {
    const prev = prevProps.matches[i];
    const next = nextProps.matches[i];

    // Сравниваем критичные поля
    if (prev.id !== next.id) return false;
    if (prev.status !== next.status) return false;
    if (prev.participant1?.id !== next.participant1?.id) return false;
    if (prev.participant2?.id !== next.participant2?.id) return false;
    if (prev.participant1?.full_name !== next.participant1?.full_name) return false;
    if (prev.participant2?.full_name !== next.participant2?.full_name) return false;
  }

  // Callbacks стабильны через useCallback, не сравниваем
  return true; // Пропсы равны, ре-рендер не нужен
});
