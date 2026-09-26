// Session duration on a workout log — one name, in one place.
//
// THE BUG THIS EXISTS TO CLOSE (found 2026-08-10, auditing Advanced
// Analytics). `workout_logs` has a column called **`duration_min`**. The
// client wrote **`duration_minutes`** — a column that does not exist — and
// `db.js`'s strip-and-retry layer did exactly what it is designed to do:
// caught the 42703, dropped the unknown key, and saved the row without it.
// Silently, by design, with only a console.warn.
//
// So every workout ever saved threw its duration away, and every reader got
// `undefined`:
//
//   · Advanced Analytics rendered "Total Time 0 min" and "Avg Duration
//     0 min" — two of its ten rows, permanently zero for everyone.
//   · Editing a workout's duration appeared to save and never did.
//   · Hub workout snapshots stored duration_minutes: null.
//   · `generate_weekly_review_for` sums `duration_min` FROM workout_logs
//     server-side, so the weekly review's duration was always 0 too. That
//     one needs no code change — it has been reading the right column all
//     along and there was simply never anything in it.
//
// The fix is to write the column the table actually has. This module is the
// single place that knows its name, so the next reader cannot get it wrong.
//
// WHY NOT RENAME THE COLUMN INSTEAD: `duration_minutes` is what the client
// says, so renaming the column would align more
// names. But `generate_weekly_review_for` reads `duration_min`, and that
// function was consolidated onto a single body by migration 331 after a
// period where two implementations disagreed — redefining it to chase a
// column rename is exactly the "read the installed artefact" hazard
// CLAUDE.md documents, for no user-visible gain. Writing the existing
// column fixes the weekly review WITHOUT touching it.

/** The real column on `workout_logs`. Write this, never 'duration_minutes'. */
export const DURATION_COLUMN = 'duration_min';

/**
 * Read a saved session's duration in minutes.
 *
 * Tolerates both spellings on purpose, and the tolerance is not paranoia:
 * `duration_minutes` is still the correct key on in-memory objects that
 * never touch the table — the AI Coach's generated plans
 * (`workoutGenerator`, `planBuilder`, `followUps`) and the payload
 * `calculateWorkoutXp` scores before the row is written. Those are a
 * different shape that happens to share a field, so a reader that has to
 * handle both is correct rather than defensive.
 *
 * @param {object|null|undefined} log  a saved workout_logs row OR an
 *                                     in-memory workout payload
 * @returns {number} whole minutes, 0 when absent or unparseable
 */
export function workoutDurationMin(log) {
  const raw = log?.[DURATION_COLUMN] ?? log?.duration_minutes;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
