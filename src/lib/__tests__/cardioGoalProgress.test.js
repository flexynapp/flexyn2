/**
 * The shared cardio goal calculator.
 *
 * This exists because there were THREE implementations of "how far along
 * is this cardio goal" — a private one in GoalsAlmostComplete, an inline
 * one in GoalsList, and a third in CardioGoals that ran off calendar-week
 * bounds rather than the goal's own period_start_date. The third also
 * read `goal_type = 'cardio'`, a value nothing else in the app writes, so
 * the Cardio → Goals screen reported "No cardio goals yet" to an account
 * holding two.
 *
 * The tests that matter here are the two filters and the vocabulary,
 * because those are what the three copies disagreed about.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  computeCardioGoalProgress,
  matchesActivity,
  isCardioGoal,
  periodStartDate,
  metThisPeriod,
  CARDIO_GOAL_TYPES,
} from '@/lib/goalProgress';

/** A cardio_logs row. `created_date` is when it was WRITTEN, `date` is
 *  the day it happened — the calculator uses both, for different filters. */
const log = (o) => ({
  type: 'running_outside',
  date: '2026-08-10',
  created_date: '2026-08-10T12:00:00Z',
  distance_meters: 5000,
  duration_seconds: 1800,
  ...o,
});

const goal = (o) => ({
  goal_type: 'cardio_distance',
  cardio_activity: 'running',
  period: 'lifetime',
  period_start_date: null,
  created_date: '2026-08-01T00:00:00Z',
  target_distance_meters: 10000,
  ...o,
});

describe('the vocabulary', () => {
  it('is exactly the three types the rest of the app writes', () => {
    expect(CARDIO_GOAL_TYPES).toEqual(['cardio_distance', 'cardio_duration', 'cardio_sessions']);
  });

  // The bug this whole change is about: 'cardio' was a fourth value that
  // only CardioGoals wrote and only CardioGoals read.
  it('does not accept the bare "cardio" type that used to be written here', () => {
    expect(isCardioGoal({ goal_type: 'cardio' })).toBe(false);
    expect(computeCardioGoalProgress({ goal_type: 'cardio' }, [log()])).toEqual({
      currentValue: 0, target: 0, progress: 0,
    });
  });

  it('rejects strength goals and junk', () => {
    expect(isCardioGoal({ goal_type: 'strength' })).toBe(false);
    expect(isCardioGoal({})).toBe(false);
    expect(isCardioGoal(null)).toBe(false);
  });
});

describe('activity matching', () => {
  it('matches on the mode prefix up to the underscore', () => {
    expect(matchesActivity('running_outside', 'running')).toBe(true);
    expect(matchesActivity('running_treadmill', 'running')).toBe(true);
    expect(matchesActivity('walking_outside', 'running')).toBe(false);
  });

  it('requires the underscore, so a longer mode cannot match a shorter one', () => {
    // The guard that a bare `startsWith(activity)` would miss.
    expect(matchesActivity('runningmachine_x', 'running')).toBe(false);
  });

  it('"any" takes everything', () => {
    expect(matchesActivity('swimming_pool', 'any')).toBe(true);
    expect(matchesActivity('biking_stationary', 'any')).toBe(true);
  });
});

describe('the three metrics', () => {
  it('sums distance', () => {
    const r = computeCardioGoalProgress(goal(), [log({ distance_meters: 4000 }), log({ distance_meters: 1000 })]);
    expect(r.currentValue).toBe(5000);
    expect(r.target).toBe(10000);
    expect(r.progress).toBe(50);
  });

  it('sums duration', () => {
    const g = goal({ goal_type: 'cardio_duration', target_duration_seconds: 3600 });
    const r = computeCardioGoalProgress(g, [log({ duration_seconds: 900 }), log({ duration_seconds: 900 })]);
    expect(r.currentValue).toBe(1800);
    expect(r.progress).toBe(50);
  });

  it('counts sessions', () => {
    const g = goal({ goal_type: 'cardio_sessions', target_sessions: 4 });
    const r = computeCardioGoalProgress(g, [log(), log(), log()]);
    expect(r.currentValue).toBe(3);
    expect(r.progress).toBe(75);
  });
});

