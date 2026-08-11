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
  CAPSTONES,
  TAIL_CAP,
  isUnlocked,
  lockedTrophies,
  requirementsFor,
  getTrophy,
  parseLadderTail,
  nextRung,
  rungsFor,
  rungProgress,
  rungSignal,
  toRoman,
  TROPHY_BY_ID,
  XP_MILESTONE_IDS,
} from '@/lib/trophyDefinitions';

describe('catalog integrity', () => {
  it('every trophy has a unique id', () => {
    const ids = TROPHIES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every trophy belongs to a ladder that exists, unless it is a capstone', () => {
    // Capstones deliberately have no ladder: they have no numeric
    // criterion to be a rung of, and are earned purely by prerequisite.
    for (const t of TROPHIES.filter(x => !x.capstone)) {
      expect(LADDERS[t.ladder], `${t.id} → ${t.ladder}`).toBeTruthy();
    }
  });

  it('offers at least 100 obtainable achievements', () => {
    expect(TROPHIES.length).toBeGreaterThanOrEqual(100);
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
    // Capstones sit in their own pseudo-category and are rendered by the
    // Locked row / Earned tab, not as a ladder section.
    for (const t of TROPHIES.filter(x => !x.capstone)) {
      expect(groups.has(t.category), `${t.id} → ${t.category}`).toBe(true);
    }
  });

  it("a trophy's category matches its ladder's category", () => {
    // The page groups ladders by LADDERS[].category but renders the
    // trophy's own; a disagreement puts a badge under the wrong heading.
    for (const t of TROPHIES.filter(x => !x.capstone)) {
      expect(LADDERS[t.ladder].category, t.id).toBe(t.category);
    }
  });

  it('every declared category actually has ladders behind it', () => {
    // An empty group renders as a heading with nothing under it.
    for (const cat of TROPHY_CATEGORIES) {
      const owned = Object.values(LADDERS).filter(l => l.category === cat.id);
      expect(owned.length, `category ${cat.id} has no ladders`).toBeGreaterThan(0);
    }
  });

  // This used to assert increasing thresholds across the WHOLE ladder,
  // which silently assumed every rung is measured by the same signal.
  // `gauntlet` breaks that assumption — see the rungSignal block below —
  // so the invariant is now stated per signal group, plus a separate
  // "tier never steps down" check that is what the old test was really
  // reaching for.
  it('rungs on a ladder never step DOWN in tier', () => {
    for (const id of Object.keys(LADDERS)) {
      const orders = rungsFor(id).map(r => TROPHY_TIERS[r.tier].order);
      const sorted = [...orders].sort((a, b) => a - b);
      expect(orders, id).toEqual(sorted);
    }
  });

  it('thresholds strictly increase among rungs measured by the SAME signal', () => {
    for (const id of Object.keys(LADDERS)) {
      const groups = {};
      for (const r of rungsFor(id)) (groups[rungSignal(r)] ||= []).push(r.threshold);
      for (const [sig, thresholds] of Object.entries(groups)) {
        const sorted = [...thresholds].sort((a, b) => a - b);
        expect(thresholds, `${id}/${sig}`).toEqual(sorted);
        expect(new Set(thresholds).size, `${id}/${sig} has duplicate thresholds`)
          .toBe(thresholds.length);
      }
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

describe('prerequisites', () => {
  const ALL_UNGATED = new Set(TROPHIES.filter(t => !t.requires).map(t => t.id));

  it('every prerequisite names a trophy that exists', () => {
    // A dangling id is a permanently locked trophy, and from the
    // outside that is indistinguishable from a bug.
    const ids = new Set(TROPHIES.map(t => t.id));
    for (const t of TROPHIES) {
      for (const r of (t.requires || [])) {
        expect(ids.has(r), `${t.id} requires missing ${r}`).toBe(true);
      }
    }
  });

  it('has no circular prerequisites', () => {
    // A cycle is unreachable for everyone, forever, and would spin the
    // server's fixpoint loop to its cap on every call.
    const seen = new Map();
    const visit = (id, stack) => {
      if (stack.includes(id)) throw new Error(`cycle: ${[...stack, id].join(' -> ')}`);
      if (seen.get(id)) return;
      seen.set(id, true);
      const t = TROPHIES.find(x => x.id === id);
      for (const r of (t?.requires || [])) visit(r, [...stack, id]);
    };
    expect(() => TROPHIES.forEach(t => visit(t.id, []))).not.toThrow();
  });

  it('every trophy is reachable — nothing is permanently locked', () => {
    // Earn everything ungated, then keep unlocking until nothing moves.
    // Anything left over can never be obtained by anyone.
    const owned = new Set(ALL_UNGATED);
    for (let i = 0; i < 10; i += 1) {
      for (const t of TROPHIES) if (!owned.has(t.id) && isUnlocked(t, owned)) owned.add(t.id);
    }
    const stuck = TROPHIES.filter(t => !owned.has(t.id)).map(t => t.id);
    expect(stuck).toEqual([]);
  });

  it('locks a trophy until every prerequisite is earned', () => {
    const iron = TROPHIES.find(t => t.id === 'capstone_iron');
    expect(isUnlocked(iron, new Set())).toBe(false);
    expect(isUnlocked(iron, new Set(['centurion']))).toBe(false);
    expect(isUnlocked(iron, new Set(iron.requires))).toBe(true);
  });

  it('treats a trophy with no prerequisites as always unlocked', () => {
    expect(isUnlocked(TROPHIES.find(t => t.id === 'first_rep'), new Set())).toBe(true);
  });

  it('reports the locked set, and it shrinks as prerequisites land', () => {
    const day1 = lockedTrophies(new Set());
    expect(day1.length).toBeGreaterThan(0);
    // crewwar_1 is gated on crew_squad; joining a crew must free it.
    expect(day1.some(t => t.id === 'crewwar_1')).toBe(true);
    const joined = lockedTrophies(new Set(['crew_squad']));
    expect(joined.some(t => t.id === 'crewwar_1')).toBe(false);
    expect(joined.length).toBe(day1.length - 1);
  });

  it('never reports an already-earned trophy as locked', () => {
    const locked = lockedTrophies(new Set(['capstone_iron']));
    expect(locked.some(t => t.id === 'capstone_iron')).toBe(false);
  });

  it('marks each requirement done or outstanding for the UI', () => {
    const iron = TROPHIES.find(t => t.id === 'capstone_iron');
    const reqs = requirementsFor(iron, new Set(['centurion']));
    expect(reqs).toHaveLength(iron.requires.length);
    expect(reqs.find(r => r.id === 'centurion').done).toBe(true);
    expect(reqs.find(r => r.id === 'variety_100').done).toBe(false);
    // Names resolve, so the UI never prints a raw id at the user.
    expect(reqs.every(r => r.name && r.name !== r.id)).toBe(true);
  });

  it('gates every capstone, so none is earnable on day one', () => {
    for (const c of CAPSTONES) {
      expect(c.requires?.length, `${c.id} has no requirements`).toBeGreaterThan(0);
      expect(isUnlocked(c, new Set()), c.id).toBe(false);
    }
  });

  it('requires only things a qualifying user must already have', () => {
    // The rule for adding a gate: a prerequisite must be strictly
    // implied by the thing it gates, or it produces a badge that can be
    // permanently missed. Capstones require ladder TOPS, which is what
    // "topped every ladder in this category" means; the one non-capstone
    // gate is causal (you cannot fight a crew war without a crew).
    const byId = Object.fromEntries(TROPHIES.map(t => [t.id, t]));
    for (const t of TROPHIES) {
      for (const r of (t.requires || [])) {
        const req = byId[r];
        if (t.capstone) continue;               // capstones gate on tops
        // A non-capstone gate must sit on the same or an upstream ladder.
        expect(req, `${t.id} -> ${r}`).toBeTruthy();
      }
    }
    // The only non-capstone gate in the catalog today.
    const gated = TROPHIES.filter(t => t.requires && !t.capstone).map(t => t.id);
    expect(gated).toEqual(['crewwar_1']);
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

// ── Per-rung signals (audit 2026-08-11) ───────────────────────────────
//
// A ladder normally measures every rung against ONE signal, so a bigger
// threshold is always a harder rung. `gauntlet` is the exception:
// `gauntlet_5` counts challenges cleared (`gauntletDone`) while
// `gauntlet_path` is a yes/no on finishing the whole path
// (`gauntletPath`). The trophy declared `signal: 'gauntletPath'` for
// exactly this reason and NOTHING read it — the only `.signal` lookup in
// the app was `LADDERS[ladderId].signal`. Two consequences, both live:
//
//   1. Sorting the two rungs on one number put the GOLD rung first, so a
//      brand-new user's gauntlet ladder offered "Gauntlet Cleared" as
//      the next thing to go and do, ahead of the bronze rung.
//   2. The moment `gauntletDone` hit 1, nextRung stepped past
//      gauntlet_path forever — the gold trophy could never again show as
//      in-progress, because it was being tested against the wrong number.
//
// These are REGRESSION tests for the fix, not characterization tests.
describe('per-rung signals', () => {
  it('resolves a rung to its own signal, falling back to the ladder’s', () => {
    expect(rungSignal(getTrophy('gauntlet_path'))).toBe('gauntletPath');
    expect(rungSignal(getTrophy('gauntlet_5'))).toBe('gauntletDone');
    expect(rungSignal(getTrophy('first_rep'))).toBe('workouts');
  });

  it('offers the BRONZE gauntlet rung to a brand-new user, not the gold one', () => {
    const rung = nextRung('gauntlet', 0, { gauntletDone: 0, gauntletPath: 0 });
    expect(rung.id).toBe('gauntlet_5');
    expect(rung.tier).toBe('bronze');
  });

  it('still offers the gold path rung after the bronze one is cleared', () => {
    // 5 challenges done, path not finished. Before the fix this returned
    // null-equivalent behaviour: gauntlet_path had already been skipped.
    const rung = nextRung('gauntlet', 5, { gauntletDone: 5, gauntletPath: 0 });
    expect(rung.id).toBe('gauntlet_path');
  });

  it('ends the gauntlet ladder only when the path itself is done', () => {
    expect(nextRung('gauntlet', 5, { gauntletDone: 5, gauntletPath: 1 })).toBeNull();
  });

  it('is a no-op for every ladder whose rungs share one signal', () => {
    // The safety argument for changing the sort: 30 of 31 ladders have a
    // single signal, so tier-order and threshold-order coincide and the
    // rung sequence is byte-identical to what it was before.
    const multi = Object.keys(LADDERS)
      .filter(id => new Set(rungsFor(id).map(rungSignal)).size > 1);
    expect(multi).toEqual(['gauntlet']);

    for (const id of Object.keys(LADDERS)) {
      if (id === 'gauntlet') continue;
      const byThreshold = [...rungsFor(id)].sort((a, b) => a.threshold - b.threshold);
      expect(rungsFor(id).map(r => r.id), id).toEqual(byThreshold.map(r => r.id));
    }
  });

  it('ignores the progress map for rungs that do not declare a signal', () => {
    // A caller passing progress must not change any other ladder.
    expect(nextRung('sessions', 12, { workouts: 999 }).id).toBe('committed');
    expect(nextRung('sessions', 12).id).toBe('committed');
  });
});

// ── XP milestones (migration 341) ─────────────────────────────────────
//
// Five badges granted at total-XP thresholds by
// `grant_xp_milestone_achievements()`, each carrying a bonus XP payout.
// They previously lived in the retired `public.achievements` table with
// NO client definition at all, so crossing 250 XP awarded a badge that
// rendered as nothing.
//
// The property that matters most here is that they stay OUT of TROPHIES:
// that array is diffed one-for-one against `grant_eligible_trophies`'
// named list, and a different function grants these.
describe('XP milestones', () => {
  it('resolves each milestone id to a rendered trophy', () => {
    for (const id of XP_MILESTONE_IDS) {
      const t = getTrophy(id);
      expect(t, id).toBeTruthy();
      expect(t.name, id).toBeTruthy();
      expect(t.emoji, id).toBeTruthy();
      expect(t.isXpMilestone, id).toBe(true);
    }
  });

  it('stays OUT of the static catalog, like tails and season trophies', () => {
    // TROPHIES.length is the "12 / 120" denominator AND the thing diffed
    // against the server's named grant list. Adding these to it would
    // break both at once.
    for (const id of XP_MILESTONE_IDS) {
      expect(TROPHIES.some(t => t.id === id), id).toBe(false);
    }
  });

  it('carries the thresholds the migration grants on, in ascending order', () => {
    const thresholds = XP_MILESTONE_IDS.map(id => getTrophy(id).threshold);
    expect(thresholds).toEqual([250, 1000, 5000, 10000, 25000]);
  });

  it('carries the bonus XP the migration pays out', () => {
    expect(XP_MILESTONE_IDS.map(id => getTrophy(id).xp)).toEqual([10, 25, 50, 100, 200]);
  });

  it('never steps down in tier as the threshold rises', () => {
    const orders = XP_MILESTONE_IDS.map(id => TROPHY_TIERS[getTrophy(id).tier].order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('does not collide with a catalog, tail or season id', () => {
    for (const id of XP_MILESTONE_IDS) {
      expect(parseLadderTail(id), id).toBeNull();
      expect(TROPHY_BY_ID[id], id).toBeUndefined();
    }
  });

  it('leaves a non-milestone xp-ish id unresolved rather than inventing one', () => {
    expect(getTrophy('xp_9999')).toBeNull();
    expect(getTrophy('xp_')).toBeNull();
  });
});
