// src/lib/data/streakRescue.js
//
// Pure logic for the "Keep your 12-day streak alive — log 1 set?"
// Dashboard prompt. Decides whether to show the rescue card based on:
//
//   • User has an active streak >= 2 days
//   • It's late enough in the user's local day (>= 6 PM)
//   • User has NOT logged a workout OR meal today
//   • User has NOT dismissed the prompt today
//
// Stateless — every input is passed in; consumers can mock easily.
// Dismissal state lives in localStorage (per-device, per-user).

import { isSameDay, parseISO } from 'date-fns';

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
