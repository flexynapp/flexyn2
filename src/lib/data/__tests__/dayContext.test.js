// src/lib/data/__tests__/dayContext.test.js
//
// The empty state's whole promise is "nothing invented", and the one way
// to break it is a chip built from a column that is empty in the real
// world. That is not hypothetical here — measured on production before
// this shipped:
//
//   workout_logs: 3 rows, title NULL on 3, duration_min NULL on 3,
//   total_volume 0 on the ones sampled. The only things actually carrying
//   the session are the `exercises` JSONB and its nested sets.
//
// So a straightforward `${row.title} · ${row.duration_min} min` chip would
// have rendered "null · null min" at every single user. These tests pin
// the two halves that stop that: the recompute from JSONB, and the rule
// that a fact with no value produces no chip.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const calls = [];
let staged = {};
// Keyed by TABLE, not a FIFO queue. getDayContext issues its two reads
// inside a Promise.all, so a queue hands the workout response to whichever
// chain happens to settle first — which is not the order they were created
// in, and produced five failures that looked like logic bugs and were not.
const stage = (byTable) => { staged = byTable; };

function makeChain(table) {
  const rec = { table, filters: [] };
  calls.push(rec);
  const settle = () => {
    const r = staged[table];
    return { data: r?.data ?? null, error: r?.error ?? null };
  };
  const chain = {
    select: (c) => { rec.cols = c; return chain; },
    eq: (c, v) => { rec.filters.push([c, v]); return chain; },
    maybeSingle: async () => settle(),
    then: (res, rej) => Promise.resolve(settle()).then(res, rej),
  };
  return chain;
}

vi.mock('@/api/supabaseClient', () => ({ supabase: { from: (t) => makeChain(t) } }));
vi.mock('@/api/safeSelect', () => ({
  safeSelect: async ({ columns, build }) => build(columns.join(', ')),
}));

const { getDayContext, contextChips } = await import('../dayContext');

const USER = 'user-1';
const DAY = '2026-08-09';
const t = (key, english) => english;

beforeEach(() => { calls.length = 0; staged = {}; });

// A row shaped exactly like production: no title, no duration_min, no
// usable total_volume, everything real hiding in the JSONB.
const PROD_SHAPED_ROW = {
  title: null,
  duration_min: null,
  total_volume: 0,
  exercises: [
    { name: 'bench_press', displayName: 'Bench Press', duration_minutes: 14,
      sets: [{ reps: 5, weight: 185 }, { reps: 5, weight: 185 }, { reps: 5, weight: 185 }] },
    { name: 'incline_db', displayName: 'Incline DB Press', duration_minutes: 9,
      sets: [{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }] },
  ],
};

describe('getDayContext', () => {
  it('recovers sets, minutes and volume from the JSONB when the columns are empty', async () => {
    stage({ workout_logs: { data: [PROD_SHAPED_ROW] }, sleep_logs: { data: { hours: 7.5 } } });
    const ctx = await getDayContext(USER, DAY);

    expect(ctx.workout).toMatchObject({
      title: null,
      exercises: 2,
      sets: 5,                                  // 3 + 2
      minutes: 23,                              // 14 + 9, since duration_min is NULL
      volume: 3735,                             // 3*5*185 + 2*8*60, since total_volume is 0
      names: ['Bench Press', 'Incline DB Press'],
    });
    expect(ctx.sleepHours).toBe(7.5);
  });

  it('prefers the denormalised columns when they carry a real value', async () => {
    stage({ workout_logs: { data: [{ ...PROD_SHAPED_ROW, duration_min: 55, total_volume: 9000 }] }, sleep_logs: { data: null } });
    const ctx = await getDayContext(USER, DAY);
    expect(ctx.workout.minutes).toBe(55);
    expect(ctx.workout.volume).toBe(9000);
  });

  it('keys on user_id and the date, and returns nulls for a day with nothing', async () => {
    stage({ workout_logs: { data: [] }, sleep_logs: { data: null } });
    const ctx = await getDayContext(USER, DAY);

    expect(ctx).toEqual({ workout: null, sleepHours: null });
    expect(calls[0].table).toBe('workout_logs');
    expect(calls[0].filters).toEqual([['user_id', USER], ['date', DAY]]);
    expect(calls[1].table).toBe('sleep_logs');
  });

  it('never throws — a failed read is an empty day, not an error state', async () => {
    stage({ workout_logs: { error: { code: '42P01' } }, sleep_logs: { error: { code: '42P01' } } });
    await expect(getDayContext(USER, DAY)).resolves.toEqual({ workout: null, sleepHours: null });
  });

  it('is inert without a user or a date', async () => {
    expect(await getDayContext(null, DAY)).toEqual({ workout: null, sleepHours: null });
    expect(await getDayContext(USER, null)).toEqual({ workout: null, sleepHours: null });
    expect(calls).toHaveLength(0);
  });
});

describe('contextChips — a fact with no value produces no chip', () => {
  it('offers only what the day actually has', async () => {
    stage({ workout_logs: { data: [PROD_SHAPED_ROW] }, sleep_logs: { data: { hours: 7.5 } } });
    const ctx = await getDayContext(USER, DAY);
    const chips = contextChips(ctx, { score: 4, emoji: '😄', label: 'Good' }, t);

    expect(chips.map(c => c.key)).toEqual(['workout', 'sets', 'minutes', 'volume', 'sleep', 'mood']);
    expect(chips.find(c => c.key === 'workout').label).toBe('Bench Press');
    expect(chips.find(c => c.key === 'mood').label).toBe('Felt 😄 Good');
  });

  it('drops zero-valued facts rather than rendering "0 lb volume" / "0 min"', async () => {
    stage({ workout_logs: { data: [{ title: null, duration_min: null, total_volume: 0, exercises: [
      { displayName: 'Plank', sets: [] },       // no sets, no weight, no duration
    ] }] }, sleep_logs: { data: null } });
    const ctx = await getDayContext(USER, DAY);
    const chips = contextChips(ctx, null, t);

    expect(chips.map(c => c.key)).toEqual(['workout']);   // the name, and nothing else
    expect(chips.some(c => /\b0\b/.test(c.label))).toBe(false);
  });

  it('falls back to an exercise count when nothing is named', async () => {
    stage({ workout_logs: { data: [{ title: null, duration_min: null, total_volume: 0, exercises: [{ sets: [] }, { sets: [] }] }] }, sleep_logs: { data: null } });
    const ctx = await getDayContext(USER, DAY);
    expect(contextChips(ctx, null, t)[0].label).toBe('2 exercises');
  });

  it('returns nothing at all for an empty day, so the block does not render', () => {
    expect(contextChips({ workout: null, sleepHours: null }, null, t)).toEqual([]);
    expect(contextChips(null, null, t)).toEqual([]);
  });

  it('offers the mood on a day with no workout and no sleep', () => {
    const chips = contextChips({ workout: null, sleepHours: null }, { score: 5, emoji: '🔥', label: 'On fire' }, t);
    expect(chips).toEqual([{ key: 'mood', label: 'Felt 🔥 On fire', line: 'Felt 🔥 On fire' }]);
  });
});
