import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { BracketListScreen } from '../../components/BracketListScreen';
import { DEFAULT_BRACKET_FILTERS, type BracketListFilters } from '../../utils/bracketFilters';
import type { Bracket, Tournament } from '../../types';

// getCachedBrackets вызывает invoke('get_cached_brackets') через Tauri — в jsdom его нет,
// поэтому мокаем сервисный модуль напрямую (как это делает компонент).
vi.mock('../../services/api', () => ({
  getCachedBrackets: vi.fn(),
}));

import { getCachedBrackets } from '../../services/api';

/**
 * BracketListScreen больше не управляет своим состоянием фильтров самостоятельно —
 * оно поднято в родителя (App.tsx). Этот враппер эмулирует такого "родителя" в тестах,
 * храня filters/searchInput через useState и прокидывая их вниз пропами — так же,
 * как это делает настоящий App.tsx.
 */
function ControlledBracketListScreen(
  props: Omit<
    ComponentProps<typeof BracketListScreen>,
    'filters' | 'onFiltersChange' | 'searchInput' | 'onSearchInputChange'
  > & { initialFilters?: BracketListFilters; initialSearchInput?: string }
) {
  const { initialFilters, initialSearchInput, ...rest } = props;
  const [filters, setFilters] = useState<BracketListFilters>(initialFilters ?? DEFAULT_BRACKET_FILTERS);
  const [searchInput, setSearchInput] = useState(initialSearchInput ?? '');
  return (
    <BracketListScreen
      {...rest}
      filters={filters}
      onFiltersChange={setFilters}
      searchInput={searchInput}
      onSearchInputChange={setSearchInput}
    />
  );
}

function makeBracket(overrides: Partial<Bracket>): Bracket {
  return {
    id: 1,
    category_id: 1,
    category_name: 'Категория',
    bracket_type: 'single_elimination',
    total_rounds: 2,
    status: 'not_started',
    ...overrides,
  };
}

const tournament: Tournament = { id: 1, title: 'Тестовый турнир' };

