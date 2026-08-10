import { describe, it, expect } from 'vitest';
import {
  buildTrendPoints, metricsFor, seriesFor, headlineFor,
  tickTimes, valueDomain, axisTicks,
} from '@/lib/exerciseTrend';

const log = (date, sets, name = 'Bench Press') => ({
  date,
  exercises: [{ name, muscle_groups: ['Chest'], sets }],
});

describe('buildTrendPoints', () => {
  it('reduces each session to its heaviest set, best reps and total volume', () => {
    const [p] = buildTrendPoints(
      [log('2026-08-01', [{ weight: 100, reps: 10 }, { weight: 135, reps: 5 }])],
      'Bench Press',
    );
    expect(p.weight).toBe(135);
    expect(p.reps).toBe(10);
    expect(p.volume).toBe(100 * 10 + 135 * 5);
  });

  it('sorts oldest first regardless of input order', () => {
    const pts = buildTrendPoints([
      log('2026-08-07', [{ weight: 3, reps: 1 }]),
      log('2026-07-25', [{ weight: 1, reps: 1 }]),
      log('2026-08-01', [{ weight: 2, reps: 1 }]),
    ], 'Bench Press');
    expect(pts.map((p) => p.weight)).toEqual([1, 2, 3]);
  });

  it('parses a YYYY-MM-DD date as LOCAL, not UTC', () => {
    // The regression this guards: `new Date('2026-08-07')` is UTC
    // midnight, which is 2026-08-06 for every user west of UTC — so
    // every point on the chart was labelled a day early.
    const [p] = buildTrendPoints([log('2026-08-07', [{ weight: 100, reps: 5 }])], 'Bench Press');
    const d = new Date(p.t);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(7);
  });

  it('excludes sessions before sinceMs, and skips sessions without the exercise', () => {
    const logs = [
      log('2026-01-01', [{ weight: 100, reps: 5 }]),
      log('2026-08-01', [{ weight: 110, reps: 5 }]),
      log('2026-08-02', [{ weight: 500, reps: 5 }], 'Squat'),
    ];
    const pts = buildTrendPoints(logs, 'Bench Press', new Date(2026, 6, 1).getTime());
    expect(pts).toHaveLength(1);
    expect(pts[0].weight).toBe(110);
  });

  it('ignores an exercise entry with no sets', () => {
    expect(buildTrendPoints([log('2026-08-01', [])], 'Bench Press')).toHaveLength(0);
    expect(buildTrendPoints([{ date: '2026-08-01', exercises: [] }], 'Bench Press')).toHaveLength(0);
  });

  it('survives a null or unparseable date', () => {
    expect(buildTrendPoints([{ date: null, exercises: [] }], 'Bench Press')).toHaveLength(0);
  });
});

describe('metricsFor — the rule that decides what may be plotted', () => {
  const pts = (...sessions) => buildTrendPoints(
    sessions.map(([date, sets]) => log(date, sets)),
    'Bench Press',
  );

  it('offers only reps for bodyweight work', () => {
    // Push-Up, which is one of the two exercise rows production actually
    // holds. Weight, volume and 1RM are all identically zero for it, so
    // offering any of them would draw a flat zero line.
    const p = pts(['2026-08-01', [{ weight: 0, reps: 12 }]], ['2026-08-07', [{ weight: 0, reps: 15 }]]);
    expect(metricsFor(p)).toEqual(['reps']);
  });

  it('offers nothing at all when there is neither weight nor reps', () => {
    expect(metricsFor(pts(['2026-08-01', [{ weight: 0, reps: 0 }]]))).toEqual([]);
    expect(metricsFor([])).toEqual([]);
  });

  it('offers weight from a single session, so a headline can be shown', () => {
    expect(metricsFor(pts(['2026-08-01', [{ weight: 135, reps: 5 }]]))).toEqual(['weight']);
  });

  it('adds 1RM and volume once each resolves on two sessions', () => {
    const p = pts(
      ['2026-08-01', [{ weight: 135, reps: 5 }]],
      ['2026-08-07', [{ weight: 145, reps: 5 }]],
    );
    expect(metricsFor(p)).toEqual(['weight', 'e1rm', 'volume']);
  });

  it('withholds 1RM when the rep counts put it outside Epley range', () => {
    // Bench Press as production actually holds it: 111 lb × 45 reps.
    // epleyOneRepMax returns 0 above 12 reps, so an estimated-1RM line
    // would be a flat zero.
    const p = pts(
      ['2026-07-25', [{ weight: 111, reps: 45 }]],
      ['2026-08-07', [{ weight: 120, reps: 40 }]],
    );
    expect(metricsFor(p)).toEqual(['weight', 'volume']);
  });

  it('withholds an alternative that resolves on only one session', () => {
    const p = pts(
      ['2026-08-01', [{ weight: 135, reps: 5 }]],   // e1rm + volume real
      ['2026-08-07', [{ weight: 145, reps: 40 }]],  // e1rm 0 (>12 reps)
    );
    expect(metricsFor(p)).toEqual(['weight', 'volume']);
  });
});

