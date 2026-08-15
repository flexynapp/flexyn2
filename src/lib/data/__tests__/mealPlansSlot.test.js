// Several meals per (user, date, meal slot), and what a day adds up to.
//
// The slot half of this file was INVERTED on 2026-08-13 by migration 355, and
// the inversion is the point rather than a regression:
//
//   1. The 2026-08-11 audit read "8 rows across 2 slots, 6 unreachable" as
//      "a slot must hold one meal", and 344 indexed that rule in. But those
//      rows were one diary entry mirrored repeatedly — the mirror writes a
//      plan row 120-192ms after its nutrition_logs row — never two different
//      dinners. The identity being violated was the MIRROR's, so uniqueness
//      moved to (user_id, log_id) and the slot took a cap of 3 instead.
//      Two is the floor that must work: every plan template's snack1 and
//      snack2 both map to `snack`, so no template could be applied whole
//      while 344 existed.
//   2. The grocery list is GONE (2026-08-13). It could only ever draw from a
//      saved recipe, and production held one recipe with one ingredient
//      across 63 profiles, so the CTA — the single full-width primary on the
//      tab — was wired to nothing. Its tests went with it; what replaced them
//      is `dayTotals`, which is what the planner now puts on screen.
//
// The shapes here are the REAL production shapes. Note especially
// `PHOTO_AI_SNAPSHOT`: 14 keys and no `ingredients`. The retired
// `mealPlans.test.js` only ever used a recipe or a snapshot carrying
// `ingredients` — neither of which any production row has ever had, which is
// how the grocery CTA's defect stayed invisible for as long as it did.

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

const { upsert, findSlot, isSlotFull, SLOT_CAPACITY, dayTotals, planMealsToSlots } =
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

