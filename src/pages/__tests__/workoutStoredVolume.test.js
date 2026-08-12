// src/pages/__tests__/workoutStoredVolume.test.js
//
// Two standing checks on the number Workout.jsx PERSISTS to
// workout_logs.total_volume. Both guard decisions whose failure mode is
// silent, which is why they are asserted on the source text rather than
// through a render: a component test would have to reach an authenticated
// save or edit to observe either one, and neither breaks visibly when it
// regresses.
//
//   1. Every WorkoutLog.update() writes total_volume.
//
//      EditWorkoutModal's onSave payload carries only the fields it edits
//      — { exercises, date, duration_minutes, notes, regimen_name, tags }.
//      Both handlers computed the new volume for the total_volume_lbs
//      delta and then called update() with that payload, so an edit
//      rewrote `exercises` and left the denormalised column at its
//      PRE-EDIT value. Measured against production on 2026-08-09 in a
//      rolled-back transaction as the gym member: save a session at
//      1000 lb, edit it down to 500, and get_gym_community_progress still
//      reported 1000. get_gym_leaderboard ranks members on the same
//      column. The profile delta was always right; only the row was
//      stale, so nothing anywhere disagreed loudly enough to notice.
//
//   2. The stored volume stays RAW — includeBarWeight: false.
//
//      include_bar_in_volume adds 45 lb per rep on barbell sets. It is a
//      display preference (the live pill honours it, and the share card
//      and saved list re-derive it), and commit 5fc8895f took it out of
//      the persisted path deliberately: the stored column is ranked,
//      summed into the gym's public "lbs moved", and spent as XP, so
//      persisting a per-user preference would climb one member past
//      another who lifted the same weight. It also keeps the column equal
//      to migration 329's backfill by construction.
//
//      This one cannot be caught by testing: 0 of 43 profiles have the
//      flag on, so re-adding the preference passes every test and every
//      manual check, and only diverges once a real user opts in.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(
  resolve(process.cwd(), 'src/pages/Workout.jsx'),
  'utf8',
);

describe('workout_logs.total_volume — what Workout.jsx stores', () => {
  it('writes total_volume on every WorkoutLog.update', () => {
    const calls = SOURCE.split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => line.includes('WorkoutLog.update('));

    // If this drops to zero the check has been silently disarmed by a
    // rename — fail rather than vacuously pass.
    expect(calls.length).toBeGreaterThan(0);

    const missing = calls.filter(({ line }) => !line.includes('total_volume'));
    expect(
      missing.map(({ n, line }) => `${n}: ${line.trim()}`),
      'a WorkoutLog.update() that does not write total_volume leaves the ' +
        'gym leaderboard ranking on the pre-edit number',
    ).toEqual([]);
  });

  it('stores raw volume, never the bar-weight preference', () => {
    const stored = SOURCE.match(/computeTotalVolume\(exList[^\n]*/);
    expect(stored, 'calculateTotalVolume definition not found').not.toBeNull();
    expect(stored[0]).toContain('includeBarWeight: false');

    // The specific regression: threading the profile flag back into the
    // value that gets persisted.
    expect(
      /computeTotalVolume\(exList[^\n]*include_bar_in_volume/.test(SOURCE),
      'the persisted volume must not read include_bar_in_volume — it is a ' +
        'display preference, and the stored column is ranked and spent',
    ).toBe(false);
  });
});

// ── Two more save-path invariants, asserted the same way and for the same
// reason: both regress silently, and observing either through a render
// would mean reaching an authenticated save.

describe('the save payload cannot be stored empty', () => {
  // The Save button guards `exercises.length === 0` on the array the USER
  // sees. The empty-set filter runs later, on the way to the insert, so
  // they are looking at two different arrays — and shouldKeepSet drops a
  // set unless reps > 0 AND (weight > 0 OR bodyweight OR cardio). A
  // WEIGHTED lift logged with reps and no weight therefore emptied the
  // whole session and saved exercises:[] behind a success toast.
  //
  // Production row dad0ba31 is one, written 2026-07-26 — six weeks AFTER
  // the bodyweight branch (17e2357c) closed the calisthenics half, which
  // is what rules that out as the explanation.
  it('throws EMPTY_WORKOUT rather than inserting exercises:[]', () => {
    expect(
      /code\s*=\s*'EMPTY_WORKOUT'/.test(SOURCE),
      'the empty-payload guard is gone — a session whose sets are all ' +
        'filtered out will be stored as exercises:[] behind a success toast',
    ).toBe(true);
  });

  it('guards AFTER the filter, not before it', () => {
    // Order is the whole point: a guard above the filter is the one the
    // Save button already does, and it is the one that does not work.
    const filterAt = SOURCE.indexOf('shouldKeepSet');
    const guardAt = SOURCE.indexOf("code = 'EMPTY_WORKOUT'");
    expect(filterAt, 'shouldKeepSet filter not found').toBeGreaterThan(-1);
    expect(guardAt, 'EMPTY_WORKOUT guard not found').toBeGreaterThan(-1);
    expect(
      guardAt > filterAt,
      'the guard must run AFTER the empty-set filter — before it, it is ' +
        'checking the same array the Save button already checked',
    ).toBe(true);
  });
});

describe('the optimistic save reaches every workoutLogs scope', () => {
  // workoutKeys.js gave the six readers their own cache entries. The
  // optimistic insert wrote to the BARE key, which after scoping nobody
  // reads — so the row you just saved would stop appearing until the
  // refetch landed. setQueriesData matches by prefix and restores the old
  // behaviour exactly; the singular setQueryData does not.
  it('uses setQueriesData, not setQueryData, for the optimistic row', () => {
    expect(
      /setQueriesData\(\{\s*queryKey:\s*\['workoutLogs'/.test(SOURCE),
      'the optimistic insert must write by PREFIX — with scoped keys, a ' +
        "singular setQueryData(['workoutLogs', email]) writes to an entry " +
        'no component reads',
    ).toBe(true);
  });

  it('captures rollback state by prefix too', () => {
    expect(
      /getQueriesData\(\{\s*queryKey:\s*\['workoutLogs'/.test(SOURCE),
      'rollback must capture every matched scope, or a failed save ' +
        'restores one entry and leaves the others holding the optimistic row',
    ).toBe(true);
  });
});
