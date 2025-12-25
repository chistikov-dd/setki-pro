import { create } from 'zustand';
import type { ParticipantEditRequest, SwapParticipantsRequest } from '../services/api';
import {
  updateBracketParticipant,
  swapBracketParticipants,
  getBracketEditHistory,
  createTempParticipant
} from '../services/api';
import { useServerModeStore } from './serverModeStore';
import type { Match } from '../types';

interface DraggedParticipant {
  matchId: number;
  slot: 'participant1' | 'participant2';
  fighterName: string;
  fighterId?: number;
  clubName?: string;
  weight?: number;
}

interface BracketEditorState {
  // Режим редактирования
  isEditMode: boolean;
  currentBracketId: number | null;

  // Drag & Drop
  draggedParticipant: DraggedParticipant | null;

  // Модальные окна
  isAddParticipantModalOpen: boolean;
  isReplaceParticipantModalOpen: boolean;
  selectedMatch: Match | null;
  selectedSlot: 'participant1' | 'participant2' | null;

  // История изменений
  editHistory: any[];

  // Состояние загрузки
  isLoading: boolean;
  error: string | null;

  // Действия
  setEditMode: (enabled: boolean, bracketId?: number) => void;

  // Drag & Drop
  startDrag: (participant: DraggedParticipant) => void;
  endDrag: () => void;
  dropParticipant: (
    targetMatchId: number,
    targetSlot: 'participant1' | 'participant2',
    bracketId: number,
    judgeName?: string,
    adminId?: number
  ) => Promise<void>;

  // Модальные окна
  openAddParticipantModal: (match: Match, slot: 'participant1' | 'participant2') => void;
  openReplaceParticipantModal: (match: Match, slot: 'participant1' | 'participant2') => void;
  closeModals: () => void;

  // Операции редактирования
  addParticipant: (
    bracketId: number,
    matchId: number,
    slot: 'participant1' | 'participant2',
    fighterData: { fighter_id?: number; fighter_name: string; club_name?: string; weight?: number },
    judgeName?: string,
    adminId?: number
  ) => Promise<void>;

  removeParticipant: (
    bracketId: number,
    matchId: number,
    slot: 'participant1' | 'participant2',
    judgeName?: string,
    adminId?: number
  ) => Promise<void>;

  replaceParticipant: (
    bracketId: number,
    matchId: number,
    slot: 'participant1' | 'participant2',
    newFighterData: { fighter_id?: number; fighter_name: string; club_name?: string; weight?: number },
    judgeName?: string,
    adminId?: number
  ) => Promise<void>;

  // История
  loadEditHistory: (bracketId: number) => Promise<void>;

  // Сброс состояния
  reset: () => void;
}

