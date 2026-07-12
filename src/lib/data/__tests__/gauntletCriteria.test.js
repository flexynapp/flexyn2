// Tests for evaluateChallengeCriteria — the pure predicate behind the
// Gauntlet path detector. Covers every one of the six metric types the
// 060_gauntlet.sql seed uses, across all 10 challenges.
import { describe, it, expect } from 'vitest';
import { evaluateChallengeCriteria } from '@/lib/data/gauntlet';

// ── Fixtures ────────────────────────────────────────────────────────────────
const set = (reps, weight) => ({ reps, weight });
// A "full" exercise: real reps + real weight on every set.
const ex = (name, sets = [set(5, 100)]) => ({ name, muscle_group: 'chest', sets });
const cardioEx = (name = 'Treadmill') => ({ name, muscle_group: 'cardio', sets: [set(1, 0)] });

// N full exercises, no skipped sets.
const fullSession = (n, date = '2026-07-10') => ({
  date,
  exercises: Array.from({ length: n }, (_, i) => ex(`Lift ${i}`)),
});

// A session whose total volume is exactly `vol` (one exercise, one set).
const volSession = (vol, date = '2026-07-10') => ({
  date,
  exercises: [ex('Barbell Squat', [set(1, vol)])],
});

const C = (metric, target_value) => ({ metric, target_value, sequence_number: 1 });

