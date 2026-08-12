// src/lib/data/foodItems.js
// Community food database — shared across all users.
// Records are created when a user scans a barcode Open Food Facts doesn't have.
// Any user who later scans the same barcode gets this record back.
//
// BACKEND_CONTRACT note: This entity is NOT scoped to created_by on read.
// On migration, ensure the read path has no user-scoping filter.
//
// ── WHAT "NOT SCOPED ON READ" ACTUALLY MEANS, MEASURED 2026-08-12 ─────────
//
// The line above is right but it is no longer the whole picture: the table
// carries THREE policies, not one, and they do different things.
//
//   owner full access          [ALL]    TO public         created_by/user_id
//   barcode community read     [SELECT] TO authenticated  barcode IS NOT NULL
//   verified items readable…   [SELECT] TO public         is_verified = true
//
// Both rows in production have a barcode, so in practice every signed-in user
// reads the whole table — verified as a real authenticated non-owner, who saw
// both rows AND the `created_by` email on them. That is what the barcode
// waterfall needs, and it is why `listMineForSearch` below does its scoping in
// the client rather than relying on the database.
//
// Two things fall out of it that a reader should know:
//   • `created_by` is an email address in a row every signed-in user can read.
//     `admin_purge_user_data` deliberately EXCLUDES `food_items` from its
//     email sweep, so a deleted account's address stays there.
//   • the third policy is `TO public`, and `anon` DOES hold SELECT on the
//     table. Logged-out reads fail today only because `anon` lacks EXECUTE on
//     `current_user_email()`, which the FIRST policy calls — so the whole
//     SELECT errors 42501 rather than returning the verified rows. CLAUDE.md:
//     depending on a missing GRANT is not a boundary. Nothing is exposed while
//     `is_verified` is 0 of 2; the migration in
//     docs/nutrition-food-database-audit.md scopes it before that changes.
//
// There is deliberately NO client writer here. A barcode miss files a
// `food_item_requests` row (see foodItemRequests.js) and an admin approval is
// what creates a `food_items` row. `create()` and `listRecent()` used to live
// in this file; the first was the direct-publish path migration 343 replaced
// and the second never had a caller. Both were removed on 2026-08-12 rather
// than left as an unused door back into the shared catalogue.

import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';

const e = () => db.entities.FoodItem;

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