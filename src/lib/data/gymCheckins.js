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

/**
 * WHICH gym the caller checked into today, or null.
 *
 * has_gym_checkin_today (mig 149) answers only yes/no, and the equipment
 * picker needs the identity: someone who belongs to three gyms should
 * see the floor of the one they actually walked into. Reads the row
 * directly rather than adding an RPC — gym_checkins is RLS'd to the
 * owning user, so there is nothing to gate server-side.
 *
 * Never throws; a null just means "don't scope", and the picker falls
 * back to the union of every gym the user belongs to.
 */
export async function getTodayCheckinGymId() {
  try {
    // The server stamps checkin_date with the lifter's LOCAL day, so read
    // it back the same way. toISOString() is the UTC day, which in the
    // evening west of UTC is already tomorrow.
    const now = new Date();
    const today = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const { data, error } = await supabase
      .from('gym_checkins')
      .select('gym_id')
      .eq('checkin_date', today)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) return null;
    return data?.[0]?.gym_id ?? null;
  } catch {
    return null;
  }
}

/** True if the caller has checked into any gym today (their local day). Never throws. */
export async function hasCheckedInToday() {
  try {
    const { data, error } = await supabase.rpc('has_gym_checkin_today');
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}
