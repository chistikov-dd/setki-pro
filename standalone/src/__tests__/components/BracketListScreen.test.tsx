import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BracketListScreen } from '../../components/BracketListScreen';
import type { Bracket, Tournament } from '../../types';

// getCachedBrackets вызывает invoke('get_cached_brackets') через Tauri — в jsdom его нет,
// поэтому мокаем сервисный модуль напрямую (как это делает компонент).
vi.mock('../../services/api', () => ({
  getCachedBrackets: vi.fn(),
}));

import { getCachedBrackets } from '../../services/api';

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
      <BracketListScreen
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
      <BracketListScreen
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
        <BracketListScreen
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
      <BracketListScreen
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
      <BracketListScreen
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
});
