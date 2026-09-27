// The Log Meal write path — what the form collects vs what the table stores.
//
// ── THESE ARE CHARACTERIZATION TESTS. READ THIS BEFORE "FIXING" ONE. ──────
//
// The block marked CHARACTERIZATION below asserts the CURRENT, DEFECTIVE
// behaviour on purpose: ten of the sixteen nutrient fields `LogMealForm`
// collects are silently discarded on save. They pass here because the bug is
// real, not because it is correct. If migration 006 is applied and those
// columns start existing, these tests SHOULD fail — INVERT them (flip the
// expectation to "persisted"), do not delete them. Deleting removes the only
// executable record of which fields the user can type and lose.
//
// The mechanism, established against production on 2026-08-11:
//
//   • `nutrition_logs` has 22 columns. Six are nutrients: calories, protein,
//     carbs, fat, fiber, sodium.
//   • `LogMealForm` renders 16 nutrient inputs (8 macros + 8 vitamins and
//     minerals) and `Nutrition.jsx:1307` sends every one of them.
//   • `src/lib/data/nutrition.js` `create()` dual-writes the five `_g`/`_mg`
//     aliases onto the old un-suffixed column names, so those five survive.
//   • The other ten — sugar_g, cholesterol_mg, iron_mg, magnesium_mg,
//     calcium_mg, potassium_mg and the four vitamins — have no column and no
//     alias. Until 2026-09-27 `db.js`'s strip-and-retry dropped each one on a
//     PGRST204/42703. That machinery is gone; `nutrition.create` now drops
//     them explicitly (`NOT_STORED`), so the user still gets a success toast
//     for data that is never stored.
//   • Migration 006 declares all sixteen columns and has never been applied.
//
// Full write-up: docs/nutrition-meal-logging-audit.md.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Supabase stub that behaves like the real schema ──────────────────────
//
// Rejects any column `nutrition_logs` does not actually have, one per
// insert attempt, the way PostgREST does. That is what makes this a test of
// the real drop mechanism rather than of a mock.

const REAL_COLUMNS = new Set([
  'id', 'created_by', 'user_id', 'date', 'meal_type', 'food_name', 'brand',
  'serving_size', 'servings', 'calories', 'protein', 'carbs', 'fat', 'fiber',
  'sodium', 'food_item_id', 'created_at', 'updated_at', 'created_date',
  'notes', 'image_url', 'ai_meta',
]);

let insertAttempts = [];

const makeInsertChain = (payload) => {
  insertAttempts.push({ ...payload });
  const unknown = Object.keys(payload).find((k) => !REAL_COLUMNS.has(k));
  const result = unknown
    ? { data: null, error: { code: 'PGRST204', message: `Could not find the '${unknown}' column of 'nutrition_logs' in the schema cache` } }
    : { data: { id: 'row-1', ...payload }, error: null };
  return { select: () => ({ single: async () => result }) };
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u-1', email: 'a@b.co' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({ insert: makeInsertChain }),
  },
}));
vi.mock('@/lib/pushCleanup', () => ({ unsubscribePushOnLogout: async () => {} }));
vi.mock('@/lib/data/users', () => ({ selectProfiles: (build) => build({}) }));

import { create as createNutritionLog, NOT_STORED } from '@/lib/data/nutrition';

// Exactly what Nutrition.jsx sends after `safeEntry` coercion, for a
// user who filled in every tile on both tabs of the form.
const FULL_FORM_ENTRY = {
  date: '2026-08-11',
  created_by: 'a@b.co',
  user_id: 'u-1',
  meal_type: 'lunch',
  food_name: 'Chicken and rice',
  calories: 600,
  protein_g: 45, carbs_g: 60, fat_g: 12, fiber_g: 5, sodium_mg: 400,
  sugar_g: 8, cholesterol_mg: 90,
  iron_mg: 3, magnesium_mg: 40, calcium_mg: 120, potassium_mg: 700,
  vitamin_a_iu: 500, vitamin_c_mg: 12, vitamin_d_iu: 40, vitamin_b12_mcg: 2,
};

