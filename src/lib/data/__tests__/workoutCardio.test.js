import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@/lib/data/cardio', () => ({ create: (...a) => create(...a) }));

const {
  cardioLogPayloadFromEntry, saveWorkoutCardio, linkedCardioLogIds, cardioEntryHasData,
  blankCardioEntry, workoutCardioSeconds, workoutCardioTotals, MAX_CARDIO_SECONDS, MAX_CARDIO_METERS,
} =
  await import('@/lib/data/workoutCardio');

const run = {
  kind: 'cardio', activity: 'running', name: 'Running', sets: [],
  segments: [{ duration_s: 600, distance_m: 2000 }, { duration_s: 900, distance_m: 3100 }],
};

describe('cardioLogPayloadFromEntry', () => {
  it('sums the splits into one run a running goal can match', () => {
    const p = cardioLogPayloadFromEntry(run, { date: '2026-09-30', userProfile: { weight_lbs: 160 } });
    expect(p).toMatchObject({ date: '2026-09-30', type: 'running_outside', duration_seconds: 1500, distance_meters: 5100 });
    expect(p.calories).toBeGreaterThan(0);
  });

  it('skips an entry with nothing in it, and anything that is not cardio', () => {
    expect(cardioLogPayloadFromEntry({ ...run, segments: [{ duration_s: null, distance_m: null }] }, {})).toBeNull();
    expect(cardioLogPayloadFromEntry({ name: 'Bench Press', sets: [{ weight: 100, reps: 5 }] }, {})).toBeNull();
    expect(cardioEntryHasData({ segments: [{ duration_s: '', distance_m: 0 }] })).toBe(false);
  });

  it('maps a ride and a swim to the tracker types', () => {
    expect(cardioLogPayloadFromEntry({ ...run, activity: 'cycling' }, {}).type).toBe('biking_outside');
    expect(cardioLogPayloadFromEntry({ ...run, activity: 'swimming' }, {}).type).toBe('swimming_pool');
  });
});

describe('workout cardio caps', () => {
  it('clamps a run to the manual form caps of 12 hours and 160 km', () => {
    const huge = { ...run, segments: [{ duration_s: 10 * 3600, distance_m: 120000 }, { duration_s: 10 * 3600, distance_m: 120000 }] };
    const p = cardioLogPayloadFromEntry(huge, {});
    expect(p.duration_seconds).toBe(MAX_CARDIO_SECONDS);
    expect(p.distance_meters).toBe(MAX_CARDIO_METERS);
    expect(MAX_CARDIO_SECONDS).toBe(12 * 3600);
    expect(MAX_CARDIO_METERS).toBe(160934);
  });

  it('sums the cardio seconds of a workout with the same cap, ignoring lifts', () => {
    const lift = { name: 'Squat', sets: [{ weight: 100, reps: 5 }] };
    expect(workoutCardioSeconds([lift, run])).toBe(1500);
    expect(workoutCardioSeconds([{ ...run, segments: [{ duration_s: 20 * 3600 }] }])).toBe(MAX_CARDIO_SECONDS);
    expect(workoutCardioSeconds(null)).toBe(0);
  });

  it('totals time and distance across runs and counts them', () => {
    const lift = { name: 'Squat', sets: [{ weight: 100, reps: 5 }] };
    expect(workoutCardioTotals([lift, run, run])).toEqual({ seconds: 3000, meters: 10200, count: 2 });
    expect(workoutCardioTotals([lift])).toEqual({ seconds: 0, meters: 0, count: 0 });
  });
});

describe('blankCardioEntry', () => {
  it('keeps the activity and drops the numbers and the saved log link', () => {
    const e = blankCardioEntry({ ...run, cardio_log_id: 'c9', detail: { pace: 300 } });
    expect(e).toEqual({
      kind: 'cardio', activity: 'running', name: 'Running', displayName: 'Running',
      segments: [{ duration_s: null, distance_m: null }], sets: [],
    });
  });
});

describe('saveWorkoutCardio', () => {
  beforeEach(() => { create.mockReset(); });

  it('saves each run once, links it, and returns what the server paid', async () => {
    create.mockResolvedValueOnce({ id: 'c1' });
    const grantXp = vi.fn().mockResolvedValue({ xp_awarded: 90 });
    const lift = { name: 'Squat', sets: [{ weight: 100, reps: 5 }] };
    const r = await saveWorkoutCardio({ exercises: [lift, run], date: '2026-09-30', grantXp });
    expect(create).toHaveBeenCalledTimes(1);
    expect(grantXp).toHaveBeenCalledWith('c1', expect.any(Object));
    expect(r.changed).toBe(true);
    expect(r.xp).toBe(90);
    expect(r.seconds).toBe(1500);
    expect(r.exercises[0]).toBe(lift);
    expect(r.exercises[1].cardio_log_id).toBe('c1');
    expect(linkedCardioLogIds(r.exercises)).toEqual(['c1']);
  });

  it('never saves an entry that already has its log', async () => {
    const r = await saveWorkoutCardio({ exercises: [{ ...run, cardio_log_id: 'c0' }], date: '2026-09-30' });
    expect(create).not.toHaveBeenCalled();
    expect(r.changed).toBe(false);
  });

  it('keeps going when one save fails', async () => {
    create.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ id: 'c2' });
    const onError = vi.fn();
    const r = await saveWorkoutCardio({ exercises: [run, run], date: '2026-09-30', onError });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'create');
    expect(r.exercises.map((e) => e.cardio_log_id)).toEqual([undefined, 'c2']);
  });
});