export const useBracketEditorStore = create<BracketEditorState>((set, get) => ({
  // Начальное состояние
  isEditMode: false,
  currentBracketId: null,
  draggedParticipant: null,
  isAddParticipantModalOpen: false,
  isReplaceParticipantModalOpen: false,
  selectedMatch: null,
  selectedSlot: null,
  editHistory: [],
  isLoading: false,
  error: null,

  setEditMode: (enabled, bracketId) => {
    set({
      isEditMode: enabled,
      currentBracketId: enabled ? bracketId || null : null,
    });

    // Загрузить историю при включении режима
    if (enabled && bracketId) {
      get().loadEditHistory(bracketId);
    }
  },

  startDrag: (participant) => {
    console.log('[bracketEditorStore] startDrag вызван:', participant);
    set({ draggedParticipant: participant });
    console.log('[bracketEditorStore] draggedParticipant установлен:', get().draggedParticipant);
  },

  endDrag: () => {
    console.log('[bracketEditorStore] endDrag вызван, текущий draggedParticipant:', get().draggedParticipant);
    set({ draggedParticipant: null });
    console.log('[bracketEditorStore] draggedParticipant очищен');
  },

  dropParticipant: async (targetMatchId, targetSlot, bracketId, judgeName, adminId) => {
    const { draggedParticipant } = get();

    // Получить serverUrl из store для локального сервера
    const { mode, serverUrl } = useServerModeStore.getState();
    const url = mode === 'local-client' ? serverUrl : null;

    console.log('[bracketEditorStore] dropParticipant вызван:', {
      targetMatchId,
      targetSlot,
      bracketId,
      draggedParticipant,
      judgeName,
      adminId,
      mode,
      serverUrl: url
    });

    if (!draggedParticipant) {
      console.warn('[bracketEditorStore] Нет draggedParticipant');
      return;
    }

    // Если перетаскиваем на тот же слот - ничего не делаем
    if (draggedParticipant.matchId === targetMatchId && draggedParticipant.slot === targetSlot) {
      console.log('[bracketEditorStore] Перетаскивание на тот же слот, пропускаем');
      set({ draggedParticipant: null });
      return;
    }

    // ВАЖНО: Если перетаскиваем внутри одного матча - всегда используем swap
    // swap API умеет менять местами двух участников И перемещать участника в пустой слот
    if (draggedParticipant.matchId === targetMatchId) {
      console.log('[bracketEditorStore] Перемещение внутри одного матча - используем swap');
      set({ isLoading: true, error: null });

      try {
        const request: SwapParticipantsRequest = {
          bracket_id: bracketId,
          match1_id: draggedParticipant.matchId,
          match1_slot: draggedParticipant.slot,
          match2_id: targetMatchId,
          match2_slot: targetSlot,
        };

        console.log('[bracketEditorStore] Отправка swap внутри одного матча:', request);
        await swapBracketParticipants(request, judgeName, adminId, url);
        console.log('[bracketEditorStore] Swap внутри матча успешно выполнен');

        set({ draggedParticipant: null, isLoading: false });

        // Обновить историю
        await get().loadEditHistory(bracketId);
      } catch (error) {
        console.error('[bracketEditorStore] Ошибка при swap внутри матча:', error);
        set({
          error: error instanceof Error ? error.message : 'Ошибка при перемещении участника',
          isLoading: false,
          draggedParticipant: null,
        });
        throw error;
      }
      return;
    }

    // Swap между разными матчами
    set({ isLoading: true, error: null });

    try {
      const request: SwapParticipantsRequest = {
        bracket_id: bracketId,
        match1_id: draggedParticipant.matchId,
        match1_slot: draggedParticipant.slot,
        match2_id: targetMatchId,
        match2_slot: targetSlot,
      };

      console.log('[bracketEditorStore] Отправка запроса swapBracketParticipants:', request);
      await swapBracketParticipants(request, judgeName, adminId, url);
      console.log('[bracketEditorStore] swapBracketParticipants успешно выполнен');

      set({ draggedParticipant: null, isLoading: false });

      // Обновить историю
      await get().loadEditHistory(bracketId);
    } catch (error) {
      console.error('[bracketEditorStore] Ошибка при перемещении:', error);
      set({
        error: error instanceof Error ? error.message : 'Ошибка при перемещении участника',
        isLoading: false,
        draggedParticipant: null,
      });
      throw error;
    }
  },

  openAddParticipantModal: (match, slot) => {
    set({
      isAddParticipantModalOpen: true,
      selectedMatch: match,
      selectedSlot: slot,
      error: null, // Сбрасываем предыдущую ошибку
    });
  },

  openReplaceParticipantModal: (match, slot) => {
    set({
      isReplaceParticipantModalOpen: true,
      selectedMatch: match,
      selectedSlot: slot,
      error: null, // Сбрасываем предыдущую ошибку
    });
  },

  closeModals: () => {
    set({
      isAddParticipantModalOpen: false,
      isReplaceParticipantModalOpen: false,
      selectedMatch: null,
      selectedSlot: null,
    });
  },

  addParticipant: async (bracketId, matchId, slot, fighterData, judgeName, adminId) => {
    set({ isLoading: true, error: null });

    try {
      // Получить serverUrl из store для локального сервера
      const { mode, serverUrl } = useServerModeStore.getState();
      const url = mode === 'local-client' ? serverUrl : null;

      console.log('[bracketEditorStore] addParticipant - mode:', mode, 'serverUrl:', url);

      // Если fighter_id не указан, создать временного участника
      let fighterId = fighterData.fighter_id;

      if (!fighterId) {
        console.log('[BracketEditor] Creating temp participant:', fighterData.fighter_name);
        fighterId = await createTempParticipant({
          bracketId,
          fullName: fighterData.fighter_name,
          clubName: fighterData.club_name,
        }, url);
        console.log('[BracketEditor] Temp participant created with ID:', fighterId);
      }

      const request: ParticipantEditRequest = {
        bracket_id: bracketId,
        match_id: matchId,
        participant_slot: slot,
        fighter_id: fighterId,
        fighter_name: fighterData.fighter_name,
        club_name: fighterData.club_name,
        weight: fighterData.weight,
        operation_type: 'add',
      };

      await updateBracketParticipant(request, judgeName, adminId, url);

      set({ isLoading: false });
      get().closeModals();

      // Обновить историю
      await get().loadEditHistory(bracketId);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Ошибка при добавлении участника',
        isLoading: false,
      });
    }
  },

  removeParticipant: async (bracketId, matchId, slot, judgeName, adminId) => {
    console.log('[bracketEditorStore] removeParticipant вызван:', {
      bracketId,
      matchId,
      slot,
      judgeName,
      adminId,
    });

    set({ isLoading: true, error: null });

    try {
      // Получить serverUrl из store для локального сервера
      const { mode, serverUrl } = useServerModeStore.getState();
      const url = mode === 'local-client' ? serverUrl : null;

      console.log('[bracketEditorStore] removeParticipant - mode:', mode, 'serverUrl:', url);

      const request: ParticipantEditRequest = {
        bracket_id: bracketId,
        match_id: matchId,
        participant_slot: slot,
        operation_type: 'remove',
      };

      console.log('[bracketEditorStore] Отправка запроса на удаление:', request);
      await updateBracketParticipant(request, judgeName, adminId, url);
      console.log('[bracketEditorStore] Запрос успешно выполнен');

      set({ isLoading: false });

      // Обновить историю
      await get().loadEditHistory(bracketId);
    } catch (error) {
      console.error('[bracketEditorStore] Ошибка при удалении:', error);
      set({
        error: error instanceof Error ? error.message : 'Ошибка при удалении участника',
        isLoading: false,
      });
      throw error; // Пробрасываем ошибку дальше
    }
  },

  replaceParticipant: async (bracketId, matchId, slot, newFighterData, judgeName, adminId) => {
    set({ isLoading: true, error: null });

    try {
      // Получить serverUrl из store для локального сервера
      const { mode, serverUrl } = useServerModeStore.getState();
      const url = mode === 'local-client' ? serverUrl : null;

      console.log('[bracketEditorStore] replaceParticipant - mode:', mode, 'serverUrl:', url);

      const request: ParticipantEditRequest = {
        bracket_id: bracketId,
        match_id: matchId,
        participant_slot: slot,
        fighter_id: newFighterData.fighter_id,
        fighter_name: newFighterData.fighter_name,
        club_name: newFighterData.club_name,
        weight: newFighterData.weight,
        operation_type: 'update',
      };

      await updateBracketParticipant(request, judgeName, adminId, url);

      set({ isLoading: false });
      get().closeModals();

      // Обновить историю
      await get().loadEditHistory(bracketId);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Ошибка при замене участника',
        isLoading: false,
      });
    }
  },

  loadEditHistory: async (bracketId) => {
    try {
      const history = await getBracketEditHistory(bracketId);
      set({ editHistory: history });
    } catch (error) {
      console.error('Ошибка загрузки истории изменений:', error);
    }
  },

  reset: () => {
    set({
      isEditMode: false,
      currentBracketId: null,
      draggedParticipant: null,
      isAddParticipantModalOpen: false,
      isReplaceParticipantModalOpen: false,
      selectedMatch: null,
      selectedSlot: null,
      editHistory: [],
      isLoading: false,
      error: null,
    });
  },
}));
