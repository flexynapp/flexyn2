/**
 * Cardio schedules ride on `scheduled_workouts`.
 *
 * Cardio used to have its own scheduler, `planned_cardio`, which held a
 * date and nothing else: no cron, no push, no deep link, and a
 * `completed_cardio_id` that was read to show "Completed" vs "Not logged"
 * and written by nothing, so a past plan could only ever say "Not logged".
 * It held 0 rows in production for its entire life.
 *
 * The property that makes one scheduler possible is that `workout` is
 * free-form JSONB and `schedule_workout()` only requires a JSON object. So
 * the tests that matter are about the DISCRIMINATOR — a lifting row and a
 * cardio row have to stay tellable apart, in both directions, including
 * for every row written before the discriminator existed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn(() => Promise.resolve({ data: 'new-id', error: null }));
let rows = [];
const chain = () => {
  const c = {
    select: () => c, eq: () => c, in: () => c, gte: () => c, order: () => c,
    limit: () => Promise.resolve({ data: rows, error: null }),
    update: () => c, maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
  };
  return c;
};
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a), from: () => chain() } }));
vi.mock('@/lib/intlFormat', () => ({ formatDate: () => '7 AM' }));

import {
  buildCardioPayload, isCardioSchedule, listCardioSchedules,
  scheduleWorkout, CARDIO_KIND,
} from '@/lib/data/scheduledWorkouts';

beforeEach(() => { rpc.mockClear(); rows = []; });

describe('the discriminator', () => {
  it('marks a cardio payload with kind', () => {
    const p = buildCardioPayload({ mode: 'running', env: 'outside' });
    expect(p.kind).toBe(CARDIO_KIND);
    expect(isCardioSchedule({ workout: p })).toBe(true);
  });

  // The compatibility property. Every scheduled_workouts row written before
  // this change is an AI Coach session with no `kind` at all, and those must
  // keep routing to the lifting path.
  it('treats a payload with no kind as lifting', () => {
    expect(isCardioSchedule({ workout: { exercises: [{ name: 'Squat' }] } })).toBe(false);
  });

  it('is not fooled by a missing or malformed row', () => {
    expect(isCardioSchedule(null)).toBe(false);
    expect(isCardioSchedule({})).toBe(false);
    expect(isCardioSchedule({ workout: null })).toBe(false);
    expect(isCardioSchedule({ workout: { kind: 'strength' } })).toBe(false);
  });
});

describe('the payload', () => {
  it('carries mode and env, which is what the deep link routes on', () => {
    const p = buildCardioPayload({ mode: 'biking', env: 'stationary' });
    expect(p.mode).toBe('biking');
    expect(p.env).toBe('stationary');
  });

  it('stores distance in canonical metres', () => {
    expect(buildCardioPayload({ mode: 'running', env: 'outside', distanceMeters: 5000 }).distance_meters).toBe(5000);
  });

  it('nulls a distance that is absent, zero, negative or NaN', () => {
    // A NaN reached the old planned_cardio table through a clipboard paste
    // and broke every downstream display that read it.
    for (const d of [undefined, null, 0, -5, NaN, 'abc']) {
      expect(buildCardioPayload({ mode: 'running', env: 'outside', distanceMeters: d }).distance_meters).toBe(null);
    }
  });

  it('round-trips through the type string the tracker needs', () => {
    const p = buildCardioPayload({ mode: 'swimming', env: 'openwater' });
    expect(`${p.mode}_${p.env}`).toBe('swimming_openwater');
  });
});

describe('listCardioSchedules', () => {
  it('returns only cardio rows, leaving lifting schedules alone', () => {
    rows = [
      { id: '1', workout: { kind: 'cardio', mode: 'running', env: 'outside' } },
      { id: '2', workout: { exercises: [{ name: 'Bench' }] } },
      { id: '3', workout: { kind: 'cardio', mode: 'biking', env: 'outside' } },
    ];
    return listCardioSchedules().then(out => {
      expect(out.map(r => r.id)).toEqual(['1', '3']);
    });
  });

  it('is empty rather than throwing when there is nothing', () => {
    rows = [];
    return listCardioSchedules().then(out => expect(out).toEqual([]));
  });
});

describe('scheduling goes through the RPC, not a client insert', () => {
  // scheduled_workouts has NO client INSERT policy on purpose (migration
  // 276): user_id and user_email are derived from auth.uid() inside
  // schedule_workout, and user_email is what the push fan-out delivers to.
  // planned_cardio, by contrast, took a direct client insert.
  it('calls schedule_workout with the cardio payload', async () => {
    await scheduleWorkout({
      date: '2026-08-20', hour: 7, title: 'Morning 5K',
      workout: buildCardioPayload({ mode: 'running', env: 'outside', distanceMeters: 5000 }),
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('schedule_workout');
    expect(args.p_date).toBe('2026-08-20');
    expect(args.p_hour).toBe(7);
    expect(args.p_title).toBe('Morning 5K');
    expect(args.p_workout.kind).toBe('cardio');
    expect(args.p_workout.distance_meters).toBe(5000);
  });
});