describe('seriesFor', () => {
  it('keeps a null where the metric does not resolve, so the line breaks', () => {
    const p = buildTrendPoints([
      log('2026-08-01', [{ weight: 135, reps: 5 }]),
      log('2026-08-04', [{ weight: 0, reps: 20 }]),
      log('2026-08-07', [{ weight: 145, reps: 5 }]),
    ], 'Bench Press');
    expect(seriesFor(p, 'weight').map((d) => d.value)).toEqual([135, null, 145]);
  });

  it('returns nothing for an unknown metric', () => {
    expect(seriesFor([{ t: 1, weight: 1 }], 'nonsense')).toEqual([]);
  });
});

describe('headlineFor', () => {
  const p = buildTrendPoints([
    log('2026-08-01', [{ weight: 135, reps: 5 }]),
    log('2026-08-04', [{ weight: 0, reps: 20 }]),
    log('2026-08-07', [{ weight: 145, reps: 5 }]),
  ], 'Bench Press');

  it('compares the two most recent RESOLVING sessions, skipping the gap', () => {
    // Without this the middle session's zero becomes "previous" and the
    // delta reads +145 — a crash to zero and a recovery that never
    // happened.
    const h = headlineFor(p, 'weight');
    expect(h.latest.weight).toBe(145);
    expect(h.previous.weight).toBe(135);
    expect(h.delta).toBe(10);
    expect(h.sessions).toBe(2);
  });

  it('has no delta on a first session — there is nothing to compare to', () => {
    const one = buildTrendPoints([log('2026-08-01', [{ weight: 135, reps: 5 }])], 'Bench Press');
    const h = headlineFor(one, 'weight');
    expect(h.latest.weight).toBe(135);
    expect(h.delta).toBeNull();
    expect(h.sessions).toBe(1);
  });

  it('reports empty rather than throwing when nothing resolves', () => {
    expect(headlineFor([], 'weight')).toEqual({ latest: null, previous: null, delta: null, sessions: 0 });
    expect(headlineFor([], 'nonsense').sessions).toBe(0);
  });
});

describe('axis helpers', () => {
  it('ticks every point when there are few enough, and every tick is a real session', () => {
    const pts = [{ t: 1 }, { t: 2 }, { t: 3 }];
    expect(tickTimes(pts, 4)).toEqual([1, 2, 3]);

    const many = Array.from({ length: 20 }, (_, i) => ({ t: i }));
    const ticks = tickTimes(many, 4);
    expect(ticks).toHaveLength(4);
    expect(ticks[0]).toBe(0);
    expect(ticks[3]).toBe(19);
    ticks.forEach((t) => expect(many.some((p) => p.t === t)).toBe(true));
  });

  it('pads the value domain and never collapses a flat series onto an edge', () => {
    const [lo, hi] = valueDomain([100, 100, 100]);
    expect(lo).toBeLessThan(100);
    expect(hi).toBeGreaterThan(100);

    const [lo2, hi2] = valueDomain([100, 200]);
    expect(lo2).toBeLessThan(100);
    expect(hi2).toBeGreaterThan(200);
  });

  it('ignores nulls, and always ticks both real bounds', () => {
    // The axis is deliberately not zero-based, so the reader has to be
    // able to see where it starts and ends.
    expect(axisTicks([100, null, 200])).toEqual([100, 150, 200]);
    expect(axisTicks([100, 100])).toEqual([100]);
    expect(axisTicks([null, null])).toEqual([]);
    expect(valueDomain([])).toEqual([0, 1]);
  });
});
