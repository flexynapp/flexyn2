// src/lib/data/streakRescue.js
//
// Two adjacent but distinct streak-rescue concepts live in this file:
//
// 1. SOFT NUDGE (client-only, the existing logic below).
//    "Keep your 12-day streak alive — log 1 set?" Dashboard prompt
//    shown after 6 PM on days the user hasn't yet logged. Decides
//    whether to show the rescue card based on streak length, time of
//    day, whether anything was logged today, and per-device dismissal.
//    Stateless function — every input is passed in.
//
// 2. POST-BREAK RESCUE (server-backed, getStreakRescueStatus +
//    useStreakRescue at the bottom of this file). When the user MISSED
//    yesterday (days_since_last_workout = 2) and had a streak of at
//    least 3 going, the server lets them spend one rescue per calendar
//    month to keep the streak alive. Atomic via migration 087's
//    use_streak_rescue RPC: UNIQUE (user_id, month_start) constraint
//    enforces the cap.
//
// The two are complementary. The soft nudge runs BEFORE the day's
// over — "log one set so this doesn't break". The post-break rescue
// runs AFTER they failed — "you missed yesterday; spend a rescue to
// recover instead of starting over". A user could (in principle) see
// the soft nudge one evening, ignore it, then see the post-break
// rescue offer the next morning.

import { isSameDay, parseISO } from 'date-fns';
import { supabase } from '@/api/supabaseClient';

const LS_KEY = (email) => `flexyn.streakRescueDismissed.${email || 'anon'}`;
const TRIGGER_HOUR = 18; // 6 PM local

/**
 * Decide whether to show the rescue card.
 *
 * @param {object} ctx
 * @param {number}  ctx.streakDays    Current workout-streak length.
 * @param {string}  [ctx.lastWorkoutDate]  ISO date string of most recent workout.
 * @param {string}  [ctx.lastMealDate]     ISO date string of most recent meal.
 * @param {string}  ctx.userEmail
 * @param {Date}    [ctx.now=new Date()]
 * @returns {boolean}
 */
export function shouldShowStreakRescue({ streakDays, lastWorkoutDate, lastMealDate, userEmail, now = new Date() }) {
  if (!streakDays || streakDays < 2) return false;
  if (now.getHours() < TRIGGER_HOUR) return false;

  const todayWorkout = lastWorkoutDate ? isSameDayLocal(lastWorkoutDate, now) : false;
  const todayMeal    = lastMealDate    ? isSameDayLocal(lastMealDate, now)    : false;
  if (todayWorkout || todayMeal) return false;

  if (wasDismissedToday(userEmail, now)) return false;

  return true;
}

/**
 * Record that the user dismissed today's rescue. Persists until
 * tomorrow's local midnight.
 */
export function markStreakRescueDismissedToday(userEmail, now = new Date()) {
  if (!userEmail) return;
  try {
    localStorage.setItem(LS_KEY(userEmail), now.toISOString());
  } catch { /* best-effort */ }
}

function wasDismissedToday(userEmail, now) {
  try {
    const raw = localStorage.getItem(LS_KEY(userEmail));
    if (!raw) return false;
    return isSameDayLocal(raw, now);
  } catch { return false; }
}

function isSameDayLocal(value, now) {
  try {
    const d = typeof value === 'string' ? parseISO(value) : new Date(value);
    if (Number.isNaN(d.getTime())) return false;
    return isSameDay(d, now);
  } catch { return false; }
}

// ── Post-break rescue (migration 087) ─────────────────────────────────────

/**
 * Read-only eligibility check. Returns either:
 *   { available: true,  current_streak, days_since }
 *   { available: false, reason, current_streak? }
 *   null if the RPC isn't deployed (pre-087 host).
 *
 * Reasons (when available=false):
 *   • 'streak_too_short'         streak < 3, not worth a rescue
 *   • 'already_used_this_month'  monthly cap spent
 *   • 'not_at_risk'              streak not in the "missed exactly
 *                                yesterday" recoverable state
 *   • 'no_profile' / 'no_last_workout'  odd state, don't render
 *
 * The Dashboard banner branches on `available` and `reason`. Pre-087
 * hosts (null) get the legacy "hide on broken streak" behavior, which
 * is the same as before this feature shipped — safe fallback.
 */
export async function getStreakRescueStatus() {
  try {
    const { data, error } = await supabase.rpc('streak_rescue_status');
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return null;
      console.warn('[streakRescue] streak_rescue_status failed:', error);
      return null;
    }
    return data ?? null;
  } catch (err) {
    console.warn('[streakRescue] status threw:', err?.message || err);
    return null;
  }
}

/**
 * Spend the monthly rescue. Returns:
 *   { ok: true,  streak_saved, next_workout_continues_streak }
 *   { ok: false, reason, current_streak?, days_since? }
 *   null if the RPC isn't deployed.
 *
 * The server-side guarantees:
 *   • Atomic via FOR UPDATE on user_profiles + UNIQUE on streak_rescues
 *   • Two concurrent presses can't double-spend
 *   • last_workout_date is set to YESTERDAY (not today) so the user
 *     still has to do a real workout to keep the streak alive — the
 *     rescue forgives ONE missed day, not the whole habit.
 *
 * Callers:
 *   • On ok=true → invalidate the workoutStreakProfile query so the
 *     banner re-reads, show a celebratory toast.
 *   • On ok=false with reason='already_used_this_month' → toast
 *     explaining the monthly cap. Shouldn't normally hit because the
 *     button only renders when available, but two devices can race.
 *   • Other reasons → log + generic error toast.
 */
export async function spendStreakRescue() {
  try {
    const { data, error } = await supabase.rpc('use_streak_rescue');
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return null;
      console.warn('[streakRescue] use_streak_rescue failed:', error);
      return { ok: false, reason: 'rpc_error' };
    }
    return data ?? { ok: false, reason: 'unknown' };
  } catch (err) {
    console.warn('[streakRescue] use threw:', err?.message || err);
    return { ok: false, reason: 'network' };
  }
}