describe('upsert — a slot holds several meals', () => {
  // Migration 355 reversed 344. These assertions are the INVERSE of the ones
  // this file shipped with, deliberately: the 8-rows-across-2-slots incident
  // was one diary entry mirrored repeatedly, never two different dinners, so
  // uniqueness moved to (user_id, log_id) and the slot gained a cap instead.
  it('does NOT look the slot up when no id is supplied — a new meal is a new row', async () => {
    selectRows = [{ id: 'existing-plan' }];
    await upsert({ user: USER, planDate: '2026-08-11', mealType: 'dinner', foodSnapshot: PHOTO_AI_SNAPSHOT });

    expect(calls.filter(c => c.op === 'select')).toHaveLength(0);
    const write = calls.find(c => c.op === 'upsert');
    expect(write.row).not.toHaveProperty('id');
    expect(write.opts).toEqual({ onConflict: 'id' });
  });

  it('REGRESSION (355): a second save into an occupied slot APPENDS', async () => {
    selectRows = [{ id: 'plan-A' }];
    await upsert({ user: USER, planDate: '2026-07-16', mealType: 'snack', foodSnapshot: PHOTO_AI_SNAPSHOT });
    await upsert({ user: USER, planDate: '2026-07-16', mealType: 'snack', foodSnapshot: PHOTO_AI_SNAPSHOT });

    const writes = calls.filter(c => c.op === 'upsert');
    expect(writes).toHaveLength(2);
    // Under 344 both carried `id: 'plan-A'` and the second overwrote the first.
    expect(writes.every(w => !('id' in w.row))).toBe(true);
  });

  it('replaceSlot:true still swaps the slot in place, for an explicit swap', async () => {
    selectRows = [{ id: 'plan-A' }];
    await upsert({ replaceSlot: true, user: USER, planDate: '2026-07-16', mealType: 'snack', foodSnapshot: PHOTO_AI_SNAPSHOT });

    const lookup = calls.find(c => c.op === 'select');
    expect(lookup.filters).toEqual({ user_id: 'u1', plan_date: '2026-07-16', meal_type: 'snack' });
    expect(calls.find(c => c.op === 'upsert').row.id).toBe('plan-A');
  });

  it('replaceSlot on an empty slot omits id, so the row is created', async () => {
    selectRows = [];
    await upsert({ replaceSlot: true, user: USER, planDate: '2026-08-12', mealType: 'lunch', foodSnapshot: PHOTO_AI_SNAPSHOT });

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
    await upsert({ replaceSlot: true, user: USER, planDate: '2026-08-11' });
    expect(calls.find(c => c.op === 'select').filters.meal_type).toBe('snack');
    expect(calls.find(c => c.op === 'upsert').row.meal_type).toBe('snack');
  });

  it('isSlotFull recognises the cap trigger and nothing else', async () => {
    expect(isSlotFull({ code: '23514' })).toBe(true);
    expect(isSlotFull({ code: '23505' })).toBe(false);   // the mirror dedupe
    expect(isSlotFull(null)).toBe(false);
    expect(SLOT_CAPACITY).toBe(3);
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

describe('dayTotals — what the open day puts on screen', () => {
  const snap = (o) => ({ food_snapshot: o });

  it('sums calories and macros across a slot holding several meals', () => {
    const t = dayTotals([
      snap({ calories: 330, protein_g: 9,  carbs_g: 69,  fat_g: 2 }),
      snap({ calories: 870, protein_g: 33, carbs_g: 104, fat_g: 36 }),
    ]);
    expect(t).toMatchObject({ calories: 1200, protein: 42, carbs: 173, fat: 38, meals: 2, counted: 2 });
  });

  it('counts a recipe-backed plan as a MEAL but not as a number', () => {
    // A recipe slot stores `recipe_id` and no snapshot, so it has no macros to
    // add. `meals` moves and `counted` does not — the caller renders "no
    // macros yet" rather than a zero, which is the rule for empty sections.
    const t = dayTotals([{ recipe_id: 'r1' }, snap({ calories: 500, protein_g: 40 })]);
    expect(t.meals).toBe(2);
    expect(t.counted).toBe(1);
    expect(t.calories).toBe(500);
  });

  it('ignores an all-zero snapshot rather than counting it as measured', () => {
    // Production holds exactly this row: calories 0 with 5/5/5 macros is a
    // real meal, but a snapshot with nothing above zero is not a measurement.
    expect(dayTotals([snap({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 })]))
      .toMatchObject({ meals: 1, counted: 0, calories: 0 });
    expect(dayTotals([snap({ calories: 0, protein_g: 5, carbs_g: 5, fat_g: 5 })]))
      .toMatchObject({ meals: 1, counted: 1, protein: 5 });
  });

  it('is inert on empty and non-numeric input', () => {
    expect(dayTotals([])).toMatchObject({ calories: 0, meals: 0, counted: 0 });
    expect(dayTotals(null)).toMatchObject({ meals: 0 });
    expect(dayTotals([snap({ calories: 'lots' })])).toMatchObject({ meals: 1, counted: 0, calories: 0 });
  });
});

describe('planMealsToSlots — five template meals into four slots', () => {
  // The real shape of a PLAN_TEMPLATES entry after scalePlan.
  const TEMPLATE = { meals: [
    { id: 'breakfast', name: 'Power Breakfast',     kcal: 523, macros: { p: 41, c: 57, f: 13 } },
    { id: 'lunch',     name: 'Chicken & Rice Bowl', kcal: 632, macros: { p: 57, c: 74, f: 9 } },
    { id: 'snack1',    name: 'Afternoon Fuel',      kcal: 218, macros: { p: 22, c: 20, f: 7 } },
    { id: 'dinner',    name: 'Steak & Red Potato',  kcal: 676, macros: { p: 57, c: 50, f: 24 } },
    { id: 'snack2',    name: 'Evening Protein',     kcal: 131, macros: { p: 15, c: 12, f: 2 } },
  ] };

  it('collapses BOTH snacks onto the single snack slot', () => {
    const out = planMealsToSlots(TEMPLATE);
    expect(out.map(o => o.mealType)).toEqual(['breakfast', 'lunch', 'snack', 'dinner', 'snack']);
    // Two in one slot is the whole reason 344 had to be reversed — under it
    // the second snack had nowhere to land, so no template applied whole.
    expect(out.filter(o => o.mealType === 'snack')).toHaveLength(2);
    expect(out.filter(o => o.mealType === 'snack').length).toBeLessThanOrEqual(SLOT_CAPACITY);
  });

  it('carries the scaled numbers onto the snapshot the planner reads', () => {
    const [first] = planMealsToSlots(TEMPLATE);
    expect(first.foodSnapshot).toEqual({
      name: 'Power Breakfast', calories: 523, protein_g: 41, carbs_g: 57, fat_g: 13,
    });
  });

  it('a mapped template still sums to the target the plan was scaled to', () => {
    // scalePlan multiplies every meal by one factor, so the five kcals add up
    // to exactly the target — dayTotals must agree with the catalog card.
    const rows = planMealsToSlots(TEMPLATE).map(o => ({ food_snapshot: o.foodSnapshot }));
    expect(dayTotals(rows).calories).toBe(2180);
  });

  it('is inert on a plan with no meals', () => {
    expect(planMealsToSlots(null)).toEqual([]);
    expect(planMealsToSlots({})).toEqual([]);
  });
});