describe('evaluateChallengeCriteria', () => {
  // ── 1 & 5: min_exercises_no_skip ──────────────────────────────────────────
  it('min_exercises_no_skip: passes at/above target with no skips', () => {
    expect(evaluateChallengeCriteria(C('min_exercises_no_skip', 4), { workoutLog: fullSession(4) }).met).toBe(true);
    expect(evaluateChallengeCriteria(C('min_exercises_no_skip', 5), { workoutLog: fullSession(5) }).met).toBe(true);
  });
  it('min_exercises_no_skip: fails below target', () => {
    expect(evaluateChallengeCriteria(C('min_exercises_no_skip', 4), { workoutLog: fullSession(3) }).met).toBe(false);
  });
  it('min_exercises_no_skip: a zero-weight non-cardio set counts as skipped', () => {
    const log = { date: '2026-07-10', exercises: [ex('A'), ex('B'), ex('C'), ex('D', [set(5, 0)])] };
    expect(evaluateChallengeCriteria(C('min_exercises_no_skip', 4), { workoutLog: log }).met).toBe(false);
  });
  it('min_exercises_no_skip: cardio is exempt from the weight check', () => {
    const log = { date: '2026-07-10', exercises: [ex('A'), ex('B'), ex('C'), cardioEx()] };
    expect(evaluateChallengeCriteria(C('min_exercises_no_skip', 4), { workoutLog: log }).met).toBe(true);
  });

  // ── 3: session_volume ─────────────────────────────────────────────────────
  it('session_volume: passes when a single session hits the target', () => {
    expect(evaluateChallengeCriteria(C('session_volume', 10000), { workoutLog: volSession(10000) }).met).toBe(true);
    expect(evaluateChallengeCriteria(C('session_volume', 10000), { workoutLog: volSession(9999) }).met).toBe(false);
  });

  // ── 2, 4, 6: sessions_in_N_days ───────────────────────────────────────────
  it('sessions_in_7_days: counts distinct DAYS in the trailing window', () => {
    const ctx = {
      workoutLog: fullSession(1, '2026-07-10'),
      historicalLogs: [fullSession(1, '2026-07-08'), fullSession(1, '2026-07-05')],
      todayStr: '2026-07-10',
    };
    expect(evaluateChallengeCriteria(C('sessions_in_7_days', 3), ctx).met).toBe(true);
  });
  it('sessions_in_7_days: two logs on the same day count once', () => {
    const ctx = {
      workoutLog: fullSession(1, '2026-07-10'),
      historicalLogs: [fullSession(1, '2026-07-10'), fullSession(1, '2026-07-09')],
      todayStr: '2026-07-10',
    };
    expect(evaluateChallengeCriteria(C('sessions_in_7_days', 3), ctx).met).toBe(false); // only 2 distinct days
  });
  it('sessions_in_7_days: a session older than 7 days is excluded', () => {
    const ctx = {
      workoutLog: fullSession(1, '2026-07-10'),
      historicalLogs: [fullSession(1, '2026-07-09'), fullSession(1, '2026-07-01')], // 07-01 is 9 days back
      todayStr: '2026-07-10',
    };
    expect(evaluateChallengeCriteria(C('sessions_in_7_days', 3), ctx).met).toBe(false);
  });
  it('sessions_in_5_days: uses a tighter 5-day window', () => {
    const ctx = {
      workoutLog: fullSession(1, '2026-07-10'),
      historicalLogs: [fullSession(1, '2026-07-09'), fullSession(1, '2026-07-08'), fullSession(1, '2026-07-04')],
      todayStr: '2026-07-10',
    };
    // 07-10, 07-09, 07-08 are in-window (3); 07-04 is 6 days back (out).
    expect(evaluateChallengeCriteria(C('sessions_in_5_days', 4), ctx).met).toBe(false);
    expect(evaluateChallengeCriteria(C('sessions_in_5_days', 3), ctx).met).toBe(true);
  });

  // ── 7 & 10: weekly_lbs ────────────────────────────────────────────────────
  it('weekly_lbs: sums the current Monday-start week only', () => {
    // Week of 2026-07-10 (Fri) starts Mon 2026-07-06.
    const ctx = {
      workoutLog: volSession(20000, '2026-07-10'),
      historicalLogs: [volSession(35000, '2026-07-07'), volSession(9999, '2026-07-05')], // 07-05 is prior week
      todayStr: '2026-07-10',
    };
    const res = evaluateChallengeCriteria(C('weekly_lbs', 50000), ctx);
    expect(res.score).toBe(55000); // 20000 + 35000, excludes 07-05
    expect(res.met).toBe(true);
  });
  it('weekly_lbs: 100k final gauntlet', () => {
    const ctx = {
      workoutLog: volSession(60000, '2026-07-10'),
      historicalLogs: [volSession(45000, '2026-07-06')],
      todayStr: '2026-07-10',
    };
    expect(evaluateChallengeCriteria(C('weekly_lbs', 100000), ctx).met).toBe(true);
  });

  // ── 8: consecutive_days ───────────────────────────────────────────────────
  it('consecutive_days: reads the authoritative streak value', () => {
    expect(evaluateChallengeCriteria(C('consecutive_days', 14), { workoutStreakDays: 14 }).met).toBe(true);
    expect(evaluateChallengeCriteria(C('consecutive_days', 14), { workoutStreakDays: 13 }).met).toBe(false);
  });

  // ── 9: any_compound_pr ────────────────────────────────────────────────────
  it('any_compound_pr: true when a compound lift beats its historical best', () => {
    const ctx = {
      workoutLog: { date: '2026-07-10', exercises: [ex('Barbell Deadlift', [set(1, 405)])] },
      historicalLogs: [{ date: '2026-07-01', exercises: [ex('Barbell Deadlift', [set(1, 315)])] }],
    };
    expect(evaluateChallengeCriteria(C('any_compound_pr', null), ctx).met).toBe(true);
  });
  it('any_compound_pr: an isolation-lift PR does NOT count', () => {
    const ctx = {
      workoutLog: { date: '2026-07-10', exercises: [ex('Bicep Curl', [set(1, 60)])] },
      historicalLogs: [{ date: '2026-07-01', exercises: [ex('Bicep Curl', [set(1, 40)])] }],
    };
    expect(evaluateChallengeCriteria(C('any_compound_pr', null), ctx).met).toBe(false);
  });
  it('any_compound_pr: a first-ever attempt is not a PR', () => {
    const ctx = {
      workoutLog: { date: '2026-07-10', exercises: [ex('Back Squat', [set(1, 225)])] },
      historicalLogs: [],
    };
    expect(evaluateChallengeCriteria(C('any_compound_pr', null), ctx).met).toBe(false);
  });

  // ── unknown metric is a safe no-op ────────────────────────────────────────
  it('unknown metric never fires', () => {
    expect(evaluateChallengeCriteria(C('made_up_metric', 1), { workoutLog: fullSession(9) }).met).toBe(false);
  });
});