describe('the two filters — what the three copies disagreed about', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('ignores logs from before the goal existed', () => {
    // Otherwise creating "run 10 km this month" on the 28th completes
    // instantly off runs the user did before they set the goal.
    const g = goal({ created_date: '2026-08-05T00:00:00Z' });
    const r = computeCardioGoalProgress(g, [
      log({ created_date: '2026-08-01T00:00:00Z', distance_meters: 9000 }),
      log({ created_date: '2026-08-06T00:00:00Z', distance_meters: 2000 }),
    ]);
    expect(r.currentValue).toBe(2000);
  });

  it('counts only the current week on a weekly goal', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 12)); // Wednesday; the week began Monday the 10th
    const g = goal({ period: 'week', period_start_date: '2026-08-10', created_date: '2026-01-01T00:00:00Z' });
    const r = computeCardioGoalProgress(g, [
      log({ date: '2026-08-09', distance_meters: 8000 }),
      log({ date: '2026-08-11', distance_meters: 3000 }),
    ]);
    expect(r.currentValue).toBe(3000);
  });

  it('starts a weekly goal over the next Monday, whatever week it was set in', () => {
    // period_start_date is the week the goal was made. Counting from it
    // forever meant "10 km this week" became "10 km since that week".
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 19, 12)); // the Wednesday after
    const g = goal({ period: 'week', period_start_date: '2026-08-10', created_date: '2026-01-01T00:00:00Z' });
    const r = computeCardioGoalProgress(g, [
      log({ date: '2026-08-11', distance_meters: 10000 }),
      log({ date: '2026-08-18', distance_meters: 2000 }),
    ]);
    expect(r.currentValue).toBe(2000);
    expect(r.progress).toBe(20);
  });

  it('starts a monthly goal over on the 1st', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 12)); // 3 September
    const g = goal({ period: 'month', period_start_date: '2026-08-01', created_date: '2026-01-01T00:00:00Z' });
    const r = computeCardioGoalProgress(g, [
      log({ date: '2026-08-30', distance_meters: 9000 }),
      log({ date: '2026-09-02', distance_meters: 4000 }),
    ]);
    expect(r.currentValue).toBe(4000);
  });

  it('applies NO period floor to a lifetime goal', () => {
    // Both production cardio goals are lifetime. CardioGoals used to
    // clamp every goal to the current calendar month, which made a
    // lifetime goal impossible to satisfy from older logs.
    const g = goal({ period: 'lifetime', period_start_date: '2026-08-10', created_date: '2026-01-01T00:00:00Z' });
    const r = computeCardioGoalProgress(g, [
      log({ date: '2026-02-01', distance_meters: 6000 }),
      log({ date: '2026-08-11', distance_meters: 4000 }),
    ]);
    expect(r.currentValue).toBe(10000);
    expect(r.progress).toBe(100);
  });

  it('filters by activity', () => {
    const r = computeCardioGoalProgress(goal(), [
      log({ type: 'running_outside', distance_meters: 3000 }),
      log({ type: 'biking_outside', distance_meters: 20000 }),
    ]);
    expect(r.currentValue).toBe(3000);
  });
});

describe('malformed goals report 0, never NaN', () => {
  it('handles a missing target', () => {
    const r = computeCardioGoalProgress(goal({ target_distance_meters: null }), [log()]);
    expect(r.progress).toBe(0);
    expect(r.target).toBe(0);
    expect(Number.isNaN(r.progress)).toBe(false);
  });

  it('handles a NaN target from a bad paste', () => {
    const r = computeCardioGoalProgress(goal({ target_distance_meters: NaN }), [log()]);
    expect(r.progress).toBe(0);
  });

  it('handles no logs at all', () => {
    expect(computeCardioGoalProgress(goal(), []).progress).toBe(0);
    expect(computeCardioGoalProgress(goal(), null).progress).toBe(0);
  });

  it('clamps overshoot to 100', () => {
    const r = computeCardioGoalProgress(goal(), [log({ distance_meters: 999999 })]);
    expect(r.progress).toBe(100);
  });

  it('survives null rows in the list', () => {
    const r = computeCardioGoalProgress(goal(), [null, log({ distance_meters: 1000 }), undefined]);
    expect(r.currentValue).toBe(1000);
  });
});

