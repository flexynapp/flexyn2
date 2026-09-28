// A Mirror's target counts only the sets the server can credit: rep sets on
// named exercises (duels audit, round four). An empty set row or an unnamed
// exercise used to make 100% unreachable.

import { describe, it, expect } from 'vitest';
import { templateExercises, templateSetCount, duelPrize } from '@/components/duels/duelLabels';

const template = {
  exercises: [
    { name: 'Bench Press', sets: [{ weight: 135, reps: 8 }, { weight: 135, reps: 8 }, { weight: null, reps: null }] },
    { name: '  ', sets: [{ weight: 20, reps: 10 }] },
    { name: 'Plank', sets: [{ weight: 0, reps: 0 }] },
    { name: 'Row', sets: [{ weight: 95, reps: 10 }] },
  ],
};

describe('Mirror template counting', () => {
  it('lists named exercises with the sets that carry reps', () => {
    expect(templateExercises(template)).toEqual([
      { name: 'Bench Press', sets: 2 },
      { name: 'Row', sets: 1 },
    ]);
  });

  it('totals the same sets the server scores', () => {
    expect(templateSetCount(template)).toBe(3);
  });

  it('is empty for a missing template', () => {
    expect(templateExercises(null)).toEqual([]);
    expect(templateSetCount(undefined)).toBe(0);
  });
});

describe('duelPrize', () => {
  const t = (_key, english, vars) =>
    Object.entries(vars || {}).reduce((str, [k, v]) => str.replace(`{${k}}`, String(v)), english);

  it('names the capsule, XP and coins that landed for each tier', () => {
    expect(duelPrize({ tier: 1, upset: false, capsule: 'standard', xp: 150, coins: 15 }, t))
      .toEqual({ paid: true, text: 'Standard capsule, 150 XP and 15 Flex Coins', upset: null });
    expect(duelPrize({ tier: 2, upset: false, capsule: 'premium', xp: 300, coins: 30 }, t).text)
      .toBe('Premium capsule, 300 XP and 30 Flex Coins');
    expect(duelPrize({ tier: 3, upset: false, capsule: 'elite', xp: 500, coins: 50 }, t).text)
      .toBe('Elite capsule, 500 XP and 50 Flex Coins');
  });

  it('shows a clamped payout as what arrived, and says why an upset paid more', () => {
    const r = duelPrize({ tier: 4, upset: true, capsule: 'elite', xp: 120, coins: 80 }, t);
    expect(r.text).toBe('Elite capsule, 120 XP and 80 Flex Coins');
    expect(r.upset).toMatch(/5 levels above you/);
  });

  it('reads a capsule-only prize without printing undefined', () => {
    expect(duelPrize({ capsule: 'elite' }, t).text).toBe('Elite capsule earned');
  });

  it('says why a win was not paid', () => {
    expect(duelPrize({ withheld: 'walkover' }, t)).toMatchObject({ paid: false, text: expect.stringMatching(/never trained/) });
    expect(duelPrize({ withheld: 'daily_limit' }, t)).toMatchObject({ paid: false, text: expect.stringMatching(/today/) });
    expect(duelPrize({ withheld: 'pair_limit' }, t)).toMatchObject({ paid: false, text: expect.stringMatching(/this week/) });
    expect(duelPrize({ withheld: 'error' }, t)).toMatchObject({ paid: false });
  });

  it('says nothing for a duel from before prizes, or a reason it does not know', () => {
    expect(duelPrize(null, t)).toBeNull();
    expect(duelPrize(undefined, t)).toBeNull();
    expect(duelPrize({ withheld: 'something_new' }, t)).toBeNull();
    expect(duelPrize({ capsule: 'mythic', xp: 1, coins: 1 }, t)).toBeNull();
  });

  // A stub that ignores the English fallback, so a dropped vars argument
  // shows up as a literal placeholder (the JournalView defect).
  it('passes its numbers to the translation, not only to the English', () => {
    const tr = (key, _english, vars) =>
      key === 'duels.prize.earned' ? `C:{capsule} X:{xp} M:{coins}`.replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? `{${k}}`)
        : key === 'capsules.tier.premium' ? 'PREM' : key;
    expect(duelPrize({ capsule: 'premium', xp: 300, coins: 30 }, tr).text).toBe('C:PREM X:300 M:30');
  });
});
