import type { Match } from '../types';

export const CARD_WIDTH = 240;
export const CARD_HEIGHT = 160;
export const HORIZONTAL_GAP = 80;
export const VERTICAL_GAP = 32;
export const PADDING = 32;
export const TOP_OFFSET = 60;

export interface BracketRound {
  roundNumber: number;
  matches: Match[];
}

export interface MatchPosition {
  match: Match;
  x: number;
  y: number;
}

export interface BracketLayout {
  rounds: BracketRound[];
  positions: MatchPosition[];
  totalWidth: number;
  totalHeight: number;
  lines: string[];
}

/**
 * Сгруппировать матчи по раундам (отсортировано по номеру раунда, внутри —
 * по номеру матча).
 */
export function groupMatchesByRound(matches: Match[]): BracketRound[] {
  const byRound = new Map<number, Match[]>();
  for (const m of matches) {
    const list = byRound.get(m.round_number) || [];
    list.push(m);
    byRound.set(m.round_number, list);
  }
  for (const list of byRound.values()) {
    list.sort((a, b) => a.match_number - b.match_number);
  }
  return Array.from(byRound.entries())
    .sort(([a], [b]) => a - b)
    .map(([roundNumber, roundMatches]) => ({ roundNumber, matches: roundMatches }));
}

/**
 * Вертикальная позиция матча внутри раунда — классическая формула для
 * турнирной сетки single elimination: каждый следующий раунд удваивает
 * вертикальный интервал между матчами и центрирует их между родительской парой.
 *
 * verticalMultiplier = 2^roundIndex (roundIndex начиная с 0 для первого раунда)
 * offset центрирует блок матчей раунда относительно самого первого раунда.
 */
export function matchY(roundIndex: number, matchIndex: number): number {
  const verticalMultiplier = Math.pow(2, roundIndex);
  const offset = ((verticalMultiplier - 1) * (CARD_HEIGHT + VERTICAL_GAP)) / 2;
  return TOP_OFFSET + offset + matchIndex * verticalMultiplier * (CARD_HEIGHT + VERTICAL_GAP);
}

export function matchX(roundIndex: number): number {
  return PADDING + roundIndex * (CARD_WIDTH + HORIZONTAL_GAP);
}

/**
 * Построить полную раскладку сетки: позиции карточек + SVG path'ы линий
 * между раундами ("скобки" турнирной сетки), + итоговые размеры контейнера.
 *
 * Устойчиво к вырожденным случаям: 0 матчей, 1 раунд, нечётное число матчей
 * в раунде (не должно случиться в валидной single-elimination сетке, но не
 * должно приводить к NaN/делению на 0).
 */
export function computeBracketLayout(matches: Match[]): BracketLayout {
  const rounds = groupMatchesByRound(matches);

  if (rounds.length === 0) {
    return { rounds, positions: [], totalWidth: 0, totalHeight: 0, lines: [] };
  }

  const positions: MatchPosition[] = [];
  rounds.forEach((round, roundIndex) => {
    const x = matchX(roundIndex);
    round.matches.forEach((match, matchIndex) => {
      const y = matchY(roundIndex, matchIndex);
      positions.push({ match, x, y });
    });
  });

  const maxMatchesInRound = Math.max(...rounds.map((r) => r.matches.length), 0);
  const totalWidth = rounds.length * (CARD_WIDTH + HORIZONTAL_GAP) - HORIZONTAL_GAP + PADDING * 2;
  const totalHeight =
    maxMatchesInRound > 0
      ? maxMatchesInRound * (CARD_HEIGHT + VERTICAL_GAP) - VERTICAL_GAP + PADDING * 2 + TOP_OFFSET
      : CARD_HEIGHT + PADDING * 2 + TOP_OFFSET;

  const lines: string[] = [];
  const dividerOffset = Math.floor(CARD_HEIGHT / 2);

  for (let roundIndex = 0; roundIndex < rounds.length - 1; roundIndex++) {
    const currentRound = rounds[roundIndex];
    const nextRound = rounds[roundIndex + 1];

    const currentX = matchX(roundIndex);
    const nextX = matchX(roundIndex + 1);

    nextRound.matches.forEach((_, nextMatchIndex) => {
      const match1Index = nextMatchIndex * 2;
      const match2Index = nextMatchIndex * 2 + 1;

      if (match1Index >= currentRound.matches.length) return;

      const y1 = matchY(roundIndex, match1Index) + dividerOffset;
      const y2 =
        match2Index < currentRound.matches.length
          ? matchY(roundIndex, match2Index) + dividerOffset
          : y1;

      const yNext = matchY(roundIndex + 1, nextMatchIndex) + dividerOffset;

      const startX = currentX + CARD_WIDTH;
      const endX = nextX;
      const midX = startX + HORIZONTAL_GAP / 2;

      const path =
        match2Index < currentRound.matches.length
          ? `M ${startX},${y1} H ${midX} V ${y2} H ${startX} M ${midX},${yNext} H ${endX}`
          : `M ${startX},${y1} H ${midX} V ${yNext} H ${endX}`;

      lines.push(path);
    });
  }

  return { rounds, positions, totalWidth, totalHeight, lines };
}

export function getRoundName(roundNumber: number, maxRound: number): string {
  const roundsFromEnd = maxRound - roundNumber;
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
      return `Раунд ${roundNumber}`;
  }
}
