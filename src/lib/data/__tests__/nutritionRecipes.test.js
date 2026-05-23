// Tests for the pure helpers in nutritionRecipes.js (sumIngredients,
// perServing). Network-touching CRUD is exercised by the parent UI.

import { describe, it, expect } from 'vitest';
import { sumIngredients, perServing } from '../nutritionRecipes';

describe('sumIngredients', () => {
  it('returns all-zero object for empty / missing input', () => {
    const z = sumIngredients([]);
    expect(z.calories).toBe(0);
    expect(z.protein_g).toBe(0);
    expect(z.fiber_g).toBe(0);
    expect(sumIngredients(undefined)).toEqual(z);
  });

  it('sums all known macro keys', () => {
    const out = sumIngredients([
      { calories: 200, protein_g: 30, carbs_g: 10, fat_g: 5,  fiber_g: 1, sugar_g: 2, sodium_mg: 100, cholesterol_mg: 60 },
      { calories: 250, protein_g: 5,  carbs_g: 50, fat_g: 2,  fiber_g: 3, sugar_g: 1, sodium_mg: 200, cholesterol_mg: 0  },
    ]);
    expect(out).toEqual({
      calories: 450, protein_g: 35, carbs_g: 60, fat_g: 7,
      fiber_g: 4, sugar_g: 3, sodium_mg: 300, cholesterol_mg: 60,
    });
  });

  it('coerces string values to numbers', () => {
    const out = sumIngredients([{ calories: '100', protein_g: '20' }]);
    expect(out.calories).toBe(100);
    expect(out.protein_g).toBe(20);
  });
});

describe('perServing', () => {
  it('divides every macro by the serving count', () => {
    expect(perServing({ calories: 600, protein_g: 60 }, 3))
      .toEqual({ calories: 200, protein_g: 20 });
  });

  it('falls back to 1 serving when servings is 0 / negative / NaN', () => {
    expect(perServing({ calories: 500 }, 0).calories).toBe(500);
    expect(perServing({ calories: 500 }, -3).calories).toBe(500);
    expect(perServing({ calories: 500 }, 'abc').calories).toBe(500);
  });

  it('returns {} for missing totals', () => {
    expect(perServing(null, 2)).toEqual({});
  });
});
