// src/lib/foodLookup.js
//
// Barcode lookup waterfall:
//   1. Community FoodItem entity (user-submitted, checked first — instant, free)
//   2. Open Food Facts (~3M products, global, keyless public API — client-side fetch)
//
// There used to be a third tier, USDA FoodData Central, and the comment here
// claimed it was "proxied through base44/functions/usdaBarcodeLookup so the
// API key stays server-side". None of that was true by the time it was
// removed (Aug 2026 audit): db.functions.invoke is a local shim, there was no
// server, and it fetched api.nal.usda.gov straight from the browser with
// `api_key=DEMO_KEY` — USDA's public demo key, rate-limited to roughly 30
// requests an hour per IP. So the tier answered for the first few scans after
// an IP went quiet and 429'd the rest of the time, while the comment said the
// opposite.
//
// Dropped rather than fixed. Making it real means a USDA key in a deployed
// Edge Function, and the tier only ever added micronutrient depth on US
// branded foods that Open Food Facts already missed. If that depth is wanted
// later, add it back as an actual server-side proxy — and do NOT put an API
// key in this file.
//
// Returns a normalised product object or null if all sources miss.
// The caller is responsible for showing the "not found" UI when null is returned.

import { findByBarcode } from '@/lib/data/foodItems';
import { db } from '@/api/db';

// ── Normalised product shape ─────────────────────────────────────────────────
// {
//   barcode:      string,
//   name:         string,
//   servingLabel: string,
//   source:       'community' | 'openfoodfacts',
//   nutrition: {
//     calories, protein, carbs, fat, fiber, sugar, sodium, cholesterol (all numbers|null)
//   },
//   vitamins: {
//     calcium_mg, iron_mg, magnesium_mg, potassium_mg,
//     vitamin_a_iu, vitamin_c_mg, vitamin_d_iu, vitamin_b12_mcg (all numbers|null)
//   }
// }


// ── Open Food Facts ──────────────────────────────────────────────────────────
function parseServingGrams(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const gMatch = s.match(/(\d+(?:\.\d+)?)\s*g/i);
  if (gMatch) return parseFloat(gMatch[1]);
  const ozMatch = s.match(/(\d+(?:\.\d+)?)\s*oz/i);
  if (ozMatch) return Math.round(parseFloat(ozMatch[1]) * 28.3495);
  return null;
}

async function lookupOpenFoodFacts(barcode) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const json = await resp.json();
  if (json.status !== 1 || !json.product) return null;

  const p = json.product;
  const n = p.nutriments || {};

  const servingGrams = parseServingGrams(p.serving_size) ?? parseServingGrams(p.serving_quantity);
  const scale = servingGrams != null ? servingGrams / 100 : 1;

  const num = (v) => (typeof v === 'number' && !isNaN(v) ? v : null);

  const perServing = (key100, keyServing) => {
    const srv = num(n[keyServing]);
    if (srv != null) return srv;
    const per100 = num(n[key100]);
    if (per100 != null) return Math.round(per100 * scale * 10) / 10;
    return null;
  };

  let calories = num(n['energy-kcal_serving']);
  if (calories == null) {
    const kcal100 = num(n['energy-kcal_100g']);
    if (kcal100 != null) calories = Math.round(kcal100 * scale);
  }
  if (calories == null) {
    const kj = perServing('energy_100g', 'energy_serving');
    if (kj != null) calories = Math.round(kj / 4.184);
  }

  const sodiumG      = perServing('sodium_100g', 'sodium_serving');
  const cholesterolG = perServing('cholesterol_100g', 'cholesterol_serving');

  // Vitamins — OFF stores these under their own keys
  const vitA   = num(n['vitamin-a_serving'])   ?? (num(n['vitamin-a_100g'])   != null ? Math.round(num(n['vitamin-a_100g'])   * scale) : null);
  const vitC   = num(n['vitamin-c_serving'])   ?? (num(n['vitamin-c_100g'])   != null ? Math.round(num(n['vitamin-c_100g'])   * scale * 10) / 10 : null);
  const vitD   = num(n['vitamin-d_serving'])   ?? (num(n['vitamin-d_100g'])   != null ? Math.round(num(n['vitamin-d_100g'])   * scale * 10000) / 10 : null);
  const vitB12 = num(n['vitamin-b12_serving']) ?? (num(n['vitamin-b12_100g']) != null ? Math.round(num(n['vitamin-b12_100g']) * scale * 100000) / 100 : null);
  const calcium = perServing('calcium_100g', 'calcium_serving');
  const iron    = perServing('iron_100g', 'iron_serving');
  const potassium = perServing('potassium_100g', 'potassium_serving');
  const magnesium = perServing('magnesium_100g', 'magnesium_serving');

  const servingLabel = p.serving_size || (servingGrams ? `${servingGrams}g` : '100g');

  return {
    barcode,
    name: p.product_name || p.generic_name || p.brands || `Product ${barcode}`,
    servingLabel,
    source: 'openfoodfacts',
    nutrition: {
      calories,
      protein:     perServing('proteins_100g', 'proteins_serving'),
      carbs:       perServing('carbohydrates_100g', 'carbohydrates_serving'),
      fat:         perServing('fat_100g', 'fat_serving'),
      fiber:       perServing('fiber_100g', 'fiber_serving'),
      sugar:       perServing('sugars_100g', 'sugars_serving'),
      sodium:      sodiumG != null ? Math.round(sodiumG * 1000) : null,
      cholesterol: cholesterolG != null ? Math.round(cholesterolG * 1000) : null,
    },
    vitamins: {
      calcium_mg:      calcium != null ? Math.round(calcium * 1000) : null,
      iron_mg:         iron    != null ? Math.round(iron    * 1000) : null,
      magnesium_mg:    magnesium != null ? Math.round(magnesium * 1000) : null,
      potassium_mg:    potassium != null ? Math.round(potassium * 1000) : null,
      vitamin_a_iu:    vitA,
      vitamin_c_mg:    vitC,
      vitamin_d_iu:    vitD != null ? Math.round(vitD) : null,
      vitamin_b12_mcg: vitB12,
    },
  };
}

