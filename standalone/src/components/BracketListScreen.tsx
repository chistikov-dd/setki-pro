import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { useDebounce } from '../hooks/useDebounce';
import { getCachedBrackets } from '../services/api';
import {
  filterBrackets,
  getUniqueSports,
  getUniqueGenders,
  getGenderLabel,
  getStatusFilterLabel,
  hasAnyAgeData,
  getAvailableCharacteristics,
  getCharacteristicValues,
  getStageFilterLabel,
  DEFAULT_BRACKET_FILTERS,
  type BracketListFilters,
  type BracketStatusFilter,
  type BracketStageFilter,
} from '../utils/bracketFilters';
import type { Bracket, Tournament } from '../types';

interface BracketListScreenProps {
  tournament: Tournament;
  brackets: Bracket[];
  onSelectBracket: (bracket: Bracket) => void;
  onReopenFile: () => void;
  /**
   * Id сетки, из которой пользователь только что вернулся (переход bracket -> bracket-list) —
   * если задан, список при монтировании прокручивается к этой карточке. Если сетка
   * отфильтрована и её нет среди видимых карточек — ничего не происходит (не крашим).
   */
  scrollToBracketId?: number | null;
}

const STATUS_FILTER_OPTIONS: BracketStatusFilter[] = ['all', 'not_started', 'in_progress', 'completed'];
const STAGE_FILTER_OPTIONS: BracketStageFilter[] = ['all', 'semifinal', 'final'];

const statusLabels: Record<Bracket['status'], string> = {
  not_started: 'Не начата',
  in_progress: 'Идёт',
  completed: 'Завершена',
};

// Цветовая семантика согласована с остальным приложением — см. MatchCard.tsx,
// где идущий матч подсвечивается оранжевым (border-orange-500 / shadow-orange-200).
const statusBadgeClasses: Record<Bracket['status'], string> = {
  not_started: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-orange-100 text-orange-700',
  completed: 'bg-green-100 text-green-700',
};

const statusDotClasses: Record<Bracket['status'], string> = {
  not_started: 'bg-gray-400',
  in_progress: 'bg-orange-500',
  completed: 'bg-green-500',
};

