import { useEffect, useState, useCallback, useRef } from 'react';
import { Users, Circle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { JudgeTableRowSkeleton, SkeletonList } from '../ui/Skeleton';
import { getActiveJudgeSessions } from '../../services/api';
import { usePageVisibility } from '../../hooks/usePageVisibility';
import type { ActiveJudgeSession } from '../../types';

interface JudgeTablesMonitorProps {
  tournamentId: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export const JudgeTablesMonitor = ({
  tournamentId,
  autoRefresh = true,
  refreshInterval = 5000,
}: JudgeTablesMonitorProps) => {
  const [sessions, setSessions] = useState<ActiveJudgeSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isVisible = usePageVisibility();
  const isFetchingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSessions = useCallback(async () => {
    // Предотвращение "стэкания" запросов
    if (isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;
    try {
      setError(null);
      const data = await getActiveJudgeSessions(tournamentId);
      setSessions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки данных');
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [tournamentId]);

  // Debounced версия для защиты от rapid re-fetches
  const debouncedFetch = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      fetchSessions();
    }, 300); // 300ms debounce
  }, [fetchSessions]);

  useEffect(() => {
    // Первоначальная загрузка без debounce
    fetchSessions();

    // Автообновление только если autoRefresh=true И страница видима
    if (autoRefresh && isVisible) {
      const interval = setInterval(fetchSessions, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [tournamentId, autoRefresh, refreshInterval, fetchSessions]);

  // Debounced обновление при изменении видимости
  useEffect(() => {
    if (isVisible) {
      debouncedFetch();
    }
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [isVisible, debouncedFetch]);

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
            Судейские столы
          </CardTitle>
          <div className="text-sm text-gray-800">
            Активных: {sessions.length}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonList
            count={3}
            itemComponent={JudgeTableRowSkeleton}
            className="space-y-3"
          />
        ) : error ? (
          <div className="text-center py-4 text-red-600">{error}</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-8 text-gray-800">
            <Users className="w-12 h-12 mx-auto mb-2 text-gray-400" />
            <p>Нет подключенных судей</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {sessions.map((session, index) => (
              <div
                key={`${session.judge_name}-${index}`}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-300"
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className="flex items-center justify-center w-10 h-10 bg-blue-100 rounded-lg border-2 border-blue-300">
                    <span className="text-lg font-bold text-blue-700">
                      {session.table_number}
                    </span>
                  </div>
                  <Circle
                    className={`w-3 h-3 ${
                      session.bracket_id ? 'text-green-500 fill-green-500' : 'text-gray-400 fill-gray-400'
                    }`}
                  />
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">
                      {session.judge_name}
                    </div>
                    <div className="text-sm text-gray-800">
                      {session.bracket_name ? (
                        <span className="text-blue-600">
                          Работает: {session.bracket_name}
                        </span>
                      ) : (
                        <span className="text-gray-600">Ожидает выбора сетки</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-xs text-gray-800">
                  {formatTime(session.logged_in_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
