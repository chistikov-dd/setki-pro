import { describe, it, expect } from 'vitest';
import {
  computeBracketLayout,
  groupMatchesByRound,
  matchX,
  matchY,
  getRoundName,
  CARD_WIDTH,
  CARD_HEIGHT,
  HORIZONTAL_GAP,
  VERTICAL_GAP,
  PADDING,
} from '../../utils/bracketLayout';
import type { Match } from '../../types';

function makeMatch(overrides: Partial<Match>): Match {
  return {
    id: 1,
    bracket_id: 1,
    round_number: 1,
    match_number: 0,
    status: 'scheduled',
    score_participant1: 0,
    score_participant2: 0,
    warnings_participant1: 0,
    warnings_participant2: 0,
    ...overrides,
  };
}

describe('bracketLayout', () => {
  describe('groupMatchesByRound', () => {
    it('groups and sorts matches by round then match number', () => {
      const matches = [
        makeMatch({ id: 3, round_number: 2, match_number: 0 }),
        makeMatch({ id: 1, round_number: 1, match_number: 1 }),
        makeMatch({ id: 2, round_number: 1, match_number: 0 }),
      ];
      const rounds = groupMatchesByRound(matches);
      expect(rounds).toHaveLength(2);
      expect(rounds[0].roundNumber).toBe(1);
      expect(rounds[0].matches.map((m) => m.id)).toEqual([2, 1]);
      expect(rounds[1].roundNumber).toBe(2);
    });

    it('returns empty array for no matches', () => {
      expect(groupMatchesByRound([])).toEqual([]);
    });
  });

  describe('matchX / matchY', () => {
    it('increases x by CARD_WIDTH + HORIZONTAL_GAP per round', () => {
      expect(matchX(0)).toBe(PADDING);
      expect(matchX(1)).toBe(PADDING + CARD_WIDTH + HORIZONTAL_GAP);
    });

    it('centers round 2 (index 1) matches between round 1 pairs', () => {
      // round 0: matches at index 0 and 1
      const y0 = matchY(0, 0);
      const y1 = matchY(0, 1);
      // round 1: match 0 should be centered between y0 and y1 (plus half card height)
      const yNext = matchY(1, 0);
      const expectedCenter = (y0 + y1) / 2;
      expect(yNext).toBeCloseTo(expectedCenter, 5);
    });

    it('never produces NaN', () => {
      expect(Number.isNaN(matchY(0, 0))).toBe(false);
      expect(Number.isNaN(matchY(5, 3))).toBe(false);
    });
  });

  describe('computeBracketLayout', () => {
    it('returns empty layout for no matches (no NaN, no crash)', () => {
      const layout = computeBracketLayout([]);
      expect(layout.rounds).toEqual([]);
      expect(layout.positions).toEqual([]);
      expect(layout.totalWidth).toBe(0);
      expect(layout.totalHeight).toBe(0);
      expect(layout.lines).toEqual([]);
    });

    it('handles a single round (e.g. final only) without lines or NaN', () => {
      const matches = [makeMatch({ id: 1, round_number: 1, match_number: 0 })];
      const layout = computeBracketLayout(matches);
      expect(layout.positions).toHaveLength(1);
      expect(layout.lines).toEqual([]);
      expect(Number.isFinite(layout.totalWidth)).toBe(true);
      expect(Number.isFinite(layout.totalHeight)).toBe(true);
      expect(Number.isFinite(layout.positions[0].x)).toBe(true);
      expect(Number.isFinite(layout.positions[0].y)).toBe(true);
    });

    it('produces one connecting line per next-round match for a 4-participant bracket', () => {
      const matches = [
        makeMatch({ id: 1, round_number: 1, match_number: 0 }),
        makeMatch({ id: 2, round_number: 1, match_number: 1 }),
        makeMatch({ id: 3, round_number: 2, match_number: 0 }),
      ];
      const layout = computeBracketLayout(matches);
      expect(layout.positions).toHaveLength(3);
      expect(layout.lines).toHaveLength(1);
      layout.lines.forEach((line) => {
        expect(line).not.toContain('NaN');
      });
    });

    it('produces correct line count for an 8-participant bracket (2 rounds of lines)', () => {
      const matches = [
        ...[0, 1, 2, 3].map((i) => makeMatch({ id: 100 + i, round_number: 1, match_number: i })),
        ...[0, 1].map((i) => makeMatch({ id: 200 + i, round_number: 2, match_number: i })),
        makeMatch({ id: 300, round_number: 3, match_number: 0 }),
      ];
      const layout = computeBracketLayout(matches);
      // Round1->2: 2 lines, Round2->3: 1 line = 3 total
      expect(layout.lines).toHaveLength(3);
      layout.lines.forEach((line) => expect(line).not.toContain('NaN'));
    });

    it('computes finite totalWidth/totalHeight scaling with number of rounds and matches', () => {
      const matches = [
        ...[0, 1, 2, 3].map((i) => makeMatch({ id: 100 + i, round_number: 1, match_number: i })),
        ...[0, 1].map((i) => makeMatch({ id: 200 + i, round_number: 2, match_number: i })),
        makeMatch({ id: 300, round_number: 3, match_number: 0 }),
      ];
      const layout = computeBracketLayout(matches);
      expect(layout.totalWidth).toBe(3 * (CARD_WIDTH + HORIZONTAL_GAP) - HORIZONTAL_GAP + PADDING * 2);
      expect(layout.totalHeight).toBeGreaterThan(4 * CARD_HEIGHT);
      expect(Number.isFinite(layout.totalHeight)).toBe(true);
      // sanity: gap constant used somewhere in height formula
      expect(VERTICAL_GAP).toBeGreaterThan(0);
    });
  });

  describe('getRoundName', () => {
    it('names the last round Финал', () => {
      expect(getRoundName(3, 3)).toBe('Финал');
    });
    it('names the second-to-last round Полуфинал', () => {
      expect(getRoundName(2, 3)).toBe('Полуфинал');
    });
    it('falls back to generic round name for early rounds', () => {
      expect(getRoundName(1, 5)).toBe('1/16 финала');
    });
  });
});
