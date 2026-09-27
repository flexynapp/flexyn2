// src/lib/data/workouts.js
import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';

/** List the current user's workout logs, newest first. */
export const list = (userId, limit = 50) =>
  db.entities.WorkoutLog.filter({ user_id: userId }, '-date', limit);

/** The current user's workout logs on one calendar day (yyyy-MM-dd). */
export const listForDate = (userId, date, limit = 50) =>
  db.entities.WorkoutLog.filter({ user_id: userId, date }, '-date', limit);

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
  db.entities.WorkoutLog.get(id);

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

/** Create a new workout log. Returns the saved record. */
export const create = (data) => {
  assertNoTextProfanity({ notes: data.notes });
  return db.entities.WorkoutLog.create(data);
};

/** Update a workout log by id. */
export const update = (id, data) => {
  if (data.notes !== undefined) assertNoTextProfanity({ notes: data.notes });
  return db.entities.WorkoutLog.update(id, data);
};

/** Delete a workout log by id. */
export const remove = (id) =>
  db.entities.WorkoutLog.delete(id);

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
