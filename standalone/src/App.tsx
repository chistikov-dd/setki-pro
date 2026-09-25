import { useState, useEffect, lazy, Suspense } from 'react';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { FileOpenScreen } from './components/FileOpenScreen';
import { BracketListScreen } from './components/BracketListScreen';
import { BracketScreen } from './components/BracketScreen';
import { hasLoadedTournament, getTournamentMeta, getCachedBrackets, getBracketMatches } from './services/api';
import { normalizeMatch } from './utils/normalizeMatch';
import { DEFAULT_SCORING_CONFIG } from './types';
import type { Bracket, LoadedTournamentFile, Match } from './types';
import { DEFAULT_BRACKET_FILTERS, type BracketListFilters } from './utils/bracketFilters';

const MatchScreen = lazy(() => import('./components/match/MatchScreen').then((m) => ({ default: m.MatchScreen })));

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-gray-600">Загрузка...</p>
      </div>
    </div>
  );
}

type Screen =
  | { name: 'file-open' }
  | { name: 'bracket-list' }
  | { name: 'bracket'; bracket: Bracket }
  | { name: 'match'; bracket: Bracket; match: Match };

function App() {
  const [tournamentData, setTournamentData] = useState<LoadedTournamentFile | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'file-open' });
  // Id сетки, которую только что просматривали — чтобы при возврате на список
  // сеток проскроллить к её карточке, а не сбрасывать скролл наверх.
  const [lastViewedBracketId, setLastViewedBracketId] = useState<number | null>(null);
  // Счётчик, инкрементируемый при каждом возврате из экрана матча в сетку.
  // Передаётся как React `key` в BracketScreen, чтобы принудительно
  // ремонтировать компонент — иначе useEffect с зависимостью от bracket.id
  // не перезапустится (bracket.id не меняется) и список матчей не обновится
  // автоматически (пользователю пришлось бы жать "Обновить" вручную).
  const [bracketReloadToken, setBracketReloadToken] = useState(0);
  // При F5/Ctrl+R (перезагрузка webview) React-состояние обнуляется, но Rust-процесс
  // Tauri и его SQLite-кэш продолжают жить с уже загруженным турниром. Пока мы не
  // проверили это на монтировании — показываем спиннер, а не FileOpenScreen, чтобы
  // он не мелькал перед восстановлением сессии.
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  // Состояние фильтров списка сеток поднято сюда (из BracketListScreen), чтобы оно
  // переживало размонтирование/монтирование этого экрана при переходах
  // bracket-list -> bracket -> bracket-list (screen.name меняется, и условная JSX-ветка
  // для 'bracket-list' полностью пересоздаётся — локальный useState внутри
  // BracketListScreen обнулялся бы при каждом возврате из сетки).
  const [bracketFilters, setBracketFilters] = useState<BracketListFilters>(DEFAULT_BRACKET_FILTERS);
  const [bracketSearchInput, setBracketSearchInput] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const loaded = await hasLoadedTournament();
        if (!loaded || cancelled) return;

        const [meta, brackets] = await Promise.all([getTournamentMeta(), getCachedBrackets()]);
        if (cancelled) return;

        // get_cached_brackets не отдаёт вложенные matches (нужны для поиска по
        // участнику в BracketListScreen) — догружаем их отдельно на сетку и мержим.
        const bracketsWithMatches: Bracket[] = await Promise.all(
          brackets.map(async (bracket) => {
            try {
              const rawMatches = await getBracketMatches(bracket.id);
              return { ...bracket, matches: rawMatches.map(normalizeMatch) };
            } catch {
              return bracket;
            }
          })
        );
        if (cancelled) return;

        const restored: LoadedTournamentFile = {
          tournament: {
            id: meta?.tournament_id ?? 0,
            title: meta?.tournament_name ?? 'Турнир',
          },
          brackets: bracketsWithMatches,
          scoring_config: meta?.scoring_config ?? DEFAULT_SCORING_CONFIG,
          judge_name: meta?.judge_name ?? undefined,
        };

        setTournamentData(restored);
        setScreen({ name: 'bracket-list' });
      } catch {
        // Не удалось проверить/восстановить сессию — остаёмся на FileOpenScreen,
        // судья сможет выбрать файл вручную.
      } finally {
        if (!cancelled) {
          setIsRestoringSession(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleFileLoaded = (data: LoadedTournamentFile) => {
    setTournamentData(data);
    setScreen({ name: 'bracket-list' });
  };

  const handleReopenFile = () => {
    setTournamentData(null);
    setScreen({ name: 'file-open' });
  };

  const handleBackToBracketList = (bracket: Bracket) => {
    setLastViewedBracketId(bracket.id);
    setScreen({ name: 'bracket-list' });
  };

  if (isRestoringSession) {
    return <LoadingSpinner />;
  }

  return (
    <ErrorBoundary>
      {screen.name === 'file-open' && <FileOpenScreen onLoaded={handleFileLoaded} />}

      {screen.name === 'bracket-list' && tournamentData && (
        <BracketListScreen
          tournament={tournamentData.tournament}
          brackets={tournamentData.brackets}
          onSelectBracket={(bracket) => setScreen({ name: 'bracket', bracket })}
          onReopenFile={handleReopenFile}
          scrollToBracketId={lastViewedBracketId}
          filters={bracketFilters}
          onFiltersChange={setBracketFilters}
          searchInput={bracketSearchInput}
          onSearchInputChange={setBracketSearchInput}
        />
      )}

      {screen.name === 'bracket' && (
        <BracketScreen
          key={bracketReloadToken}
          bracket={screen.bracket}
          onOpenMatch={(match) => setScreen({ name: 'match', bracket: screen.bracket, match })}
          onBack={() => handleBackToBracketList(screen.bracket)}
        />
      )}

      {screen.name === 'match' && (
        <Suspense fallback={<LoadingSpinner />}>
          <MatchScreen
            match={screen.match}
            categoryName={screen.bracket.category_name}
            onExit={() => {
              setBracketReloadToken((prev) => prev + 1);
              setScreen({ name: 'bracket', bracket: screen.bracket });
            }}
          />
        </Suspense>
      )}
    </ErrorBoundary>
  );
}

export default App;
