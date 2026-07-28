// Tests for the capsule streak counter.
//
// This number is shown directly under the drop-rate table, so a wrong
// value doesn't just look wrong — it reads as a claim about the odds. The
// ordering case below is the one that matters most: rows arriving in the
// wrong order produce a streak that looks entirely plausible and is simply
// false.

import { describe, it, expect } from 'vitest';
import { computePity, GOOD_RARITIES } from '../pity';

// Descending timestamps so index 0 is the newest open.
const at = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const open = (rarity, minutesAgo) => ({ rolled_rarity: rarity, opened_at: at(minutesAgo) });

describe('GOOD_RARITIES', () => {
  it('is epic and above — the tiers a user is actually chasing', () => {
    expect(Array.from(GOOD_RARITIES).sort())
      .toEqual(['animated', 'epic', 'legendary', 'mythic']);
    expect(GOOD_RARITIES.has('rare')).toBe(false);
  });
});

describe('computePity — empty and degenerate input', () => {
  it('reports no history for null/empty', () => {
    for (const input of [null, undefined, []]) {
      expect(computePity(input)).toEqual({
        opens: 0, sinceGood: null, bestRarity: null, lastGoodAt: null, hasHistory: false,
      });
    }
  });

  it('ignores rows with no rolled_rarity — legacy pre-028 opens carry none', () => {
    const p = computePity([{ opened_at: at(1) }, open('common', 2)]);
    expect(p.opens).toBe(1);
  });
});

describe('computePity — streak', () => {
  it('returns null sinceGood when the user has NEVER pulled Epic+', () => {
    const p = computePity([open('common', 1), open('rare', 2), open('uncommon', 3)]);
    expect(p.sinceGood).toBeNull();
    expect(p.opens).toBe(3);
    expect(p.hasHistory).toBe(true);
  });

  it('counts 0 when the most recent open WAS Epic+', () => {
    const p = computePity([open('legendary', 1), open('common', 2)]);
    expect(p.sinceGood).toBe(0);
  });

  it('counts the opens since the last Epic+', () => {
    const p = computePity([
      open('common', 1), open('rare', 2), open('common', 3), open('epic', 4), open('common', 5),
    ]);
    expect(p.sinceGood).toBe(3);
  });

  it('treats every tier at or above epic as good', () => {
    for (const r of ['epic', 'legendary', 'mythic', 'animated']) {
      expect(computePity([open('common', 1), open(r, 2)]).sinceGood).toBe(1);
    }
  });

  it('does NOT count rare as good — rare is common enough to be meaningless here', () => {
    const p = computePity([open('rare', 1), open('epic', 2)]);
    expect(p.sinceGood).toBe(1);
  });

  it('re-sorts mis-ordered input rather than trusting call-site order', () => {
    // Same three opens, shuffled. Newest is the common at 1m; the epic is
    // oldest. Reading these in array order would report sinceGood = 0.
    const rows = [open('epic', 30), open('common', 1), open('common', 2)];
    expect(computePity(rows).sinceGood).toBe(2);
  });

  it('falls back to earned_at when opened_at is missing', () => {
    const rows = [
      { rolled_rarity: 'common', earned_at: at(1) },
      { rolled_rarity: 'epic',   earned_at: at(9) },
    ];
    expect(computePity(rows).sinceGood).toBe(1);
  });

  it('records when the last good pull happened', () => {
    const when = at(4);
    const p = computePity([open('common', 1), { rolled_rarity: 'epic', opened_at: when }]);
    expect(p.lastGoodAt).toBe(when);
  });
});

describe('computePity — best pull', () => {
  it('reports the rarest tier ever pulled, not the most recent', () => {
    const p = computePity([open('common', 1), open('legendary', 50), open('rare', 2)]);
    expect(p.bestRarity).toBe('legendary');
  });

  it('handles a history of a single common', () => {
    const p = computePity([open('common', 1)]);
    expect(p.bestRarity).toBe('common');
    expect(p.sinceGood).toBeNull();
  });

  it('ranks animated above legendary', () => {
    expect(computePity([open('legendary', 1), open('animated', 2)]).bestRarity).toBe('animated');
  });

  it('does not crash on an unknown rarity string', () => {
    const p = computePity([open('sparkly', 1), open('rare', 2)]);
    expect(p.opens).toBe(2);
    expect(p.bestRarity).toBe('rare');
  });
});
