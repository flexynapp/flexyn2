import { describe, it, expect } from 'vitest';
import { MACROS, MACRO_ORDER, MICRO_ORDER, macroValue } from '@/lib/macroColors';

// A row shaped the way `nutrition_logs` ACTUALLY is. Migration 006 declared the
// `_g` / `_mg` aliases and has never been applied, so the real columns are bare
// and `select('*')` never returns a `protein_g`. Reading the alias off a row is
// how the history sheet came to render "P 0g · C 0g · F 0g" on every day.
const REAL_ROW = {
  id: 'r1',
  food_name: 'Grilled panini sandwich with french fries and ketchup',
  calories: 870, protein: 33, carbs: 104, fat: 36, fiber: 7, sodium: 1200,
};

describe('macroValue', () => {
  it('reads the real bare columns a production row carries', () => {
    expect(macroValue(REAL_ROW, MACROS.protein)).toBe(33);
    expect(macroValue(REAL_ROW, MACROS.carbs)).toBe(104);
    expect(macroValue(REAL_ROW, MACROS.fat)).toBe(36);
  });

  it('prefers the _g alias if migration 006 is ever applied', () => {
    const both = { ...REAL_ROW, protein_g: 41, carbs_g: 91, fat_g: 38 };
    expect(macroValue(both, MACROS.protein)).toBe(41);
    expect(macroValue(both, MACROS.carbs)).toBe(91);
    expect(macroValue(both, MACROS.fat)).toBe(38);
  });

  it('falls through a null alias to the real column', () => {
    expect(macroValue({ protein_g: null, protein: 33 }, MACROS.protein)).toBe(33);
  });

  it('is 0 for a row carrying neither, rather than NaN', () => {
    expect(macroValue({}, MACROS.protein)).toBe(0);
    expect(macroValue(null, MACROS.protein)).toBe(0);
    expect(macroValue({ protein: 'not a number' }, MACROS.protein)).toBe(0);
  });

  it('keeps a genuine zero as zero', () => {
    expect(macroValue({ protein: 0 }, MACROS.protein)).toBe(0);
  });

  it("sums to roughly the row's calories, which is the point of showing them", () => {
    const p = macroValue(REAL_ROW, MACROS.protein);
    const c = macroValue(REAL_ROW, MACROS.carbs);
    const f = macroValue(REAL_ROW, MACROS.fat);
    expect(Math.abs(p * 4 + c * 4 + f * 9 - REAL_ROW.calories)).toBeLessThan(30);
  });
});

describe('the palette itself', () => {
  it('gives the three macros three distinct hues', () => {
    expect(new Set(MACRO_ORDER.map(m => m.css)).size).toBe(3);
  });

  it('draws from the validated categorical ramp, not the state hues', () => {
    // CLAUDE.md carves macros out of the four-hue rule: they need mutual
    // distinguishability, not state meaning. `destructive` for fat is the app
    // calling a macro a failure.
    for (const m of MACRO_ORDER) {
      expect(m.css).toMatch(/var\(--chart-[123]\)/);
      expect(m.chip).not.toMatch(/destructive|success|info|primary/);
    }
  });

  it('never uses the ramp as a TEXT colour', () => {
    // Measured at 11px bold: 2.38:1 (protein) and 2.26:1 (fat) in light, ~4.2:1
    // in dark — under AA either way. The hue tints, the foreground reads.
    for (const m of [...MACRO_ORDER, ...MICRO_ORDER]) {
      expect(m.tint).toMatch(/^bg-chart-[123]\/\d+$/);
      expect(m.chip ?? '').not.toMatch(/text-chart-/);
      expect(m.text).toBeUndefined();
    }
  });

  it('does not reuse one hue twice across the nutrient slide', () => {
    expect(new Set(MICRO_ORDER.map(m => m.tint)).size).toBe(3);
  });

  it('keeps `field` result-shaped so the detail modal can index its state by it', () => {
    expect(MACRO_ORDER.map(m => m.field)).toEqual(['protein_g', 'carbs_g', 'fat_g']);
    expect(MICRO_ORDER.map(m => m.field)).toEqual(['fiber_g', 'sugar_g', 'sodium_mg']);
  });
});
