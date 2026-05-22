// src/lib/data/activity.js
//
// Live activity presence helpers (migration 088). Wraps the three RPCs:
//   • markActive(durationMinutes) — set user_profiles.active_until to
//     now() + duration. Cap is enforced server-side at 240 minutes.
//   • clearActive() — explicit clear when workout saves / is cancelled.
//   • getActiveFollowees() — list of currently-active followees for
//     the green-dot indicator on the Hub follow list.
//
// All three gracefully no-op on pre-088 hosts (42883 / 42P01) so the
// "live activity" UX degrades to "no presence indicator" rather than
// breaking the workout save flow.

import { supabase } from '@/api/supabaseClient';

/**
 * Mark the current user as actively working out for `durationMinutes`.
 * Returns the new active_until timestamp (string) or null on failure.
 * Fire-and-forget at call sites — the workout flow shouldn't block
 * on this.
 */
export async function markActive(durationMinutes = 90) {
  try {
    const { data, error } = await supabase.rpc('mark_workout_active', {
      p_duration_minutes: durationMinutes,
    });
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return null;
      console.warn('[activity] mark_workout_active failed:', error);
      return null;
    }
    return data ?? null;
  } catch (err) {
    console.warn('[activity] markActive threw:', err?.message || err);
    return null;
  }
}

/** Clear the active flag (e.g. after a workout saves). Idempotent. */
export async function clearActive() {
  try {
    const { error } = await supabase.rpc('clear_workout_active');
    if (error && error.code !== '42883' && error.code !== '42P01') {
      console.warn('[activity] clear_workout_active failed:', error);
    }
  } catch (err) {
    console.warn('[activity] clearActive threw:', err?.message || err);
  }
}

/**
 * Returns currently-active followees as an array of
 *   { user_id, username, avatar_url, active_until }
 *
 * Empty array on RPC failure / pre-088 host — the green-dot UI
 * simply renders nothing.
 */
export async function getActiveFollowees() {
  try {
    const { data, error } = await supabase.rpc('get_active_followees');
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return [];
      console.warn('[activity] get_active_followees failed:', error);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[activity] getActiveFollowees threw:', err?.message || err);
    return [];
  }
}
