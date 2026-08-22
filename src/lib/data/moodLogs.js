// src/lib/data/moodLogs.js
//
// Wraps the public.mood_logs table (migration 096). Daily emoji-tier
// log. One row per (user, date) via UNIQUE constraint — upsert
// pattern matches sleepLogs.js.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import { format, subDays } from 'date-fns';
import { accountEmail } from '@/lib/guestIdentity';

const todayDateString = () => format(new Date(), 'yyyy-MM-dd');

export const MOOD_EMOJIS = ['😩', '😐', '🙂', '😄', '🔥'];
export const MOOD_LABELS = ['Awful', 'Meh', 'Okay', 'Good', 'On fire'];

/**
 * Upsert a day's mood. mood is 1-5 (matches MOOD_EMOJIS index + 1).
 *
 * `date` defaults to today, which is every caller except My Journal — it
 * lets you edit a day inside its 7-day window, and without a date here
 * that window would have meant "edit yesterday's words but not
 * yesterday's mood". Guarded rather than trusted: a malformed string or a
 * future date is refused instead of silently writing to today, because a
 * mood attributed to the wrong day is worse than one that failed to save.
 */
export async function upsertMoodLog({ mood, notes, date } = {}) {
  if (typeof mood !== 'number' || mood < 1 || mood > 5) {
    return { ok: false, reason: 'invalid_mood' };
  }
  const today = todayDateString();
  if (date != null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today)) {
    return { ok: false, reason: 'invalid_date' };
  }
  const entryDate = date || today;
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
    date:       entryDate,
    mood:       Math.round(mood),
    updated_at: new Date().toISOString(),
  };
  if (typeof notes === 'string') payload.notes = notes.slice(0, 280);

  const { error } = await supabase
    .from('mood_logs')
    .upsert(payload, { onConflict: 'user_id,date' });
  if (error) {
    console.warn('[moodLogs] upsert failed:', error);
    return { ok: false, reason: 'db_error' };
  }
  return { ok: true };
}

/** Returns today's mood log or null. */
export async function getTodayMoodLog() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const { data, error } = await safeSelect({
    columns: ['date', 'mood', 'notes'],
    build: (cols) => supabase
      .from('mood_logs')
      .select(cols)
      .eq('user_id', user.id)
      .eq('date', todayDateString())
      .maybeSingle(),
  });
  if (error) return null;
  return data ?? null;
}

/** Returns the last N days of mood logs (oldest first). */
export async function listRecentMoodLogs(days = 30) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return [];
  const since = format(subDays(new Date(), days), 'yyyy-MM-dd');
  const { data, error } = await safeSelect({
    columns: ['date', 'mood', 'notes'],
    build: (cols) => supabase
      .from('mood_logs')
      .select(cols)
      .eq('user_id', user.id)
      .gte('date', since)
      .order('date', { ascending: true }),
  });
  if (error) return [];
  return data ?? [];
}
