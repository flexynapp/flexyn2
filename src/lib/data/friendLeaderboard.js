// src/lib/data/friendLeaderboard.js
//
// Wrapper around the `get_friend_leaderboard` RPC. Three sort modes
// ('weekly_xp', 'weekly_volume', 'weekly_sessions'), returns the
// caller + their mutual follows ranked.
//
// Definition history: introduced in migration 093 against
// user_profiles.weekly_{xp,volume,sessions} — but those columns
// never existed on user_profiles (only league_members.weekly_xp
// exists). Migration 101 (audit_fix_batch) rewrote the RPC to
// aggregate weekly_volume / weekly_sessions from workout_logs on
// the fly and pull weekly_xp from league_members. Result-row shape
// is identical so this client doesn't need a version branch.

import { supabase } from '@/api/supabaseClient';

const VALID_MODES = new Set(['weekly_xp', 'weekly_volume', 'weekly_sessions']);

/**
 * Returns the friend leaderboard rows for the caller. Returns []
 * on pre-093 host (RPC missing) so the UI falls back gracefully
 * rather than erroring.
 *
 * @param {object} opts
 * @param {'weekly_xp'|'weekly_volume'|'weekly_sessions'} [opts.mode='weekly_xp']
 * @param {number} [opts.limit=20]
 */
export async function getFriendLeaderboard({ mode = 'weekly_xp', limit = 20 } = {}) {
  const safeMode = VALID_MODES.has(mode) ? mode : 'weekly_xp';
  try {
    const { data, error } = await supabase.rpc('get_friend_leaderboard', {
      p_mode:  safeMode,
      p_limit: limit,
    });
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return [];
      console.warn('[friendLeaderboard] failed:', error);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[friendLeaderboard] threw:', err?.message || err);
    return [];
  }
}
