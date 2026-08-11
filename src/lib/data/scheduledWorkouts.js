// src/lib/data/scheduledWorkouts.js
//
// Scheduled workouts — the data layer behind "Schedule it" on the AI Coach
// plan card. Backed by migration 276.
//
// The date and hour are the user's LOCAL ones and are stored as such; see the
// migration header for why an absolute timestamp would be the wrong shape.
// Everything here therefore works in local time and never touches UTC.

import { formatDate } from '@/lib/intlFormat';
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

// ── Cardio schedules ────────────────────────────────────────────────────────
//
// Cardio used to have its OWN scheduler — a `planned_cardio` table behind
// Cardio → Planned Sessions. It held 0 rows in production and could not
// notify: no cron, no push, no deep link, and a `completed_cardio_id`
// column that was read to show "Completed" vs "Not logged" and never
// written by anything, so a past plan could only ever say "Not logged".
//
// `scheduled_workouts.workout` is free-form JSONB and `schedule_workout()`
// only requires it be a JSON object, so a cardio plan needs no new table,
// no new RPC and no migration — it rides the machinery that already
// resolves the user's local hour, fires hourly, pushes a notification and
// deep-links into the session.
//
// The discriminator is `workout.kind`. A lifting session has none (it is a
// generateWorkout() payload with an `exercises` array), so absent means
// lifting and every row written before today keeps reading correctly.

export const CARDIO_KIND = 'cardio';

/** True for a schedule that represents a cardio session. */
export function isCardioSchedule(row) {
  return row?.workout?.kind === CARDIO_KIND;
}

/**
 * The `workout` payload for a scheduled cardio session.
 *
 * `mode` and `env` are the same vocabulary CardioSection routes on
 * (running/walking/biking/swimming × outside/treadmill/stationary/pool/
 * openwater), so the deep link can drop the user straight into the right
 * tracker rather than back at the activity picker.
 */
export function buildCardioPayload({ mode, env, distanceMeters = null, notes = null }) {
  return {
    kind: CARDIO_KIND,
    mode,
    env,
    // Canonical metres, like cardio_logs — never the user's display unit.
    distance_meters: Number.isFinite(Number(distanceMeters)) && Number(distanceMeters) > 0
      ? Number(distanceMeters)
      : null,
    notes: notes || null,
  };
}

/**
 * Every cardio schedule for the current user, soonest first.
 *
 * Unlike listUpcomingWorkouts this does NOT filter by status or date — the
 * Planned Sessions screen shows past plans too, and their status is the
 * whole point of that section now that it is a real lifecycle
 * (pending → notified → completed / cancelled / missed) rather than a
 * column nothing wrote.
 *
 * The kind filter is client-side: `workout` is JSONB and a `->>` filter
 * through PostgREST would not use an index here anyway, and the per-user
 * row count is bounded by the RPC's own 100-pending ceiling.
 */
export async function listCardioSchedules(limit = 100) {
  const { data, error } = await supabase
    .from('scheduled_workouts')
    .select('id, scheduled_date, scheduled_hour, title, status, workout, completed_at')
    .order('scheduled_date', { ascending: true })
    .order('scheduled_hour', { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data ?? []).filter(isCardioSchedule);
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
export function daySlots(now = new Date(), language = 'en') {
  // `toLocaleDateString(undefined, …)` reads the BROWSER's locale, not the
  // app's — the exact bug src/lib/intl.js exists to prevent, and it put an
  // English weekday inside an otherwise-translated Coach sentence.
  const dayName = (d) => formatDate(d, language, { weekday: 'short' });
  const at = (offset) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return d;
  };
  return [
    // Today/Tomorrow are words, so they carry a key. The two weekday slots
    // come from Intl and need none.
    { id: 'today', label: 'Today', labelKey: 'coach.schedule.today', date: localDateKey(at(0)) },
    { id: 'tomorrow', label: 'Tomorrow', labelKey: 'coach.schedule.tomorrow', date: localDateKey(at(1)) },
    { id: 'day2', label: dayName(at(2)), date: localDateKey(at(2)) },
    { id: 'day3', label: dayName(at(3)), date: localDateKey(at(3)) },
  ];
}

/** Hour choices. Four covers the shape of most training days without turning
 *  the picker into a clock; the point is to commit to a slot, not to a minute. */
export const HOUR_SLOTS = [
  { id: 'morning', label: 'Morning', labelKey: 'coach.schedule.morning', hour: 7 },
  { id: 'midday',  label: 'Midday',  labelKey: 'coach.schedule.midday',  hour: 12 },
  { id: 'evening', label: 'Evening', labelKey: 'coach.schedule.evening', hour: 18 },
  { id: 'night',   label: 'Night',   labelKey: 'coach.schedule.night',   hour: 20 },
];

/** "7am" / "12pm" / "6pm" — the hour as the user reads it back. */
export function formatHour(hour, language = 'en') {
  const h = ((Number(hour) % 24) + 24) % 24;
  // Intl picks 12h vs 24h from the locale — most of the 15 languages we ship
  // write 19:00, not 7pm. The old hardcoded am/pm was English convention
  // wearing a number.
  const d = new Date(2000, 0, 1, h, 0, 0);
  return formatDate(d, language, { hour: 'numeric', minute: undefined })
    || `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
}

/**
 * Whether a slot has already passed today — "Today / Morning" at 6pm is not a
 * plan, and a reminder for it would fire immediately or be marked missed.
 */
export function slotIsPast(dateKey, hour, now = new Date()) {
  if (dateKey !== localDateKey(now)) return dateKey < localDateKey(now);
  return hour <= now.getHours();
}
