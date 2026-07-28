// Tests for src/lib/trainingWeek — the week strip and streak on the profile
// hero. Both are derived from the same logs on purpose, so the cases that
// matter are the ones where a naive implementation would make them disagree
// with each other or with the calendar the user is standing in.

import { describe, it, expect } from 'vitest';
import { buildTrainingWeek, currentStreak, trainedDayKeys } from '../trainingWeek';

// Local-midday timestamps, so no case here is decided by the runner's offset.
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);
const log = (dateStr) => ({ date: dateStr });

const NOW = at(2026, 7, 27); // Monday 27 July 2026, local noon

describe('trainedDayKeys', () => {
  it('buckets bare YYYY-MM-DD without shifting timezone', () => {
    // new Date('2026-07-27') is UTC midnight — the 26th for anyone west of
    // Greenwich. Bare dates must be treated as local calendar days.
    const keys = trainedDayKeys([log('2026-07-27')]);
    expect(keys.has('2026-07-27')).toBe(true);
    expect(keys.has('2026-07-26')).toBe(false);
  });

  it('buckets full timestamps by local day', () => {
    const keys = trainedDayKeys([{ date: at(2026, 7, 25, 23).toISOString() }]);
    expect(keys.has('2026-07-25')).toBe(true);
  });

  it('collapses several workouts on one day', () => {
    expect(trainedDayKeys([log('2026-07-27'), log('2026-07-27')]).size).toBe(1);
  });

  it('ignores rows with a missing or unparseable date', () => {
    expect(trainedDayKeys([{}, { date: null }, { date: 'not a date' }]).size).toBe(0);
  });

  it('survives a null log list', () => {
    expect(trainedDayKeys(null).size).toBe(0);
  });
});

describe('buildTrainingWeek', () => {
  it('returns seven days ending today, oldest first', () => {
    const days = buildTrainingWeek([], NOW, 'en');
    expect(days).toHaveLength(7);
    expect(days[0].key).toBe('2026-07-21');
    expect(days[6].key).toBe('2026-07-27');
  });

  it('marks only today as today', () => {
    const days = buildTrainingWeek([], NOW, 'en');
    expect(days.filter((d) => d.isToday)).toHaveLength(1);
    expect(days[6].isToday).toBe(true);
  });

  it('rolls rather than resetting on a calendar boundary', () => {
    // Trained Fri/Sat/Sun. On Monday a fixed Mon-Sun week would show an empty
    // strip and imply the user had done nothing, which is a lie.
    const logs = [log('2026-07-24'), log('2026-07-25'), log('2026-07-26')];
    const days = buildTrainingWeek(logs, NOW, 'en');
    expect(days.filter((d) => d.trained)).toHaveLength(3);
  });

  it('flags the days that were trained', () => {
    const days = buildTrainingWeek([log('2026-07-27'), log('2026-07-23')], NOW, 'en');
    expect(days.find((d) => d.key === '2026-07-27').trained).toBe(true);
    expect(days.find((d) => d.key === '2026-07-23').trained).toBe(true);
    expect(days.find((d) => d.key === '2026-07-22').trained).toBe(false);
  });

  it('ignores workouts older than the window', () => {
    expect(buildTrainingWeek([log('2026-06-01')], NOW, 'en').some((d) => d.trained)).toBe(false);
  });

  it('gives every day a weekday initial', () => {
    for (const d of buildTrainingWeek([], NOW, 'en')) {
      expect(typeof d.label).toBe('string');
      expect(d.label.length).toBeGreaterThan(0);
    }
  });
});

describe('currentStreak', () => {
  it('counts consecutive days back from today', () => {
    const logs = ['2026-07-27', '2026-07-26', '2026-07-25'].map(log);
    expect(currentStreak(logs, NOW)).toBe(3);
  });

  it('does NOT break the streak just because today is still empty', () => {
    // The single most important case. At 9am you have not trained yet and you
    // have all day to. Telling someone their 3-day streak is 0 is wrong and
    // it is the thing that makes people stop trusting the number.
    const logs = ['2026-07-26', '2026-07-25', '2026-07-24'].map(log);
    expect(currentStreak(logs, NOW)).toBe(3);
  });

  it('breaks once a full empty day has passed', () => {
    // Nothing yesterday and nothing today — the streak is genuinely over.
    const logs = ['2026-07-25', '2026-07-24'].map(log);
    expect(currentStreak(logs, NOW)).toBe(0);
  });

  it('stops at the first gap rather than counting all logged days', () => {
    const logs = ['2026-07-27', '2026-07-26', '2026-07-23', '2026-07-22'].map(log);
    expect(currentStreak(logs, NOW)).toBe(2);
  });

  it('is zero with no logs at all', () => {
    expect(currentStreak([], NOW)).toBe(0);
    expect(currentStreak(null, NOW)).toBe(0);
  });

  it('counts a streak longer than the visible week', () => {
    const logs = [];
    for (let i = 0; i < 40; i++) {
      const d = new Date(2026, 6, 27 - i);
      logs.push(log(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`));
    }
    expect(currentStreak(logs, NOW)).toBe(40);
  });

  it('agrees with the week strip on the same data', () => {
    // The reason both come from one source: they must never contradict.
    const logs = ['2026-07-27', '2026-07-26', '2026-07-25'].map(log);
    const days = buildTrainingWeek(logs, NOW, 'en');
    const trailing = [...days].reverse().findIndex((d) => !d.trained);
    expect(currentStreak(logs, NOW)).toBe(trailing);
  });
});