// ── Community FoodItem lookup ─────────────────────────────────────────────────

// Coerce a flat numeric column to number|null. PostgREST serializes
// `numeric` as a JSON number, but be tolerant of string payloads too.
function flatNum(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function lookupCommunity(barcode) {
  // Fetch a handful of candidates and pick the newest CLIENT-side.
  // Multiple users can submit the same barcode, and relying on a bare
  // '-created_date' order risks NULL-created_date legacy rows sorting
  // first (Postgres DESC puts NULLs first by default).
  let records = [];
  try {
    records = await db.entities.FoodItem.filter({ barcode }, '-created_date', 10);
  } catch {
    // Fall back to the single-row helper (it swallows its own errors).
    const one = await findByBarcode(barcode);
    records = one ? [one] : [];
  }
  if (!records.length) return null;
  const ts = (r) => Date.parse(r.created_date || r.created_at || '') || 0;
  const record = [...records].sort((a, b) => ts(b) - ts(a))[0];

  // Prefer the rich `nutrition` jsonb (community-barcode migration);
  // fall back per-field to the flat legacy columns from
  // 001_initial_schema (calories/protein/carbs/fat/fiber/sodium).
  // Rows written before the dual-shape fix may only have one or the
  // other populated — reading both ends the 0-calorie re-scan bug.
  const json = (record.nutrition && typeof record.nutrition === 'object') ? record.nutrition : {};
  const pick = (key) => json[key] ?? flatNum(record[key]);

  return {
    barcode: record.barcode,
    name: record.name,
    servingLabel: record.serving_label || '1 serving',
    source: 'community',
    nutrition: {
      calories:    pick('calories'),
      protein:     pick('protein'),
      carbs:       pick('carbs'),
      fat:         pick('fat'),
      fiber:       pick('fiber'),
      sodium:      pick('sodium'),
      sugar:       json.sugar       ?? null, // no flat column for these two
      cholesterol: json.cholesterol ?? null,
    },
    vitamins: (record.vitamins && typeof record.vitamins === 'object') ? record.vitamins : {},
    communityId: record.id,  // preserve so we can show attribution
  };
}

// ── Public waterfall ──────────────────────────────────────────────────────────
/**
 * Look up a barcode across all three sources in order:
 *   community → Open Food Facts
 *
 * Returns a normalised product object, or null if none found.
 * Errors in individual sources are swallowed — the next source is tried.
 */
export async function lookupBarcode(barcode) {
  if (!barcode?.trim()) return null;

  // 1. Community database — fastest, zero external calls
  try {
    const community = await lookupCommunity(barcode);
    if (community) return community;
  } catch { /* swallow */ }

  // 2. Open Food Facts — largest global coverage
  try {
    const off = await lookupOpenFoodFacts(barcode);
    if (off) return off;
  } catch { /* swallow */ }

  return null;
}