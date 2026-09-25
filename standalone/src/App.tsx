import { useState, lazy, Suspense } from 'react';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { FileOpenScreen } from './components/FileOpenScreen';
import { BracketListScreen } from './components/BracketListScreen';
import { BracketScreen } from './components/BracketScreen';
import type { Bracket, LoadedTournamentFile, Match } from './types';

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

  const handleFileLoaded = (data: LoadedTournamentFile) => {
    setTournamentData(data);
    setScreen({ name: 'bracket-list' });
  };

  const handleReopenFile = () => {
    setTournamentData(null);
    setScreen({ name: 'file-open' });
  };

  return (
    <ErrorBoundary>
      {screen.name === 'file-open' && <FileOpenScreen onLoaded={handleFileLoaded} />}

      {screen.name === 'bracket-list' && tournamentData && (
        <BracketListScreen
          tournament={tournamentData.tournament}
          brackets={tournamentData.brackets}
          onSelectBracket={(bracket) => setScreen({ name: 'bracket', bracket })}
          onReopenFile={handleReopenFile}
        />
      )}

      {screen.name === 'bracket' && (
        <BracketScreen
          bracket={screen.bracket}
          onOpenMatch={(match) => setScreen({ name: 'match', bracket: screen.bracket, match })}
          onBack={() => setScreen({ name: 'bracket-list' })}
        />
      )}

      {screen.name === 'match' && (
        <Suspense fallback={<LoadingSpinner />}>
          <MatchScreen
            match={screen.match}
            categoryName={screen.bracket.category_name}
            onExit={() => setScreen({ name: 'bracket', bracket: screen.bracket })}
          />
        </Suspense>
      )}
    </ErrorBoundary>
  );
}

export default App;
