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

/** A recipe's own serving count, floored at 1 so nothing divides by zero. */
export function servingsOf(recipe) {
  const s = Number(recipe?.servings);
  return s > 0 ? s : 1;
}

// Which recipe-level micro keys the diary actually has a column for.
//
// vitamin_a_mcg and vitamin_d_mcg are DELIBERATELY absent: nutrition_logs
// stores those two in IU (vitamin_a_iu / vitamin_d_iu), and the mcg→IU factor
// depends on the form of the vitamin (retinol vs beta-carotene, D2 vs D3).
// Guessing one would write a confidently wrong number into someone's diary,
// so those micros stay on the recipe and are simply not carried to the log.
const MICRO_TO_LOG_COLUMN = {
  fiber_g:         'fiber_g',
  sugar_g:         'sugar_g',
  sodium_mg:       'sodium_mg',
  cholesterol_mg:  'cholesterol_mg',
  potassium_mg:    'potassium_mg',
  calcium_mg:      'calcium_mg',
  iron_mg:         'iron_mg',
  magnesium_mg:    'magnesium_mg',
  vitamin_c_mg:    'vitamin_c_mg',
  vitamin_b12_mcg: 'vitamin_b12_mcg',
};

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/**
 * The diary row a recipe produces when it is logged. Pure — the caller owns
 * the write, so this stays testable and the Nutrition page's existing save
 * mutation (quests, XP, first-meal celebration, cache invalidation) remains
 * the ONLY path a nutrition_logs row is created on.
 *
 * `servings` is how many of the recipe's own servings are being eaten, so
 * every figure is (whole recipe ÷ recipe.servings) × servings.
 */
export function recipeLogPayload({ recipe, servings = 1, mealType, date }) {
  const n = Number(servings) > 0 ? Number(servings) : 1;
  const per = perServing(recipe?.totals || {}, servingsOf(recipe));
  const eaten = (v) => round1((Number(v) || 0) * n);

  const row = {
    date,
    meal_type:      mealType || 'snack',
    food_name:      recipe?.name?.trim() || 'Recipe',
    // nutrition_logs.servings defaults to 1 and nothing in the app reads it
    // today. Write the real count anyway: a stored 1 against a 4-serving log
    // is a wrong number waiting for its first reader, which is exactly the
    // shape CLAUDE.md documents for this schema's other dead columns.
    servings:       n,
    calories:       Math.round((Number(per.calories) || 0) * n),
    protein_g:      eaten(per.protein_g),
    carbs_g:        eaten(per.carbs_g),
    fat_g:          eaten(per.fat_g),
    fiber_g:        eaten(per.fiber_g),
    sugar_g:        eaten(per.sugar_g),
    sodium_mg:      eaten(per.sodium_mg),
    cholesterol_mg: eaten(per.cholesterol_mg),
    image_url:      recipe?.image_url || null,
  };

  // Recipe-level micros are entered for the WHOLE recipe, same as the
  // ingredient totals. Where one names a nutrient the ingredient rows also
  // carry (fiber, sugar, sodium, cholesterol) it OVERRIDES rather than adds —
  // the user typed it at recipe level precisely because it is the real figure.
  const recipeServings = servingsOf(recipe);
  for (const m of normalizeMicros(recipe?.micros)) {
    const col = MICRO_TO_LOG_COLUMN[m.key];
    if (col) row[col] = round1((m.amount / recipeServings) * n);
  }
  return row;
}

/**
 * Seed the builder from a meal already in the diary — the "from a meal you
 * logged" route on the empty state. The log becomes a single one-serving
 * ingredient the user can then break apart, which is the point: it is faster
 * to split a known 620-cal plate than to type six rows from nothing.
 */
export function recipeFromLog(log) {
  if (!log) return null;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n !== 0 ? n : ''; };
  const name = (log.food_name || '').trim();
  return {
    name,
    servings: 1,
    image_url: log.image_url || null,
    directions: '',
    micros: [],
    ingredients: [{
      name:      name || 'Ingredient',
      amount:    1,
      unit:      'serving',
      grams:     1,
      calories:  num(log.calories),
      protein_g: num(log.protein_g ?? log.protein),
      carbs_g:   num(log.carbs_g   ?? log.carbs),
      fat_g:     num(log.fat_g     ?? log.fat),
      fiber_g:   num(log.fiber_g   ?? log.fiber),
    }],
  };
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

/**
 * Every column a client is allowed to READ — i.e. all of them except
 * `user_email`. Use this everywhere instead of `select('*')`.
 *
 * `*` was a privacy hole rather than a style problem. RLS on this table is
 * row-level, and mig 227 added a policy letting any authenticated user read
 * a PUBLISHED recipe — so `select('*')` handed the author's real email
 * address to every user who opened Discover, including anonymous guests.
 * Migration 227's own comment says the opposite ("author_username … so
 * Discover never has to expose user_email"); the intent was written down and
 * never enforced. Verified against production, as a second real user, that
 * `select *` returned the owner's email.
 *
 * The database is the actual boundary — the companion migration revokes
 * table-level SELECT and re-grants it column by column, so a hand-rolled
 * `select=user_email` gets 42501 rather than a row. This constant is what
 * keeps the client's queries inside that grant, so it must stay in sync with
 * it: adding a column here without adding it to the GRANT breaks every read.
 */
export const RECIPE_COLUMNS = [
  'id', 'user_id', 'name', 'servings', 'ingredients', 'totals',
  'created_at', 'updated_at', 'directions', 'micros',
  'is_public', 'author_username', 'published_at', 'image_url',
].join(',');

export async function listMine(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('nutrition_recipes')
    .select(RECIPE_COLUMNS)
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });
  if (error) return [];
  return data ?? [];
}

/** Public "Discover" feed — every user's published recipes, newest first. */
export async function listPublic({ excludeUserId = null, limit = 60 } = {}) {
  let q = supabase
    .from('nutrition_recipes')
    .select(RECIPE_COLUMNS)
    .eq('is_public', true)
    // nullsFirst: Postgres sorts NULLs FIRST on a DESC order, so a published
    // row with no timestamp would pin itself to the top of Discover forever.
    .order('published_at', { ascending: false, nullsFirst: false })
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
    (payload) => supabase.from('nutrition_recipes').upsert(payload, { onConflict: 'id' }).select(RECIPE_COLUMNS).maybeSingle(),
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
    (payload) => supabase.from('nutrition_recipes').update(payload).eq('id', id).select(RECIPE_COLUMNS).maybeSingle(),
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
    (payload) => supabase.from('nutrition_recipes').insert(payload).select(RECIPE_COLUMNS).maybeSingle(),
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
