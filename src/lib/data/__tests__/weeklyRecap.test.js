import { describe, it, expect } from 'vitest';
import { computeWeeklyRecap } from '../weeklyRecap';
import { subDays, format } from 'date-fns';

// Fixed reference time so the rolling-7-day window is reproducible.
// Picked an arbitrary mid-day to avoid edge cases around UTC midnight.
const NOW = new Date('2026-04-15T18:00:00Z');

function dateNDaysAgo(n) {
  return format(subDays(NOW, n), 'yyyy-MM-dd');
}

function mkLog({ daysAgo, exercises = [] }) {
  return {
    id:   `log-${daysAgo}`,
    date: dateNDaysAgo(daysAgo),
    exercises,
  };
}

function mkSet(weight, reps) {
  return { weight, reps };
}

describe('computeWeeklyRecap — empty / null cases', () => {
  it('returns null when logs is missing', () => {
    expect(computeWeeklyRecap({ now: NOW })).toBeNull();
  });

  it('returns null when logs is empty', () => {
    expect(computeWeeklyRecap({ logs: [], now: NOW })).toBeNull();
  });

  it('returns null when no logs land inside the current 7-day window', () => {
    const logs = [mkLog({ daysAgo: 10, exercises: [{ name: 'Bench', sets: [mkSet(135, 5)] }] })];
    expect(computeWeeklyRecap({ logs, now: NOW })).toBeNull();
  });

  it('skips logs with a missing date instead of throwing', () => {
    const logs = [
      { id: 'orphan', exercises: [{ name: 'Bench', sets: [mkSet(135, 5)] }] },
      mkLog({ daysAgo: 1, exercises: [{ name: 'Squat', sets: [mkSet(225, 5)] }] }),
    ];
    const r = computeWeeklyRecap({ logs, now: NOW });
    expect(r).not.toBeNull();
    expect(r.workouts).toBe(1);
  });
});

describe('computeWeeklyRecap — counts and volume', () => {
  it('partitions logs into this-week and prev-week buckets', () => {
    const logs = [
      mkLog({ daysAgo: 1,  exercises: [{ name: 'Bench', sets: [mkSet(100, 5)] }] }),
      mkLog({ daysAgo: 3,  exercises: [{ name: 'Squat', sets: [mkSet(200, 5)] }] }),
      mkLog({ daysAgo: 9,  exercises: [{ name: 'Bench', sets: [mkSet(100, 5)] }] }),
      mkLog({ daysAgo: 12, exercises: [{ name: 'Bench', sets: [mkSet(100, 5)] }] }),
      mkLog({ daysAgo: 20, exercises: [{ name: 'Bench', sets: [mkSet(100, 5)] }] }),
    ];
    const r = computeWeeklyRecap({ logs, now: NOW });
    expect(r.workouts).toBe(2);
    expect(r.workoutsPrev).toBe(2);
    expect(r.workoutsDelta).toBe(0);
  });

  it('computes volume as sum of weight × reps across sets', () => {
    const logs = [
      mkLog({
        daysAgo: 2,
        exercises: [{
          name: 'Bench',
          sets: [mkSet(135, 5), mkSet(155, 5), mkSet(185, 3)],
        }],
      }),
    ];
    const r = computeWeeklyRecap({ logs, now: NOW });
    // 135*5 + 155*5 + 185*3 = 675 + 775 + 555 = 2005
    expect(r.volumeLbs).toBe(2005);
  });

  it('volumePct compares this week against prev week', () => {
    const logs = [
      mkLog({ daysAgo: 1, exercises: [{ name: 'Bench', sets: [mkSet(100, 10)] }] }),   // 1000
      mkLog({ daysAgo: 9, exercises: [{ name: 'Bench', sets: [mkSet(100, 5)] }] }),    // 500 (prev)
    ];
    const r = computeWeeklyRecap({ logs, now: NOW });
    expect(r.volumePct).toBe(100); // 100% increase
  });

  it('volumePct is null when prior week had zero volume', () => {
    const logs = [
      mkLog({ daysAgo: 1, exercises: [{ name: 'Bench', sets: [mkSet(100, 10)] }] }),
    ];
    const r = computeWeeklyRecap({ logs, now: NOW });
    expect(r.volumePct).toBeNull();
  });
});

describe('computeWeeklyRecap — days active', () => {
  it('counts distinct calendar days across workouts and cardio', () => {
    const logs = [
      mkLog({ daysAgo: 1, exercises: [] }),
      mkLog({ daysAgo: 1, exercises: [] }),  // same day, shouldn't double-count
      mkLog({ daysAgo: 3, exercises: [] }),
    ];
    const cardioLogs = [
      { id: 'c1', date: dateNDaysAgo(2) },
      { id: 'c2', date: dateNDaysAgo(20) }, // outside window — skipped
    ];
    const r = computeWeeklyRecap({ logs, cardioLogs, now: NOW });
    expect(r.daysActive).toBe(3); // days 1, 2, 3
  });
});

