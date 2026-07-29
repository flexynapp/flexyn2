// src/lib/data/periodLeaderboard.js
//
// Wraps the server-side leaderboard RPCs.
//
//   get_period_leaderboard    (mig 125, extended by 257) — top-N board
//   get_leaderboard_around_me (mig 257)                  — caller + neighbours
//
// Migration 257 widened get_period_leaderboard to cover every board the UI
// offers (it previously handled volume / xp / sessions only), added a
// server-computed `rank`, gave ties a deterministic order, and dropped
// `email` from the return — it was handing the top 100's addresses to any
// authenticated caller, the same surface migration 195 closed on the
// public_profiles view.
//
// IMPORTANT — the frontend ships ahead of the database here. Netlify
// auto-deploys from main, but migrations are applied by hand in the Supabase
// SQL editor, so there is always a window where this code runs against a
// pre-257 schema. Every call reports whether the new RPC was actually
// available so callers can fall back rather than render an empty board.

import { supabase } from '@/api/supabaseClient';

// Postgres codes meaning "this function isn't on this host yet".
const MISSING = new Set(['42883', '42P01']);

// 22023 = the RPC rejected the board name. A pre-257 host raises this for
// 'achievements' / 'distance', which it has never heard of, so for our
// purposes it means the same thing as a missing function.
const UNKNOWN_BOARD = '22023';

/**
 * Top-N rows for a board.
 *
 * @param {object} opts
 * @param {'volume'|'xp'|'sessions'|'achievements'|'distance'} opts.board
 * @param {'weekly'|'monthly'|'alltime'} opts.period
 * @param {number} [opts.limit=100]
 * @returns {Promise<{ rows: Array, supported: boolean }>}
 *   `supported: false` means this host can't serve the board and the caller
 *   should use its legacy client-side path.
 */
export async function getPeriodLeaderboard({ board, period, limit = 100 } = {}) {
  if (!board || !period) return { rows: [], supported: true };
  try {
    const { data, error } = await supabase.rpc('get_period_leaderboard', {
      p_board:  board,
      p_period: period,
      p_limit:  limit,
    });
    if (error) {
      if (MISSING.has(error.code) || error.code === UNKNOWN_BOARD) {
        return { rows: [], supported: false };
      }
      console.warn('[periodLeaderboard] RPC error:', error);
      return { rows: [], supported: false };
    }
    return { rows: Array.isArray(data) ? data : [], supported: true };
  } catch (err) {
    console.warn('[periodLeaderboard] threw:', err?.message || err);
    return { rows: [], supported: false };
  }
}

/**
 * The caller's own rank plus `radius` rows either side, with true global
 * ranks — the piece a top-N read can't give you. Without it, anyone outside
 * the top 100 has no rank to show at all.
 *
 * All-time only: the RPC rejects other periods because only the all-time
 * boards are backed by denormalized columns cheap enough to rank the whole
 * table on demand.
 *
 * @returns {Promise<{ rows: Array, supported: boolean }>}
 */
export async function getLeaderboardAroundMe({ board, radius = 3 } = {}) {
  if (!board) return { rows: [], supported: true };
  try {
    const { data, error } = await supabase.rpc('get_leaderboard_around_me', {
      p_board:  board,
      p_period: 'alltime',
      p_radius: radius,
    });
    if (error) {
      if (MISSING.has(error.code) || error.code === UNKNOWN_BOARD) {
        return { rows: [], supported: false };
      }
      console.warn('[periodLeaderboard] around-me RPC error:', error);
      return { rows: [], supported: false };
    }
    return { rows: Array.isArray(data) ? data : [], supported: true };
  } catch (err) {
    console.warn('[periodLeaderboard] around-me threw:', err?.message || err);
    return { rows: [], supported: false };
  }
}