const finalPayload = () => insertAttempts[insertAttempts.length - 1];

beforeEach(() => { insertAttempts = []; });

describe('nutrition create() — the five aliases that DO survive', () => {
  it('dual-writes the _g/_mg aliases onto the columns that exist', async () => {
    await createNutritionLog(FULL_FORM_ENTRY);
    const stored = finalPayload();

    // The alias names themselves never reach the table...
    for (const alias of ['protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg']) {
      expect(stored).not.toHaveProperty(alias);
    }
    // ...but their VALUES do, under the old un-suffixed names.
    expect(stored.protein).toBe(45);
    expect(stored.carbs).toBe(60);
    expect(stored.fat).toBe(12);
    expect(stored.fiber).toBe(5);
    expect(stored.sodium).toBe(400);
  });

  it('keeps calories, which is a real column and needs no alias', async () => {
    await createNutritionLog(FULL_FORM_ENTRY);
    expect(finalPayload().calories).toBe(600);
  });

  it('still succeeds despite the unknown columns — the save is not broken', async () => {
    const row = await createNutritionLog(FULL_FORM_ENTRY);
    expect(row).toMatchObject({ id: 'row-1' });
  });
});

describe('CHARACTERIZATION — ten nutrient fields the user can type and lose', () => {
  // Invert these if migration 006 lands. Do not delete them.
  const DISCARDED = [
    'sugar_g', 'cholesterol_mg',
    'iron_mg', 'magnesium_mg', 'calcium_mg', 'potassium_mg',
    'vitamin_a_iu', 'vitamin_c_mg', 'vitamin_d_iu', 'vitamin_b12_mcg',
  ];

  it.each(DISCARDED)('%s is dropped and never reaches the table', async (field) => {
    await createNutritionLog(FULL_FORM_ENTRY);
    expect(FULL_FORM_ENTRY).toHaveProperty(field);      // the form does send it
    expect(finalPayload()).not.toHaveProperty(field);   // the table never sees it
  });

  it('matches the list nutrition.create drops on purpose', () => {
    expect([...NOT_STORED].sort()).toEqual([...DISCARDED].sort());
  });

  it('drops exactly ten fields, no more and no fewer', async () => {
    await createNutritionLog(FULL_FORM_ENTRY);
    const sent = new Set(Object.keys(FULL_FORM_ENTRY));
    const landed = new Set(Object.keys(finalPayload()));
    // The five aliases are "lost" but their values survive under another
    // name, so they are excluded here — this counts genuine data loss only.
    const aliases = new Set(['protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg']);
    const lost = [...sent].filter((k) => !landed.has(k) && !aliases.has(k));
    expect(lost.sort()).toEqual([...DISCARDED].sort());
  });

  it('sends one insert, with nothing for the table to reject', async () => {
    await createNutritionLog(FULL_FORM_ENTRY);
    expect(insertAttempts.length).toBe(1);
  });
});

describe('a column the table lacks now fails the save', () => {
  // db.js used to strip an unknown column and retry, so the save "succeeded"
  // without it. That is how whole fields went missing unnoticed. Anything not
  // dropped on purpose in nutrition.create must now surface as an error.
  it('rejects a field nutrition.create does not know about', async () => {
    await expect(createNutritionLog({ ...FULL_FORM_ENTRY, water_oz: 8 }))
      .rejects.toMatchObject({ code: 'PGRST204' });
    expect(insertAttempts.length).toBe(1);
  });
});

describe('the water encoding is unaffected by any of this', () => {
  it('stores oz in food_name, not in a water_oz column', async () => {
    await createNutritionLog({
      date: '2026-08-11', food_name: 'Water|30', calories: 0,
      created_by: 'a@b.co', user_id: 'u-1',
    });
    const stored = finalPayload();
    expect(stored.food_name).toBe('Water|30');
    expect(stored).not.toHaveProperty('water_oz');
  });
});
