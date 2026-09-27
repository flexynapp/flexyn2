// src/lib/data/rivalMonth.js
//
// The monthly layer on top of the weekly races (migration 20260927190000).
// Every week won in a calendar month, human Rival or Past You, counts; win
// RIVAL_MONTH_GOAL of them and RIVAL_MONTH_BONUS is paid when the month ends.
// A walkover (the rival never logged) does not count. The server derives all
// of it from settled races; the client only reads it.

import { supabase } from '@/api/supabaseClient';

export const RIVAL_MONTH_GOAL = 3;
export const RIVAL_MONTH_BONUS = { xp: 2000, coins: 200, capsules: 2 };

/**
 * @returns {Promise<{ month: Date, wins: number, goal: number } | null>}
 *   `month` is the first day of the user's local month, as a local date.
 */
export async function getMyRivalMonth() {
  const { data, error } = await supabase.rpc('get_my_rival_month');
  if (error || !data || typeof data !== 'object') return null;
  const [y, m] = String(data.month || '').split('-').map(Number);
  if (!y || !m) return null;
  return {
    month: new Date(y, m - 1, 1),
    wins: Math.max(0, Number(data.wins) || 0),
    goal: Math.max(1, Number(data.goal) || RIVAL_MONTH_GOAL),
  };
}
