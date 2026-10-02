// src/lib/data/firstWeekCheckin.js
//
// The first-week check-in: one tap a day for a new account's first seven
// days (migration 20261002160000). The server decides everything: which day
// it is from the account's sign-up date, whether today is still open, and
// what it pays. This module only asks and reports back.
//
// "Today" is the device's local date, the same clock the login streak and
// daily quests use, so the sheet turns over at the user's midnight. The
// server holds it to within a day of its own UTC date.

import { format } from 'date-fns';
import { supabase } from '@/api/supabaseClient';
import { patchProfile } from '@/api/profileCache';

/** The first week is seven days; older accounts never need to ask. */
export const FIRST_WEEK_DAYS = 7;

export function localDateString(d = new Date()) {
  return format(d, 'yyyy-MM-dd');
}

/** Milliseconds until the next local midnight (plus a second of slack). */
export function msUntilLocalMidnight(now = new Date()) {
  const next = new Date(now);
  next.setHours(24, 0, 1, 0);
  return Math.max(1000, next.getTime() - now.getTime());
}

/**
 * Cheap client-side gate so an older account never makes the call. The
 * server still decides; this only saves a round trip. One day of slack
 * either side covers time zones.
 */
export function mayBeInFirstWeek(createdAt, now = new Date(), { unknown = true } = {}) {
  const ms = Date.parse(createdAt || '');
  if (!Number.isFinite(ms)) return unknown;
  return now.getTime() - ms < (FIRST_WEEK_DAYS + 1) * 24 * 60 * 60 * 1000;
}

/**
 * @returns {Promise<null | { eligible: boolean, day: number, claimable?: boolean,
 *   days?: Array<{ day: number, xp: number, coins: number,
 *                  status: 'claimed'|'missed'|'today'|'future' }> }>}
 *   null when the server could not answer (including before the migration
 *   is applied), which the caller treats as "nothing to show".
 */
export async function getFirstWeekCheckin(today = localDateString()) {
  const { data, error } = await supabase.rpc('get_first_week_checkin', { p_today: today });
  if (error) return null;
  return data || null;
}

/**
 * @returns {Promise<{ claimed: boolean, day?: number, xp_awarded?: number,
 *   coins_awarded?: number, reason?: string }>}
 */
export async function claimFirstWeekCheckin(today = localDateString()) {
  const { data, error } = await supabase.rpc('claim_first_week_checkin', { p_today: today });
  if (error) throw error;
  if (data?.claimed) {
    // Both values came back from the server, which is the only kind of
    // value the profile cache may hold for these columns.
    patchProfile({ total_xp: data.total_xp, flex_coins: data.flex_coins });
  }
  return data || { claimed: false };
}
