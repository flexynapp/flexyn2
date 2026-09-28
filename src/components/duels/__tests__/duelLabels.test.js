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
  const t = (_key, english) => english;

  it('reads a paid win as the Elite capsule', () => {
    expect(duelPrize({ capsule: 'elite' }, t)).toEqual({ paid: true, text: 'Elite capsule earned' });
  });

  it('says why a win was not paid', () => {
    expect(duelPrize({ withheld: 'walkover' }, t)).toMatchObject({ paid: false, text: expect.stringMatching(/never trained/) });
    expect(duelPrize({ withheld: 'daily_limit' }, t)).toMatchObject({ paid: false, text: expect.stringMatching(/today/) });
    expect(duelPrize({ withheld: 'pair_limit' }, t)).toMatchObject({ paid: false, text: expect.stringMatching(/this week/) });
    expect(duelPrize({ withheld: 'session' }, t)).toMatchObject({ paid: false });
    expect(duelPrize({ withheld: 'error' }, t)).toMatchObject({ paid: false });
  });

  it('says nothing for a duel from before prizes, or a reason it does not know', () => {
    expect(duelPrize(null, t)).toBeNull();
    expect(duelPrize(undefined, t)).toBeNull();
    expect(duelPrize({ withheld: 'something_new' }, t)).toBeNull();
  });

  it('routes every line through a translation key', () => {
    const keys = [];
    const spy = (key, english) => { keys.push(key); return english; };
    duelPrize({ capsule: 'elite' }, spy);
    ['walkover', 'daily_limit', 'pair_limit', 'session', 'error'].forEach((w) => duelPrize({ withheld: w }, spy));
    expect(keys).toEqual([
      'duels.prize.elite', 'duels.prize.walkover', 'duels.prize.dailyLimit',
      'duels.prize.pairLimit', 'duels.prize.session', 'duels.prize.error',
    ]);
  });
});
