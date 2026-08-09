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
