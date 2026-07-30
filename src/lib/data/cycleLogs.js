// src/lib/data/cycleLogs.js
//
// Owner-only CRUD for cycle_logs (migration 128). Strict opt-in —
// every UI caller must check user_profiles.cycle_tracking_enabled
// BEFORE mounting any cycle UI or invoking these helpers.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { db } from '@/api/db';


const TABLE = 'cycle_logs';

/** All period-start dates for the current user (ascending). */
export async function listMine(userId, limit = 24) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, start_date, notes, created_at')
    .eq('user_id', userId)
    .order('start_date', { ascending: true })
    .limit(limit);
  if (error) {
    if (error.code === '42P01') return [];
    return [];
  }
  return data ?? [];
}

/** Record a new period start. start_date is an ISO date (YYYY-MM-DD). */
export async function logStart({ userId, startDate, notes }) {
  if (!userId || !startDate) return { ok: false, error: 'missing' };
  const { error } = await supabase
    .from(TABLE)
    .insert({ user_id: userId, start_date: startDate, notes: notes || null });
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'DUPLICATE' };
    return { ok: false, error: error.message || 'db_error' };
  }
  return { ok: true };
}

/** Delete a cycle log row (only the owner can; enforced by RLS). */
export async function remove(id) {
  if (!id) return { ok: false };
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  return { ok: !error };
}

/** Enable/disable cycle tracking on user_profiles. */
export async function setEnabled(userId, enabled, cycleLengthDays) {
  if (!userId) return { ok: false };
  const patch = { cycle_tracking_enabled: !!enabled };
  if (cycleLengthDays != null) patch.cycle_length_days = Number(cycleLengthDays) || null;
  const { error } = await supabase
    .from('user_profiles')
    .update(patch)
    .eq('id', userId);
  // db.auth.me() serves a module-level cache and only re-reads the row when
  // that cache is empty, so invalidating the ['userProfile'] query alone does
  // NOT refresh this — react-query refetches and gets handed the same stale
  // object back. Tapping the X on the cycle card therefore wrote the column
  // correctly but left the card on screen until a full reload, which reads as
  // "the button is broken". patchCache is the documented fix for writers that
  // go through a raw update instead of db.auth.updateMe.
  if (!error) {
    try { db.auth.patchCache(patch); } catch { /* non-critical */ }
  }
  return { ok: !error };
}
