import { useRef, useMemo } from 'react';
import { MatchCard } from './MatchCard';
import type { Match } from '../../types';

interface Round {
  name: string;
  matches: Match[];
}

interface TournamentBracketProps {
  matches: Match[];
  onStartMatch: (matchId: number) => void;
  categoryName?: string;
}

export function TournamentBracket({ matches, onStartMatch, categoryName }: TournamentBracketProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Мемоизация группировки матчей по раундам
  // Оптимизация: O(n*m) операций → пересчет только при изменении matches
  const rounds = useMemo(() => {
    const groupedRounds: Round[] = [];
    const maxRound = Math.max(...matches.map(m => m.round_number));

    for (let roundNum = 1; roundNum <= maxRound; roundNum++) {
      const roundMatches = matches
        .filter(m => m.round_number === roundNum)
        .sort((a, b) => a.match_number - b.match_number);

      if (roundMatches.length > 0) {
        groupedRounds.push({
          name: getRoundName(roundNum, maxRound),
          matches: roundMatches
        });
      }
    }

    return groupedRounds;
  }, [matches]);

  const CARD_WIDTH = 264;
  const CARD_HEIGHT = 160;
  const HORIZONTAL_GAP = 100;
  const VERTICAL_GAP = 40;
  const DIVIDER_OFFSET = Math.floor(CARD_HEIGHT * 0.53);
  const PADDING = 32;

  // Мемоизация размеров контейнера
  // Оптимизация: пересчет только при изменении rounds
  const { totalWidth, totalHeight, maxMatchesInRound: _maxMatchesInRound } = useMemo(() => {
    const width = rounds.length * (CARD_WIDTH + HORIZONTAL_GAP) - HORIZONTAL_GAP + PADDING * 2;

    let maxMatches = 0;
    rounds.forEach((round) => {
      if (round.matches.length > maxMatches) {
        maxMatches = round.matches.length;
      }
    });

    const height = maxMatches * (CARD_HEIGHT + VERTICAL_GAP) - VERTICAL_GAP + PADDING * 2 + 60;

    return { totalWidth: width, totalHeight: height, maxMatchesInRound: maxMatches };
  }, [rounds]);

  // Мемоизация генерации SVG линий между матчами
  // Оптимизация: дорогой расчет всех path элементов → пересчет только при изменении rounds
  const svgLines = useMemo(() => {
    const lines: React.ReactElement[] = [];

    for (let roundIndex = 0; roundIndex < rounds.length - 1; roundIndex++) {
      const currentRound = rounds[roundIndex];
      const nextRound = rounds[roundIndex + 1];

      const currentX = roundIndex * (CARD_WIDTH + HORIZONTAL_GAP);
      const nextX = (roundIndex + 1) * (CARD_WIDTH + HORIZONTAL_GAP);

      nextRound.matches.forEach((_, nextMatchIndex) => {
        const match1Index = nextMatchIndex * 2;
        const match2Index = nextMatchIndex * 2 + 1;

        if (match1Index >= currentRound.matches.length) return;

        // Вычисляем вертикальные позиции
        const verticalMultiplierCurrent = Math.pow(2, roundIndex);
        const offsetCurrent = ((verticalMultiplierCurrent - 1) * (CARD_HEIGHT + VERTICAL_GAP)) / 2;

        const y1 = 60 + offsetCurrent + match1Index * verticalMultiplierCurrent * (CARD_HEIGHT + VERTICAL_GAP) + DIVIDER_OFFSET;
        const y2 = match2Index < currentRound.matches.length
          ? 60 + offsetCurrent + match2Index * verticalMultiplierCurrent * (CARD_HEIGHT + VERTICAL_GAP) + DIVIDER_OFFSET
          : y1;

        const verticalMultiplierNext = Math.pow(2, roundIndex + 1);
        const offsetNext = ((verticalMultiplierNext - 1) * (CARD_HEIGHT + VERTICAL_GAP)) / 2;
        const yNext = 60 + offsetNext + nextMatchIndex * verticalMultiplierNext * (CARD_HEIGHT + VERTICAL_GAP) + DIVIDER_OFFSET;

        // SVG путь: соединяет два матча текущего раунда с одним матчем следующего
        const startX = currentX + CARD_WIDTH;
        const endX = nextX;
        const midX = startX + HORIZONTAL_GAP / 2;

        const path = match2Index < currentRound.matches.length
          ? `M ${startX},${y1} H ${midX} V ${y2} H ${startX} M ${midX},${yNext} H ${endX}`
          : `M ${startX},${y1} H ${midX} V ${yNext} H ${endX}`;

        lines.push(
          <path
            key={`line-${roundIndex}-${nextMatchIndex}`}
            d={path}
            stroke="#4b5563"
            strokeWidth="3"
            fill="none"
            opacity="0.8"
          />
        );
      });
    }

    return lines;
  }, [rounds]);

  if (matches.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-gray-800">Нет матчей в сетке</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full bg-gradient-to-br from-gray-50 via-white to-gray-100 rounded-lg overflow-auto p-8"
    >
      {/* Категория турнирной сетки */}
      {categoryName && (
        <div className="mb-6 pb-4 border-b-2 border-gray-300">
          <h3 className="text-2xl font-bold text-gray-900">
            Категория: {categoryName}
          </h3>
        </div>
      )}

      <div
        className="relative"
        style={{
          width: `${totalWidth}px`,
          height: `${totalHeight}px`,
          minHeight: '400px'
        }}
      >
        {/* SVG слой с линиями */}
        <svg
          className="absolute top-0 left-0 pointer-events-none"
          style={{
            width: '100%',
            height: '100%',
            overflow: 'visible'
          }}
        >
          {svgLines}
        </svg>

        {/* Раунды и матчи */}
        {rounds.map((round, roundIndex) => {
          const x = roundIndex * (CARD_WIDTH + HORIZONTAL_GAP);

          return (
            <div key={roundIndex}>
              {/* Название раунда */}
              <div
                className="absolute text-center text-sm font-semibold text-gray-800"
                style={{
                  left: `${x}px`,
                  top: '20px',
                  width: `${CARD_WIDTH}px`
                }}
              >
                {round.name}
              </div>

              {/* Матчи раунда */}
              {round.matches.map((match, matchIndex) => {
                const verticalMultiplier = Math.pow(2, roundIndex);
                const offset = ((verticalMultiplier - 1) * (CARD_HEIGHT + VERTICAL_GAP)) / 2;
                const y = 60 + offset + matchIndex * verticalMultiplier * (CARD_HEIGHT + VERTICAL_GAP);

                return (
                  <div
                    key={match.id}
                    className="absolute transition-all duration-200"
                    style={{
                      left: `${x}px`,
                      top: `${y}px`
                    }}
                  >
                    <MatchCard
                      match={match}
                      width={CARD_WIDTH}
                      onStartMatch={onStartMatch}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Вспомогательная функция для названия раунда
function getRoundName(roundNum: number, maxRound: number): string {
  const roundsFromEnd = maxRound - roundNum;

  switch (roundsFromEnd) {
    case 0:
      return 'Финал';
    case 1:
      return 'Полуфинал';
    case 2:
      return '1/4 финала';
    case 3:
      return '1/8 финала';
    case 4:
      return '1/16 финала';
    default:
      return `Раунд ${roundNum}`;
  }
}
