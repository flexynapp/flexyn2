// src/lib/data/foodItems.js
// Community food database — shared across all users.
// Records are created when a user scans a barcode not found in OFF or USDA.
// Any user who later scans the same barcode gets this record back.
// 
// BACKEND_CONTRACT note: This entity is NOT scoped to created_by on read.
// On migration, ensure the read path has no user-scoping filter.

import { db } from '@/api/db';
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