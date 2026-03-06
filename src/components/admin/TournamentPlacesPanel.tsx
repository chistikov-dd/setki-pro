import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';

interface TournamentPlace {
  id: number;
  tournament_id: number;
  bracket_id: number;
  bracket_name: string | null;
  place: number;
  fighter_id: number | null;
  fighter_name: string;
  club_name: string | null;
  computed_at: string;
}

interface TournamentPlacesPanelProps {
  tournamentId: number;
}

const PLACE_MEDALS: Record<number, string> = {
  1: '🥇',
  2: '🥈',
  3: '🥉',
};

const PLACE_LABELS: Record<number, string> = {
  1: '1 место',
  2: '2 место',
  3: '3 место',
  4: '4 место',
  5: '5 место',
  6: '6 место',
  7: '7 место',
  8: '8 место',
  9: '9 место',
  10: '10 место',
};

export const TournamentPlacesPanel: React.FC<TournamentPlacesPanelProps> = ({ tournamentId }) => {
  const [places, setPlaces] = useState<TournamentPlace[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isComputing, setIsComputing] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPlaces = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<TournamentPlace[]>('get_tournament_places', { tournamentId });
      setPlaces(result);
      setIsLoaded(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const computePlaces = async () => {
    setIsComputing(true);
    setError(null);
    try {
      const result = await invoke<TournamentPlace[]>('compute_tournament_places', { tournamentId });
      setPlaces(result);
      setIsLoaded(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsComputing(false);
    }
  };

  // Группируем по bracket_id
  const byBracket: Record<number, TournamentPlace[]> = {};
  for (const p of places) {
    if (!byBracket[p.bracket_id]) byBracket[p.bracket_id] = [];
    byBracket[p.bracket_id].push(p);
  }

  return (
    <Card variant="bordered">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Итоговые места</CardTitle>
          <div className="flex gap-2">
            {!isLoaded && (
              <Button
                variant="ghost"
                size="sm"
                onClick={loadPlaces}
                disabled={isLoading}
              >
                {isLoading ? 'Загрузка...' : 'Показать'}
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={computePlaces}
              disabled={isComputing}
            >
              {isComputing ? 'Вычисление...' : 'Пересчитать'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        {!isLoaded && !isLoading && (
          <p className="text-gray-500 text-sm text-center py-4">
            Нажмите «Показать» или «Пересчитать» для отображения мест
          </p>
        )}

        {isLoaded && places.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-4">
            Нет данных — сначала завершите хотя бы один матч в сетке
          </p>
        )}

        {Object.entries(byBracket).map(([bracketId, bracketPlaces]) => {
          const bracketName = bracketPlaces[0]?.bracket_name || `Сетка ${bracketId}`;
          return (
            <div key={bracketId} className="mb-6 last:mb-0">
              <h4 className="text-sm font-semibold text-gray-700 mb-2 pb-1 border-b border-gray-200">
                {bracketName}
              </h4>
              <div className="space-y-1">
                {bracketPlaces
                  .sort((a, b) => a.place - b.place)
                  .map((p) => (
                  <div key={p.id} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-gray-50">
                    <span className="w-8 text-center text-lg leading-none">
                      {PLACE_MEDALS[p.place] || ''}
                    </span>
                    <span className="w-16 text-xs font-medium text-gray-500">
                      {PLACE_LABELS[p.place] || `${p.place} место`}
                    </span>
                    <span className="font-medium text-gray-900 text-sm flex-1">
                      {p.fighter_name}
                    </span>
                    {p.club_name && (
                      <span className="text-xs text-gray-400 truncate max-w-[140px]">
                        {p.club_name}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
