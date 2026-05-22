// src/lib/data/sleepLogs.js
//
// Wraps the public.sleep_logs table (migration 095). One row per
// (user, date) — last night's sleep. Upserts on date so logging
// twice for the same day overwrites rather than duplicates.
//
// Sleep dates are stored as the MORNING the user logs them — i.e.,
// "Tuesday morning's sleep log" represents Monday night → Tuesday
// morning. Consistent with how Garmin / Whoop / Oura present it.

import { supabase } from '@/api/supabaseClient';
import { format, subDays } from 'date-fns';

const todayDateString = () => format(new Date(), 'yyyy-MM-dd');

/**
 * Upsert today's sleep log. Replaces any existing row for the same
 * (user, date) — the UNIQUE constraint handles that atomically.
 *
 * @param {object} fields
 * @param {number} fields.hours    required; 0-24, decimal allowed
 * @param {number} [fields.quality]  optional; 1-5
 * @param {number} [fields.soreness] optional; 1-5
 * @param {string} [fields.notes]    optional
 */
export async function upsertSleepLog({ hours, quality, soreness, notes }) {
  if (typeof hours !== 'number' || hours < 0 || hours > 24) {
    return { ok: false, reason: 'invalid_hours' };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id || !user?.email) return { ok: false, reason: 'unauthenticated' };

  const payload = {
    user_id:    user.id,
    user_email: user.email,
    date:       todayDateString(),
    hours,
    updated_at: new Date().toISOString(),
  };
  if (quality != null)  payload.quality = Math.max(1, Math.min(5, Math.round(quality)));
  if (soreness != null) payload.soreness = Math.max(1, Math.min(5, Math.round(soreness)));
  if (typeof notes === 'string') payload.notes = notes.slice(0, 280);

  const { error } = await supabase
    .from('sleep_logs')
    .upsert(payload, { onConflict: 'user_id,date' });
  if (error) {
    console.warn('[sleepLogs] upsert failed:', error);
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true };
}

/**
 * Returns the last N days of sleep logs for the current user, oldest
 * first so chart-style consumers can plot them directly.
 */
export async function listRecentSleepLogs(days = 14) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return [];
  const since = format(subDays(new Date(), days), 'yyyy-MM-dd');
  const { data, error } = await supabase
    .from('sleep_logs')
    .select('date, hours, quality, soreness, notes')
    .eq('user_id', user.id)
    .gte('date', since)
    .order('date', { ascending: true });
  if (error) return [];
  return data ?? [];
}

/** Returns today's sleep log if logged, else null. */
export async function getTodaySleepLog() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const { data, error } = await supabase
    .from('sleep_logs')
    .select('date, hours, quality, soreness, notes')
    .eq('user_id', user.id)
    .eq('date', todayDateString())
    .maybeSingle();
  if (error) return null;
  return data ?? null;
}
