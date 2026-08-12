// One plan per (user, date, meal slot) — and an honest grocery count.
//
// These cover the two defects the 2026-08-11 meal-plans audit confirmed
// against production:
//
//   1. `upsert` sent no `id` on a fresh save, so `onConflict: 'id'` never
//      matched and every re-fill of an occupied slot INSERTed a second row.
//      Production held 8 rows across 2 slots; 6 were unreachable in the grid.
//   2. The grocery CTA counted plans, not plans that contribute ingredients,
//      so it advertised 6 meals and opened a sheet reading "Nothing to buy".
//
// The shapes here are the REAL production shapes. Note especially
// `PHOTO_AI_SNAPSHOT`: 14 keys, no `ingredients`. Every pre-existing test in
// `mealPlans.test.js` uses a recipe or a snapshot carrying `ingredients` —
// neither of which any production row has ever had.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls = [];
let selectRows = [];

vi.mock('@/api/supabaseClient', () => {
  const makeChain = (table) => {
    const chain = {
      _table: table,
      _filters: {},
      select() { return chain; },
      eq(col, val) { chain._filters[col] = val; return chain; },
      gte() { return chain; },
      lte() { return chain; },
      order() { return chain; },
      limit() {
        calls.push({ op: 'select', table, filters: { ...chain._filters } });
        return Promise.resolve({ data: selectRows, error: null });
      },
      upsert(row, opts) {
        calls.push({ op: 'upsert', table, row, opts });
        return {
          select: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }),
        };
      },
    };
    return chain;
  };
  return { supabase: { from: (table) => makeChain(table) } };
});

const { upsert, findSlot, buildGroceryList, shoppablePlans, planIngredients } =
  await import('../mealPlans');

const USER = { id: 'u1', email: 'a@b.c' };

// The exact snapshot the photo-meal mirror writes (Nutrition.jsx
// `plannerSnapshot` + `log_id`). All 8 production rows have this shape.
const PHOTO_AI_SNAPSHOT = {
  name: 'Farro and roasted vegetable bowl',
  calories: 520, protein_g: 18, carbs_g: 72, fat_g: 16,
  fiber_g: 9, sugar_g: 7, sodium_mg: 480,
  image_url: 'https://example.test/x.jpg',
  portion_estimate: '1 bowl', confidence: 'medium',
  items: [{ name: 'farro' }, { name: 'courgette' }],
  source: 'photo_ai', log_id: 'log-1',
};

beforeEach(() => { calls.length = 0; selectRows = []; });

