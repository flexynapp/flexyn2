// src/lib/data/foodItems.js
// Community food database — shared across all users.
// Records are created when a user scans a barcode Open Food Facts doesn't have.
// Any user who later scans the same barcode gets this record back.
// 
// BACKEND_CONTRACT note: This entity is NOT scoped to created_by on read.
// On migration, ensure the read path has no user-scoping filter.

import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';

const e = () => db.entities.FoodItem;

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

/**
 * Look up a barcode in the community database.
 * Returns the first matching record, or null if none.
 */
export const findByBarcode = async (barcode) => {
  if (!barcode) return null;
  try {
    const results = await e().filter({ barcode }, '-created_date', 1);
    return results?.[0] || null;
  } catch {
    return null;
  }
};

/**
 * Create a new community food entry.
 * @param {object} data — { barcode, name, serving_label, nutrition, vitamins }
 */
export const create = (data) => {
  assertNoTextProfanity({ name: data.name, brand: data.brand });
  return e().create(data);
};

/**
 * List recent community submissions — for admin/moderation use.
 */
export const listRecent = (limit = 50) =>
  e().filter({}, '-created_date', limit);

/**
 * This user's own scanner history — every food_items row they created by
 * scanning a barcode nothing else knew.
 *
 * One of the three sources behind "Search" in the Log Meal panel; the other
 * two are their saved recipes and their diary. Ranking and de-duplication
 * across all three live in `src/lib/foodSearch.js`.
 *
 * **Scoped to the caller on purpose.** The table itself is readable by
 * everybody (see the head note above) and that is still correct for the
 * barcode waterfall — a scan should find anyone's contribution. Search is a
 * different question: it autocompletes on every keystroke, so it answers
 * "what have *I* eaten", which is both the useful answer for a diary and the
 * one that cannot surface an unapproved entry somebody else typed.
 *
 * Opening this to the approved shared catalogue later means dropping the
 * `created_by` filter and adding `is_verified`; `foodSearch.js` already
 * carries a `source` per entry and needs no change.
 *
 * @param {string} email
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<object[]>} raw rows, unranked
 */
export const listMineForSearch = async (email, { limit = 200 } = {}) => {
  if (!email) return [];
  try {
    const { data, error } = await supabase
      .from('food_items')
      .select('*')
      .eq('created_by', email)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  } catch {
    // A failed fetch must render one empty source, never break the sheet —
    // the other two are independent and still have something to show.
    return [];
  }
};