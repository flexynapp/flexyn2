// src/lib/data/foodItemRequests.js
//
// "Request this item" — what a barcode miss files instead of writing straight
// into the shared catalogue.
//
// Wired exactly like Report a Bug (`fileBugReport` in hubReports.js): a plain
// authenticated insert into a queue table, read back by an admin through a
// SECURITY DEFINER RPC at /admin/reports. Migration 342 has the schema and
// the reasoning.
//
// WHAT THIS DOES NOT DO: it does not email anyone. Neither does Report a Bug
// — `bug_reports` has no trigger and nothing in the database references a
// support address. Both are in-app queues. If requests should reach an inbox,
// that is an Edge Function plus a mail provider, and it is not built.

import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';

/**
 * File a request for a food the catalogue does not have.
 *
 * @param {object} data
 * @param {string} data.name           what the user says it is (required)
 * @param {string} [data.brand]
 * @param {string} [data.barcode]      the code that missed, if this came from a scan
 * @param {string} [data.servingLabel]
 * @param {object} [data.nutrition]    { calories, protein, carbs, fat, fiber, sugar, sodium, cholesterol }
 * @param {object} [data.vitamins]
 * @param {string} [data.note]         anything else the user wants to tell the reviewer
 * @param {{ email?: string, id?: string }} [data.user]
 */
export async function requestFoodItem(data = {}) {
  const name = String(data.name || '').trim();
  if (!name) {
    throw Object.assign(new Error('Food name is required'), { code: 'NO_NAME' });
  }
  // Same guard the two existing writers use. A queue an admin reads is still
  // a place a slur can be typed, and it is cheaper to refuse it here.
  for (const [field, val] of Object.entries({ name, brand: data.brand, note: data.note })) {
    if (typeof val === 'string' && val && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in "${field}"`), { code: 'PROFANITY', field });
    }
  }

  const { error } = await supabase.from('food_item_requests').insert({
    requester_email:   data.user?.email || null,
    // The INSERT policy checks `requester_user_id = auth.uid()`, so this is
    // not decoration — omit it and the write is rejected by RLS.
    requester_user_id: data.user?.id || null,
    name,
    brand:         data.brand?.trim() || null,
    barcode:       data.barcode || null,
    serving_label: data.servingLabel?.trim() || null,
    nutrition:     data.nutrition || null,
    vitamins:      data.vitamins || null,
    note:          data.note?.trim() || null,
  });

  if (error) {
    // 23505 on the partial unique index means somebody already asked for this
    // barcode and it is still pending. That is a success from where the user
    // is standing — the thing they wanted to happen is already happening.
    if (error.code === '23505') return { ok: true, alreadyQueued: true };
    throw error;
  }
  return { ok: true, alreadyQueued: false };
}

/**
 * This user's own requests, so the scan sheet can say "you already asked for
 * this" rather than offering the button again.
 */
export async function listMyRequests({ limit = 50 } = {}) {
  try {
    const { data, error } = await supabase
      .from('food_item_requests')
      .select('id, barcode, name, status, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  } catch {
    return [];
  }
}
