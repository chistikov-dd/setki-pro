import { useEffect, useState, useRef, useMemo } from 'react';
import { getCachedBrackets, getBracketMatches, getBracketTableAssignments, type BracketTableAssignment } from '../../services/api';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { BracketCardSkeleton, SkeletonList } from '../ui/Skeleton';
import type { BracketResponse, BracketFilters } from '../../types';
import { useDebounce } from '../../hooks/useDebounce';
import { applySortAndFilter, getGenderLabel, getAgeRangeLabel, getWeightRangeLabel } from '../../utils/bracketFilters';
import { useServerModeStore } from '../../stores/serverModeStore';

interface BracketSelectionProps {
  tournamentId: number;
  onBracketSelect: (bracketId: number, categoryName: string) => void;
  lastSelectedBracketId?: number | null;
  reloadTrigger?: number; // Триггер для принудительной перезагрузки
}

const FILTERS_STORAGE_KEY = 'bracket_filters';

export const BracketSelection: React.FC<BracketSelectionProps> = ({
  tournamentId,
  onBracketSelect,
  lastSelectedBracketId,
  reloadTrigger,
}) => {
  const [brackets, setBrackets] = useState<BracketResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bracketRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());

  // Информация о занятых столах (bracket_id → table assignment)
  const [tableAssignments, setTableAssignments] = useState<Map<number, BracketTableAssignment>>(new Map());

  // Флаг для контроля автопрокрутки (срабатывает только при первом рендере после возврата)
  const shouldScrollToSelected = useRef(false);
  const previousSelectedBracketId = useRef<number | null>(null);

  // Кэш участников по сеткам (bracket_id -> список имен участников)
  const [participantsByBracket, setParticipantsByBracket] = useState<Record<number, string[]>>({});

  // Фильтры
  const [filters, setFilters] = useState<BracketFilters>(() => {
    // Загрузить фильтры из localStorage
    const saved = localStorage.getItem(FILTERS_STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Ignore parse errors
      }
    }
    return {
      searchQuery: '',
      gender: 'all' as const,
    };
  });

  const [searchInput, setSearchInput] = useState(filters.searchQuery);
  const debouncedSearch = useDebounce(searchInput, 300);

  // Обновить фильтры при изменении debounced search
  useEffect(() => {
    setFilters(prev => ({ ...prev, searchQuery: debouncedSearch }));
  }, [debouncedSearch]);

  // Сохранить фильтры в localStorage при изменении
  useEffect(() => {
    localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    console.log('[BracketSelection] Перезагрузка сеток, reloadTrigger:', reloadTrigger);
    loadBrackets();
  }, [tournamentId, reloadTrigger]); // Добавлен reloadTrigger для перезагрузки

  const loadBrackets = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Получаем serverUrl из store для локального сервера
      const { mode, serverUrl } = useServerModeStore.getState();
      const url = mode === 'local-client' ? serverUrl : null;

      console.log('[BracketSelection] Загрузка сеток, mode:', mode, 'serverUrl:', url);
      const data = await getCachedBrackets(tournamentId, url);
      setBrackets(data);

      // Загрузить информацию о занятых столах
      try {
        const assignments = await getBracketTableAssignments(tournamentId);
        const assignmentsMap = new Map<number, BracketTableAssignment>();
        assignments.forEach((assignment) => {
          assignmentsMap.set(assignment.bracket_id, assignment);
        });
        setTableAssignments(assignmentsMap);
        console.log('[BracketSelection] Загружено занятых столов:', assignments.length);
      } catch (err) {
        console.error('[BracketSelection] Ошибка загрузки информации о столах:', err);
        // Не критичная ошибка, продолжаем работу
      }

      // Загрузить участников для каждой сетки (для поиска)
      const participantsMap: Record<number, string[]> = {};

      await Promise.all(
        data.map(async (bracket) => {
          try {
            // ОПТИМИЗАЦИЯ: Если сетка уже содержит matches (локальный сервер), используем их
            let matches: any[];
            if (bracket.matches && Array.isArray(bracket.matches) && bracket.matches.length > 0) {
              console.log(`[BracketSelection] Сетка ${bracket.id}: используем вложенные матчи (${bracket.matches.length})`);
              matches = bracket.matches;
            } else {
              // Иначе загружаем отдельно (для online режима или если пусто)
              console.log(`[BracketSelection] Сетка ${bracket.id}: загружаем матчи отдельно, serverUrl: ${url}`);
              matches = await getBracketMatches(bracket.id, url);
            }

            const participants = new Set<string>();

            // Собрать уникальные имена участников из матчей
            matches.forEach((match: any) => {
              if (match.fighter1_name) participants.add(match.fighter1_name);
              if (match.fighter2_name) participants.add(match.fighter2_name);
            });

            participantsMap[bracket.id] = Array.from(participants);
            console.log(`[BracketSelection] Сетка ${bracket.id} (${bracket.category_name}): найдено ${participants.size} участников`);
          } catch (err) {
            console.error(`Ошибка загрузки матчей для сетки ${bracket.id}:`, err);
            participantsMap[bracket.id] = [];
          }
        })
      );

      setParticipantsByBracket(participantsMap);
      console.log('[BracketSelection] Загрузка завершена, всего сеток:', data.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки сеток');
    } finally {
      setIsLoading(false);
    }
  };

  // Применить фильтры и сортировку
  const filteredBrackets = useMemo(() => {
    const sorted = applySortAndFilter(brackets, filters, participantsByBracket);
    // Отфильтровать сетки без участников
    return sorted.filter(bracket => {
      const participants = participantsByBracket[bracket.id];
      return participants && participants.length > 0;
    });
  }, [brackets, filters, participantsByBracket]);

  // Отслеживаем изменение lastSelectedBracketId для определения момента возврата
  useEffect(() => {
    // Если lastSelectedBracketId изменился (появился новый ID), значит мы вернулись из сетки
    if (lastSelectedBracketId && lastSelectedBracketId !== previousSelectedBracketId.current) {
      shouldScrollToSelected.current = true;
      previousSelectedBracketId.current = lastSelectedBracketId;
    }
  }, [lastSelectedBracketId]);

  // Автоматическая прокрутка к последней выбранной сетке (только после возврата)
  useEffect(() => {
    if (shouldScrollToSelected.current && lastSelectedBracketId && filteredBrackets.length > 0) {
      // Проверяем, что выбранная сетка присутствует в отфильтрованном списке
      const isBracketVisible = filteredBrackets.some(b => b.id === lastSelectedBracketId);

      if (isBracketVisible) {
        const bracketElement = bracketRefs.current.get(lastSelectedBracketId);
        if (bracketElement) {
          // Небольшая задержка для завершения рендеринга
          setTimeout(() => {
            bracketElement.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });
            // Сбрасываем флаг после прокрутки
            shouldScrollToSelected.current = false;
          }, 150);
        }
      }
    }
  }, [lastSelectedBracketId, filteredBrackets]);

  const handleSelectBracket = (bracket: BracketResponse) => {
    onBracketSelect(bracket.id, bracket.category_name);
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setFilters({
      searchQuery: '',
      gender: 'all',
    });
  };

  const hasActiveFilters = filters.searchQuery !== '' || filters.gender !== 'all';

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'not_started':
        return 'Не начата';
      case 'in_progress':
        return 'В процессе';
      case 'completed':
        return 'Завершена';
      default:
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'not_started':
        return 'text-gray-800';
      case 'in_progress':
        return 'text-yellow-400';
      case 'completed':
        return 'text-green-400';
      default:
        return 'text-gray-800';
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-gray-900">Загрузка сеток...</h2>
        </div>
        <SkeletonList
          count={6}
          itemComponent={BracketCardSkeleton}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-6 text-center">
        <svg
          className="w-12 h-12 text-red-400 mx-auto mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="text-red-400 font-medium mb-2">Ошибка загрузки</p>
        <p className="text-red-300 text-sm mb-4">{error}</p>
        <Button onClick={loadBrackets} variant="secondary" size="sm">
          Повторить
        </Button>
      </div>
    );
  }

  if (brackets.length === 0) {
    return (
      <div className="bg-white/30 border border-gray-400/50 rounded-lg p-8 text-center">
        <svg
          className="w-16 h-16 text-gray-800 mx-auto mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
          />
        </svg>
        <p className="text-gray-800 text-lg font-medium mb-2">Нет доступных сеток</p>
        <p className="text-gray-700 text-sm">
          Администратор еще не загрузил данные турнира для offline работы.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Выберите сетку</h2>
        <span className="text-sm text-gray-700">
          Показано: <span className="text-gray-900 font-medium">{filteredBrackets.length}</span> из{' '}
          <span className="text-gray-900 font-medium">{brackets.length}</span>
        </span>
      </div>

      {/* Поиск и фильтры - Sticky */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-md border border-gray-300 rounded-lg p-4 space-y-4 shadow-md">
        {/* Поиск */}
        <div className="flex gap-3">
          <div className="flex-1 relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Поиск по категории или участнику..."
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {hasActiveFilters && (
            <Button onClick={handleResetFilters} variant="secondary" size="sm">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Сбросить
            </Button>
          )}
        </div>

        {/* Фильтр по полу */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-700 font-medium whitespace-nowrap">Пол:</span>
          <div className="flex gap-2 flex-wrap">
            {(['all', 'male', 'female'] as const).map((gender) => (
              <button
                key={gender}
                onClick={() => setFilters(prev => ({ ...prev, gender }))}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filters.gender === gender
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {gender === 'all' ? 'Все' : getGenderLabel(gender)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Сообщение если нет результатов */}
      {filteredBrackets.length === 0 && brackets.length > 0 && (
        <div className="bg-white/10 border border-gray-400/30 rounded-lg p-8 text-center">
          <svg
            className="w-12 h-12 text-gray-400 mx-auto mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <p className="text-gray-300 font-medium mb-2">Ничего не найдено</p>
          <p className="text-gray-400 text-sm mb-4">Попробуйте изменить параметры поиска или фильтры</p>
          <Button onClick={handleResetFilters} variant="secondary" size="sm">
            Сбросить фильтры
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredBrackets.map((bracket) => (
          <div
            key={bracket.id}
            ref={(el: HTMLDivElement | null) => {
              bracketRefs.current.set(bracket.id, el);
            }}
          >
            <Card
              className={`hover:border-blue-500/50 transition-all duration-200 cursor-pointer ${
                bracket.id === lastSelectedBracketId ? 'ring-2 ring-blue-500/70 border-blue-500/70' : ''
              }`}
            >
              <CardHeader>
              <div className="flex items-start justify-between">
                <CardTitle className="text-lg">{bracket.category_name}</CardTitle>
                <div className="flex items-center gap-2">
                  {/* Индикатор занятого стола */}
                  {tableAssignments.has(bracket.id) && (
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-blue-500/20 text-blue-600 border border-blue-500/50">
                      Стол №{tableAssignments.get(bracket.id)!.table_number}
                    </span>
                  )}
                  {/* Статус сетки */}
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${getStatusColor(bracket.status)}`}
                  >
                    {getStatusLabel(bracket.status)}
                  </span>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {/* Пол */}
              {bracket.gender && (
                <div className="flex items-center text-sm">
                  <svg
                    className="w-4 h-4 text-gray-800 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                  <span className="text-gray-800">{getGenderLabel(bracket.gender)}</span>
                </div>
              )}

              {/* Возраст */}
              {(bracket.min_age || bracket.max_age) && (
                <div className="flex items-center text-sm">
                  <svg
                    className="w-4 h-4 text-gray-800 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="text-gray-800">{getAgeRangeLabel(bracket.min_age, bracket.max_age)}</span>
                </div>
              )}

              {/* Вес */}
              {(bracket.min_weight || bracket.max_weight) && (
                <div className="flex items-center text-sm">
                  <svg
                    className="w-4 h-4 text-gray-800 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"
                    />
                  </svg>
                  <span className="text-gray-800">{getWeightRangeLabel(bracket.min_weight, bracket.max_weight)}</span>
                </div>
              )}

              {/* Количество участников */}
              {participantsByBracket[bracket.id] && participantsByBracket[bracket.id].length > 0 && (
                <div className="flex items-center text-sm">
                  <svg
                    className="w-4 h-4 text-gray-800 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                  </svg>
                  <span className="text-gray-800">
                    Участников: {participantsByBracket[bracket.id].length}
                  </span>
                </div>
              )}

              {/* Количество пар */}
              {participantsByBracket[bracket.id] && participantsByBracket[bracket.id].length > 1 && (
                <div className="flex items-center text-sm">
                  <svg
                    className="w-4 h-4 text-gray-800 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                    />
                  </svg>
                  <span className="text-gray-800">
                    Пар: {Math.ceil(participantsByBracket[bracket.id].length / 2)}
                  </span>
                </div>
              )}

              {/* Кнопка выбора */}
              <Button
                onClick={() => handleSelectBracket(bracket)}
                variant="primary"
                size="sm"
                className="w-full mt-4"
                disabled={bracket.status === 'completed'}
              >
                {bracket.status === 'completed' ? 'Завершена' : 'Выбрать сетку'}
              </Button>
            </CardContent>
          </Card>
          </div>
        ))}
      </div>
    </div>
  );
};