describe('computeWeeklyRecap — best lift', () => {
  it('returns the heaviest single set across the week', () => {
    const logs = [
      mkLog({ daysAgo: 1, exercises: [
        { name: 'Bench', sets: [mkSet(135, 5), mkSet(185, 3)] },
        { name: 'Squat', sets: [mkSet(225, 5)] },
      ]}),
      mkLog({ daysAgo: 3, exercises: [
        { name: 'Deadlift', sets: [mkSet(315, 3)] },
      ]}),
    ];
    const r = computeWeeklyRecap({ logs, now: NOW });
    expect(r.bestLift).toEqual({ name: 'Deadlift', weight: 315, reps: 3 });
  });

  it('ignores zero-weight bodyweight sets when picking best lift', () => {
    const logs = [
      mkLog({ daysAgo: 1, exercises: [
        { name: 'Pull-up', sets: [mkSet(0, 10)] },
        { name: 'Bench',   sets: [mkSet(135, 5)] },
      ]}),
    ];
    const r = computeWeeklyRecap({ logs, now: NOW });
    expect(r.bestLift).toEqual({ name: 'Bench', weight: 135, reps: 5 });
  });

  it('best lift is null when nothing has weight > 0', () => {
    const logs = [
      mkLog({ daysAgo: 1, exercises: [
        { name: 'Pull-up', sets: [mkSet(0, 10)] },
      ]}),
    ];
    const r = computeWeeklyRecap({ logs, now: NOW });
    expect(r.bestLift).toBeNull();
  });
});

describe('computeWeeklyRecap — PR detection', () => {
  it('flags an exercise as PR when this week exceeds all prior weeks', () => {
    const logs = [
      mkLog({ daysAgo: 2,  exercises: [{ name: 'Bench', sets: [mkSet(200, 3)] }] }),
      mkLog({ daysAgo: 12, exercises: [{ name: 'Bench', sets: [mkSet(185, 3)] }] }),
      mkLog({ daysAgo: 30, exercises: [{ name: 'Bench', sets: [mkSet(195, 3)] }] }),
    ];
    const r = computeWeeklyRecap({ logs, now: NOW });
    expect(r.prs).toHaveLength(1);
    expect(r.prs[0]).toMatchObject({ name: 'Bench', weight: 200, prevWeight: 195 });
  });

  it('skips first-time exercises (no prior baseline = not a PR)', () => {
    const logs = [
      mkLog({ daysAgo: 1, exercises: [{ name: 'Squat',         sets: [mkSet(225, 5)] }] }),
      mkLog({ daysAgo: 9, exercises: [{ name: 'Some Old Lift', sets: [mkSet(100, 5)] }] }),
    ];
    const r = computeWeeklyRecap({ logs, now: NOW });
    // Squat has no history → not a PR. Some Old Lift wasn't this week.
    expect(r.prs).toHaveLength(0);
  });

  it('matches exercise names case-insensitively', () => {
    const logs = [
      mkLog({ daysAgo: 1,  exercises: [{ name: 'bench press', sets: [mkSet(225, 3)] }] }),
      mkLog({ daysAgo: 12, exercises: [{ name: 'Bench Press', sets: [mkSet(215, 3)] }] }),
    ];
    const r = computeWeeklyRecap({ logs, now: NOW });
    expect(r.prs).toHaveLength(1);
    expect(r.prs[0].prevWeight).toBe(215);
  });

  it('caps at 3 PRs, sorted by largest delta', () => {
    const logs = [
      // This week
      mkLog({ daysAgo: 1, exercises: [
        { name: 'A', sets: [mkSet(101, 1)] }, // +1
        { name: 'B', sets: [mkSet(150, 1)] }, // +50
        { name: 'C', sets: [mkSet(120, 1)] }, // +20
        { name: 'D', sets: [mkSet(110, 1)] }, // +10
      ]}),
      // Prior baseline
      mkLog({ daysAgo: 12, exercises: [
        { name: 'A', sets: [mkSet(100, 1)] },
        { name: 'B', sets: [mkSet(100, 1)] },
        { name: 'C', sets: [mkSet(100, 1)] },
        { name: 'D', sets: [mkSet(100, 1)] },
      ]}),
    ];
    const r = computeWeeklyRecap({ logs, now: NOW });
    expect(r.prs).toHaveLength(3);
    expect(r.prs.map(p => p.name)).toEqual(['B', 'C', 'D']);
  });
});
