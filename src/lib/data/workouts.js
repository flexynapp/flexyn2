// src/lib/data/workouts.js
import { supabase } from '@/api/supabaseClient';
import { ownedRows } from './ownedRows';
import { containsProfanity } from '@/lib/profanityFilter';

const rows = ownedRows('workout_logs');

/** List the current user's workout logs, newest first. */
export const list = (userId, limit = 50) =>
  rows.filter({ user_id: userId }, '-date', limit);

/** The current user's workout logs on one calendar day (yyyy-MM-dd). */
export const listForDate = (userId, date, limit = 50) =>
  rows.filter({ user_id: userId, date }, '-date', limit);

/**
 * Just the `date` of each log on or after `since` (yyyy-MM-dd). For callers
 * that count sessions rather than show them: the nutrition target only needs
 * how many days had training in the last 30, and used to fetch up to 1,000
 * full rows (exercises JSONB included) to learn it.
 */
export async function listDatesSince(userId, since) {
  const { data, error } = await supabase
    .from('workout_logs')
    .select('date')
    .eq('user_id', userId)
    .gte('date', since)
    .order('date', { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data ?? [];
}

/** Fetch a workout log by id. */
export const get = (id) =>
  rows.get(id);

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

/**
 * Create a new workout log. Returns the saved record.
 *
 * A retried save carries the same `idempotency_key` as the attempt that may
 * already have landed (mig 142, audit C-2). When the unique index refuses
 * it, the row that landed is returned marked `__duplicate: true`, so the
 * save screen treats it as saved and skips XP, volume and streak credits.
 */
export const create = (data) => {
  assertNoTextProfanity({ notes: data.notes });
  return rows.create(data).catch(async (error) => {
    const existing = await findSavedDuplicate(error, data.idempotency_key);
    if (existing) return existing;
    throw error;
  });
};

async function findSavedDuplicate(error, idempotencyKey) {
  if (error?.code !== '23505' || !idempotencyKey) return null;
  const isIdempotencyConflict = /idempotency/i.test(error.message || '')
    || error.constraint === 'workout_logs_idempotency_idx';
  if (!isIdempotencyConflict) return null;
  const { data: { session } } = await supabase.auth.getSession()
    .catch(() => ({ data: { session: null } }));
  const userId = session?.user?.id;
  if (!userId) return null;
  const { data: existing, error: fetchErr } = await supabase
    .from('workout_logs')
    .select('*')
    .eq('user_id', userId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (fetchErr || !existing) return null;
  return { ...existing, __duplicate: true };
}

/** Update a workout log by id. */
export const update = (id, data) => {
  if (data.notes !== undefined) assertNoTextProfanity({ notes: data.notes });
  return rows.update(id, data);
};

/** Delete a workout log by id. */
export const remove = (id) =>
  rows.remove(id);

/**
 * Best-effort: reconcile any recent workout_logs that landed on the
 * server but never had increment_user_volume applied (e.g. the network
 * died between INSERT and the credit RPC). Audit D-4.
 *
 * Fail-closed on pre-mig-142 hosts so the Dashboard mount doesn't
 * thrash retry-loops on environments where the RPC isn't deployed.
 */
export const reconcileMyVolume = async () => {
  const { data, error } = await supabase.rpc('reconcile_my_workout_volume');
  if (error) {
    if (error.code === '42883' || error.code === '42P01') return { ok: false, reason: 'PIPELINE_MISSING' };
    return { ok: false, error: error.message };
  }
  return { ok: true, reconciled: data?.reconciled ?? 0, delta: Number(data?.delta || 0) };
};
