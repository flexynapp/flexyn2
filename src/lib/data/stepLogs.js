// src/lib/data/stepLogs.js
//
// Wraps the public.step_logs table (migration 162). One row per
// (user, date) — manual daily step count. Upserts on date so logging
// twice for the same day overwrites rather than duplicates. Mirrors
// sleepLogs.js / moodLogs.js.

import { supabase } from '@/api/supabaseClient';
import { format, subDays } from 'date-fns';

const todayDateString = () => format(new Date(), 'yyyy-MM-dd');
const MAX_STEPS = 200000; // sane ceiling; matches the DB CHECK constraint

/**
 * Upsert today's step count. Replaces any existing row for the same
 * (user, date) — the UNIQUE constraint handles that atomically.
 *
 * @param {object} fields
 * @param {number} fields.steps  required; 0 - 200000 integer
 * @param {string} [fields.notes] optional
 */
export async function upsertStepLog({ steps, notes }) {
  const n = Math.round(Number(steps));
  if (!Number.isFinite(n) || n < 0 || n > MAX_STEPS) {
    return { ok: false, reason: 'invalid_steps' };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id || !user?.email) return { ok: false, reason: 'unauthenticated' };

  const payload = {
    user_id:    user.id,
    user_email: user.email,
    date:       todayDateString(),
    steps:      n,
    updated_at: new Date().toISOString(),
  };
  if (typeof notes === 'string') payload.notes = notes.slice(0, 280);

  const { error } = await supabase
    .from('step_logs')
    .upsert(payload, { onConflict: 'user_id,date' });
  if (error) {
    console.warn('[stepLogs] upsert failed:', error);
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true };
}

/**
 * Last N days of step logs for the current user, oldest first so a
 * chart can plot them directly (parity with listRecentSleepLogs).
 */
export async function listRecentStepLogs(days = 14) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return [];
  const since = format(subDays(new Date(), days), 'yyyy-MM-dd');
  const { data, error } = await supabase
    .from('step_logs')
    .select('date, steps, notes')
    .eq('user_id', user.id)
    .gte('date', since)
    .order('date', { ascending: true });
  if (error) return [];
  return data ?? [];
}

/** Returns today's step log if logged, else null. */
export async function getTodayStepLog() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const { data, error } = await supabase
    .from('step_logs')
    .select('date, steps, notes')
    .eq('user_id', user.id)
    .eq('date', todayDateString())
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}
