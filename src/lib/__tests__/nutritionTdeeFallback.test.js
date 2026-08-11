// Audit 21 — the no-goal branch of calculateDailyValues.
//
// Nutrition onboarding has never been completed by a single account, so
// `nutrition_goal` is null for everyone and this branch IS the product.
// It used to return a flat 2000 kcal regardless of who was asking.
//
// The tests that matter most here are the ones pinning when it must NOT
// personalise: `calculateDailyValues` fills missing demographics with
// 180 lb / 70 in / 30 yr so the RDA rows have something to branch on, and a
// TDEE built from those placeholders would look exactly like a measured one
// on screen.

import { describe, it, expect } from 'vitest';
import { calculateDailyValues } from '@/lib/nutritionDefaults';
import { calcBMR, activityMultiplier } from '@/lib/tdee';

const MEASURED = { weight_lbs: 180, height_inches: 70, age: 30, gender: 'male' };

describe('calculateDailyValues — maintenance from observed training', () => {
  it('keeps the flat 2000 when no sessionsPerWeek is supplied', () => {
    // Every caller behaved this way before the option existed; a caller
    // that has not been migrated must not change what it shows.
    expect(calculateDailyValues(MEASURED).calories).toBe(2000);
  });

  it('derives calories from BMR × the observed activity band', () => {
    const dv = calculateDailyValues(MEASURED, { sessionsPerWeek: 5 });
    const bmr = calcBMR({
      weightKg: 180 * 0.453592, heightCm: 70 * 2.54, age: 30, sex: 'male',
    });
    expect(dv.calories).toBe(Math.round(bmr * activityMultiplier(5)));
    expect(dv.calories).not.toBe(2000);
  });

  it('moves with training frequency', () => {
    const rest = calculateDailyValues(MEASURED, { sessionsPerWeek: 0 }).calories;
    const some = calculateDailyValues(MEASURED, { sessionsPerWeek: 3 }).calories;
    const lots = calculateDailyValues(MEASURED, { sessionsPerWeek: 7 }).calories;
    expect(rest).toBeLessThan(some);
    expect(some).toBeLessThan(lots);
  });

  it('scales macros to the derived number instead of leaving the 2000 split', () => {
    const dv = calculateDailyValues(MEASURED, { sessionsPerWeek: 6 });
    // Carbs 300 / fat 78 are the flat-default literals. If they survive
    // alongside a raised calorie figure the plate no longer adds up.
    expect(dv.carbs_g).not.toBe(300);
    expect(dv.fat_g).not.toBe(78);
    const fromMacros = dv.protein_g * 4 + dv.carbs_g * 4 + dv.fat_g * 9;
    expect(Math.abs(fromMacros - dv.calories)).toBeLessThanOrEqual(12);
  });

  // ── the guards ────────────────────────────────────────────────────────
  it.each([
    ['weight',  { height_inches: 70, age: 30 }],
    ['height',  { weight_lbs: 180, age: 30 }],
    ['age',     { weight_lbs: 180, height_inches: 70 }],
  ])('falls back to 2000 when %s is missing rather than using a placeholder', (_l, profile) => {
    expect(calculateDailyValues(profile, { sessionsPerWeek: 5 }).calories).toBe(2000);
  });

  it('falls back to 2000 on an empty profile', () => {
    expect(calculateDailyValues({}, { sessionsPerWeek: 5 }).calories).toBe(2000);
  });

  it('treats a non-finite sessionsPerWeek as no answer', () => {
    for (const v of [undefined, null, NaN, Infinity]) {
      expect(calculateDailyValues(MEASURED, { sessionsPerWeek: v }).calories).toBe(2000);
    }
  });

  it('still lets an explicit calorie-cycling override win', () => {
    const dv = calculateDailyValues(
      { ...MEASURED, calorie_cycling: { rest: { calories: 1234 } }, last_workout_date: '2020-01-01' },
      { sessionsPerWeek: 5 },
    );
    expect(dv.calories).toBe(1234);
  });

  it('leaves the micronutrient rows alone', () => {
    const flat = calculateDailyValues(MEASURED);
    const derived = calculateDailyValues(MEASURED, { sessionsPerWeek: 5 });
    for (const k of ['iron_mg', 'magnesium_mg', 'calcium_mg', 'vitamin_c_mg', 'sodium_mg']) {
      expect(derived[k]).toBe(flat[k]);
    }
  });
});

describe('calculateDailyValues — the sex term reaches Mifflin-St Jeor', () => {
  // `gender` was normalised to 'male' at the top of the function, so
  // calcBMR's midpoint branch could never be reached from here and every
  // profile without a stated gender was costed as male. 45 of 56
  // production profiles have no gender.
  it('an unset gender is not priced as male', () => {
    const male    = calculateDailyValues({ ...MEASURED, gender: 'male' }, { sessionsPerWeek: 4 });
    const unset   = calculateDailyValues({ ...MEASURED, gender: null },   { sessionsPerWeek: 4 });
    const female  = calculateDailyValues({ ...MEASURED, gender: 'female' }, { sessionsPerWeek: 4 });
    expect(unset.calories).toBeLessThan(male.calories);
    expect(unset.calories).toBeGreaterThan(female.calories);
  });

  it('lands on the midpoint of the two sex terms', () => {
    const male   = calculateDailyValues({ ...MEASURED, gender: 'male' },   { sessionsPerWeek: 4 }).calories;
    const female = calculateDailyValues({ ...MEASURED, gender: 'female' }, { sessionsPerWeek: 4 }).calories;
    const unset  = calculateDailyValues({ ...MEASURED, gender: null },     { sessionsPerWeek: 4 }).calories;
    expect(Math.abs(unset - (male + female) / 2)).toBeLessThanOrEqual(1);
  });

  it('applies to the goal-driven branch too', () => {
    const p = { ...MEASURED, nutrition_goal: 'maintain', activity_level: 'moderate' };
    const male  = calculateDailyValues({ ...p, gender: 'male' }).calories;
    const unset = calculateDailyValues({ ...p, gender: null }).calories;
    expect(unset).toBeLessThan(male);
  });
});

describe('calculateDailyValues — a stated activity_level still outranks inference', () => {
  it('uses the stored band when the user set one', () => {
    const p = { ...MEASURED, nutrition_goal: 'maintain', activity_level: 'sedentary' };
    // sessionsPerWeek 7 would mean 1.9; the user said sedentary (1.2).
    const stated = calculateDailyValues(p, { sessionsPerWeek: 7 }).calories;
    const noHint = calculateDailyValues(p).calories;
    expect(stated).toBe(noHint);
  });

  it('infers when the user never answered', () => {
    const p = { ...MEASURED, nutrition_goal: 'maintain' };
    const busy = calculateDailyValues(p, { sessionsPerWeek: 7 }).calories;
    const rest = calculateDailyValues(p, { sessionsPerWeek: 0 }).calories;
    expect(busy).toBeGreaterThan(rest);
  });
});
