// The Log Meal write path: what the form collects vs what the table stores.
//
// The form sends sixteen nutrient fields. Five carry a unit suffix the table
// does not (protein_g -> protein and so on) and nutrition.create renames
// them. The other eleven are stored under their own names.
//
// History, because the inverted block below is the record of it: until
// 2026-09-27 ten of those fields (sugar, cholesterol, four minerals, four
// vitamins) had no column. db.js silently stripped them on every save, then
// nutrition.create dropped them by name, and the user got a success toast
// for data that was never kept. Migration 20260927174000 added the columns.
// These tests used to assert the loss; they now assert the fields persist.
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
  // Added by migration 20260927174000.
  'sugar_g', 'cholesterol_mg', 'iron_mg', 'magnesium_mg', 'calcium_mg',
  'potassium_mg', 'vitamin_a_iu', 'vitamin_c_mg', 'vitamin_d_iu', 'vitamin_b12_mcg',
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

import { create as createNutritionLog } from '@/lib/data/nutrition';

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

  it('saves a fully filled form', async () => {
    const row = await createNutritionLog(FULL_FORM_ENTRY);
    expect(row).toMatchObject({ id: 'row-1' });
  });
});

describe('the ten micronutrients are stored', () => {
  const STORED = [
    'sugar_g', 'cholesterol_mg',
    'iron_mg', 'magnesium_mg', 'calcium_mg', 'potassium_mg',
    'vitamin_a_iu', 'vitamin_c_mg', 'vitamin_d_iu', 'vitamin_b12_mcg',
  ];

  it.each(STORED)('%s reaches the table with the value the user typed', async (field) => {
    await createNutritionLog(FULL_FORM_ENTRY);
    expect(finalPayload()[field]).toBe(FULL_FORM_ENTRY[field]);
  });

  it('loses nothing: every field sent lands, apart from the five renamed aliases', async () => {
    await createNutritionLog(FULL_FORM_ENTRY);
    const landed = new Set(Object.keys(finalPayload()));
    const aliases = new Set(['protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sodium_mg']);
    const lost = Object.keys(FULL_FORM_ENTRY).filter((k) => !landed.has(k) && !aliases.has(k));
    expect(lost).toEqual([]);
  });

  it('sends one insert, with nothing for the table to reject', async () => {
    await createNutritionLog(FULL_FORM_ENTRY);
    expect(insertAttempts.length).toBe(1);
  });

  it('leaves a micronutrient the user did not fill in absent, not zero', async () => {
    const { iron_mg: _iron, ...rest } = FULL_FORM_ENTRY;
    await createNutritionLog(rest);
    expect(finalPayload()).not.toHaveProperty('iron_mg');
  });
});

describe('a column the table lacks now fails the save', () => {
  // db.js used to strip an unknown column and retry, so the save "succeeded"
  // without it. That is how whole fields went missing unnoticed. Anything not
  // the table has must surface as an error.
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
