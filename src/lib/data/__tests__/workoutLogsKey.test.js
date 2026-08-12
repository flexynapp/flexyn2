/**
 * Six workout_logs readers, six cache entries.
 *
 * They all used the bare key `['workoutLogs', email]` with different
 * queryFns and different limits — 50, 50, 500, 1000, 1000, 1000. React
 * Query caches by key, so that was not six queries, it was one, and
 * whichever observer triggered the fetch decided what every other
 * component received.
 *
 * The sharpest case is All Workouts ▸ Gym. `WorkoutSavedList` asks for 500
 * and is a STATIC import in `Workout.jsx` (:30), which registers the same
 * key with a limit of 50 (:596) and mounts first — so the one surface whose
 * whole job is "show me every workout" could never see past 50, and its own
 * 500 never ran.
 *
 * Nothing failed loudly: every consumer got well-formed rows, just not
 * necessarily the ones it asked for, and never reproducibly — the winner
 * depends on mount order. This is the identical defect `cardioLogsKey`
 * fixed for cardio_logs; the gym half was left untouched.
 *
 * Both properties are tested against a REAL QueryClient rather than
 * asserted about arrays, because the second one is the reason the fix could
 * stay small: invalidation still works untouched.
 */
import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { workoutLogsKey } from '@/lib/data/workoutKeys';

// Every scope in use, so a seventh reader added without a scope shows up.
const SCOPES = ['savedList', 'workout', 'dashboard', 'progress',
                'bodyMetrics', 'nutritionTargets'];
const EMAIL = 'k@x.com';

describe('workoutLogsKey', () => {
  it('gives every reader a distinct key', () => {
    const keys = SCOPES.map(s => JSON.stringify(workoutLogsKey(EMAIL, s)));
    expect(new Set(keys).size).toBe(SCOPES.length);
  });

  it('keeps the shared prefix, which is what invalidation matches on', () => {
    for (const s of SCOPES) {
      expect(workoutLogsKey(EMAIL, s).slice(0, 2)).toEqual(['workoutLogs', EMAIL]);
    }
  });

  it('separates users as well as scopes', () => {
    expect(workoutLogsKey('a@x.com', 'savedList'))
      .not.toEqual(workoutLogsKey('b@x.com', 'savedList'));
  });
});

describe('the cache actually keeps them apart', () => {
  it("Workout.jsx's 50 rows cannot serve the saved list's 500", () => {
    const qc = new QueryClient();
    // Workout.jsx mounts first and lands its 50.
    qc.setQueryData(workoutLogsKey(EMAIL, 'workout'), Array.from({ length: 50 }, (_, i) => ({ id: i })));
    // The saved list asks a different question and has not been answered yet.
    expect(qc.getQueryData(workoutLogsKey(EMAIL, 'savedList'))).toBeUndefined();
  });

  it('each scope holds its own rows at the same time', () => {
    const qc = new QueryClient();
    qc.setQueryData(workoutLogsKey(EMAIL, 'workout'), [{ id: '1' }]);
    qc.setQueryData(workoutLogsKey(EMAIL, 'savedList'), [{ id: '1' }, { id: '2' }, { id: '3' }]);
    expect(qc.getQueryData(workoutLogsKey(EMAIL, 'workout'))).toHaveLength(1);
    expect(qc.getQueryData(workoutLogsKey(EMAIL, 'savedList'))).toHaveLength(3);
  });

  it('the OLD bare key is what collapsed them — one entry, first writer wins', () => {
    const qc = new QueryClient();
    qc.setQueryData(['workoutLogs', EMAIL], Array.from({ length: 50 }, (_, i) => ({ id: i })));
    // This is what every reader got, whatever limit it asked for.
    expect(qc.getQueryData(['workoutLogs', EMAIL])).toHaveLength(50);
  });
});

describe('the eleven existing invalidations still reach every scope', () => {
  // This is the property that lets the fix stay small. React Query matches
  // queryKey as a PREFIX unless `exact: true`, so every save/edit/delete
  // path can keep calling invalidateQueries({ queryKey: ['workoutLogs',
  // email] }) with no edit at all. If that were ever false, saving a
  // workout would refresh nothing and the bug would be worse than the one
  // being fixed.
  it('a bare prefix invalidation marks all six stale', async () => {
    const qc = new QueryClient();
    for (const s of SCOPES) qc.setQueryData(workoutLogsKey(EMAIL, s), [{ id: s }]);
    SCOPES.forEach(s =>
      expect(qc.getQueryState(workoutLogsKey(EMAIL, s)).isInvalidated).toBe(false));

    await qc.invalidateQueries({ queryKey: ['workoutLogs', EMAIL] });

    SCOPES.forEach(s =>
      expect(qc.getQueryState(workoutLogsKey(EMAIL, s)).isInvalidated,
        `${s} was not invalidated`).toBe(true));
  });

  it('does not invalidate another user on the way past', async () => {
    const qc = new QueryClient();
    qc.setQueryData(workoutLogsKey('a@x.com', 'savedList'), [{ id: 'a' }]);
    qc.setQueryData(workoutLogsKey('b@x.com', 'savedList'), [{ id: 'b' }]);
    await qc.invalidateQueries({ queryKey: ['workoutLogs', 'a@x.com'] });
    expect(qc.getQueryState(workoutLogsKey('b@x.com', 'savedList')).isInvalidated).toBe(false);
  });
});
