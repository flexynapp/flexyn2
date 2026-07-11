// Tests the calorie-cycling override baked into calculateDailyValues.
// The feature: user_profiles.calorie_cycling stores { training, rest }
// macro targets; the resolver picks the branch based on whether a workout
// was logged today (last_workout_date === today), so every consumer of
// calculateDailyValues shows the right target without threading a flag.
import { describe, it, expect } from 'vitest';
import { calculateDailyValues } from '@/lib/nutritionDefaults';

// Local yyyy-MM-dd, matching how last_workout_date is stored.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const cycling = {
  training: { calories: 2600, protein_g: 190, carbs_g: 300, fat_g: 70 },
  rest: { calories: 1900, protein_g: 190, carbs_g: 140, fat_g: 65 },
};

describe('calculateDailyValues — calorie cycling', () => {
  it('uses the TRAINING branch when a workout was logged today', () => {
    const dv = calculateDailyValues({ calorie_cycling: cycling, last_workout_date: todayStr() });
    expect(dv.calories).toBe(2600);
    expect(dv.carbs_g).toBe(300);
  });

  it('uses the REST branch when the last workout was not today', () => {
    const dv = calculateDailyValues({ calorie_cycling: cycling, last_workout_date: '2020-01-01' });
    expect(dv.calories).toBe(1900);
    expect(dv.carbs_g).toBe(140);
  });

  it('uses the REST branch when no workout has ever been logged', () => {
    const dv = calculateDailyValues({ calorie_cycling: cycling });
    expect(dv.calories).toBe(1900);
  });

  it('leaves micros (sodium, iron, …) untouched by cycling', () => {
    const dv = calculateDailyValues({ calorie_cycling: cycling, last_workout_date: todayStr() });
    expect(dv.sodium_mg).toBe(2300);
    expect(dv.iron_mg).toBeGreaterThan(0);
  });

  it('only overrides the keys the branch actually sets', () => {
    const partial = { training: { calories: 2500 }, rest: { calories: 1800 } };
    const dv = calculateDailyValues({ calorie_cycling: partial, last_workout_date: todayStr() });
    expect(dv.calories).toBe(2500);
    // protein/carbs/fat fall through to the computed standard values
    expect(dv.protein_g).toBeGreaterThan(0);
    expect(dv.carbs_g).toBe(300); // standard fallback, not overridden
  });

  it('ignores blank/invalid branch values instead of zeroing the target', () => {
    const messy = { training: { calories: '', protein_g: null, carbs_g: 'abc', fat_g: 80 }, rest: null };
    const dv = calculateDailyValues({ calorie_cycling: messy, last_workout_date: todayStr() });
    expect(dv.calories).toBe(2000);      // '' ignored → standard
    expect(dv.fat_g).toBe(80);           // valid override applied
    expect(dv.carbs_g).toBe(300);        // 'abc' ignored → standard
  });

  it('is a no-op when calorie_cycling is absent (prior behavior preserved)', () => {
    const dv = calculateDailyValues({});
    expect(dv.calories).toBe(2000);
    const goalDv = calculateDailyValues({ nutrition_goal: 'maintain', weight_lbs: 180 });
    expect(goalDv.calories).toBeGreaterThan(0);
  });

  it('cycling overrides even the goal-driven calorie target', () => {
    const dv = calculateDailyValues({
      nutrition_goal: 'lose', weight_lbs: 200, calorie_cycling: cycling, last_workout_date: todayStr(),
    });
    expect(dv.calories).toBe(2600); // training override wins over the deficit calc
  });
});
