// src/lib/pendingWorkout.js
//
// One-shot handoff for "Start workout" from the AI Coach / Quick generator to
// the Workout page. The two routes are separate chunks, so we stash the
// generated session in sessionStorage and the Workout page loads it on mount.
//
// Robust to React StrictMode's dev double-mount: the first (discarded) mount
// would otherwise consume the one-shot, leaving the real mount with nothing.
// We read sessionStorage exactly once into a module-scoped cache (which
// survives the remount) and return it on every read until the Workout page
// explicitly clears it after the session has been applied.

const PENDING_WORKOUT_KEY = 'flexyn.pendingGeneratedWorkout';

let _cache; // undefined = not yet read; object/null once read

export function setPendingWorkout(workout) {
  _cache = undefined; // a fresh handoff supersedes any stale cache
  try { sessionStorage.setItem(PENDING_WORKOUT_KEY, JSON.stringify(workout)); } catch { /* quota */ }
}

/**
 * Read the pending workout. Reads sessionStorage at most once (removing the
 * key so a refresh won't replay it), then serves the cached value on every
 * subsequent call — so a StrictMode remount still sees it. Returns null when
 * there's nothing pending.
 */
export function readPendingWorkout() {
  if (_cache === undefined) {
    try {
      const raw = sessionStorage.getItem(PENDING_WORKOUT_KEY);
      _cache = raw ? JSON.parse(raw) : null;
      if (raw) sessionStorage.removeItem(PENDING_WORKOUT_KEY);
    } catch {
      _cache = null;
    }
  }
  return _cache;
}

/** Clear the cached handoff once it's been applied, so it doesn't replay. */
export function clearPendingWorkout() {
  _cache = null;
}
