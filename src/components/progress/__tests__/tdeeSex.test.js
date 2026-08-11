// The BMR sex term, and what it does when we do not know.
//
// Measured on production 2026-08-10: `user_profiles.gender` is null on 44
// of 53 profiles, 'male' on 8, 'female' on 1. The old code collapsed
// everything that was not exactly 'female' into male, so 83% of users got
// a male estimate — silently, with the card presenting it as measured and
// the Cut / Bulk targets derived from it.
//
// The rule is reproduced here rather than imported because calcBMR is
// module-private to InsightsTab.jsx. That is a real limitation and worth
// stating: this pins the ARITHMETIC and the policy, and a change to the
// component that diverges from it would not fail here. The guard against
// that is the shared constant name and the comment at the call site.

import { describe, it, expect } from 'vitest';

const BMR_SEX_TERM = { male: 5, female: -161, unknown: -78 };
const calcBMR = ({ weightKg, heightCm, age, sex }) => {
  if (!weightKg || !heightCm || !age) return null;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return base + (BMR_SEX_TERM[sex] ?? BMR_SEX_TERM.unknown);
};

const subject = { weightKg: 80, heightCm: 180, age: 30 };

describe('BMR sex term', () => {
  it('uses the published Mifflin-St Jeor terms for a known sex', () => {
    expect(calcBMR({ ...subject, sex: 'male' }) - calcBMR({ ...subject, sex: 'female' })).toBe(166);
  });

  it('takes the MIDPOINT when sex is unknown — not male', () => {
    const male = calcBMR({ ...subject, sex: 'male' });
    const female = calcBMR({ ...subject, sex: 'female' });
    const unknown = calcBMR({ ...subject, sex: '' });
    expect(unknown).toBe((male + female) / 2);
    // The regression this exists to prevent: `sex === 'female' ? … : male`.
    expect(unknown).not.toBe(male);
  });

  it('treats every not-female value as unknown rather than as male', () => {
    // null, undefined, 'other', 'prefer_not_to_say' — the old expression
    // mapped all of these onto the male formula.
    for (const sex of [undefined, null, '', 'other', 'prefer_not_to_say', 'nonbinary']) {
      expect(calcBMR({ ...subject, sex })).toBe(calcBMR({ ...subject, sex: 'unknown' }));
    }
  });

  it('matches the direction workoutGenerator already chose for unset', () => {
    // _demographicScale() gives 'other' / unset a middle value between the
    // male and female scalars for the same reason. One codebase, one answer.
    const male = calcBMR({ ...subject, sex: 'male' });
    const female = calcBMR({ ...subject, sex: 'female' });
    const unknown = calcBMR({ ...subject, sex: null });
    expect(unknown).toBeLessThan(male);
    expect(unknown).toBeGreaterThan(female);
  });

  it('still refuses to estimate without weight, height or age', () => {
    // Unknown sex narrows the estimate; a missing measurement blocks it.
    expect(calcBMR({ ...subject, weightKg: null, sex: 'male' })).toBeNull();
    expect(calcBMR({ ...subject, heightCm: null, sex: 'male' })).toBeNull();
    expect(calcBMR({ ...subject, age: null, sex: 'male' })).toBeNull();
  });

  it('moves the displayed TDEE by 200-315 cal across the activity bands', () => {
    // Why this matters at all: the sex term is not a rounding difference
    // once the multiplier is applied, and the Cut/Bulk targets come off it.
    const spread = calcBMR({ ...subject, sex: 'male' }) - calcBMR({ ...subject, sex: 'female' });
    expect(Math.round(spread * 1.2)).toBe(199);
    expect(Math.round(spread * 1.9)).toBe(315);
  });
});
