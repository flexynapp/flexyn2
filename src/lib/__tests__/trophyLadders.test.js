// src/lib/__tests__/trophyLadders.test.js
//
// The ladder mechanics from migration 323. The property under test
// throughout is "there is always a next thing": a badge system that can
// be finished stops working the day somebody finishes it.

import { describe, it, expect } from 'vitest';
import {
  TROPHIES,
  LADDERS,
  TROPHY_TIERS,
  TROPHY_CATEGORIES,
  TAIL_CAP,
  getTrophy,
  parseLadderTail,
  nextRung,
  rungsFor,
  rungProgress,
  toRoman,
} from '@/lib/trophyDefinitions';

describe('catalog integrity', () => {
  it('every trophy has a unique id', () => {
    const ids = TROPHIES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every trophy belongs to a ladder that exists', () => {
    for (const t of TROPHIES) {
      expect(LADDERS[t.ladder], `${t.id} → ${t.ladder}`).toBeTruthy();
    }
  });

  it('every trophy tier exists in TROPHY_TIERS', () => {
    // ProfileTrophies reads TROPHY_TIERS[tier].color for the stripe and
    // would render a blank one on a typo.
    for (const t of TROPHIES) {
      expect(TROPHY_TIERS[t.tier], t.id).toBeTruthy();
    }
  });

  it('every trophy category is a declared group', () => {
    const groups = new Set(TROPHY_CATEGORIES.map(c => c.id));
    for (const t of TROPHIES) {
      expect(groups.has(t.category), `${t.id} → ${t.category}`).toBe(true);
    }
  });

  it("a trophy's category matches its ladder's category", () => {
    // The page groups ladders by LADDERS[].category but renders the
    // trophy's own; a disagreement puts a badge under the wrong heading.
    for (const t of TROPHIES) {
      expect(LADDERS[t.ladder].category, t.id).toBe(t.category);
    }
  });

  it('rungs on a ladder have strictly increasing thresholds', () => {
    for (const id of Object.keys(LADDERS)) {
      const thresholds = rungsFor(id).map(r => r.threshold);
      const sorted = [...thresholds].sort((a, b) => a - b);
      expect(thresholds, id).toEqual(sorted);
      expect(new Set(thresholds).size, `${id} has duplicate thresholds`).toBe(thresholds.length);
    }
  });

  it("each ladder's tailBase equals its top named rung", () => {
    // If these drift, the first tail rung is either unreachable or
    // duplicates a badge the user already holds.
    for (const [id, ladder] of Object.entries(LADDERS)) {
      if (ladder.tailBase == null) continue;
      const rungs = rungsFor(id);
      expect(rungs.length, `${id} has a tail but no rungs`).toBeGreaterThan(0);
      expect(ladder.tailBase, id).toBe(rungs[rungs.length - 1].threshold);
    }
  });

  it('every ladder is reachable from at least one named rung', () => {
    for (const id of Object.keys(LADDERS)) {
      expect(rungsFor(id).length, `${id} has no rungs`).toBeGreaterThan(0);
    }
  });
});

