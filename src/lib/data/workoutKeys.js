// src/lib/data/workoutKeys.js
//
// React Query keys for workout_logs reads. ZERO IMPORTS, and that is the
// point of the file — the same reasoning as `cardioKeys.js`, which this
// mirrors deliberately rather than inventing a second shape.
//
// A component importing nothing but a key string must not drag
// `@/api/db` in with it: db.js registers a
// `supabase.auth.onAuthStateChange` listener at module scope, so any test
// stubbing the supabase client dies on `Cannot read properties of
// undefined (reading 'onAuthStateChange')`. CLAUDE.md documents that trap;
// a key factory is the purest thing in the codebase and has no business
// sitting behind a side effect.
//
// ── Why the keys are scoped ────────────────────────────────────────────
// Six components read workout_logs, and all six used the bare key
// `['workoutLogs', email]` with different queryFns and different limits —
// 50, 50, 500, 1000, 1000, 1000. React Query caches by key, so that was
// not six queries, it was one, and whichever observer happened to trigger
// the fetch decided what all the others got.
//
// The direction of the damage is worth stating precisely, because the
// obvious guess is backwards. Measured against the installed react-query
// with two live QueryObservers: a second observer mounting on a shared key
// does NOT read the stale entry — with the default staleTime of 0 it
// refetches using its OWN queryFn and OVERWRITES the entry for everyone.
//
// So `WorkoutSavedList` was never capped at 50; it got its 500. What broke
// was every other reader. It is a STATIC import in `Workout.jsx` (:30),
// which registers the same key with a limit of 50 (:596) — so opening
// All Workouts ▸ Gym replaced the page's 50-row entry with 500 rows, and
// the page's own stats recomputed over rows it never asked for. Mount
// Dashboard (50) afterwards and Progress (1000) is left holding 50.
//
// Nothing failed loudly. Every consumer received well-formed rows, just not
// necessarily the ones it asked for, and never reproducibly, because the
// winner depends on mount order. This is the identical defect that
// `cardioKeys.js` fixed for cardio_logs on 2026-08-12; the gym half was
// left untouched.
//
// ── Invalidation is deliberately untouched ─────────────────────────────
// React Query matches `queryKey` as a PREFIX unless you pass
// `exact: true`, so the eleven existing
// `invalidateQueries({ queryKey: ['workoutLogs', email] })` calls still
// clear every scope without being edited. Asserted against the installed
// @tanstack/react-query in `workoutLogsKey.test.js`, because the fix being
// small depends entirely on that being true.

/**
 * @param {string} email  the owner
 * @param {string} scope  which reader — 'savedList' | 'workout' |
 *   'dashboard' | 'progress' | 'bodyMetrics' | 'nutritionTargets'.
 *   A NEW reader gets a NEW scope; it does not reuse one, because two
 *   readers sharing a scope is the original bug in miniature.
 */
export const workoutLogsKey = (email, scope) => ['workoutLogs', email, scope];

export default workoutLogsKey;
