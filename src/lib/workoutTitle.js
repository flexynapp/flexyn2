// What a saved workout is called — one name, in one place.
//
// The second instance of the bug `workoutDuration.js` documents, found the
// same day and by the same method: comparing what the client writes against
// what `information_schema` says the table has.
//
// `workout_logs` is exactly:
//   id, created_by, user_id, title, date, notes, exercises, duration_min,
//   total_volume, created_at, updated_at, created_date, idempotency_key,
//   volume_credited_at, tags
//
// There is no `regimen_name` and no `regimen_id`. The client wrote both on
// every save, `db.js`'s strip-and-retry caught the 42703 and dropped them,
// and the row saved without either — silently, by design, with one
// console.warn. So **every workout's name has been thrown away since
// launch**, while `title` sat at 0 of 3 rows populated because nothing has
// ever written it.
//
// What it was costing, all of it invisible because each reader had a
// sensible fallback:
//
//   · The Progress page's last-workout row said "Freestyle Session" for
//     everyone, always.
//   · `WorkoutSavedList` titled every saved session "Freestyle", and its
//     search matched on a name that was never there.
//   · `TodaysPlanCard` builds regimenName → last-used-date to suggest what
//     to train next. Every log failed its `if (!name) return`, so the map
//     was always empty and the suggestion never had history behind it.
//   · The Trends tab's regimen filter listed every regimen the user owned
//     and matched each against a field that did not exist, so every option
//     filtered to zero logs. (Found independently by the Exercise Trends
//     session, which is what surfaced this.)
//   · `WidgetRenderer`'s best-session widget showed an unnamed session.
//
// `regimen_id` is NOT reinstated under another name. It had no readers at
// all — every `regimen_id` in the codebase belongs to a different table
// (crew messages, trainer listings, regimen reviews) — so it was pure
// payload weight buying a stripped column and a wasted round-trip.
//
// NOTE the asymmetry with duration: a workout's name is genuinely optional,
// so `null` is a legitimate stored value and callers supply their own
// "Freestyle" wording. This returns null rather than a default, because the
// default is a translated string and this module has no business owning it.

/** The real column on `workout_logs`. Write this, never `regimen_name`. */
export const TITLE_COLUMN = 'title';

/**
 * Read a saved session's name.
 *
 * Tolerates `regimen_name` on purpose and for two live reasons, not as
 * superstition: the AI Coach's generated plans carry their own in-memory
 * shape that never touches the table, and every row written before this fix
 * has a NULL title with no name recoverable from anywhere — so a reader
 * that handles both is correct rather than defensive.
 *
 * @param {object|null|undefined} log a saved workout_logs row OR an
 *                                    in-memory workout payload
 * @returns {string|null} the trimmed name, or null when there isn't one
 */
export function workoutTitle(log) {
  const raw = log?.[TITLE_COLUMN] ?? log?.regimen_name;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}
