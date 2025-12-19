import { useEffect, useState, useCallback, useRef } from 'react';
import { Swords, Clock, AlertTriangle } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { ActiveMatchCardSkeleton, SkeletonList } from '../ui/Skeleton';
import { getActiveMatches } from '../../services/api';
import { usePageVisibility } from '../../hooks/usePageVisibility';
import type { ActiveMatch } from '../../types';

interface ActiveMatchesMonitorProps {
  tournamentId: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

// Удалить отчество из ФИО (оставить только Фамилию Имя)
const removePatronymic = (fullName: string | null): string => {
  if (!fullName) return 'Неизвестно';
  const parts = fullName.trim().split(/\s+/);
  return parts.slice(0, 2).join(' ');
};

export const ActiveMatchesMonitor = ({
  tournamentId,
  autoRefresh = true,
  refreshInterval = 3000,
}: ActiveMatchesMonitorProps) => {
  const [matches, setMatches] = useState<ActiveMatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isVisible = usePageVisibility();
  const isFetchingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchMatches = useCallback(async () => {
    // Предотвращение "стэкания" запросов
    if (isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;
    try {
      setError(null);
      const data = await getActiveMatches(tournamentId);
      setMatches(data);
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
      fetchMatches();
    }, 300); // 300ms debounce
  }, [fetchMatches]);

  useEffect(() => {
    // Первоначальная загрузка без debounce
    fetchMatches();

    // Автообновление только если autoRefresh=true И страница видима
    if (autoRefresh && isVisible) {
      const interval = setInterval(fetchMatches, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [tournamentId, autoRefresh, refreshInterval, fetchMatches]);

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

  return (
    <Card variant="bordered">
      <CardHeader>
        <div className="flex justify-between items-center">
          <CardTitle className="flex items-center gap-2">
            <Swords className="w-5 h-5" />
            Активные поединки
          </CardTitle>
          <div className="text-sm text-gray-800">
            Идет: {matches.length}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <SkeletonList
            count={2}
            itemComponent={ActiveMatchCardSkeleton}
            className="space-y-3"
          />
        ) : error ? (
          <div className="text-center py-4 text-red-600">{error}</div>
        ) : matches.length === 0 ? (
          <div className="text-center py-8 text-gray-800">
            <Clock className="w-12 h-12 mx-auto mb-2 text-gray-400" />
            <p>Нет активных поединков</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {matches.map((match) => (
              <div
                key={match.match_id}
                className="p-4 bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg border border-gray-300"
              >
                {/* Header: Категория и Судья */}
                <div className="flex justify-between items-start mb-3">
                  <div className="text-sm font-semibold text-gray-900">
                    {match.bracket_name || `Сетка #${match.bracket_id}`}
                  </div>
                  {match.judge_name && (
                    <div className="flex items-center gap-2">
                      {match.table_number && (
                        <div className="flex items-center justify-center w-8 h-8 bg-blue-100 rounded border-2 border-blue-300">
                          <span className="text-sm font-bold text-blue-700">
                            {match.table_number}
                          </span>
                        </div>
                      )}
                      <div className="text-xs text-gray-800 bg-white px-2 py-1 rounded">
                        Судья: {match.judge_name}
                      </div>
                    </div>
                  )}
                </div>

                {/* Fighters and Scores */}
                <div className="grid grid-cols-3 gap-3 mb-2">
                  {/* Blue Fighter (Participant 1) */}
                  <div className="bg-blue-100 border-2 border-blue-500 rounded-lg p-3 text-center">
                    <div className="text-xs text-blue-700 mb-1 font-medium">СИНИЙ</div>
                    <div className="font-bold text-gray-900 text-sm mb-2">
                      {removePatronymic(match.fighter1_name)}
                    </div>
                    <div className="text-3xl font-bold text-blue-700">
                      {match.score_participant1}
                    </div>
                    {match.warnings_participant1 > 0 && (
                      <div className="flex justify-center gap-1 mt-2">
                        {Array.from({ length: match.warnings_participant1 }).map((_, i) => (
                          <AlertTriangle
                            key={i}
                            className="w-3 h-3 text-yellow-500 fill-yellow-500"
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* VS */}
                  <div className="flex items-center justify-center">
                    <div className="text-2xl font-bold text-gray-600">VS</div>
                  </div>

                  {/* Red Fighter (Participant 2) */}
                  <div className="bg-red-100 border-2 border-red-500 rounded-lg p-3 text-center">
                    <div className="text-xs text-red-700 mb-1 font-medium">КРАСНЫЙ</div>
                    <div className="font-bold text-gray-900 text-sm mb-2">
                      {removePatronymic(match.fighter2_name)}
                    </div>
                    <div className="text-3xl font-bold text-red-700">
                      {match.score_participant2}
                    </div>
                    {match.warnings_participant2 > 0 && (
                      <div className="flex justify-center gap-1 mt-2">
                        {Array.from({ length: match.warnings_participant2 }).map((_, i) => (
                          <AlertTriangle
                            key={i}
                            className="w-3 h-3 text-yellow-500 fill-yellow-500"
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Status Indicator */}
                <div className="flex items-center justify-center gap-2 pt-2 border-t border-gray-300">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-xs text-gray-800">В процессе</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
