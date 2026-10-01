import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectRankUp, nextSeen, consumeRankUp, readSeenRank, rankDramaFor, RANK_DRAMA, LEVEL_DRAMA, DOWN_DRAMA,
} from '@/lib/rankUp';
import { TIERS } from '@/lib/leagueTiers';

describe('detectRankUp', () => {
  it('plays nothing without a record to compare against', () => {
    expect(detectRankUp(null, { tier: 'gold', level: 2 })).toBeNull();
  });

  it('a league up is a tier move, including a jump of several', () => {
    expect(detectRankUp({ tier: 'silver', level: 4 }, { tier: 'gold', level: 1 }))
      .toEqual({ kind: 'tier', from: { tier: 'silver', level: 4 }, to: { tier: 'gold', level: 1 } });
    expect(detectRankUp({ tier: 'bronze', level: 1 }, { tier: 'platinum', level: 1 })?.kind).toBe('tier');
  });

  it('a level up inside the same league is a level move', () => {
    expect(detectRankUp({ tier: 'gold', level: 2 }, { tier: 'gold', level: 3 })?.kind).toBe('level');
  });

  it('a league down is its own move', () => {
    expect(detectRankUp({ tier: 'gold', level: 3 }, { tier: 'silver', level: 1 }))
      .toEqual({ kind: 'down', from: { tier: 'gold', level: 3 }, to: { tier: 'silver', level: 1 } });
  });

  it('never plays for a lower level inside one league', () => {
    expect(detectRankUp({ tier: 'gold', level: 3 }, { tier: 'gold', level: 1 })).toBeNull();
    expect(detectRankUp({ tier: 'gold', level: 3 }, { tier: 'gold', level: 3 })).toBeNull();
  });

  it('ignores a tier it does not know', () => {
    expect(detectRankUp({ tier: 'gold', level: 1 }, { tier: 'mithril', level: 1 })).toBeNull();
  });
});

describe('first placement', () => {
  const gold = { tier: 'gold', level: 1 };
  it('plays when this device saw the unplaced state', () => {
    expect(detectRankUp({ unplaced: true }, gold)).toEqual({ kind: 'placed', from: null, to: gold });
  });
  it('plays without a record only when the server placement is fresh', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(detectRankUp(null, gold, { placedAt: '2026-09-30T12:00:00Z', now })?.kind).toBe('placed');
    expect(detectRankUp(null, gold, { placedAt: '2026-08-01T12:00:00Z', now })).toBeNull();
    expect(detectRankUp(null, gold, { placedAt: 'nonsense', now })).toBeNull();
  });
  it('a known league is never mistaken for a placement', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(detectRankUp({ tier: 'gold', level: 1 }, gold, { placedAt: '2026-09-30T12:00:00Z', now })).toBeNull();
  });
  it('records unplaced, plays once, then behaves like any league', () => {
    localStorage.clear();
    expect(consumeRankUp('p', { unplaced: true })).toBeNull();
    expect(readSeenRank('p')).toEqual({ unplaced: true });
    expect(consumeRankUp('p', gold)?.kind).toBe('placed');
    expect(consumeRankUp('p', gold)).toBeNull();
    expect(consumeRankUp('p', { tier: 'platinum', level: 1 })?.kind).toBe('tier');
  });
  it('a failed read (null) records nothing, so it cannot arm a placement', () => {
    localStorage.clear();
    consumeRankUp('q', gold);
    expect(consumeRankUp('q', null)).toBeNull();
    expect(readSeenRank('q')).toEqual(gold);
  });
});

describe('nextSeen', () => {
  it('keeps the higher level inside one league, so a failed level read cannot replay a step', () => {
    expect(nextSeen({ tier: 'gold', level: 3 }, { tier: 'gold', level: 1 })).toEqual({ tier: 'gold', level: 3 });
  });
  it('takes the new league as it is after a move', () => {
    expect(nextSeen({ tier: 'gold', level: 3 }, { tier: 'silver', level: 1 })).toEqual({ tier: 'silver', level: 1 });
  });
});

describe('consumeRankUp', () => {
  beforeEach(() => localStorage.clear());

  it('records silently on the first look, then plays once per move', () => {
    expect(consumeRankUp('u1', { tier: 'silver', level: 4 })).toBeNull();
    expect(readSeenRank('u1')).toEqual({ tier: 'silver', level: 4 });
    expect(consumeRankUp('u1', { tier: 'gold', level: 1 })?.kind).toBe('tier');
    expect(consumeRankUp('u1', { tier: 'gold', level: 1 })).toBeNull();
    expect(consumeRankUp('u1', { tier: 'gold', level: 2 })?.kind).toBe('level');
    expect(consumeRankUp('u1', { tier: 'silver', level: 1 })?.kind).toBe('down');
    expect(consumeRankUp('u1', { tier: 'silver', level: 1 })).toBeNull();
  });

  it('keeps each user separate on a shared device', () => {
    consumeRankUp('a', { tier: 'gold', level: 1 });
    expect(consumeRankUp('b', { tier: 'diamond', level: 1 })).toBeNull();
  });
});

describe('rank drama', () => {
  it('every league up the ladder is a bigger moment than the one below', () => {
    const rows = TIERS.map((t) => RANK_DRAMA[t.id]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].shake).toBeGreaterThan(rows[i - 1].shake);
      expect(rows[i].sparks).toBeGreaterThan(rows[i - 1].sparks);
      expect(rows[i].charge).toBeGreaterThan(rows[i - 1].charge);
    }
  });
  it('a level step is lighter than any promotion', () => {
    expect(rankDramaFor({ kind: 'level', to: { tier: 'legend' } })).toBe(LEVEL_DRAMA);
    for (const t of TIERS) expect(LEVEL_DRAMA.shake).toBeLessThan(RANK_DRAMA[t.id].shake);
  });
  it('a demotion throws nothing: no sparks, rings, shake or flash', () => {
    expect(rankDramaFor({ kind: 'down', to: { tier: 'silver' } })).toBe(DOWN_DRAMA);
    expect([DOWN_DRAMA.sparks, DOWN_DRAMA.rings, DOWN_DRAMA.shake, DOWN_DRAMA.flash]).toEqual([0, 0, 0, 0]);
  });
});
