import { useEffect, useState } from 'react';
import { Users, Circle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { useJudgeMonitorStore } from '../../stores/judgeMonitorStore';
import { getActiveJudgeSessions } from '../../services/api';

interface JudgeTablesMonitorProps {
  tournamentId: number;
}

export const JudgeTablesMonitor = ({ tournamentId }: JudgeTablesMonitorProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Получаем список судей из reactive store (автоматически обновляется через WebSocket)
  // ВАЖНО: Используем selector напрямую к connectedJudges, а не через getJudgesList()
  // чтобы избежать бесконечного цикла обновлений
  const connectedJudges = useJudgeMonitorStore((state) => state.connectedJudges);
  const { addJudge, clearJudges } = useJudgeMonitorStore();

  // Загрузка активных судейских сессий
  useEffect(() => {
    let isMounted = true;

    const loadActiveSessions = async () => {
      try {
        setIsLoading(true);
        setError(null);

        console.log('[JudgeTablesMonitor] Загрузка активных судей для турнира:', tournamentId);
        const sessions = await getActiveJudgeSessions(tournamentId);
        console.log('[JudgeTablesMonitor] Получено активных судей:', sessions.length);

        if (!isMounted) return;

        // Очищаем старые данные и добавляем новые
        clearJudges();
        sessions.forEach((session) => {
          // Преобразуем ActiveJudgeSession в ConnectedJudge
          // Используем user_id = 0 как placeholder, так как в ActiveJudgeSession нет user_id
          addJudge({
            user_id: 0, // ActiveJudgeSession не содержит user_id
            judge_name: session.judge_name,
            table_number: session.table_number,
            tournament_id: session.tournament_id || tournamentId,
            connected_at: session.logged_in_at,
          });
        });

        setIsLoading(false);
      } catch (err) {
        console.error('[JudgeTablesMonitor] Ошибка загрузки активных судей:', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Ошибка загрузки судей');
          setIsLoading(false);
        }
      }
    };

    loadActiveSessions();

    // Polling каждые 5 секунд для обновления списка
    const intervalId = setInterval(loadActiveSessions, 5000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [tournamentId, addJudge, clearJudges]);

  // Преобразуем Map в массив и фильтруем по tournament_id
  const tournamentJudges = Array.from(connectedJudges.values())
    .filter((judge) => judge.tournament_id === tournamentId)
    .sort((a, b) => a.table_number - b.table_number);

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  return (
    <Card variant="bordered">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            Подключенные судьи
          </CardTitle>
          <div className="text-sm text-gray-800">
            Активных: {tournamentJudges.length}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && tournamentJudges.length === 0 ? (
          <div className="text-center py-8 text-gray-800">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-400 border-t-blue-500 mb-2"></div>
            <p className="text-sm">Загрузка...</p>
          </div>
        ) : error ? (
          <div className="text-center py-8 text-red-400">
            <p className="font-medium mb-1">Ошибка загрузки</p>
            <p className="text-sm">{error}</p>
          </div>
        ) : tournamentJudges.length === 0 ? (
          <div className="text-center py-8 text-gray-800">
            <Users className="w-12 h-12 mx-auto mb-2 text-gray-400" />
            <p>Нет подключенных судей</p>
            <p className="text-sm mt-1">Судьи появятся здесь автоматически при подключении</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {tournamentJudges.map((judge) => (
              <div
                key={`${judge.table_number}-${judge.user_id}`}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-300"
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-lg border-2 border-blue-300">
                    <span className="text-lg font-bold text-blue-700">
                      {judge.table_number}
                    </span>
                  </div>
                  <Circle className="w-3 h-3 text-green-500 fill-green-500" />
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">
                      {judge.judge_name}
                    </div>
                    <div className="text-sm text-gray-600">
                      Стол №{judge.table_number}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-800">
                  {formatTime(judge.connected_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
