// Tests for the pure helpers in nutritionRecipes.js (sumIngredients,
// perServing). Network-touching CRUD is exercised by the parent UI.

import { describe, it, expect } from 'vitest';
import {
  sumIngredients, perServing, normalizeUnit, normalizeMicros,
  INGREDIENT_UNITS, MICRO_PRESETS, DEFAULT_UNIT,
  recipeLogPayload, recipeFromLog, servingsOf,
} from '../nutritionRecipes';

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

describe('normalizeUnit', () => {
  it('keeps a known unit', () => {
    for (const u of INGREDIENT_UNITS) expect(normalizeUnit(u.value)).toBe(u.value);
  });
  it('falls back to the default unit for unknown/empty', () => {
    expect(normalizeUnit('furlong')).toBe(DEFAULT_UNIT);
    expect(normalizeUnit(undefined)).toBe(DEFAULT_UNIT);
    expect(normalizeUnit('')).toBe(DEFAULT_UNIT);
    expect(DEFAULT_UNIT).toBe('g');
  });
});

describe('normalizeMicros', () => {
  it('keeps rows with a label and a finite amount', () => {
    const out = normalizeMicros([
      { key: 'iron_mg', label: 'Iron', amount: '3', unit: 'mg' },
      { label: 'Vitamin C', amount: 60, unit: 'mg' },
    ]);
    expect(out).toEqual([
      { key: 'iron_mg', label: 'Iron', amount: 3, unit: 'mg' },
      { key: 'vitamin_c', label: 'Vitamin C', amount: 60, unit: 'mg' },
    ]);
  });

  it('drops rows missing a label or a valid amount', () => {
    const out = normalizeMicros([
      { label: '', amount: 5, unit: 'mg' },          // no label
      { label: 'Zinc', amount: '', unit: 'mg' },     // no amount
      { label: 'Sodium', amount: 'abc', unit: 'mg' },// non-numeric
      { label: 'Fiber', amount: 4, unit: 'g' },      // keep
    ]);
    expect(out).toEqual([{ key: 'fiber', label: 'Fiber', amount: 4, unit: 'g' }]);
  });

  it('derives a key by slugifying the label when none is given', () => {
    const [row] = normalizeMicros([{ label: 'Omega 3 (EPA/DHA)', amount: 1, unit: 'g' }]);
    expect(row.key).toBe('omega_3_epa_dha');
  });

  it('is safe on non-array input', () => {
    expect(normalizeMicros(undefined)).toEqual([]);
    expect(normalizeMicros(null)).toEqual([]);
    expect(normalizeMicros('nope')).toEqual([]);
  });
});

describe('constants', () => {
  it('exposes grams as a selectable ingredient unit', () => {
    expect(INGREDIENT_UNITS.some(u => u.value === 'g')).toBe(true);
  });
  it('every micro preset has a key, label and default unit', () => {
    for (const p of MICRO_PRESETS) {
      expect(p.key).toBeTruthy();
      expect(p.label).toBeTruthy();
      expect(p.unit).toBeTruthy();
    }
  });
  it('offers headline vitamins & minerals as presets', () => {
    const labels = MICRO_PRESETS.map(p => p.label);
    for (const l of ['Vitamin C', 'Vitamin D', 'Iron', 'Calcium']) {
      expect(labels).toContain(l);
    }
  });
});

// ── The log path (added with the Recipes redesign, boards C/D) ──────────
//
// recipeLogPayload is the only place a recipe becomes a diary row, so the
// arithmetic that divides by servings and multiplies by what was eaten is
// worth pinning down: getting it wrong writes a wrong number into someone's
// day and nothing downstream can tell.