describe('infinite tails', () => {
  it('resolves a tail id to a rung above the last named one', () => {
    const tail = parseLadderTail('sessions_x1');
    expect(tail).toBeTruthy();
    expect(tail.threshold).toBe(200);   // base 100 + 1 × step 100
    expect(tail.name).toBe('Centurion II');
    expect(tail.isTail).toBe(true);
  });

  it('keeps climbing — the whole point', () => {
    expect(parseLadderTail('sessions_x2').threshold).toBe(300);
    expect(parseLadderTail('sessions_x9').threshold).toBe(1000);
    expect(parseLadderTail('sessions_x9').name).toBe('Centurion X');
  });

  it('refuses a tail on a ladder that deliberately dead-ends', () => {
    // `cardio` tops out at a marathon on purpose — a generated rung past
    // it would be an ultra, and a badge is not a reason to attempt one.
    expect(LADDERS.cardio.tailBase).toBeNull();
    expect(parseLadderTail('cardio_x1')).toBeNull();
    expect(parseLadderTail('cross_x1')).toBeNull();
    expect(parseLadderTail('level_x1')).toBeNull();
  });

  it('refuses forged and out-of-range ids', () => {
    expect(parseLadderTail('nonsense_x1')).toBeNull();
    expect(parseLadderTail('sessions_x0')).toBeNull();
    expect(parseLadderTail(`sessions_x${TAIL_CAP + 1}`)).toBeNull();
    expect(parseLadderTail('sessions')).toBeNull();
    expect(parseLadderTail('')).toBeNull();
    expect(parseLadderTail(null)).toBeNull();
  });

  it('stays OUT of the static catalog', () => {
    // TROPHIES.length is the "12 / 73" denominator. A denominator that
    // grows forever makes every collection look permanently unfinished —
    // same reasoning that keeps league season trophies out.
    expect(TROPHIES.some(t => /_x\d+$/.test(t.id))).toBe(false);
  });

  it('getTrophy resolves catalog, season AND tail ids', () => {
    expect(getTrophy('first_rep')?.name).toBe('First Rep');
    expect(getTrophy('league_s5_legend')?.name).toBe('Season 5 Legend');
    expect(getTrophy('sessions_x1')?.name).toBe('Centurion II');
    expect(getTrophy('nonsense')).toBeNull();
  });
});

describe('nextRung — there is always something next', () => {
  it('walks the named rungs in order', () => {
    expect(nextRung('sessions', 0).id).toBe('first_rep');
    expect(nextRung('sessions', 1).id).toBe('consistent');
    expect(nextRung('sessions', 11).id).toBe('committed');
    expect(nextRung('sessions', 50).id).toBe('centurion');
  });

  it('falls through into the tail past the last named rung', () => {
    expect(nextRung('sessions', 100).threshold).toBe(200);
    expect(nextRung('sessions', 150).threshold).toBe(200);
    expect(nextRung('sessions', 200).threshold).toBe(300);
  });

  it('never runs out on a laddered signal', () => {
    // The regression this whole design exists to prevent.
    for (const value of [0, 1, 99, 100, 1000, 100000]) {
      expect(nextRung('sessions', value), `value=${value}`).toBeTruthy();
    }
  });

  it('returns null only for the deliberate dead ends', () => {
    expect(nextRung('cardio', 999999)).toBeNull();
    expect(nextRung('level', 999)).toBeNull();
    // ...and those still answer while rungs remain.
    expect(nextRung('cardio', 0).id).toBe('cardio_5k');
  });

  it('clamps rather than exploding on an absurd signal', () => {
    const r = nextRung('sessions', Number.MAX_SAFE_INTEGER);
    expect(r).toBeTruthy();
    expect(r.id).toBe(`sessions_x${TAIL_CAP}`);
  });

  it('answers for every ladder at zero, so a new user is never stuck', () => {
    for (const id of Object.keys(LADDERS)) {
      expect(nextRung(id, 0), id).toBeTruthy();
    }
  });
});

describe('rungProgress', () => {
  it('reports partial progress', () => {
    const p = rungProgress({ threshold: 50 }, 25);
    expect(p.pct).toBe(50);
    expect(p.done).toBe(false);
  });

  it('clamps past 100 rather than overflowing the bar', () => {
    expect(rungProgress({ threshold: 10 }, 999).pct).toBe(100);
  });

  it('never returns a negative width', () => {
    expect(rungProgress({ threshold: 10 }, -5).pct).toBe(0);
  });
});

describe('toRoman', () => {
  it('covers the numerals tails actually use', () => {
    expect(toRoman(2)).toBe('II');
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(9)).toBe('IX');
    expect(toRoman(14)).toBe('XIV');
    expect(toRoman(51)).toBe('LI');
  });
});
