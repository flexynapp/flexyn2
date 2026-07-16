// src/lib/data/nutritionRecipes.js
//
// CRUD wrapper for user-built recipes (mig 123 + 227). A "recipe" is a
// multi-ingredient meal saved once and loggable in one tap —
// "my chicken rice bowl" = 1 row vs 3 entries every time the user eats
// it. As of mig 227 recipes also carry prep directions, an open-ended
// list of custom nutrients (vitamins/minerals/anything), and can be
// published to a community "Discover" feed.

import { supabase } from '@/api/supabaseClient';

// Per-ingredient measurement units. Stored on each ingredient object so a
// user can mix grams for rice and cups for milk in the same recipe. `value`
// is what we persist; `label` is what the picker shows.
export const INGREDIENT_UNITS = [
  { value: 'g',       label: 'g' },
  { value: 'oz',      label: 'oz' },
  { value: 'ml',      label: 'ml' },
  { value: 'cup',     label: 'cup' },
  { value: 'tbsp',    label: 'tbsp' },
  { value: 'tsp',     label: 'tsp' },
  { value: 'piece',   label: 'piece' },
  { value: 'slice',   label: 'slice' },
  { value: 'serving', label: 'serving' },
];
const UNIT_VALUES = new Set(INGREDIENT_UNITS.map(u => u.value));
export const DEFAULT_UNIT = 'g';

// Quick-add presets for the recipe-level "More nutrients" section. Covers
// the common macro-adjacent values plus the headline vitamins & minerals.
// `unit` is the default unit; users can still change it, and add a fully
// custom nutrient with any name/unit of their own.
export const MICRO_PRESETS = [
  { key: 'fiber_g',        label: 'Fiber',       unit: 'g'   },
  { key: 'sugar_g',        label: 'Sugar',       unit: 'g'   },
  { key: 'sodium_mg',      label: 'Sodium',      unit: 'mg'  },
  { key: 'cholesterol_mg', label: 'Cholesterol', unit: 'mg'  },
  { key: 'sat_fat_g',      label: 'Sat. Fat',    unit: 'g'   },
  { key: 'potassium_mg',   label: 'Potassium',   unit: 'mg'  },
  { key: 'calcium_mg',     label: 'Calcium',     unit: 'mg'  },
  { key: 'iron_mg',        label: 'Iron',        unit: 'mg'  },
  { key: 'vitamin_a_mcg',  label: 'Vitamin A',   unit: 'mcg' },
  { key: 'vitamin_c_mg',   label: 'Vitamin C',   unit: 'mg'  },
  { key: 'vitamin_d_mcg',  label: 'Vitamin D',   unit: 'mcg' },
  { key: 'vitamin_b12_mcg',label: 'Vitamin B12', unit: 'mcg' },
  { key: 'magnesium_mg',   label: 'Magnesium',   unit: 'mg'  },
  { key: 'zinc_mg',        label: 'Zinc',        unit: 'mg'  },
];
// Units offered for a custom nutrient amount.
export const MICRO_UNITS = ['g', 'mg', 'mcg', 'IU', '%DV'];

/** Coerce a stored/edited unit to a known value, defaulting to grams. */
export function normalizeUnit(unit) {
  return UNIT_VALUES.has(unit) ? unit : DEFAULT_UNIT;
}

/**
 * Clean a recipe-level micro list down to persistable rows: a label and a
 * finite amount are required; unit falls back to a plain empty string.
 * Pure — safe to unit-test and to run on both save and render.
 */
export function normalizeMicros(micros = []) {
  if (!Array.isArray(micros)) return [];
  return micros
    .map(m => ({
      key:    (m?.key || '').toString().trim() || slugifyMicro(m?.label),
      label:  (m?.label || '').toString().trim(),
      // Blank/absent amount is "unfilled" → NaN → dropped below. Number('')
      // is 0, which would otherwise persist an empty nutrient row.
      amount: (m?.amount === '' || m?.amount == null) ? NaN : Number(m.amount),
      unit:   (m?.unit || '').toString().trim(),
    }))
    .filter(m => m.label && Number.isFinite(m.amount));
}

function slugifyMicro(label) {
  return (label || '')
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'nutrient';
}

/** Sum macros across the ingredients array. Stored in totals JSONB. */
export function sumIngredients(ingredients = []) {
  return ingredients.reduce(
    (acc, i) => ({
      calories:       acc.calories       + (Number(i.calories)       || 0),
      protein_g:      acc.protein_g      + (Number(i.protein_g)      || 0),
      carbs_g:        acc.carbs_g        + (Number(i.carbs_g)        || 0),
      fat_g:          acc.fat_g          + (Number(i.fat_g)          || 0),
      fiber_g:        acc.fiber_g        + (Number(i.fiber_g)        || 0),
      sugar_g:        acc.sugar_g        + (Number(i.sugar_g)        || 0),
      sodium_mg:      acc.sodium_mg      + (Number(i.sodium_mg)      || 0),
      cholesterol_mg: acc.cholesterol_mg + (Number(i.cholesterol_mg) || 0),
    }),
    {
      calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0,
      fiber_g: 0, sugar_g: 0, sodium_mg: 0, cholesterol_mg: 0,
    }
  );
}

