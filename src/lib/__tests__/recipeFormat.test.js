// Tests for the per-serving presentation helpers shared by the Recipes
// surfaces. The whole point of this module is that the hub row, the detail
// sheet and the log sheet cannot disagree about the same recipe, so the
// arithmetic is pinned here rather than in three components.

import { describe, it, expect } from 'vitest';
import {
  perServingCals, perServingMacros, macroLine, nutritionLine,
  servingsLabel, scaledIngredients, microChips,
} from '../recipeFormat';

const recipe = {
  name: 'Chicken & rice bowl',
  servings: 4,
  totals: { calories: 1648, protein_g: 152, carbs_g: 164, fat_g: 36 },
  ingredients: [
    { name: 'Chicken breast', amount: 320, unit: 'g', calories: 528 },
    { name: 'Jasmine rice, cooked', amount: 400, unit: 'g', calories: 520 },
    { name: 'Olive oil', amount: 3, unit: 'tsp', calories: 120 },
  ],
  micros: [
    { key: 'fiber_g', label: 'Fiber', amount: 24, unit: 'g' },
    { key: 'sodium_mg', label: 'Sodium', amount: 2480, unit: 'mg' },
  ],
};

describe('per-serving figures', () => {
  it('divides calories and every macro by servings', () => {
    expect(perServingCals(recipe)).toBe(412);
    expect(perServingMacros(recipe)).toEqual({ p: 38, c: 41, f: 9 });
  });

  it('renders the macro line and the full nutrition line', () => {
    expect(macroLine(recipe)).toBe('38P · 41C · 9F');
    expect(nutritionLine(recipe)).toBe('412 cal · 38P · 41C · 9F');
  });

  it('treats a missing or zero serving count as one', () => {
    const single = { ...recipe, servings: 0 };
    expect(perServingCals(single)).toBe(1648);
    expect(perServingCals({ totals: { calories: 500 } })).toBe(500);
  });

  it('survives a recipe with no totals at all', () => {
    expect(perServingCals({})).toBe(0);
    expect(macroLine({})).toBe('0P · 0C · 0F');
  });

  it('pluralises the servings label', () => {
    expect(servingsLabel({ servings: 1 })).toBe('1 serving');
    expect(servingsLabel({ servings: 4 })).toBe('4 servings');
    expect(servingsLabel({})).toBe('1 serving');
  });
});

describe('scaledIngredients', () => {
  it('scales whole-recipe amounts down to one serving', () => {
    const rows = scaledIngredients(recipe, 1);
    expect(rows[0]).toMatchObject({ name: 'Chicken breast', amount: '80 g', cals: 132 });
    expect(rows[1].amount).toBe('100 g');
    expect(rows[2].amount).toBe('0.75 tsp');
  });

  it('scales to several servings', () => {
    expect(scaledIngredients(recipe, 4)[0].amount).toBe('320 g');
    expect(scaledIngredients(recipe, 2)[0].amount).toBe('160 g');
  });

  it('defaults the unit to grams and marks an absent amount', () => {
    const rows = scaledIngredients({ servings: 1, ingredients: [{ name: 'Salt' }] }, 1);
    expect(rows[0].amount).toBe('—');
  });

  it('reads the legacy grams-only shape', () => {
    const rows = scaledIngredients({ servings: 1, ingredients: [{ name: 'Rice', grams: 200 }] }, 1);
    expect(rows[0].amount).toBe('200 g');
  });

  it('returns an empty list rather than throwing on a malformed recipe', () => {
    expect(scaledIngredients({}, 1)).toEqual([]);
    expect(scaledIngredients(null, 1)).toEqual([]);
  });
});

describe('microChips', () => {
  it('renders recipe-level nutrients per serving', () => {
    expect(microChips(recipe)).toEqual(['Fiber 6 g', 'Sodium 620 mg']);
  });

  it('drops rows with no label or no finite amount', () => {
    const messy = {
      servings: 1,
      micros: [
        { key: 'x', label: '', amount: 5, unit: 'g' },
        { key: 'y', label: 'Zinc', amount: '', unit: 'mg' },
        { key: 'z', label: 'Iron', amount: 3, unit: 'mg' },
      ],
    };
    expect(microChips(messy)).toEqual(['Iron 3 mg']);
  });

  it('is empty for a recipe with no micros', () => {
    expect(microChips({})).toEqual([]);
  });
});
