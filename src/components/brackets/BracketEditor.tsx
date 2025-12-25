import { useEffect, useState, useCallback } from 'react';
import { useBracketEditorStore } from '../../stores/bracketEditorStore';
import { useAuthStore } from '../../stores/authStore';
import { useServerModeStore } from '../../stores/serverModeStore';
import { useToast } from '../../hooks/useToast';
import { getBracketMatches } from '../../services/api';
import type { Match } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface BracketEditorProps {
  bracketId: number;
  bracketName: string;
  onClose: () => void;
}

interface MatchWithData extends Match {
  fighter1_name?: string;
  fighter2_name?: string;
}

interface DropTargetState {
  matchId: number;
  slot: 'participant1' | 'participant2';
}

export const BracketEditor: React.FC<BracketEditorProps> = ({ bracketId, bracketName, onClose }) => {
  const [matches, setMatches] = useState<MatchWithData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{
    matchId: number;
    slot: 'participant1' | 'participant2';
  } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);

  const {
    draggedParticipant,
    startDrag,
    endDrag,
    dropParticipant,
    openAddParticipantModal,
    removeParticipant,
    editHistory,
  } = useBracketEditorStore();

  const { user } = useAuthStore();
  const { showToast } = useToast();

  // FIX: Используем useCallback для loadMatches чтобы избежать лишних рендеров
  const loadMatches = useCallback(async () => {
    console.log('[BracketEditor] loadMatches вызван');
    setIsLoading(true);
    setError(null);

    try {
      // Получаем serverUrl из store для локального сервера
      const { mode, serverUrl } = useServerModeStore.getState();
      const url = mode === 'local-client' ? serverUrl : null;

      console.log('[BracketEditor] Загрузка матчей, bracket_id:', bracketId, 'mode:', mode, 'serverUrl:', url);
      const data = await getBracketMatches(bracketId, url);
      console.log('[BracketEditor] Получено матчей:', data.length);
      console.log('[BracketEditor] Первые 2 матча:', data.slice(0, 2));

      // КРИТИЧНО: создаем новый массив чтобы React гарантированно обновил UI
      setMatches([...data as MatchWithData[]]);
    } catch (err) {
      console.error('[BracketEditor] Ошибка загрузки:', err);
      setError(err instanceof Error ? err.message : 'Ошибка загрузки матчей');
    } finally {
      setIsLoading(false);
    }
  }, [bracketId]);

  useEffect(() => {
    console.log('[BracketEditor] Компонент смонтирован, bracketId:', bracketId);
    loadMatches();
  }, [bracketId, loadMatches]);

  const handleDragStart = (
    matchId: number,
    slot: 'participant1' | 'participant2',
    fighterName: string,
    fighterId?: number
  ) => {
    console.log('[DragDrop] START:', { matchId, slot, fighterName, fighterId });
    startDrag({
      matchId,
      slot,
      fighterName,
      fighterId,
    });
  };

  const handleDragOver = (e: React.DragEvent, matchId: number, slot: 'participant1' | 'participant2') => {
    e.preventDefault(); // КРИТИЧНО: без этого drop не сработает!
    e.stopPropagation();

    // Устанавливаем визуальную подсветку целевой ячейки
    if (!dropTarget || dropTarget.matchId !== matchId || dropTarget.slot !== slot) {
      console.log('[DragDrop] OVER:', { matchId, slot });
      setDropTarget({ matchId, slot });
    }
  };

  const handleDragLeave = (e: React.DragEvent, matchId: number, slot: 'participant1' | 'participant2') => {
    e.preventDefault();

    // Проверяем, что мы действительно покидаем элемент, а не переходим на дочерний
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;

    // Убираем подсветку только если курсор вышел за границы элемента
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      if (dropTarget?.matchId === matchId && dropTarget?.slot === slot) {
        setDropTarget(null);
      }
    }
  };

  const handleDrop = async (e: React.DragEvent, targetMatchId: number, targetSlot: 'participant1' | 'participant2') => {
    e.preventDefault(); // КРИТИЧНО: предотвращаем стандартное поведение браузера
    e.stopPropagation();

    console.log('[DragDrop] DROP:', { targetMatchId, targetSlot, draggedParticipant });

    setDropTarget(null); // Убираем визуальную подсветку

    if (!draggedParticipant) {
      console.warn('[DragDrop] DROP отменён: нет draggedParticipant');
      return;
    }

    try {
      console.log('[DragDrop] Вызов dropParticipant...');
      await dropParticipant(
        targetMatchId,
        targetSlot,
        bracketId,
        user?.role === 'referee' ? user.judge_name : undefined,
        user?.role === 'admin' ? user.user_id : undefined
      );

      console.log('[DragDrop] DROP успешен');
      showToast('Участник перемещён', 'success');

      // Перезагрузить матчи
      await loadMatches();
    } catch (error) {
      console.error('[DragDrop] DROP ошибка:', error);
      showToast(error instanceof Error ? error.message : 'Ошибка перемещения участника', 'error');
    }
  };

  const handleAddParticipant = (match: MatchWithData, slot: 'participant1' | 'participant2') => {
    openAddParticipantModal(match as Match, slot);
  };

  const handleRemoveParticipant = (matchId: number, slot: 'participant1' | 'participant2') => {
    setConfirmRemove({ matchId, slot });
  };

  const confirmRemoveParticipant = async () => {
    if (!confirmRemove) return;

    try {
      await removeParticipant(
        bracketId,
        confirmRemove.matchId,
        confirmRemove.slot,
        user?.role === 'referee' ? user.judge_name : undefined,
        user?.role === 'admin' ? user.user_id : undefined
      );

      showToast('Участник удалён', 'success');
      setConfirmRemove(null);
      await loadMatches();
    } catch (error) {
      console.error('Ошибка удаления участника:', error);
      showToast(error instanceof Error ? error.message : 'Ошибка удаления участника', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
        <p className="mt-4 text-gray-700">Загрузка сетки...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-6 text-center">
          <p className="text-red-400 font-medium mb-2">Ошибка загрузки</p>
          <p className="text-red-300 text-sm mb-4">{error}</p>
          <Button onClick={loadMatches} variant="secondary" size="sm">
            Повторить
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Редактирование сетки</h2>
          <p className="text-gray-700 mt-1">{bracketName}</p>
        </div>
        <Button onClick={onClose} variant="secondary">
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Закрыть
        </Button>
      </div>

      {/* Инструкция */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
        <h3 className="text-blue-800 font-medium mb-2">Как редактировать:</h3>
        <ul className="text-blue-700 text-sm space-y-1">
          <li>• Перетащите участника из одного матча в другой (drag & drop)</li>
          <li>• Нажмите "+" чтобы добавить участника в пустой слот</li>
          <li>• Нажмите "×" чтобы удалить участника</li>
        </ul>
      </div>

      {/* История изменений */}
      {editHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>История изменений (последние 5)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {editHistory.slice(0, 5).map((item) => (
                <div key={item.id} className="text-sm text-gray-700 flex items-center gap-2">
                  <span className="text-gray-500">{new Date(item.created_at).toLocaleTimeString()}</span>
                  <span className="font-medium">{item.operation_type}</span>
                  <span>{item.fighter_name || '—'}</span>
                  <span className="text-gray-500">
                    ({item.edited_by_judge || `Админ #${item.edited_by_admin}`})
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Список матчей */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {matches.map((match) => {
          console.log('[BracketEditor] Рендер матча:', match.id, 'fighter1:', match.fighter1_name, 'fighter2:', match.fighter2_name);
          return (
          <Card key={match.id} className="border-2">
            <CardHeader>
              <CardTitle className="text-base">
                Раунд {match.round_number} • Матч #{match.match_number}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Participant 1 */}
              <div
                className={`p-3 rounded-lg border-2 transition-all ${
                  match.fighter1_name ? 'cursor-grab active:cursor-grabbing' : ''
                } ${
                  draggedParticipant?.matchId === match.id && draggedParticipant?.slot === 'participant1'
                    ? 'border-blue-500 bg-blue-500/10 opacity-50'
                    : dropTarget?.matchId === match.id && dropTarget?.slot === 'participant1'
                    ? 'border-green-500 bg-green-500/20 ring-2 ring-green-500/50 shadow-lg'
                    : 'border-gray-300 bg-white hover:border-blue-400'
                }`}
                draggable={!!match.fighter1_name}
                onDragStart={() => {
                  console.log('[DragDrop] onDragStart вызван для participant1');
                  if (match.fighter1_name) {
                    handleDragStart(match.id, 'participant1', match.fighter1_name, match.participant1?.fighter_id);
                  }
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => handleDragOver(e, match.id, 'participant1')}
                onDragLeave={(e) => handleDragLeave(e, match.id, 'participant1')}
                onDrop={(e) => handleDrop(e, match.id, 'participant1')}
                onMouseDown={() => console.log('[DragDrop] mouseDown на participant1')}
              >
                <div className="flex items-center justify-between pointer-events-none">
                  <div className="flex-1">
                    {match.fighter1_name ? (
                      <div>
                        <p className="font-medium text-gray-900">{match.fighter1_name}</p>
                        {match.participant1?.club_name && (
                          <p className="text-sm text-gray-600">{match.participant1.club_name}</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-gray-400 italic">Пусто</p>
                    )}
                  </div>
                  <div className="flex gap-2 pointer-events-auto">
                    {match.fighter1_name ? (
                      <button
                        onClick={() => handleRemoveParticipant(match.id, 'participant1')}
                        className="p-1 hover:bg-red-500/20 rounded text-red-500"
                        title="Удалить"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAddParticipant(match, 'participant1')}
                        className="p-1 hover:bg-green-500/20 rounded text-green-500"
                        title="Добавить"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="text-center text-gray-500 text-sm font-medium">VS</div>

              {/* Participant 2 */}
              <div
                className={`p-3 rounded-lg border-2 transition-all ${
                  match.fighter2_name ? 'cursor-grab active:cursor-grabbing' : ''
                } ${
                  draggedParticipant?.matchId === match.id && draggedParticipant?.slot === 'participant2'
                    ? 'border-blue-500 bg-blue-500/10 opacity-50'
                    : dropTarget?.matchId === match.id && dropTarget?.slot === 'participant2'
                    ? 'border-green-500 bg-green-500/20 ring-2 ring-green-500/50 shadow-lg'
                    : 'border-gray-300 bg-white hover:border-blue-400'
                }`}
                draggable={!!match.fighter2_name}
                onDragStart={() => {
                  console.log('[DragDrop] onDragStart вызван для participant2');
                  if (match.fighter2_name) {
                    handleDragStart(match.id, 'participant2', match.fighter2_name, match.participant2?.fighter_id);
                  }
                }}
                onDragEnd={endDrag}
                onDragOver={(e) => handleDragOver(e, match.id, 'participant2')}
                onDragLeave={(e) => handleDragLeave(e, match.id, 'participant2')}
                onDrop={(e) => handleDrop(e, match.id, 'participant2')}
                onMouseDown={() => console.log('[DragDrop] mouseDown на participant2')}
              >
                <div className="flex items-center justify-between pointer-events-none">
                  <div className="flex-1">
                    {match.fighter2_name ? (
                      <div>
                        <p className="font-medium text-gray-900">{match.fighter2_name}</p>
                        {match.participant2?.club_name && (
                          <p className="text-sm text-gray-600">{match.participant2.club_name}</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-gray-400 italic">Пусто</p>
                    )}
                  </div>
                  <div className="flex gap-2 pointer-events-auto">
                    {match.fighter2_name ? (
                      <button
                        onClick={() => handleRemoveParticipant(match.id, 'participant2')}
                        className="p-1 hover:bg-red-500/20 rounded text-red-500"
                        title="Удалить"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    ) : (
                      <button
                        onClick={() => handleAddParticipant(match, 'participant2')}
                        className="p-1 hover:bg-green-500/20 rounded text-green-500"
                        title="Добавить"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
        })}
      </div>

      {matches.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">В этой сетке пока нет матчей</p>
        </div>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Удаление участника"
          message="Удалить участника из матча?"
          onConfirm={confirmRemoveParticipant}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
};
