// src/lib/data/workoutCardio.js
//
// A run, ride, walk or swim logged INSIDE a workout (a kind:'cardio' entry,
// see CardioLogger) becomes its own cardio_logs row when the workout saves.
//
// Until 2026-09-30 these entries were dropped on save: keepLoggedSets kept
// only exercises with sets, and a cardio entry has none, so the run vanished
// from the log, never reached a running goal, never paid XP, and a run-only
// workout could not be saved at all. Production held zero cardio entries in
// workout_logs.
//
// Why a separate row rather than reading the workout's JSON everywhere:
// running goals, lifetime distance (zz_cardio_logs_distance_credit_tr), the
// server's cardio XP (grant_cardio_xp) and the plausibility checks all read
// cardio_logs. One row per entry puts a workout run through exactly the same
// server path as a run saved from the Cardio tracker, so nothing credits it
// twice: the workout pays for its sets, and workout_xp_for leaves the run's
// minutes out of the workout's duration bonus (migration
// 20260930170000_workout_cardio_minutes).
//
// The entry keeps the new row's id as `cardio_log_id`, so deleting the
// workout deletes the run with it (workouts.remove).

import * as cardioData from '@/lib/data/cardio';
import { estimateCalories, userWeightKg } from '@/lib/cardioCalories';
import { speedKmhFrom, paceSecPerKmFrom } from '@/lib/distanceUnit';

// CardioLogger activity id -> the `<mode>_<env>` type the Cardio tracker
// stores. A workout does not say indoor or outdoor, so outdoor is assumed
// (a pool for swimming), which is what running goals match on anyway
// (goal_is_met: type LIKE 'running\_%').
const TYPE_BY_ACTIVITY = {
  walking: 'walking_outside',
  running: 'running_outside',
  cycling: 'biking_outside',
  swimming: 'swimming_pool',
};

const segmentsOf = (ex) => (Array.isArray(ex?.segments)
  ? ex.segments
  : [{ duration_s: ex?.duration_s, distance_m: ex?.distance_m }]);

/** True when a cardio entry carries any time or distance. */
export function cardioEntryHasData(ex) {
  return segmentsOf(ex).some((s) => Number(s?.duration_s) > 0 || Number(s?.distance_m) > 0);
}

/** The cardio_logs row for one workout cardio entry, or null when it has nothing in it. */
export function cardioLogPayloadFromEntry(ex, { date, userProfile } = {}) {
  if (ex?.kind !== 'cardio' || !cardioEntryHasData(ex)) return null;
  let seconds = 0;
  let meters = 0;
  for (const s of segmentsOf(ex)) {
    const d = Number(s?.duration_s);
    const m = Number(s?.distance_m);
    if (Number.isFinite(d) && d > 0) seconds += d;
    if (Number.isFinite(m) && m > 0) meters += m;
  }
  seconds = Math.round(seconds);
  meters = Math.round(meters);
  const type = TYPE_BY_ACTIVITY[ex.activity] || 'running_outside';
  // A typed 42 km in a minute is still saved, as the tracker would save it,
  // and the server credits no distance and pays no XP for it.
  return {
    date,
    type,
    mode: 'manual',
    duration_seconds: seconds || null,
    distance_meters: meters || null,
    pace_seconds_per_km: paceSecPerKmFrom(meters, seconds),
    avg_speed_kmh: speedKmhFrom(meters, seconds),
    calories: estimateCalories({
      type,
      durationSeconds: seconds,
      distanceMeters: meters,
      weightKg: userWeightKg(userProfile),
    }),
    notes: null,
    gps_track: null,
  };
}

/**
 * Save each cardio entry of a just-saved workout as a cardio_logs row and
 * ask the server to score it. Returns the entries with `cardio_log_id` set,
 * whether anything changed, the XP the server credited, and the seconds
 * logged (for quests). One entry failing does not stop the others.
 */
export async function saveWorkoutCardio({ exercises, date, userProfile, grantXp, onError } = {}) {
  let changed = false;
  let xp = 0;
  let seconds = 0;
  let sessions = 0;
  const out = [];
  for (const ex of exercises || []) {
    const payload = ex?.cardio_log_id ? null : cardioLogPayloadFromEntry(ex, { date, userProfile });
    if (!payload) { out.push(ex); continue; }
    try {
      const row = await cardioData.create(payload);
      if (!row?.id) { out.push(ex); continue; }
      changed = true;
      sessions += 1;
      seconds += payload.duration_seconds || 0;
      out.push({ ...ex, cardio_log_id: row.id });
      if (grantXp) {
        try {
          const credited = await grantXp(row.id, payload);
          xp += Number(credited?.xp_awarded) || 0;
        } catch (err) {
          onError?.(err, 'xp');
        }
      }
    } catch (err) {
      onError?.(err, 'create');
      out.push(ex);
    }
  }
  return { exercises: out, changed, xp, seconds, sessions };
}

/** The cardio_logs ids a workout's entries point at. */
export function linkedCardioLogIds(exercises) {
  return (Array.isArray(exercises) ? exercises : [])
    .filter((ex) => ex?.kind === 'cardio' && ex.cardio_log_id)
    .map((ex) => ex.cardio_log_id);
}
