import { describe, it, expect } from 'vitest';
import {
  isWaterEntry, waterEntryOz, waterFoodName, splitWaterEntries, sumWaterOz,
} from '@/lib/waterEntries';

describe('isWaterEntry', () => {
  it('matches a bare "Water" row even when water_oz is null', () => {
    // THE BUG. MealHistoryModal required `water_oz > 0` here, so every row
    // written before migration 006 fell through the filter and rendered in
    // meal history as a "Water — 0 cal" meal.
    expect(isWaterEntry({ food_name: 'Water', water_oz: null })).toBe(true);
    expect(isWaterEntry({ food_name: 'Water' })).toBe(true);
    expect(isWaterEntry({ food_name: 'Water', water_oz: 0 })).toBe(true);
  });

  it('matches the oz-encoded form', () => {
    expect(isWaterEntry({ food_name: 'Water|24' })).toBe(true);
  });

  it('does not match a meal, or a meal that merely mentions water', () => {
    expect(isWaterEntry({ food_name: 'Watermelon salad' })).toBe(false);
    expect(isWaterEntry({ food_name: 'Sparkling Water' })).toBe(false);
    expect(isWaterEntry({})).toBe(false);
    expect(isWaterEntry(null)).toBe(false);
    expect(isWaterEntry({ food_name: 123 })).toBe(false);
  });
});

describe('waterEntryOz', () => {
  it('defaults a bare "Water" to 8 oz', () => {
    expect(waterEntryOz({ food_name: 'Water' })).toBe(8);
    expect(waterEntryOz({ food_name: 'Water', water_oz: null })).toBe(8);
  });

  it('reads the oz out of the name', () => {
    expect(waterEntryOz({ food_name: 'Water|24' })).toBe(24);
  });

  it('prefers a stored water_oz, including a genuine zero', () => {
    // `??` semantics preserved on purpose: a stored 0 is an answer, not a gap.
    expect(waterEntryOz({ food_name: 'Water|24', water_oz: 12 })).toBe(12);
    expect(waterEntryOz({ food_name: 'Water', water_oz: 0 })).toBe(0);
  });

  it('falls back to 8 on an unparseable name', () => {
    expect(waterEntryOz({ food_name: 'Water|abc' })).toBe(8);
  });

  it('is 0 for anything that is not water', () => {
    expect(waterEntryOz({ food_name: 'Grilled panini', calories: 870 })).toBe(0);
  });
});

describe('waterFoodName', () => {
  it('round-trips through waterEntryOz', () => {
    for (const oz of [8, 12, 16, 24, 32]) {
      expect(waterEntryOz({ food_name: waterFoodName(oz) })).toBe(oz);
    }
  });
});

describe('splitWaterEntries', () => {
  it('keeps water out of the meal list', () => {
    // The exact shape from the reported screenshot: one meal and four bare
    // "Water" rows on the same day, all with a null water_oz. History showed
    // five rows, four of them reading "Water · 0 cal".
    const day = [
      { id: 'm', food_name: 'Grilled panini sandwich', calories: 870 },
      { id: 'w1', food_name: 'Water', water_oz: null, calories: 0 },
      { id: 'w2', food_name: 'Water', water_oz: null, calories: 0 },
      { id: 'w3', food_name: 'Water', water_oz: null, calories: 0 },
      { id: 'w4', food_name: 'Water', water_oz: null, calories: 0 },
    ];
    const { meals, water } = splitWaterEntries(day);
    expect(meals.map(m => m.id)).toEqual(['m']);
    expect(water).toHaveLength(4);
    expect(sumWaterOz(water)).toBe(32);
  });

  it('handles a day with no rows at all', () => {
    expect(splitWaterEntries([])).toEqual({ meals: [], water: [] });
    expect(splitWaterEntries()).toEqual({ meals: [], water: [] });
  });
});
