import { useEffect, useState, useCallback } from 'react';
import { Button } from './ui/Button';
import { TournamentBracketView } from './brackets/TournamentBracketView';
import { getBracketMatches } from '../services/api';
import type { Bracket, Match } from '../types';

interface BracketScreenProps {
  bracket: Bracket;
  onOpenMatch: (match: Match) => void;
  onBack: () => void;
}

function normalizeMatch(raw: any): Match {
  return {
    id: raw.id,
    bracket_id: raw.bracket_id,
    participant1: raw.participant1 ?? undefined,
    participant2: raw.participant2 ?? undefined,
    winner_id: raw.winner_id ?? undefined,
    round_number: raw.round_number,
    match_number: raw.match_number,
    status: raw.status,
    score_participant1: raw.score_participant1 ?? 0,
    score_participant2: raw.score_participant2 ?? 0,
    warnings_participant1: raw.warnings_participant1 ?? 0,
    warnings_participant2: raw.warnings_participant2 ?? 0,
    result_type: raw.result_type ?? undefined,
  };
}

export function BracketScreen({ bracket, onOpenMatch, onBack }: BracketScreenProps) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const raw = await getBracketMatches(bracket.id);
      setMatches(raw.map(normalizeMatch));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [bracket.id]);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenMatch = (matchId: number) => {
    const match = matches.find((m) => m.id === matchId);
    if (match) {
      onOpenMatch(match);
    }
  };

  return (
    <div className="h-screen w-full flex flex-col bg-gradient-to-br from-gray-50 via-white to-gray-100">
      <header className="px-6 py-4 border-b border-gray-300 flex items-center justify-between bg-white/60">
        <div>
          <h1 className="text-lg font-bold text-gray-900">{bracket.category_name}</h1>
          <p className="text-sm text-gray-500">Сетка #{bracket.id}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={load}>Обновить</Button>
          <Button variant="ghost" size="sm" onClick={onBack}>← Назад</Button>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500">Загрузка...</div>
        ) : error ? (
          <div className="flex items-center justify-center h-full text-red-600">{error}</div>
        ) : (
          <TournamentBracketView matches={matches} onOpenMatch={handleOpenMatch} onMatchesChanged={load} />
        )}
      </div>
    </div>
  );
}
