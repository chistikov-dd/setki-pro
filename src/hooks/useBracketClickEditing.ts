import { useState, useCallback } from 'react';

/**
 * Hook для альтернативного метода редактирования участников турнирной сетки
 * Режим "Клик-размещение": выбрать участника → кликнуть на целевой слот
 * Работает параллельно с DnD, не заменяет его
 */

export interface SelectedParticipant {
  matchId: number;
  slot: 'participant1' | 'participant2';
  fighterName: string;
  fighterId?: number;
  clubName?: string;
}

export interface UseBracketClickEditingReturn {
  // Текущий выбранный участник
  selectedParticipant: SelectedParticipant | null;

  // Выбрать участника (клик по нему)
  selectParticipant: (participant: SelectedParticipant) => void;

  // Разместить выбранного участника в целевой слот
  placeParticipant: (targetMatchId: number, targetSlot: 'participant1' | 'participant2') => void;

  // Отменить выбор
  cancelSelection: () => void;

  // Проверка: выбран ли данный участник
  isSelected: (matchId: number, slot: 'participant1' | 'participant2') => boolean;

  // Проверка: доступен ли слот для размещения
  isTargetSlot: (matchId: number, slot: 'participant1' | 'participant2') => boolean;
}

export function useBracketClickEditing(
  onSwap?: (
    sourceMatchId: number,
    sourceSlot: 'participant1' | 'participant2',
    targetMatchId: number,
    targetSlot: 'participant1' | 'participant2'
  ) => Promise<void>
): UseBracketClickEditingReturn {
  const [selectedParticipant, setSelectedParticipant] = useState<SelectedParticipant | null>(null);

  // Выбрать участника
  const selectParticipant = useCallback((participant: SelectedParticipant) => {
    setSelectedParticipant(participant);
  }, []);

  // Разместить участника в целевой слот
  const placeParticipant = useCallback(async (targetMatchId: number, targetSlot: 'participant1' | 'participant2') => {
    if (!selectedParticipant) return;

    // Если кликнули на того же самого участника - снять выделение
    if (selectedParticipant.matchId === targetMatchId && selectedParticipant.slot === targetSlot) {
      setSelectedParticipant(null);
      return;
    }

    // Выполнить swap
    if (onSwap) {
      try {
        await onSwap(
          selectedParticipant.matchId,
          selectedParticipant.slot,
          targetMatchId,
          targetSlot
        );

        // Автоматически снять выделение после успешного размещения
        setSelectedParticipant(null);
      } catch (error) {
        console.error('[useBracketClickEditing] Ошибка при размещении:', error);
        // НЕ снимаем выделение при ошибке - пользователь может попробовать ещё раз
      }
    }
  }, [selectedParticipant, onSwap]);

  // Отменить выбор (Escape, клик на пустой области)
  const cancelSelection = useCallback(() => {
    setSelectedParticipant(null);
  }, []);

  // Проверка: выбран ли данный участник
  const isSelected = useCallback((matchId: number, slot: 'participant1' | 'participant2') => {
    return selectedParticipant?.matchId === matchId && selectedParticipant?.slot === slot;
  }, [selectedParticipant]);

  // Проверка: является ли слот целевым для размещения
  // Возвращает true если есть выбранный участник и это НЕ тот же слот
  const isTargetSlot = useCallback((matchId: number, slot: 'participant1' | 'participant2') => {
    if (!selectedParticipant) return false;
    // Все слоты доступны (включая занятые - будет swap)
    return !(selectedParticipant.matchId === matchId && selectedParticipant.slot === slot);
  }, [selectedParticipant]);

  return {
    selectedParticipant,
    selectParticipant,
    placeParticipant,
    cancelSelection,
    isSelected,
    isTargetSlot,
  };
}
