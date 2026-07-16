// Tests for the pure helpers in nutritionRecipes.js (sumIngredients,
// perServing). Network-touching CRUD is exercised by the parent UI.

import { describe, it, expect } from 'vitest';
import {
  sumIngredients, perServing, normalizeUnit, normalizeMicros,
  INGREDIENT_UNITS, MICRO_PRESETS, DEFAULT_UNIT,
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
