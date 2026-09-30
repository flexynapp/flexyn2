import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@/lib/data/cardio', () => ({ create: (...a) => create(...a) }));

const { cardioLogPayloadFromEntry, saveWorkoutCardio, linkedCardioLogIds, cardioEntryHasData } =
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
