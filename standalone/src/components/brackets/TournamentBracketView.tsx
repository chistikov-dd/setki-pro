import { useMemo } from 'react';
import { MatchCard } from './MatchCard';
import type { Match } from '../../types';

interface TournamentBracketViewProps {
  matches: Match[];
  onOpenMatch: (matchId: number) => void;
}

/**
 * Простой (не drag&drop) вид турнирной сетки: колонки — раунды, строки — матчи.
 * Судья кликает по матчу, чтобы перейти на экран поединка.
 */
export function TournamentBracketView({ matches, onOpenMatch }: TournamentBracketViewProps) {
  const rounds = useMemo(() => {
    const byRound = new Map<number, Match[]>();
    for (const m of matches) {
      const list = byRound.get(m.round_number) || [];
      list.push(m);
      byRound.set(m.round_number, list);
    }
    for (const list of byRound.values()) {
      list.sort((a, b) => a.match_number - b.match_number);
    }
    return Array.from(byRound.entries()).sort(([a], [b]) => a - b);
  }, [matches]);

  if (matches.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        В этой сетке пока нет матчей
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto p-6">
      <div className="flex gap-8 items-start min-w-max">
        {rounds.map(([roundNumber, roundMatches]) => (
          <div key={roundNumber} className="flex flex-col gap-6">
            <h3 className="text-sm font-semibold text-gray-600 text-center">
              Раунд {roundNumber}
            </h3>
            {roundMatches.map((match) => (
              <MatchCard key={match.id} match={match} onOpenMatch={onOpenMatch} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
