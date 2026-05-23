// Tests for mealPlans.js's pure buildGroceryList helper. CRUD
// wrappers are exercised by the parent UI; the aggregator is the
// only piece worth unit testing in isolation.

import { describe, it, expect } from 'vitest';
import { buildGroceryList } from '../mealPlans';

const RECIPES = new Map([
  ['r1', { id: 'r1', name: 'Chicken Bowl', ingredients: [
    { name: 'Chicken Breast', grams: 200 },
    { name: 'Rice',           grams: 150 },
  ] }],
  ['r2', { id: 'r2', name: 'Oatmeal',      ingredients: [
    { name: 'Oats',  grams: 60 },
    { name: 'Milk',  grams: 250 },
  ] }],
]);

describe('buildGroceryList', () => {
  it('returns [] for empty / null input', () => {
    expect(buildGroceryList([], RECIPES)).toEqual([]);
    expect(buildGroceryList(null, RECIPES)).toEqual([]);
  });

  it('walks recipe ingredients and sums grams across plans', () => {
    const plans = [
      { recipe_id: 'r1' },
      { recipe_id: 'r1' },
      { recipe_id: 'r2' },
    ];
    const out = buildGroceryList(plans, RECIPES);
    const grams = Object.fromEntries(out.map(o => [o.name, o.total_grams]));
    expect(grams['Chicken Breast']).toBe(400);
    expect(grams['Rice']).toBe(300);
    expect(grams['Oats']).toBe(60);
    expect(grams['Milk']).toBe(250);
  });

  it('skips plans marked completed', () => {
    const plans = [
      { recipe_id: 'r1', is_completed: true },
      { recipe_id: 'r1', is_completed: false },
    ];
    const out = buildGroceryList(plans, RECIPES);
    expect(out.find(o => o.name === 'Chicken Breast').total_grams).toBe(200);
  });

  it('uses food_snapshot.ingredients when no recipe id', () => {
    const plans = [{
      food_snapshot: { ingredients: [
        { name: 'Banana', grams: 100 },
      ] },
    }];
    const out = buildGroceryList(plans, RECIPES);
    expect(out[0].name).toBe('Banana');
    expect(out[0].total_grams).toBe(100);
  });

  it('attaches recipe names to each item for context', () => {
    const plans = [{ recipe_id: 'r1' }];
    const out = buildGroceryList(plans, RECIPES);
    expect(out[0].recipes).toEqual(['Chicken Bowl']);
  });

  it('case-insensitively deduplicates ingredient names', () => {
    const recipes = new Map([
      ['x', { ingredients: [{ name: 'rice', grams: 100 }] }],
      ['y', { ingredients: [{ name: 'Rice', grams: 50  }] }],
    ]);
    const out = buildGroceryList([{ recipe_id: 'x' }, { recipe_id: 'y' }], recipes);
    expect(out).toHaveLength(1);
    expect(out[0].total_grams).toBe(150);
  });

  it('sorts results alphabetically', () => {
    const plans = [{ recipe_id: 'r2' }, { recipe_id: 'r1' }];
    const out = buildGroceryList(plans, RECIPES);
    expect(out.map(o => o.name)).toEqual(['Chicken Breast', 'Milk', 'Oats', 'Rice']);
  });
});
