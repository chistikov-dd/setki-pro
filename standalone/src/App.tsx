import { useState, lazy, Suspense } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { FileOpenScreen } from './components/FileOpenScreen';
import { CategoryListScreen } from './components/CategoryListScreen';
import { BracketListScreen } from './components/BracketListScreen';
import { BracketScreen } from './components/BracketScreen';
import { buildCategoriesFromBrackets, filterBracketsByCategory } from './utils/categoryGrouping';
import type { Bracket, Category, LoadedTournamentFile, Match } from './types';

const MatchScreen = lazy(() => import('./components/match/MatchScreen').then((m) => ({ default: m.MatchScreen })));
const PublicDisplayPage = lazy(() => import('./pages/PublicDisplayPage').then((m) => ({ default: m.PublicDisplayPage })));

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
  | { name: 'categories' }
  | { name: 'brackets'; category: Category }
  | { name: 'bracket'; category: Category; bracket: Bracket }
  | { name: 'match'; category: Category; bracket: Bracket; match: Match };

function App() {
  const currentWindow = getCurrentWebviewWindow();
  const isPublicDisplayWindow = currentWindow.label === 'public-display';

  const [tournamentData, setTournamentData] = useState<LoadedTournamentFile | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'file-open' });

  if (isPublicDisplayWindow) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<LoadingSpinner />}>
          <PublicDisplayPage />
        </Suspense>
      </ErrorBoundary>
    );
  }

  const handleFileLoaded = (data: LoadedTournamentFile) => {
    setTournamentData(data);
    setScreen({ name: 'categories' });
  };

  const handleReopenFile = () => {
    setTournamentData(null);
    setScreen({ name: 'file-open' });
  };

  const categories: Category[] = tournamentData ? buildCategoriesFromBrackets(tournamentData.brackets) : [];

  return (
    <ErrorBoundary>
      {screen.name === 'file-open' && <FileOpenScreen onLoaded={handleFileLoaded} />}

      {screen.name === 'categories' && tournamentData && (
        <CategoryListScreen
          tournament={tournamentData.tournament}
          categories={categories}
          onSelectCategory={(category) => setScreen({ name: 'brackets', category })}
          onReopenFile={handleReopenFile}
        />
      )}

      {screen.name === 'brackets' && tournamentData && (
        <BracketListScreen
          category={screen.category}
          brackets={filterBracketsByCategory(tournamentData.brackets, screen.category)}
          onSelectBracket={(bracket) => setScreen({ name: 'bracket', category: screen.category, bracket })}
          onBack={() => setScreen({ name: 'categories' })}
        />
      )}

      {screen.name === 'bracket' && (
        <BracketScreen
          bracket={screen.bracket}
          onOpenMatch={(match) =>
            setScreen({ name: 'match', category: screen.category, bracket: screen.bracket, match })
          }
          onBack={() => setScreen({ name: 'brackets', category: screen.category })}
        />
      )}

      {screen.name === 'match' && (
        <Suspense fallback={<LoadingSpinner />}>
          <MatchScreen
            match={screen.match}
            categoryName={screen.category.name}
            onExit={() => setScreen({ name: 'bracket', category: screen.category, bracket: screen.bracket })}
          />
        </Suspense>
      )}
    </ErrorBoundary>
  );
}

export default App;
