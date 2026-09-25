import { useMemo, useState } from 'react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { useDebounce } from '../hooks/useDebounce';
import {
  filterBrackets,
  getUniqueSports,
  getUniqueGenders,
  getGenderLabel,
  DEFAULT_BRACKET_FILTERS,
  type BracketListFilters,
} from '../utils/bracketFilters';
import type { Bracket, Tournament } from '../types';

interface BracketListScreenProps {
  tournament: Tournament;
  brackets: Bracket[];
  onSelectBracket: (bracket: Bracket) => void;
  onReopenFile: () => void;
}

const statusLabels: Record<Bracket['status'], string> = {
  not_started: 'Не начата',
  in_progress: 'Идёт',
  completed: 'Завершена',
};

/**
 * Единый экран списка сеток турнира (без промежуточного экрана "категорий" —
 * в подавляющем большинстве турниров категория 1:1 с сеткой, поэтому
 * промежуточный уровень только мешал). Поддерживает поиск по названию
 * категории и по именам участников, а также фильтры по виду спорта и полу.
 */
export function BracketListScreen({ tournament, brackets, onSelectBracket, onReopenFile }: BracketListScreenProps) {
  const [filters, setFilters] = useState<BracketListFilters>(DEFAULT_BRACKET_FILTERS);
  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);

  const activeFilters: BracketListFilters = { ...filters, searchQuery: debouncedSearch };

  const uniqueSports = useMemo(() => getUniqueSports(brackets), [brackets]);
  const uniqueGenders = useMemo(() => getUniqueGenders(brackets), [brackets]);

  const filteredBrackets = useMemo(
    () => filterBrackets(brackets, activeFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [brackets, activeFilters.sportId, activeFilters.gender, activeFilters.searchQuery]
  );

  const hasActiveFilters = searchInput !== '' || filters.sportId !== 'all' || filters.gender !== 'all';

  const handleResetFilters = () => {
    setSearchInput('');
    setFilters(DEFAULT_BRACKET_FILTERS);
  };

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
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {brackets.length === 0 ? (
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
                variant="bordered"
                hoverable
                interactive
                onClick={() => onSelectBracket(bracket)}
              >
                <CardContent>
                  <h2 className="text-base font-semibold text-gray-900 mb-1">{bracket.category_name}</h2>
                  <p className="text-sm text-gray-500">{statusLabels[bracket.status]}</p>
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