describe('upsert — one plan per slot', () => {
  it('looks the slot up before writing when no id is supplied', async () => {
    selectRows = [{ id: 'existing-plan' }];
    await upsert({ user: USER, planDate: '2026-08-11', mealType: 'dinner', foodSnapshot: PHOTO_AI_SNAPSHOT });

    const lookup = calls.find(c => c.op === 'select');
    expect(lookup).toBeTruthy();
    expect(lookup.table).toBe('meal_plans');
    expect(lookup.filters).toEqual({
      user_id: 'u1', plan_date: '2026-08-11', meal_type: 'dinner',
    });
  });

  it('carries the found id onto the row so onConflict:id actually matches', async () => {
    selectRows = [{ id: 'existing-plan' }];
    await upsert({ user: USER, planDate: '2026-08-11', mealType: 'dinner', foodSnapshot: PHOTO_AI_SNAPSHOT });

    const write = calls.find(c => c.op === 'upsert');
    expect(write.row.id).toBe('existing-plan');
    expect(write.opts).toEqual({ onConflict: 'id' });
  });

  it('REGRESSION: a second save into an occupied slot updates, it does not append', async () => {
    selectRows = [{ id: 'plan-A' }];
    await upsert({ user: USER, planDate: '2026-07-16', mealType: 'snack', foodSnapshot: PHOTO_AI_SNAPSHOT });
    await upsert({ user: USER, planDate: '2026-07-16', mealType: 'snack', foodSnapshot: PHOTO_AI_SNAPSHOT });

    const writes = calls.filter(c => c.op === 'upsert');
    expect(writes).toHaveLength(2);
    // Before the fix both of these had `id: undefined` and produced two rows.
    expect(writes.every(w => w.row.id === 'plan-A')).toBe(true);
  });

  it('omits id entirely on a genuinely empty slot, so the row is created', async () => {
    selectRows = [];
    await upsert({ user: USER, planDate: '2026-08-12', mealType: 'lunch', foodSnapshot: PHOTO_AI_SNAPSHOT });

    const write = calls.find(c => c.op === 'upsert');
    expect(write.row).not.toHaveProperty('id');
    expect(write.row.meal_type).toBe('lunch');
  });

  it('an explicit id short-circuits the lookup', async () => {
    await upsert({ id: 'given', user: USER, planDate: '2026-08-11', mealType: 'dinner' });
    expect(calls.filter(c => c.op === 'select')).toHaveLength(0);
    expect(calls.find(c => c.op === 'upsert').row.id).toBe('given');
  });

  it('defaults a missing mealType to snack on BOTH the lookup and the write', async () => {
    selectRows = [];
    await upsert({ user: USER, planDate: '2026-08-11' });
    expect(calls.find(c => c.op === 'select').filters.meal_type).toBe('snack');
    expect(calls.find(c => c.op === 'upsert').row.meal_type).toBe('snack');
  });

  it('findSlot returns null rather than throwing when the slot is empty', async () => {
    selectRows = [];
    await expect(findSlot('u1', '2026-08-11', 'dinner')).resolves.toBeNull();
  });

  it('findSlot is inert without a user or a date', async () => {
    await expect(findSlot(null, '2026-08-11', 'dinner')).resolves.toBeNull();
    await expect(findSlot('u1', null, 'dinner')).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('grocery count — what the CTA is allowed to promise', () => {
  const recipes = new Map([
    ['r1', { id: 'r1', name: 'Chicken Bowl', ingredients: [{ name: 'Rice', grams: 150 }] }],
  ]);

  it('a real photo-AI plan contributes NOTHING — it has macros, not ingredients', () => {
    const plans = [{ food_snapshot: PHOTO_AI_SNAPSHOT }];
    expect(planIngredients(plans[0], recipes)).toEqual([]);
    expect(shoppablePlans(plans, recipes)).toHaveLength(0);
    expect(buildGroceryList(plans, recipes)).toEqual([]);
  });

  it('THE DEFECT: production\'s 8-row shape counted 8 and produced 0 items', () => {
    const plans = Array.from({ length: 8 }, () => ({ is_completed: false, food_snapshot: PHOTO_AI_SNAPSHOT }));
    // What the old CTA showed:
    expect(plans.filter(p => !p.is_completed)).toHaveLength(8);
    // What the sheet actually renders:
    expect(buildGroceryList(plans, recipes)).toEqual([]);
    // What the CTA now shows — the two agree.
    expect(shoppablePlans(plans, recipes)).toHaveLength(0);
  });

  it('the count and the list always agree, on a mixed week', () => {
    const plans = [
      { recipe_id: 'r1' },                                     // contributes
      { food_snapshot: PHOTO_AI_SNAPSHOT },                    // does not
      { food_snapshot: { ingredients: [{ name: 'Banana', grams: 100 }] } }, // contributes
      { recipe_id: 'r1', is_completed: true },                 // completed → skipped
    ];
    expect(shoppablePlans(plans, recipes)).toHaveLength(2);
    expect(buildGroceryList(plans, recipes).map(i => i.name)).toEqual(['Banana', 'Rice']);
  });

  it('a completed plan contributes nothing — the flag still gates the list', () => {
    const plans = [{ recipe_id: 'r1', is_completed: true }];
    expect(shoppablePlans(plans, recipes)).toHaveLength(0);
    expect(buildGroceryList(plans, recipes)).toEqual([]);
  });

  it('an ingredients array of blank names is not shoppable', () => {
    const plans = [{ food_snapshot: { ingredients: [{ name: '   ' }, { name: '' }] } }];
    expect(shoppablePlans(plans, recipes)).toHaveLength(0);
  });

  it('tolerates a missing recipe map rather than throwing', () => {
    expect(() => buildGroceryList([{ recipe_id: 'r1' }], undefined)).not.toThrow();
    expect(shoppablePlans([{ recipe_id: 'r1' }], undefined)).toHaveLength(0);
  });
});
