import { useEffect, useState, useRef, useMemo } from 'react';
import { getCachedBrackets, getCachedBracketsWithMatches, getBracketTableAssignments, type BracketTableAssignment } from '../../services/api';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { BracketCardSkeleton, SkeletonList } from '../ui/Skeleton';
import type { BracketResponse, BracketFilters } from '../../types';
import { useDebounce } from '../../hooks/useDebounce';
import { applySortAndFilter, getGenderLabel, getAgeRangeLabel, getWeightRangeLabel, getEnhancedCategoryName } from '../../utils/bracketFilters';
import { useServerModeStore } from '../../stores/serverModeStore';
import { CreateBracketDialog } from './CreateBracketDialog';

interface BracketSelectionProps {
  tournamentId: number;
  onBracketSelect: (bracketId: number, categoryName: string) => void;
  lastSelectedBracketId?: number | null;
  reloadTrigger?: number; // Триггер для принудительной перезагрузки
  useDirectDbAccess?: boolean; // Для админа - прямой доступ к БД с matches
}

const FILTERS_STORAGE_KEY = 'bracket_filters';

export const BracketSelection: React.FC<BracketSelectionProps> = ({
  tournamentId,
  onBracketSelect,
  lastSelectedBracketId,
  reloadTrigger,
  useDirectDbAccess = false,
}) => {
  const [brackets, setBrackets] = useState<BracketResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bracketRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const [showCreateDialog, setShowCreateDialog] = useState(false);

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
        const parsed = JSON.parse(saved);
        // Убедимся, что characteristics существует (для обратной совместимости)
        return {
          ...parsed,
          characteristics: parsed.characteristics || {},
        };
      } catch (error) {
        // FIX: Логируем ошибку парсинга и очищаем поврежденные данные
        console.error('[BracketSelection] Failed to parse filters from localStorage:', error);
        localStorage.removeItem(FILTERS_STORAGE_KEY);
      }
    }
    return {
      searchQuery: '',
      gender: 'all' as const,
      sportId: 'all' as const,
      characteristics: {},
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

  // Polling для обновления информации о занятых столах (каждые 5 секунд в local-client режиме)
  useEffect(() => {
    const { mode } = useServerModeStore.getState();

    // Polling только в local-client режиме (когда есть другие судьи)
    if (mode !== 'local-client') {
      console.log('[BracketSelection] Polling отключен (режим:', mode, ')');
      return;
    }

    console.log('[BracketSelection] Запуск polling занятых столов (каждые 5 сек)');

    // FIX: Добавляем abort controller и флаг isFetching для предотвращения memory leak
    let isFetching = false;
    let abortController: AbortController | null = null;

    // Обновлять информацию о столах каждые 5 секунд
    const intervalId = setInterval(async () => {
      // Пропускаем если предыдущий запрос еще выполняется
      if (isFetching) {
        console.warn('[BracketSelection] Previous fetch still running, skipping...');
        return;
      }

      isFetching = true;
      abortController = new AbortController();

      try {
        // Получаем актуальный serverUrl для каждого запроса
        const { mode: currentMode, serverUrl: currentServerUrl } = useServerModeStore.getState();
        const url = currentMode === 'local-client' ? currentServerUrl : null;

        const assignments = await getBracketTableAssignments(tournamentId, url);

        // Проверка что ответ - массив
        if (!Array.isArray(assignments)) {
          console.error('[BracketSelection] Invalid response (not an array):', assignments);
          return;
        }

        const assignmentsMap = new Map<number, BracketTableAssignment>();
        assignments.forEach((assignment) => {
          assignmentsMap.set(assignment.bracket_id, assignment);
        });
        setTableAssignments(assignmentsMap);
        console.log('[BracketSelection] Polling: обновлено занятых столов:', assignments.length);
      } catch (err) {
        // Проверяем тип ошибки
        if (err instanceof Error && err.name === 'AbortError') {
          console.log('[BracketSelection] Polling aborted');
        } else {
          console.error('[BracketSelection] Polling ошибка:', err);
        }
        // Не прерываем polling при ошибке
      } finally {
        isFetching = false;
      }
    }, 5000); // 5 секунд

    return () => {
      console.log('[BracketSelection] Остановка polling занятых столов');
      clearInterval(intervalId);

      // Отменяем текущий fetch если есть
      if (abortController) {
        abortController.abort();
      }
    };
  }, [tournamentId]);

  const loadBrackets = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const loadStartTime = performance.now();
      console.log('[BracketSelection] ===== НАЧАЛО ЗАГРУЗКИ СЕТОК =====');
      console.log('[BracketSelection] tournamentId:', tournamentId);
      console.log('[BracketSelection] useDirectDbAccess:', useDirectDbAccess);

      let data: BracketResponse[];
      let serverUrl: string | null = null;

      if (useDirectDbAccess) {
        // Админ - прямой доступ к БД с matches
        console.log('[BracketSelection] Using direct DB access with matches');
        data = await getCachedBracketsWithMatches(tournamentId);
      } else {
        // Судья - обычный режим
        const { mode, serverUrl: url } = useServerModeStore.getState();
        serverUrl = mode === 'local-client' ? url : null;
        console.log('[BracketSelection] mode:', mode);
        console.log('[BracketSelection] serverUrl:', serverUrl);
        data = await getCachedBrackets(tournamentId, serverUrl);
      }

      const fetchTime = performance.now() - loadStartTime;
      console.log(`[BracketSelection] getCachedBrackets завершен за ${fetchTime.toFixed(0)}ms`);
      console.log(`[BracketSelection] Получено ${data.length} сеток`);

      setBrackets(data);

      // Загрузить информацию о занятых столах
      try {
        const assignments = await getBracketTableAssignments(tournamentId, serverUrl);
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
      const processStartTime = performance.now();

      console.log('[BracketSelection] Начало обработки участников для', data.length, 'сеток');

      // ОПТИМИЗАЦИЯ: Обрабатываем все сетки синхронно, используя вложенные matches
      for (const bracket of data) {
        try {
          // Проверяем наличие вложенных матчей (локальный сервер всегда их возвращает)
          if (bracket.matches && Array.isArray(bracket.matches) && bracket.matches.length > 0) {
            const participants = new Set<string>();

            // Собрать уникальные имена участников из матчей
            bracket.matches.forEach((match: any) => {
              if (match.fighter1_name) participants.add(match.fighter1_name);
              if (match.fighter2_name) participants.add(match.fighter2_name);
              // Также проверяем альтернативные поля
              if (match.participant1?.full_name) participants.add(match.participant1.full_name);
              if (match.participant2?.full_name) participants.add(match.participant2.full_name);
            });

            participantsMap[bracket.id] = Array.from(participants);
            console.log(`[BracketSelection] Сетка ${bracket.id}: ${participants.size} участников из ${bracket.matches.length} матчей (используем вложенные данные)`);
          } else {
            // Fallback: если matches отсутствуют (не должно случаться с локальным сервером)
            console.warn(`[BracketSelection] Сетка ${bracket.id}: matches отсутствуют, пропускаем`);
            participantsMap[bracket.id] = [];
          }
        } catch (err) {
          console.error(`[BracketSelection] Ошибка обработки сетки ${bracket.id}:`, err);
          participantsMap[bracket.id] = [];
        }
      }

      const elapsed = performance.now() - processStartTime;
      console.log(`[BracketSelection] Обработка завершена за ${elapsed.toFixed(0)}ms: ${data.length} сеток, ${Object.values(participantsMap).flat().length} уникальных участников`);

      setParticipantsByBracket(participantsMap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки сеток');
    } finally {
      setIsLoading(false);
    }
  };

  // Применить фильтры и сортировку
  const filteredBrackets = useMemo(() => {
    const sorted = applySortAndFilter(brackets, filters, participantsByBracket);
    // Отфильтровать сетки без участников, НО показывать локально созданные (ID < 0)
    return sorted.filter(bracket => {
      // Локально созданные сетки (отрицательный ID) показываем всегда
      if (bracket.id < 0) {
        return true;
      }
      // Остальные сетки показываем только если есть участники
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
    // Проверка: если сетка уже занята другим столом, показать toast
    const assignment = tableAssignments.get(bracket.id);
    if (assignment) {
      // Показываем уведомление что сетка занята
      const event = new CustomEvent('show-toast', {
        detail: {
          message: `Сетка занята столом №${assignment.table_number}`,
          type: 'error',
          duration: 3000,
        },
      });
      window.dispatchEvent(event);
      return;
    }

    onBracketSelect(bracket.id, bracket.category_name);
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setFilters({
      searchQuery: '',
      gender: 'all',
      sportId: 'all',
      characteristics: {},
    });
  };

  const hasActiveFilters =
    filters.searchQuery !== '' ||
    filters.gender !== 'all' ||
    filters.sportId !== 'all' ||
    (filters.characteristics && Object.keys(filters.characteristics).some(key => filters.characteristics[key] !== 'all'));

  // Получить уникальные виды спорта из сеток
  const uniqueSports = useMemo(() => {
    const sportsMap = new Map<number, string>();
    brackets.forEach(bracket => {
      if (bracket.sport_id && bracket.sport_name) {
        sportsMap.set(bracket.sport_id, bracket.sport_name);
      }
    });
    return Array.from(sportsMap.entries()).map(([id, name]) => ({ id, name }));
  }, [brackets]);

  // Сбросить фильтр по виду спорта, если выбранный вид не существует
  // Но только при первой загрузке, не при каждом обновлении
  useEffect(() => {
    if (brackets.length === 0) return; // Ждём загрузки данных

    if (filters.sportId !== 'all') {
      const sportExists = uniqueSports.some(sport => sport.id === filters.sportId);
      if (!sportExists && uniqueSports.length > 0) {
        setFilters(prev => ({ ...prev, sportId: 'all' }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueSports.length]); // Зависим только от количества видов спорта, не от filters.sportId

  // Получить уникальные характеристики для фильтров из схемы турнира
  const availableCharacteristics = useMemo(() => {
    if (brackets.length === 0) return [];

    // Берем схему из первой сетки (у всех сеток одного турнира она одинаковая)
    const schema = brackets[0]?.characteristics_schema;
    if (!schema) return [];

    // Фильтруем только те характеристики, у которых use_as_category_tag=true
    return schema.filter(field => field.use_as_category_tag && field.options);
  }, [brackets]);

  // Получить уникальные значения для каждой характеристики из всех сеток
  const characteristicValues = useMemo(() => {
    const valuesMap = new Map<string, Set<string>>();

    console.log('[BracketSelection] Пересчет characteristicValues для', brackets.length, 'сеток');

    brackets.forEach(bracket => {
      if (!bracket.characteristic_filters) {
        console.log(`[BracketSelection] Сетка ${bracket.id} не имеет characteristic_filters`);
        return;
      }

      // Проверяем, является ли characteristic_filters массивом
      if (!Array.isArray(bracket.characteristic_filters)) {
        console.log(`[BracketSelection] Сетка ${bracket.id} имеет characteristic_filters не в виде массива, пропускаем`);
        return;
      }

      bracket.characteristic_filters.forEach(filter => {
        if (!valuesMap.has(filter.key)) {
          valuesMap.set(filter.key, new Set());
        }
        valuesMap.get(filter.key)!.add(filter.value);
      });
    });

    console.log('[BracketSelection] characteristicValues:', Array.from(valuesMap.entries()).map(([key, values]) => ({key, values: Array.from(values)})));

    return valuesMap;
  }, [brackets]);

  // Сбросить фильтры по характеристикам, если выбранные значения не существуют
  // Но только при первой загрузке, не при каждом обновлении
  useEffect(() => {
    if (brackets.length === 0) return; // Ждём загрузки данных
    if (!filters.characteristics) return;

    const updatedCharacteristics = { ...filters.characteristics };
    let hasChanges = false;

    Object.entries(filters.characteristics).forEach(([key, value]) => {
      if (value === 'all') return;

      const availableValues = characteristicValues.get(key);
      if (!availableValues || !availableValues.has(value)) {
        updatedCharacteristics[key] = 'all';
        hasChanges = true;
      }
    });

    if (hasChanges) {
      setFilters(prev => ({ ...prev, characteristics: updatedCharacteristics }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characteristicValues.size]); // Зависим только от количества характеристик

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
        return 'bg-gray-200 text-gray-800 border-gray-300';
      case 'in_progress':
        return 'bg-yellow-100 text-yellow-800 border-yellow-400';
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-400';
      default:
        return 'bg-gray-200 text-gray-800 border-gray-300';
    }
  };

  const getCardBackgroundColor = (status: string) => {
    switch (status) {
      case 'not_started':
        return 'bg-white/80';
      case 'in_progress':
        return 'bg-yellow-50/90 border-yellow-200';
      case 'completed':
        return 'bg-green-50/90 border-green-200';
      default:
        return 'bg-white/80';
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
      {showCreateDialog && (
        <CreateBracketDialog
          tournamentId={tournamentId}
          onClose={() => setShowCreateDialog(false)}
          onSuccess={() => loadBrackets()}
        />
      )}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Выберите сетку</h2>
        <Button
          onClick={() => setShowCreateDialog(true)}
          variant="primary"
          size="sm"
        >
          + Создать сетку
        </Button>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div className="flex-1"></div>
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

        {/* Фильтр по виду спорта (только если есть несколько видов спорта) */}
        {uniqueSports.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700 font-medium whitespace-nowrap">Вид спорта:</span>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => setFilters(prev => ({ ...prev, sportId: 'all' }))}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filters.sportId === 'all'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Все
              </button>
              {uniqueSports.map((sport) => (
                <button
                  key={sport.id}
                  onClick={() => setFilters(prev => ({ ...prev, sportId: sport.id }))}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    filters.sportId === sport.id
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {sport.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Динамические фильтры по характеристикам */}
        {availableCharacteristics.map((characteristic) => {
          const values = characteristicValues.get(characteristic.key);
          if (!values || values.size === 0) return null;

          return (
            <div key={characteristic.key} className="flex items-center gap-2">
              <span className="text-sm text-gray-700 font-medium whitespace-nowrap">
                {characteristic.label}:
              </span>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() =>
                    setFilters(prev => ({
                      ...prev,
                      characteristics: { ...(prev.characteristics || {}), [characteristic.key]: 'all' },
                    }))
                  }
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    !filters.characteristics?.[characteristic.key] ||
                    filters.characteristics[characteristic.key] === 'all'
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Все
                </button>
                {Array.from(values).map((value) => {
                  // Находим label для value из options
                  const option = characteristic.options?.find(opt => opt.value === value);
                  const label = option?.label || value;

                  return (
                    <button
                      key={value}
                      onClick={() =>
                        setFilters(prev => ({
                          ...prev,
                          characteristics: { ...(prev.characteristics || {}), [characteristic.key]: value },
                        }))
                      }
                      className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                        filters.characteristics?.[characteristic.key] === value
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
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
              } ${getCardBackgroundColor(bracket.status)}`}
            >
              <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                  <CardTitle className="text-lg">{getEnhancedCategoryName(bracket)}</CardTitle>
                  {/* Индикатор занятого стола рядом с названием */}
                  {tableAssignments.has(bracket.id) && (
                    <span className="text-xs font-medium px-2 py-1 rounded-full bg-blue-500/20 text-blue-600 border border-blue-500/50">
                      Стол №{tableAssignments.get(bracket.id)!.table_number}
                    </span>
                  )}
                </div>
                {/* Статус сетки - увеличенный badge с яркими цветами */}
                <span
                  className={`text-sm font-bold px-3 py-1.5 rounded-lg border-2 whitespace-nowrap ${getStatusColor(bracket.status)}`}
                >
                  {getStatusLabel(bracket.status)}
                </span>
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
              >
                {bracket.status === 'completed' ? 'Просмотр' : 'Выбрать сетку'}
              </Button>
            </CardContent>
          </Card>
          </div>
        ))}
      </div>
    </div>
  );
};
