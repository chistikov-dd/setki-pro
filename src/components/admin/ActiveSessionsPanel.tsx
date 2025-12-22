import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAuthStore } from '../../stores/authStore';
import { useToast } from '../../hooks/useToast';
import type { ActiveJudgeSession } from '../../types';

export function ActiveSessionsPanel() {
  const [sessions, setSessions] = useState<ActiveJudgeSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { user } = useAuthStore();
  const { showToast } = useToast();

  const loadSessions = async () => {
    if (!user?.tournament_id) return;

    setIsLoading(true);
    try {
      const data = await invoke<ActiveJudgeSession[]>('get_active_judge_sessions', {
        tournamentId: user.tournament_id,
      });
      setSessions(data);
    } catch (error) {
      console.error('[ActiveSessionsPanel] Failed to load sessions:', error);
      showToast('Ошибка загрузки активных судей', 'error', 3000);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReleaseTable = async (tableNumber: number) => {
    if (!user?.tournament_id) return;

    const confirmed = window.confirm(
      `Освободить стол №${tableNumber}?\n\nСудья потеряет доступ к сетке.`
    );

    if (!confirmed) return;

    try {
      await invoke('force_release_table', {
        tournamentId: user.tournament_id,
        tableNumber,
      });

      showToast(`Стол №${tableNumber} освобожден`, 'success', 2000);
      await loadSessions();
    } catch (error) {
      console.error('[ActiveSessionsPanel] Failed to release table:', error);
      showToast('Ошибка освобождения стола', 'error', 3000);
    }
  };

  const handleClearAll = async () => {
    if (!user?.tournament_id) return;

    const confirmed = window.confirm(
      `Освободить ВСЕ столы (${sessions.length})?\n\n` +
        'Все судьи потеряют доступ к своим сеткам.\n' +
        'Это действие рекомендуется только между раундами турнира.'
    );

    if (!confirmed) return;

    try {
      const count = await invoke<number>('clear_all_table_reservations', {
        tournamentId: user.tournament_id,
      });

      showToast(`Освобождено столов: ${count}`, 'success', 3000);
      await loadSessions();
    } catch (error) {
      console.error('[ActiveSessionsPanel] Failed to clear all:', error);
      showToast('Ошибка сброса резерваций', 'error', 3000);
    }
  };

  useEffect(() => {
    loadSessions();

    // Автообновление каждые 10 секунд
    const interval = setInterval(loadSessions, 10000);

    return () => clearInterval(interval);
  }, [user?.tournament_id]);

  if (!user?.tournament_id) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-500">Выберите турнир для просмотра активных судей</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      {/* Заголовок */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-gray-900">
            Активные судьи
          </h2>
          <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
            {sessions.length} {sessions.length === 1 ? 'судья' : 'судей'}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadSessions}
            disabled={isLoading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Обновление...' : 'Обновить'}
          </button>

          {sessions.length > 0 && (
            <button
              onClick={handleClearAll}
              className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
            >
              Освободить все столы
            </button>
          )}
        </div>
      </div>

      {/* Таблица */}
      {sessions.length === 0 ? (
        <div className="text-center py-12">
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
          <p className="mt-4 text-sm text-gray-500">
            Нет активных судей
          </p>
          <p className="mt-1 text-xs text-gray-400">
            Судьи появятся здесь после входа в систему
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Стол №
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Судья
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Сетка
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Время входа
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {sessions.map((session) => (
                <tr key={session.table_number} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 bg-blue-100 rounded-lg flex items-center justify-center">
                        <span className="text-blue-800 font-bold">
                          {session.table_number}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {session.judge_name}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {session.bracket_name ? (
                      <div className="text-sm text-gray-900">
                        {session.bracket_name}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400 italic">
                        Сетка не выбрана
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-500">
                      {new Date(session.logged_in_at).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button
                      onClick={() => handleReleaseTable(session.table_number)}
                      className="text-red-600 hover:text-red-900 hover:underline transition-colors"
                    >
                      Освободить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Подсказка внизу */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          💡 <strong>Совет:</strong> Столы освобождаются автоматически при выходе судьи из системы.
          Используйте кнопку "Освободить" только при зависших сессиях.
        </p>
      </div>
    </div>
  );
}
