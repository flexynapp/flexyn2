import { describe, it, expect } from 'vitest';
import { liftSeries, defaultLift } from '@/lib/liftSeries';

const log = (date, exercises) => ({ date, exercises });
const ex = (name, ...weights) => ({ name, sets: weights.map((w) => ({ weight: w, reps: 5 })) });

describe('liftSeries', () => {
  it('keeps each lift on its own line rather than one mixed max', () => {
    // Leg day then arm day: the old chart plotted 315 then 40, a sawtooth
    // that only said which day it was.
    const series = liftSeries([
      log('2026-09-01', [ex('Squat', 275, 315)]),
      log('2026-09-03', [ex('Curl', 35, 40)]),
      log('2026-09-05', [ex('Squat', 320)]),
    ]);
    const squat = series.find((s) => s.name === 'Squat');
    expect(squat.sessions.map((e) => e.maxLbs)).toEqual([315, 320]);
    expect(series.find((s) => s.name === 'Curl').sessions).toHaveLength(1);
  });

  it('orders sessions by date and merges two logs on one day', () => {
    const [bench] = liftSeries([
      log('2026-09-05', [ex('Bench', 185)]),
      log('2026-09-01', [ex('Bench', 175)]),
      log('2026-09-05', [ex('Bench', 195)]),
    ]);
    expect(bench.sessions).toEqual([
      { rawDate: '2026-09-01', maxLbs: 175 },
      { rawDate: '2026-09-05', maxLbs: 195 },
    ]);
  });

  it('leaves out bodyweight movements', () => {
    expect(liftSeries([log('2026-09-01', [ex('Pull-up', 0, 0)])])).toEqual([]);
  });
});

describe('defaultLift', () => {
  it('prefers the heaviest lift that can draw a line', () => {
    const lifts = liftSeries([
      log('2026-09-01', [ex('Deadlift', 405), ex('Squat', 275)]),
      log('2026-09-04', [ex('Squat', 285)]),
    ]);
    // Deadlift is heavier but has one session, so Squat opens the chart.
    expect(defaultLift(lifts).name).toBe('Squat');
  });

  it('falls back to the heaviest overall when no lift has two sessions', () => {
    const lifts = liftSeries([log('2026-09-01', [ex('Deadlift', 405), ex('Squat', 275)])]);
    expect(defaultLift(lifts).name).toBe('Deadlift');
  });

  it('returns null with nothing to chart', () => {
    expect(defaultLift([])).toBeNull();
  });
});
