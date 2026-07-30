// src/lib/data/quietHours.js
//
// Get/set the user's do-not-disturb push window. Backed by
// migration 098 — quiet_hours_start and quiet_hours_end on
// user_profiles. The push trigger (also updated in 098) reads
// these and short-circuits push delivery when in-window. The
// in-app notifications row STILL inserts — only push is muted.
//
// A window with start == end is treated as "no quiet hours".
// A wrapping window (start > end) is supported: e.g. 22 → 7
// = quiet from 22:00 through 06:59.

import { supabase } from '@/api/supabaseClient';
import { patchProfile } from '@/api/profileCache';
import { safeSelect } from '@/api/safeSelect';


/**
 * Returns { start, end } where each is 0-23 or null.
 */
export async function getMyQuietHours() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { start: null, end: null };
  const { data, error } = await safeSelect({
    columns: ['quiet_hours_start', 'quiet_hours_end'],
    build: (cols) => supabase
    .from('user_profiles')
    .select(cols)
    .eq('id', user.id)
    .maybeSingle(),
  });
  if (error || !data) return { start: null, end: null };
  return {
    start: data.quiet_hours_start ?? null,
    end:   data.quiet_hours_end ?? null,
  };
}

/**
 * Set the quiet-hours window. Pass nulls to clear (always-on).
 * Validates 0-23 range. Returns { ok, reason? }.
 */
export async function setMyQuietHours({ start, end }) {
  const validHour = (h) => h == null || (Number.isInteger(h) && h >= 0 && h <= 23);
  if (!validHour(start) || !validHour(end)) {
    return { ok: false, reason: 'invalid_hour' };
  }
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false, reason: 'unauthenticated' };

  const { error } = await supabase
    .from('user_profiles')
    .update({
      quiet_hours_start: start,
      quiet_hours_end:   end,
    })
    .eq('id', user.id);
  if (error) {
    console.warn('[quietHours] update failed:', error);
    return { ok: false, reason: 'db_error' };
  }
  patchProfile({ quiet_hours_start: start, quiet_hours_end: end });
  return { ok: true };
}

/** Format an hour 0-23 as 12-hour clock with am/pm. */
export function formatHour12(h) {
  if (h == null) return '';
  if (h === 0)  return '12am';
  if (h === 12) return '12pm';
  if (h < 12)   return `${h}am`;
  return `${h - 12}pm`;
}
