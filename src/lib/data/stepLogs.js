// src/lib/data/stepLogs.js
//
// Wraps the public.step_logs table (migration 162). One row per
// (user, date) — manual daily step count. Upserts on date so logging
// twice for the same day overwrites rather than duplicates. Mirrors
// sleepLogs.js / moodLogs.js.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';

import { format, subDays } from 'date-fns';
import { accountEmail } from '@/lib/guestIdentity';

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
  if (!user?.id) return { ok: false, reason: 'unauthenticated' };
  // Guest (anonymous) sessions have an EMPTY auth email while their profile
  // row carries guest_<uuid>@flexyn.guest (migration 172's trigger). This
  // table's user_email is NOT NULL, so the old `|| !user?.email` guard meant
  // every guest silently got { ok: false } here and NOTHING they logged
  // saved — sleep, mood and steps all refused, and Readiness went on
  // substituting a neutral estimate for signals the user had just entered.
  // Synthesize the same placeholder makeEntity() in api/db.js already uses,
  // so the identity layer stays consistent.
  const userEmail = accountEmail(user);

  const payload = {
    user_id:    user.id,
    user_email: userEmail,
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
  const { data, error } = await safeSelect({
    columns: ['date', 'steps', 'notes'],
    build: (cols) => supabase
      .from('step_logs')
      .select(cols)
      .eq('user_id', user.id)
      .gte('date', since)
      .order('date', { ascending: true }),
  });
  if (error) return [];
  return data ?? [];
}

/** Returns today's step log if logged, else null. */
export async function getTodayStepLog() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const { data, error } = await safeSelect({
    columns: ['date', 'steps', 'notes'],
    build: (cols) => supabase
      .from('step_logs')
      .select(cols)
      .eq('user_id', user.id)
      .eq('date', todayDateString())
      .maybeSingle(),
  });
  if (error) return null;
  return data ?? null;
}

/**
 * How many steps a save may credit to the daily steps quest.
 *
 * step_logs is an UPSERT, so correcting 3,000 to 5,000 is a second save of
 * the same day — crediting the absolute figure each time would count the
 * first 3,000 twice and walk a 5k quest to done off a 3k correction.
 *
 * The delta was computed against `today?.steps` alone, which is a
 * react-query snapshot: a correction made before the invalidate's refetch
 * lands still reads the OLD count, so the base is stale and those steps are
 * credited a second time — the exact double-count the delta exists to
 * prevent. Passing the caller's own synchronous record of what it has
 * already credited closes that window; the higher of the two always wins,
 * so neither a stale snapshot nor a stale ref can widen the delta.
 *
 * @param {number} next            the count being saved
 * @param {number} alreadyCredited what this session has already credited
 * @param {number} serverValue     the last count the server confirmed
 * @returns {{ delta: number, credited: number }} delta to award, and the
 *          new high-water mark for the caller to store.
 */
export function creditableStepDelta(next, alreadyCredited = 0, serverValue = 0) {
  const n = Number(next);
  if (!Number.isFinite(n) || n < 0) return { delta: 0, credited: Math.max(0, alreadyCredited || 0, serverValue || 0) };
  const base = Math.max(0, alreadyCredited || 0, serverValue || 0);
  // Revising a count DOWN credits nothing and does not lower the mark:
  // those steps were already awarded and cannot be taken back.
  return { delta: Math.max(0, n - base), credited: Math.max(base, n) };
}