describe('recipeLogPayload', () => {
  const recipe = {
    name: '  Chicken & rice bowl  ',
    servings: 4,
    image_url: 'https://example.test/a.jpg',
    totals: {
      calories: 1648, protein_g: 152, carbs_g: 164, fat_g: 36,
      fiber_g: 24, sugar_g: 8, sodium_mg: 2480, cholesterol_mg: 400,
    },
  };

  it('divides by the recipe servings and multiplies by what was eaten', () => {
    const row = recipeLogPayload({ recipe, servings: 1, mealType: 'lunch', date: '2026-08-12' });
    expect(row.calories).toBe(412);        // 1648 / 4
    expect(row.protein_g).toBe(38);        // 152 / 4
    expect(row.carbs_g).toBe(41);
    expect(row.fat_g).toBe(9);
    expect(row.meal_type).toBe('lunch');
    expect(row.date).toBe('2026-08-12');
    expect(row.food_name).toBe('Chicken & rice bowl');   // trimmed
    expect(row.image_url).toBe('https://example.test/a.jpg');
  });

  it('scales to several servings, including halves', () => {
    expect(recipeLogPayload({ recipe, servings: 2 }).calories).toBe(824);
    expect(recipeLogPayload({ recipe, servings: 4 }).calories).toBe(1648);
    expect(recipeLogPayload({ recipe, servings: 0.5 }).calories).toBe(206);
    expect(recipeLogPayload({ recipe, servings: 0.5 }).protein_g).toBe(19);
  });

  it('floors servings at 1 rather than dividing by zero', () => {
    const zero = { ...recipe, servings: 0 };
    expect(recipeLogPayload({ recipe: zero, servings: 1 }).calories).toBe(1648);
    const missing = { ...recipe, servings: undefined };
    expect(Number.isFinite(recipeLogPayload({ recipe: missing, servings: 1 }).calories)).toBe(true);
  });

  it('defaults the meal type rather than writing null', () => {
    expect(recipeLogPayload({ recipe, servings: 1 }).meal_type).toBe('snack');
  });

  it('carries recipe-level micros the diary has a column for, per serving', () => {
    const withMicros = {
      ...recipe,
      micros: [
        { key: 'iron_mg', label: 'Iron', amount: 12, unit: 'mg' },
        { key: 'vitamin_c_mg', label: 'Vitamin C', amount: 200, unit: 'mg' },
      ],
    };
    const row = recipeLogPayload({ recipe: withMicros, servings: 1 });
    expect(row.iron_mg).toBe(3);          // 12 / 4 servings
    expect(row.vitamin_c_mg).toBe(50);
  });

  it('lets an explicit micro override the ingredient-derived total', () => {
    const withMicros = {
      ...recipe,
      micros: [{ key: 'sodium_mg', label: 'Sodium', amount: 800, unit: 'mg' }],
    };
    // Ingredients summed to 2480 (620/serving); the user typed 800 for the
    // whole recipe, so 200/serving wins rather than the two adding up.
    expect(recipeLogPayload({ recipe: withMicros, servings: 1 }).sodium_mg).toBe(200);
  });

  it('does NOT carry vitamin A or D — the diary stores those in IU', () => {
    const withMicros = {
      ...recipe,
      micros: [
        { key: 'vitamin_a_mcg', label: 'Vitamin A', amount: 900, unit: 'mcg' },
        { key: 'vitamin_d_mcg', label: 'Vitamin D', amount: 20, unit: 'mcg' },
      ],
    };
    const row = recipeLogPayload({ recipe: withMicros, servings: 1 });
    expect(row.vitamin_a_iu).toBeUndefined();
    expect(row.vitamin_d_iu).toBeUndefined();
    expect(row.vitamin_a_mcg).toBeUndefined();
  });
});

describe('recipeFromLog', () => {
  it('turns a diary row into a one-serving draft recipe', () => {
    const draft = recipeFromLog({
      food_name: 'Chicken & rice', calories: 620, protein_g: 55, carbs_g: 60, fat_g: 14,
      image_url: 'https://example.test/b.jpg',
    });
    expect(draft.name).toBe('Chicken & rice');
    expect(draft.servings).toBe(1);
    expect(draft.image_url).toBe('https://example.test/b.jpg');
    expect(draft.ingredients).toHaveLength(1);
    expect(draft.ingredients[0]).toMatchObject({
      name: 'Chicken & rice', amount: 1, unit: 'serving', calories: 620, protein_g: 55,
    });
  });

  it('reads the legacy un-suffixed macro columns too', () => {
    const draft = recipeFromLog({ food_name: 'Oats', calories: 300, protein: 12, carbs: 50, fat: 6 });
    expect(draft.ingredients[0].protein_g).toBe(12);
    expect(draft.ingredients[0].carbs_g).toBe(50);
  });

  it('leaves absent macros blank rather than seeding zeros', () => {
    const draft = recipeFromLog({ food_name: 'Mystery', calories: 200 });
    expect(draft.ingredients[0].protein_g).toBe('');
    expect(draft.ingredients[0].fat_g).toBe('');
  });

  it('returns null for no log', () => {
    expect(recipeFromLog(null)).toBeNull();
  });
});

describe('servingsOf', () => {
  it('floors at 1 for missing, zero and negative values', () => {
    expect(servingsOf({ servings: 4 })).toBe(4);
    expect(servingsOf({ servings: 0 })).toBe(1);
    expect(servingsOf({ servings: -2 })).toBe(1);
    expect(servingsOf({})).toBe(1);
    expect(servingsOf(null)).toBe(1);
  });
});