/** Per-serving macros — divides totals by servings (default 1). */
export function perServing(totals, servings) {
  const s = Number(servings) > 0 ? Number(servings) : 1;
  const out = {};
  for (const k of Object.keys(totals || {})) {
    out[k] = (Number(totals[k]) || 0) / s;
  }
  return out;
}

// Strip-and-retry wrapper, mirroring db.js create()/update(). If a write
// references a column the deployed schema doesn't have yet (mig 227 not
// applied on this host), drop that column and retry — so recipes still
// save in the window between the frontend deploy and the SQL run. New
// columns (directions/micros/is_public/…) degrade away; the core recipe
// still persists.
async function writeWithColumnRetry(run, row, safeKeys) {
  const payload = { ...row };
  for (let attempt = 0; attempt < 10; attempt++) {
    const { data, error } = await run(payload);
    if (!error) return data;
    let col = null;
    if (error.code === '42703') col = error.message?.match(/column "([^"]+)"/)?.[1];
    else if (error.code === 'PGRST204') {
      col = error.message?.match(/the '([^']+)' column/)?.[1]
         || error.message?.match(/'([^']+)' column/)?.[1];
    }
    if (col && col in payload && !safeKeys.has(col)) {
      delete payload[col];
      continue;
    }
    throw error;
  }
  throw new Error('nutrition_recipes write failed after stripping unknown columns');
}

// Columns that predate mig 227 and must never be stripped.
const CORE_RECIPE_COLS = new Set(['id', 'user_id', 'user_email', 'name', 'servings', 'ingredients', 'totals']);

export async function listMine(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('nutrition_recipes')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) return [];
  return data ?? [];
}

/** Public "Discover" feed — every user's published recipes, newest first. */
export async function listPublic({ excludeUserId = null, limit = 60 } = {}) {
  let q = supabase
    .from('nutrition_recipes')
    .select('*')
    .eq('is_public', true)
    .order('published_at', { ascending: false })
    .limit(limit);
  if (excludeUserId) q = q.neq('user_id', excludeUserId);
  const { data, error } = await q;
  if (error) return [];
  return data ?? [];
}

export async function upsert({ id, user, name, servings, ingredients, directions, micros, imageUrl }) {
  if (!user?.id || !name?.trim()) throw new Error('user + name required');
  const totals = sumIngredients(ingredients);
  const row = {
    user_id:     user.id,
    user_email:  user.email,
    name:        name.trim(),
    servings:    Number(servings) || 1,
    ingredients,
    totals,
    directions:  directions?.trim() || null,
    micros:      normalizeMicros(micros),
    image_url:   imageUrl || null,
    updated_at:  new Date().toISOString(),
  };
  if (id) row.id = id;
  return writeWithColumnRetry(
    (payload) => supabase.from('nutrition_recipes').upsert(payload, { onConflict: 'id' }).select().maybeSingle(),
    row,
    CORE_RECIPE_COLS,
  );
}

/**
 * Publish or unpublish a recipe to the Discover feed. Owner-only (RLS).
 * On publish we stamp the author's display name + publish time; on
 * unpublish we clear the timestamp so it drops out of the feed ordering.
 */
export async function setPublished({ id, isPublic, authorUsername }) {
  if (!id) throw new Error('id required');
  const patch = {
    is_public:       !!isPublic,
    published_at:    isPublic ? new Date().toISOString() : null,
    author_username: isPublic ? (authorUsername || null) : null,
    updated_at:      new Date().toISOString(),
  };
  return writeWithColumnRetry(
    (payload) => supabase.from('nutrition_recipes').update(payload).eq('id', id).select().maybeSingle(),
    patch,
    CORE_RECIPE_COLS,
  );
}

/**
 * Clone a discovered recipe into the current user's own saved list. The
 * copy is private (is_public false) and owned by the saver, so they can
 * freely edit or log it. The original is untouched.
 */
export async function saveCopy({ user, recipe }) {
  if (!user?.id || !recipe) throw new Error('user + recipe required');
  const row = {
    user_id:     user.id,
    user_email:  user.email,
    name:        recipe.name,
    servings:    Number(recipe.servings) || 1,
    ingredients: recipe.ingredients ?? [],
    totals:      recipe.totals ?? sumIngredients(recipe.ingredients ?? []),
    directions:  recipe.directions ?? null,
    micros:      normalizeMicros(recipe.micros),
    image_url:   recipe.image_url ?? null,
    is_public:   false,
    author_username: null,
    published_at:    null,
    updated_at:  new Date().toISOString(),
  };
  return writeWithColumnRetry(
    (payload) => supabase.from('nutrition_recipes').insert(payload).select().maybeSingle(),
    row,
    CORE_RECIPE_COLS,
  );
}

export async function remove(id) {
  if (!id) throw new Error('id required');
  const { error } = await supabase
    .from('nutrition_recipes')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