describe('BracketListScreen', () => {
  beforeEach(() => {
    vi.mocked(getCachedBrackets).mockReset();
    vi.mocked(getCachedBrackets).mockResolvedValue([]);
    // scrollIntoView не реализован в jsdom по умолчанию.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders without crashing when scrollToBracketId is not provided', async () => {
    const brackets = [makeBracket({ id: 1 }), makeBracket({ id: 2, category_name: 'Категория 2' })];
    render(
      <ControlledBracketListScreen
        tournament={tournament}
        brackets={brackets}
        onSelectBracket={vi.fn()}
        onReopenFile={vi.fn()}
      />
    );

    expect(await screen.findByText('Категория')).toBeInTheDocument();
    expect(screen.getByText('Категория 2')).toBeInTheDocument();
  });

  it('renders without crashing and calls scrollIntoView when scrollToBracketId matches a visible bracket', async () => {
    const brackets = [makeBracket({ id: 1 }), makeBracket({ id: 2, category_name: 'Категория 2' })];
    render(
      <ControlledBracketListScreen
        tournament={tournament}
        brackets={brackets}
        onSelectBracket={vi.fn()}
        onReopenFile={vi.fn()}
        scrollToBracketId={2}
      />
    );

    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    });
  });

  it('does not crash when scrollToBracketId references a bracket filtered out of view', async () => {
    const brackets = [makeBracket({ id: 1 })];
    expect(() =>
      render(
        <ControlledBracketListScreen
          tournament={tournament}
          brackets={brackets}
          onSelectBracket={vi.fn()}
          onReopenFile={vi.fn()}
          scrollToBracketId={999}
        />
      )
    ).not.toThrow();
  });

  it('merges live status from get_cached_brackets over the static bracket status', async () => {
    const brackets = [makeBracket({ id: 1, status: 'not_started' })];
    vi.mocked(getCachedBrackets).mockResolvedValue([
      { ...makeBracket({ id: 1, status: 'in_progress' }) } as Bracket,
    ]);

    render(
      <ControlledBracketListScreen
        tournament={tournament}
        brackets={brackets}
        onSelectBracket={vi.fn()}
        onReopenFile={vi.fn()}
      />
    );

    expect(await screen.findByText('Идёт')).toBeInTheDocument();
  });

  it('filters brackets by status via pill buttons', async () => {
    const brackets = [
      makeBracket({ id: 1, category_name: 'Категория А', status: 'not_started' }),
      makeBracket({ id: 2, category_name: 'Категория Б', status: 'in_progress' }),
    ];
    render(
      <ControlledBracketListScreen
        tournament={tournament}
        brackets={brackets}
        onSelectBracket={vi.fn()}
        onReopenFile={vi.fn()}
      />
    );

    await screen.findByText('Категория А');
    const inProgressPill = screen.getByRole('button', { name: 'В процессе' });
    inProgressPill.click();

    await waitFor(() => {
      expect(screen.queryByText('Категория А')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Категория Б')).toBeInTheDocument();
  });

  // Регрессионный тест на баг "фильтры сбрасываются при возврате из сетки в список":
  // раньше filters/searchInput жили в локальном useState ВНУТРИ BracketListScreen, поэтому
  // при переходе bracket-list -> bracket -> bracket-list (в App.tsx это условная JSX-ветка,
  // компонент полностью размонтируется и монтируется заново) выбранные фильтры сбрасывались
  // на дефолт. Теперь filters/searchInput приходят пропами из родителя (App.tsx) и переживают
  // размонтирование/повторное монтирование. Этот тест напрямую эмулирует именно такой ремаунт:
  // рендерим BracketListScreen (не Controlled-обёртку!) с явными non-default filters/searchInput,
  // размонтируем (как это делает App.tsx при screen.name !== 'bracket-list') и монтируем заново
  // с ТЕМИ ЖЕ пропами (как если бы состояние хранилось в App.tsx и просто передалось снова) —
  // отфильтрованный список должен остаться корректным, а не сброшенным к дефолту.
  it('does not reset filters on remount when the parent keeps passing the same non-default filters prop', async () => {
    const brackets = [
      makeBracket({ id: 1, category_name: 'Категория А', status: 'not_started' }),
      makeBracket({ id: 2, category_name: 'Категория Б', status: 'in_progress' }),
      makeBracket({ id: 3, category_name: 'Категория В', status: 'completed' }),
    ];
    const nonDefaultFilters: BracketListFilters = {
      ...DEFAULT_BRACKET_FILTERS,
      status: 'in_progress',
    };

    const { unmount } = render(
      <BracketListScreen
        tournament={tournament}
        brackets={brackets}
        onSelectBracket={vi.fn()}
        onReopenFile={vi.fn()}
        filters={nonDefaultFilters}
        onFiltersChange={vi.fn()}
        searchInput=""
        onSearchInputChange={vi.fn()}
      />
    );

    // Фильтр "В процессе" применён -> видна только Категория Б.
    expect(await screen.findByText('Категория Б')).toBeInTheDocument();
    expect(screen.queryByText('Категория А')).not.toBeInTheDocument();
    expect(screen.queryByText('Категория В')).not.toBeInTheDocument();

    // Симулируем переход bracket-list -> bracket -> bracket-list: полное размонтирование
    // и повторное монтирование компонента (как в App.tsx при смене screen.name), но с ТЕМИ ЖЕ
    // пропами filters/searchInput, что и живут в App.tsx между переходами.
    unmount();

    render(
      <BracketListScreen
        tournament={tournament}
        brackets={brackets}
        onSelectBracket={vi.fn()}
        onReopenFile={vi.fn()}
        filters={nonDefaultFilters}
        onFiltersChange={vi.fn()}
        searchInput=""
        onSearchInputChange={vi.fn()}
      />
    );

    // Если бы баг был не исправлен (filters — локальный useState внутри компонента),
    // после ремаунта фильтр всё равно сбросился бы на DEFAULT_BRACKET_FILTERS и снова
    // были бы видны все 3 категории. С поднятым состоянием ремаунт с теми же пропами
    // должен сохранить тот же отфильтрованный результат.
    expect(await screen.findByText('Категория Б')).toBeInTheDocument();
    expect(screen.queryByText('Категория А')).not.toBeInTheDocument();
    expect(screen.queryByText('Категория В')).not.toBeInTheDocument();
  });
});
