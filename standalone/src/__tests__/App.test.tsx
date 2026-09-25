import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';

// Мокаем весь сервисный слой Tauri-инвоков — App.tsx и BracketListScreen.tsx
// используют его напрямую, а в jsdom/happy-dom реального Tauri backend нет.
vi.mock('../services/api', () => ({
  hasLoadedTournament: vi.fn(),
  getTournamentMeta: vi.fn(),
  getCachedBrackets: vi.fn(),
  getBracketMatches: vi.fn(),
  pickAndLoadTournamentFile: vi.fn(),
}));

import {
  hasLoadedTournament,
  getTournamentMeta,
  getCachedBrackets,
  getBracketMatches,
} from '../services/api';

describe('App: восстановление сессии после F5/Ctrl+R', () => {
  beforeEach(() => {
    vi.mocked(hasLoadedTournament).mockReset();
    vi.mocked(getTournamentMeta).mockReset();
    vi.mocked(getCachedBrackets).mockReset();
    vi.mocked(getBracketMatches).mockReset();
  });

  it('показывает FileOpenScreen, если турнир ещё не загружен в SQLite-кэш', async () => {
    vi.mocked(hasLoadedTournament).mockResolvedValue(false);

    render(<App />);

    expect(await screen.findByText('Открыть файл турнира')).toBeInTheDocument();
    expect(getTournamentMeta).not.toHaveBeenCalled();
  });

  it('минуя FileOpenScreen, восстанавливает список сеток из SQLite-кэша, если турнир уже загружен (например, после F5)', async () => {
    vi.mocked(hasLoadedTournament).mockResolvedValue(true);
    vi.mocked(getTournamentMeta).mockResolvedValue({
      tournament_id: 42,
      tournament_name: 'Восстановленный турнир',
      judge_name: null,
      scoring_config: { sport_id: 1, actions: [], warnings: { enabled: true, max_count: 3 } },
    });
    vi.mocked(getCachedBrackets).mockResolvedValue([
      {
        id: 1,
        category_id: 1,
        category_name: 'Категория А',
        bracket_type: 'single_elimination',
        total_rounds: 1,
        status: 'in_progress',
      },
    ]);
    vi.mocked(getBracketMatches).mockResolvedValue([]);

    render(<App />);

    // FileOpenScreen не должен появиться вовсе.
    expect(await screen.findByText('Восстановленный турнир')).toBeInTheDocument();
    expect(screen.queryByText('Открыть файл турнира')).not.toBeInTheDocument();
    expect(await screen.findByText('Категория А')).toBeInTheDocument();
  });

  it('остаётся на FileOpenScreen, если проверка сессии падает с ошибкой', async () => {
    vi.mocked(hasLoadedTournament).mockRejectedValue(new Error('IPC недоступен'));

    render(<App />);

    expect(await screen.findByText('Открыть файл турнира')).toBeInTheDocument();
  });
});
