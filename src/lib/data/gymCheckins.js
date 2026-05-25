// src/lib/data/gymCheckins.js
// Gym check-in: scan the signage QR (/checkin/<CODE>) or type the gym's
// 8-char code to check in. A check-in grants a 1.2x XP multiplier on
// workouts logged that day (applied at workout save via WORKOUT_XP_MULTIPLIER).
import { supabase } from '@/api/supabaseClient';

// 1.2x XP for a session logged on a day the user checked into a gym.
export const GYM_CHECKIN_XP_MULTIPLIER = 1.2;

/**
 * Check in using a gym's printable code. The gym is resolved server-side
 * from the code (check_in_to_gym RPC, mig 149).
 * @returns {Promise<{ ok: boolean, gym_id?: string, gym_name?: string, already?: boolean, error?: string }>}
 */
export async function checkInWithCode(code) {
  const { data, error } = await supabase.rpc('check_in_to_gym', { p_code: code });
  if (error) throw error;
  return data || { ok: false, error: 'UNKNOWN' };
}

/** True if the caller has checked into any gym today (UTC). Never throws. */
export async function hasCheckedInToday() {
  try {
    const { data, error } = await supabase.rpc('has_gym_checkin_today');
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}