// The exact rows that were in production on 2026-08-11, when the Cardio →
// Goals screen was reporting "No cardio goals yet" at an account holding
// both of these. Queried, not invented. If this block ever goes red, the
// screen has gone blind to real goals again.
describe('the two goals the screen could not see', () => {
  const RUN_A_5K = (createdDate) => ({
    title: 'Run a 5K',
    goal_type: 'cardio_distance',
    cardio_activity: 'running',
    period: 'lifetime',
    period_start_date: null,
    target_distance_meters: 5000,
    created_date: createdDate,
    status: 'active',
  });

  const PROD_RUNS = [
    { date: '2026-05-13', created_date: '2026-05-14T00:42:15.962574Z', type: 'running_outside',   distance_meters: 11265 },
    { date: '2026-07-15', created_date: '2026-07-15T23:16:08.453521Z', type: 'running_outside',   distance_meters: 8047 },
    { date: '2026-08-09', created_date: '2026-08-09T05:25:33.591850Z', type: 'running_treadmill', distance_meters: 3219 },
  ];

  it('both are recognised as cardio goals', () => {
    expect(isCardioGoal(RUN_A_5K('2026-08-09T01:40:54Z'))).toBe(true);
    expect(isCardioGoal(RUN_A_5K('2026-07-26T03:52:50Z'))).toBe(true);
  });

  it('the newer one counts only the treadmill run that postdates it', () => {
    const r = computeCardioGoalProgress(RUN_A_5K('2026-08-09T01:40:54.392756Z'), PROD_RUNS);
    expect(r.currentValue).toBe(3219);
    expect(Math.round(r.progress)).toBe(64);
  });

  it('the older one also excludes the July run, which predates it by 11 days', () => {
    const r = computeCardioGoalProgress(RUN_A_5K('2026-07-26T03:52:50.367130Z'), PROD_RUNS);
    expect(r.currentValue).toBe(3219);
    expect(Math.round(r.progress)).toBe(64);
  });

  it('counts a TREADMILL run toward a "running" goal', () => {
    // The one log that counts is running_treadmill, not running_outside.
    // A matcher keyed on the full type rather than the mode prefix would
    // score both these goals at 0% and look plausible doing it.
    expect(matchesActivity('running_treadmill', 'running')).toBe(true);
  });
});

describe('periodStartDate', () => {
  it('returns null for lifetime, which is what "no floor" means', () => {
    expect(periodStartDate('lifetime')).toBe(null);
    expect(periodStartDate(undefined)).toBe(null);
  });

  it('returns a yyyy-MM-dd string for week and month', () => {
    expect(periodStartDate('week')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(periodStartDate('month')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('starts the month on the 1st', () => {
    expect(periodStartDate('month').slice(-2)).toBe('01');
  });

  it('starts the week on a Monday', () => {
    // Parsed as local time (no Z) so this reads the same weekday the
    // helper computed, rather than shifting under UTC.
    const [y, m, d] = periodStartDate('week').split('-').map(Number);
    expect(new Date(y, m - 1, d).getDay()).toBe(1);
  });

  it('never returns tomorrow — the local-date bug toISOString() would cause', () => {
    const start = periodStartDate('month');
    const now = new Date();
    const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(start <= todayLocal).toBe(true);
  });
});

describe('metThisPeriod', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('is true only for a week or month goal met in the current period', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 12)); // week of Monday 10 August
    expect(metThisPeriod(goal({ period: 'week', period_met_start: '2026-08-10' }))).toBe(true);
    expect(metThisPeriod(goal({ period: 'week', period_met_start: '2026-08-03' }))).toBe(false);
    expect(metThisPeriod(goal({ period: 'week', period_met_start: null }))).toBe(false);
    expect(metThisPeriod(goal({ period: 'month', period_met_start: '2026-08-01' }))).toBe(true);
    expect(metThisPeriod(goal({ period: 'month', period_met_start: '2026-07-01' }))).toBe(false);
  });

  it('never applies to a lifetime goal', () => {
    expect(metThisPeriod(goal({ period: 'lifetime', period_met_start: '2099-01-01' }))).toBe(false);
  });
});