function StatusBadge({ status }: { status: Bracket['status'] }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClasses[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}

/**
 * Единый экран списка сеток турнира (без промежуточного экрана "категорий" —
 * в подавляющем большинстве турниров категория 1:1 с сеткой, поэтому
 * промежуточный уровень только мешал). Поддерживает поиск по названию
 * категории и по именам участников, а также фильтры по виду спорта и полу.
 */
export function BracketListScreen({
  tournament,
  brackets,
  onSelectBracket,
  onReopenFile,
  scrollToBracketId,
}: BracketListScreenProps) {
  const [filters, setFilters] = useState<BracketListFilters>(DEFAULT_BRACKET_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  // Статус сетки на момент открытия файла быстро устаревает (матчи начинаются/завершаются
  // без перезагрузки файла) — поэтому подгружаем live-статус из SQLite-кэша через
  // get_cached_brackets и мержим его поверх статичных данных из tournamentData.brackets.
  // Состав участников (matches) для поиска оставляем как есть из исходной загрузки —
  // get_cached_brackets вложенные матчи не отдаёт, а актуализировать состав участников
  // в реальном времени на списке сеток не критично.
  const [liveStatusById, setLiveStatusById] = useState<Map<number, Bracket['status']>>(new Map());

  useEffect(() => {
    let cancelled = false;

    getCachedBrackets()
      .then((liveBrackets) => {
        if (cancelled) return;
        const map = new Map<number, Bracket['status']>();
        for (const b of liveBrackets) {
          map.set(b.id, b.status);
        }
        setLiveStatusById(map);
      })
      .catch(() => {
        // Если live-статус не удалось получить — просто остаёмся со статичными
        // данными из tournamentData.brackets (не критично для работы экрана).
      });

    return () => {
      cancelled = true;
    };
    // Рефетчим при каждом монтировании экрана — то есть при первой загрузке файла
    // и при каждом возврате из экрана сетки (App.tsx размонтирует/монтирует этот компонент).
  }, []);

  const bracketsWithLiveStatus = useMemo(() => {
    if (liveStatusById.size === 0) return brackets;
    return brackets.map((b) => {
      const liveStatus = liveStatusById.get(b.id);
      return liveStatus && liveStatus !== b.status ? { ...b, status: liveStatus } : b;
    });
  }, [brackets, liveStatusById]);

  const activeFilters: BracketListFilters = { ...filters, searchQuery: debouncedSearch };

  const uniqueSports = useMemo(() => getUniqueSports(bracketsWithLiveStatus), [bracketsWithLiveStatus]);
  const uniqueGenders = useMemo(() => getUniqueGenders(bracketsWithLiveStatus), [bracketsWithLiveStatus]);
  const showAgeFilter = useMemo(() => hasAnyAgeData(bracketsWithLiveStatus), [bracketsWithLiveStatus]);

  // Динамические характеристики турнира (например "уровень" A/B/C) — берутся из
  // characteristics_schema первой сетки (считается одинаковой для всего турнира) и
  // отфильтрованы по use_as_category_tag === true. Показываем ряд pill-кнопок только
  // для тех характеристик, у которых больше одного уникального значения в турнире —
  // тот же паттерн, что уже используется для "Вид спорта"/"Пол" в этом компоненте.
  const availableCharacteristics = useMemo(
    () => getAvailableCharacteristics(bracketsWithLiveStatus),
    [bracketsWithLiveStatus]
  );
  const characteristicValuesByKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const field of availableCharacteristics) {
      map.set(field.key, getCharacteristicValues(bracketsWithLiveStatus, field.key));
    }
    return map;
  }, [availableCharacteristics, bracketsWithLiveStatus]);

  const filteredBrackets = useMemo(
    () => filterBrackets(bracketsWithLiveStatus, activeFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      bracketsWithLiveStatus,
      activeFilters.sportId,
      activeFilters.gender,
      activeFilters.status,
      activeFilters.searchQuery,
      activeFilters.ageFrom,
      activeFilters.ageTo,
      activeFilters.characteristics,
      activeFilters.stage,
    ]
  );

  const hasActiveCharacteristicFilters = Object.values(filters.characteristics).some(
    (value) => value !== 'all'
  );

  const hasActiveFilters =
    searchInput !== '' ||
    filters.sportId !== 'all' ||
    filters.gender !== 'all' ||
    filters.status !== 'all' ||
    filters.ageFrom !== null ||
    filters.ageTo !== null ||
    filters.stage !== 'all' ||
    hasActiveCharacteristicFilters;

  const handleResetFilters = () => {
    setSearchInput('');
    setFilters(DEFAULT_BRACKET_FILTERS);
  };

  // Парсинг значения числового инпута фильтра по возрасту: пустая строка -> null (фильтр
  // по этой границе не задан), иначе целое число (отрицательные/NaN игнорируем как null).
  const parseAgeInput = (value: string): number | null => {
    if (value.trim() === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) || parsed < 0 ? null : parsed;
  };

  // Прокрутка к сетке, из которой только что вернулись (см. App.tsx). Если сетка
  // отфильтрована и её карточки нет в DOM — querySelector вернёт null и мы просто
  // ничего не делаем.
  useEffect(() => {
    if (scrollToBracketId == null) return;
    const container = listContainerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-bracket-id="${scrollToBracketId}"]`);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToBracketId, filteredBrackets]);

  return (
    <div className="h-screen w-full flex flex-col bg-gradient-to-br from-gray-50 via-white to-gray-100">
      <header className="px-6 py-4 border-b border-gray-300 flex items-center justify-between bg-white/60">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{tournament.title}</h1>
          <p className="text-sm text-gray-500">Выберите сетку</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onReopenFile}>
          Открыть другой файл
        </Button>
      </header>

      <div className="px-6 pt-4">
        <div className="bg-white/95 border border-gray-300 rounded-lg p-4 space-y-3 shadow-sm">
          <div className="flex gap-3">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Поиск по категории или участнику..."
              className="flex-1 px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {hasActiveFilters && (
              <Button variant="secondary" size="sm" onClick={handleResetFilters}>
                Сбросить
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-700 font-medium whitespace-nowrap">Статус:</span>
            {STATUS_FILTER_OPTIONS.map((status) => (
              <button
                key={status}
                onClick={() => setFilters((prev) => ({ ...prev, status }))}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filters.status === status ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {status !== 'all' && (
                  <span className={`inline-block w-2 h-2 rounded-full ${statusDotClasses[status]}`} />
                )}
                {getStatusFilterLabel(status)}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-700 font-medium whitespace-nowrap">Стадия:</span>
            {STAGE_FILTER_OPTIONS.map((stage) => (
              <button
                key={stage}
                onClick={() => setFilters((prev) => ({ ...prev, stage }))}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filters.stage === stage ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {getStageFilterLabel(stage)}
              </button>
            ))}
          </div>

          {availableCharacteristics.map((field) => {
            const values = characteristicValuesByKey.get(field.key) ?? [];
            if (values.length <= 1) return null;
            const selected = filters.characteristics[field.key] ?? 'all';
            return (
              <div key={field.key} className="flex items-center gap-2 flex-wrap">
                <span className="text-sm text-gray-700 font-medium whitespace-nowrap">
                  {field.label || field.key}:
                </span>
                <button
                  onClick={() =>
                    setFilters((prev) => ({
                      ...prev,
                      characteristics: { ...prev.characteristics, [field.key]: 'all' },
                    }))
                  }
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    selected === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Все
                </button>
                {values.map((value) => (
                  <button
                    key={value}
                    onClick={() =>
                      setFilters((prev) => ({
                        ...prev,
                        characteristics: { ...prev.characteristics, [field.key]: value },
                      }))
                    }
                    className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                      selected === value ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            );
          })}

          {uniqueSports.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-700 font-medium whitespace-nowrap">Вид спорта:</span>
              <button
                onClick={() => setFilters((prev) => ({ ...prev, sportId: 'all' }))}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filters.sportId === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Все
              </button>
              {uniqueSports.map((sport) => (
                <button
                  key={sport.id}
                  onClick={() => setFilters((prev) => ({ ...prev, sportId: sport.id }))}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    filters.sportId === sport.id ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {sport.name}
                </button>
              ))}
            </div>
          )}

          {uniqueGenders.length > 1 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-700 font-medium whitespace-nowrap">Пол:</span>
              <button
                onClick={() => setFilters((prev) => ({ ...prev, gender: 'all' }))}
                className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                  filters.gender === 'all' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Все
              </button>
              {uniqueGenders.map((gender) => (
                <button
                  key={gender}
                  onClick={() => setFilters((prev) => ({ ...prev, gender }))}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    filters.gender === gender ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {getGenderLabel(gender)}
                </button>
              ))}
            </div>
          )}

          {showAgeFilter && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-gray-700 font-medium whitespace-nowrap">Возраст:</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={filters.ageFrom ?? ''}
                onChange={(e) => setFilters((prev) => ({ ...prev, ageFrom: parseAgeInput(e.target.value) }))}
                placeholder="от"
                className="w-20 px-2 py-1 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-gray-400">—</span>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={filters.ageTo ?? ''}
                onChange={(e) => setFilters((prev) => ({ ...prev, ageTo: parseAgeInput(e.target.value) }))}
                placeholder="до"
                className="w-20 px-2 py-1 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}
        </div>
      </div>

      <div ref={listContainerRef} className="flex-1 overflow-auto p-6">
        {bracketsWithLiveStatus.length === 0 ? (
          <p className="text-gray-500 text-center mt-12">В этом турнире нет сеток</p>
        ) : filteredBrackets.length === 0 ? (
          <div className="text-center mt-12">
            <p className="text-gray-500 mb-4">Ничего не найдено</p>
            <Button variant="secondary" size="sm" onClick={handleResetFilters}>
              Сбросить фильтры
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredBrackets.map((bracket) => (
              <Card
                key={bracket.id}
                data-bracket-id={bracket.id}
                variant="bordered"
                hoverable
                interactive
                onClick={() => onSelectBracket(bracket)}
              >
                <CardContent>
                  <h2 className="text-base font-semibold text-gray-900 mb-1">{bracket.category_name}</h2>
                  <StatusBadge status={bracket.status} />
                  {bracket.sport_name && (
                    <p className="text-xs text-gray-400 mt-1">{bracket.sport_name}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
