// src/lib/data/scheduledWorkouts.js
//
// Scheduled workouts — the data layer behind "Schedule it" on the AI Coach
// plan card. Backed by migration 276.
//
// The date and hour are the user's LOCAL ones and are stored as such; see the
// migration header for why an absolute timestamp would be the wrong shape.
// Everything here therefore works in local time and never touches UTC.

import { supabase } from '@/api/supabaseClient';

/** Local YYYY-MM-DD. `toISOString()` would return the UTC date, which is the
 *  previous day for anyone west of Greenwich after their evening. */
export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** N days from today, as a local date key. */
export function dateKeyOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}

/**
 * Pin a generated session to a local date and hour.
 *
 * @param {object}  args
 * @param {string}  args.date     local YYYY-MM-DD
 * @param {number}  args.hour     local hour, 0–23
 * @param {string}  args.title    what the reminder calls it
 * @param {object}  args.workout  the generateWorkout() session, stored whole
 * @returns {Promise<string>} the new row's id
 */
export async function scheduleWorkout({ date, hour, title, workout }) {
  const { data, error } = await supabase.rpc('schedule_workout', {
    p_date: date,
    p_hour: hour,
    p_title: title || 'Workout',
    p_workout: workout,
  });
  if (error) throw error;
  return data;
}

/**
 * The user's upcoming and recently-fired schedules, soonest first.
 * 'notified' rows are included because a reminder that fired this morning is
 * still the thing the user is most likely to want to open.
 */
export async function listUpcomingWorkouts(limit = 20) {
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .select('id, scheduled_date, scheduled_hour, title, status, workout')
    .in('status', ['pending', 'notified'])
    .gte('scheduled_date', dateKeyOffset(-1))
    .order('scheduled_date', { ascending: true })
    .order('scheduled_hour', { ascending: true })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}

/** One schedule by id — used by the /workout?scheduled=<id> deep link. */
export async function getScheduledWorkout(id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .select('id, scheduled_date, scheduled_hour, title, status, workout')
    .eq('id', id)
    .maybeSingle();
  return error ? null : data;
}

/** Mark one done. Best-effort: the workout log is the real record, so a failure
 *  here must never block or undo a save the user already completed. */
export async function completeScheduledWorkout(id) {
  if (!id) return false;
  const { error } = await supabase
    .from('scheduled_workouts')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id);
  return !error;
}

/** Cancel one. Kept as a status rather than a delete so a user who cancels and
 *  re-schedules doesn't silently blow past the pending-row ceiling. */
export async function cancelScheduledWorkout(id) {
  if (!id) return false;
  const { error } = await supabase
    .from('scheduled_workouts')
    .update({ status: 'cancelled' })
    .eq('id', id);
  return !error;
}

// ── Slot presentation ───────────────────────────────────────────────────────

/** The day choices offered on the card. Today is deliberately included: the
 *  most common real answer to "when?" is "later today". */
export function daySlots(now = new Date()) {
  const dayName = (d) => d.toLocaleDateString(undefined, { weekday: 'short' });
  const at = (offset) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return d;
  };
  return [
    { id: 'today', label: 'Today', date: localDateKey(at(0)) },
    { id: 'tomorrow', label: 'Tomorrow', date: localDateKey(at(1)) },
    { id: 'day2', label: dayName(at(2)), date: localDateKey(at(2)) },
    { id: 'day3', label: dayName(at(3)), date: localDateKey(at(3)) },
  ];
}

/** Hour choices. Four covers the shape of most training days without turning
 *  the picker into a clock; the point is to commit to a slot, not to a minute. */
export const HOUR_SLOTS = [
  { id: 'morning', label: 'Morning', hour: 7 },
  { id: 'midday', label: 'Midday', hour: 12 },
  { id: 'evening', label: 'Evening', hour: 18 },
  { id: 'night', label: 'Night', hour: 20 },
];

/** "7am" / "12pm" / "6pm" — the hour as the user reads it back. */
export function formatHour(hour) {
  const h = ((Number(hour) % 24) + 24) % 24;
  const suffix = h < 12 ? 'am' : 'pm';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
}

/**
 * Whether a slot has already passed today — "Today / Morning" at 6pm is not a
 * plan, and a reminder for it would fire immediately or be marked missed.
 */
export function slotIsPast(dateKey, hour, now = new Date()) {
  if (dateKey !== localDateKey(now)) return dateKey < localDateKey(now);
  return hour <= now.getHours();
}
