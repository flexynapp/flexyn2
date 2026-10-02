import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectRankUp, nextSeen, consumeRankUp, consumePlacement, readSeenRank, rankDramaFor, RANK_DRAMA, LEVEL_DRAMA, DOWN_DRAMA,
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

describe('consumePlacement', () => {
  beforeEach(() => localStorage.clear());

  it('plays only when the server says a reveal is pending', () => {
    expect(consumePlacement('u', { reveal_pending: false, tier: 'gold' })).toBeNull();
    expect(consumePlacement('u', { revealed: false, tier: null })).toBeNull();
    expect(consumePlacement('u', null)).toBeNull();
    expect(consumePlacement('u', { reveal_pending: true, tier: 'gold' }, 2))
      .toEqual({ kind: 'placed', from: null, to: { tier: 'gold', level: 2 } });
  });

  it('records the league, so the ordinary comparison stays quiet after it', () => {
    consumePlacement('u', { reveal_pending: true, tier: 'silver' });
    expect(readSeenRank('u')).toEqual({ tier: 'silver', level: 1 });
    expect(consumeRankUp('u', { tier: 'silver', level: 1 })).toBeNull();
    expect(consumeRankUp('u', { tier: 'gold', level: 1 })?.kind).toBe('tier');
  });

  it('a placement holds a beat longer than the same promotion', () => {
    const placed = rankDramaFor({ kind: 'placed', to: { tier: 'gold' } });
    expect(placed.hold).toBeGreaterThan(RANK_DRAMA.gold.hold);
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
