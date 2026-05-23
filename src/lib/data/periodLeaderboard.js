// src/lib/data/periodLeaderboard.js
//
// Wraps the get_period_leaderboard RPC (migration 125). Returns the
// top N users by volume / XP / sessions over a weekly, monthly, or
// all-time window. Used by LeaderboardsContent to back the time-
// window toggle.
//
// Falls back to [] on pre-125 hosts (RPC missing) — the UI then
// shows an empty period leaderboard rather than crashing.

import { supabase } from '@/api/supabaseClient';

/**
 * @param {object} opts
 * @param {'volume'|'xp'|'sessions'} opts.board
 * @param {'weekly'|'monthly'|'alltime'} opts.period
 * @param {number} [opts.limit=100]
 */
export async function getPeriodLeaderboard({ board, period, limit = 100 } = {}) {
  if (!board || !period) return [];
  try {
    const { data, error } = await supabase.rpc('get_period_leaderboard', {
      p_board:  board,
      p_period: period,
      p_limit:  limit,
    });
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return [];
      console.warn('[periodLeaderboard] RPC error:', error);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[periodLeaderboard] threw:', err?.message || err);
    return [];
  }
}
