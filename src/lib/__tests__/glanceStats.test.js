import { describe, it, expect } from 'vitest';
import {
  personalBestEvents,
  personalBestCounts,
  rawVolume,
  weeklyVolumeSeries,
  startOfWeekMonday,
} from '@/lib/glanceStats';

const NOW = new Date(2026, 8, 27, 12); // Sunday 27 Sep 2026, local
const log = (date, exercises) => ({ date, exercises });
const ex = (name, sets) => ({ name, sets: sets.map(([weight, reps]) => ({ weight, reps })) });

describe('startOfWeekMonday', () => {
  it('goes back to local Monday, including from a Sunday', () => {
    expect(startOfWeekMonday(NOW)).toEqual(new Date(2026, 8, 21));
    expect(startOfWeekMonday(new Date(2026, 8, 21, 0, 5))).toEqual(new Date(2026, 8, 21));
  });
});

describe('personalBestEvents', () => {
  it('does not count the first time an exercise is logged', () => {
    expect(personalBestEvents([log('2026-09-27', [ex('Bench', [[135, 5]]), ex('Squat', [[185, 5]])])])).toEqual([]);
  });

  it('records a heavier top set with the reps done at that weight, oldest first', () => {
    const logs = [
      log('2026-09-26', [ex('Bench', [[155, 3], [135, 8]])]),
      log('2026-08-10', [ex('Bench', [[135, 5]]), ex('Squat', [[185, 5]])]),
      log('2026-09-05', [ex('Squat', [[195, 5]]), ex('Bench', [[135, 8]])]),
    ];
    expect(personalBestEvents(logs)).toEqual([
      { name: 'Squat', date: '2026-09-05', weight: 195, reps: 5 },
      { name: 'Bench', date: '2026-09-26', weight: 155, reps: 3 },
    ]);
  });

  it('counts reps for a bodyweight movement', () => {
    const logs = [log('2026-09-01', [ex('Pull Up', [[0, 8]])]), log('2026-09-20', [ex('Pull Up', [[0, 10]])])];
    expect(personalBestEvents(logs)).toEqual([{ name: 'Pull Up', date: '2026-09-20', weight: 0, reps: 10 }]);
  });

  it('survives empty and malformed rows', () => {
    expect(personalBestEvents()).toEqual([]);
    expect(personalBestEvents([null, { date: null }, log('2026-09-02', [{ sets: [] }])])).toEqual([]);
  });
});

describe('personalBestCounts', () => {
  it('splits this month and this Monday week', () => {
    const events = [
      { date: '2026-08-30' }, // last month
      { date: '2026-09-05' }, // this month, earlier week
      { date: '2026-09-21' }, // this week (Monday)
      { date: '2026-09-27' }, // today
    ];
    expect(personalBestCounts(events, NOW)).toEqual({ month: 3, week: 2 });
    expect(personalBestCounts([], NOW)).toEqual({ month: 0, week: 0 });
  });
});

describe('volume', () => {
  it('rawVolume sums weight × reps only', () => {
    expect(rawVolume([log('2026-09-01', [ex('Bench', [[100, 5], [100, 5]])])])).toBe(1000);
    expect(rawVolume([])).toBe(0);
  });

  it('weeklyVolumeSeries buckets by local Monday week, current week last', () => {
    const logs = [
      log('2026-09-21', [ex('Bench', [[100, 10]])]), // this week, Monday
      log('2026-09-20', [ex('Bench', [[100, 5]])]),  // last week, Sunday
      log('2026-07-01', [ex('Bench', [[100, 5]])]),  // outside the window
    ];
    const series = weeklyVolumeSeries(logs, NOW, 4);
    expect(series).toEqual([0, 0, 500, 1000]);
  });
});
