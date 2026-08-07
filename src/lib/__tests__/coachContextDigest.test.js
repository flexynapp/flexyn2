// src/lib/__tests__/coachContextDigest.test.js
//
// buildCoachContext assembles the only facts the Coach's language model is
// allowed to state, so what it omits, the model has to admit it doesn't know.
//
// The `daysAgo` fields are the reason this file exists. Asked "what are my
// PRs?", the model reported a lift logged 2026-07-28 as "28 days ago" — it
// was 10 — having read the day-of-month as the day count, while describing
// the same lift correctly in a different reply. The date is now subtracted
// here and shipped alongside, because arithmetic belongs in code and the
// failure mode of getting it wrong is a confidently wrong number sitting
// next to four right ones.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const filter = vi.fn();

vi.mock('@/api/db', () => ({
  db: { entities: { WorkoutLog: { filter: (...a) => filter(...a) }, CardioLog: { filter: (...a) => filter(...a) } } },
}));
vi.mock('@/api/supabaseClient', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/api/safeSelect', () => ({ safeSelect: vi.fn(async () => ({ data: null })) }));

import { buildCoachContext } from '../aiCoach/responders';

const USER = { id: 'u1', email: 'a@b.c' };

// Fixed clock: every expectation below is a day count relative to this.
const TODAY = new Date('2026-08-07T12:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);
  filter.mockReset();
  filter.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

function workout(date, exercises) {
  return { date, exercises };
}

describe('buildCoachContext — dates arrive pre-computed', () => {
  it('ships daysAgo on every top lift, counted from today not the day-of-month', async () => {
    filter.mockResolvedValue([
      workout('2026-07-28', [{ name: 'Deadlift',   sets: [{ weight: 345, reps: 3 }] }]),
      workout('2026-08-02', [{ name: 'Back Squat', sets: [{ weight: 285, reps: 5 }] }]),
      workout('2026-08-06', [{ name: 'Bench',      sets: [{ weight: 205, reps: 5 }] }]),
    ]);

    const ctx = await buildCoachContext({ user: USER });
    const byName = Object.fromEntries(ctx.topLifts.map(l => [l.name, l]));

    // The regression: 2026-07-28 is 10 days before 2026-08-07, not 28.
    expect(byName.Deadlift.daysAgo).toBe(10);
    expect(byName.Deadlift.daysAgo).not.toBe(28);
    expect(byName['Back Squat'].daysAgo).toBe(5);
    expect(byName.Bench.daysAgo).toBe(1);

    // The raw date rides along too, so the model can fall back to it.
    expect(byName.Deadlift.date).toBe('2026-07-28');
  });

  it('ships daysAgo on recent sessions', async () => {
    filter.mockResolvedValue([workout('2026-08-05', [{ name: 'Row', sets: [{ weight: 135, reps: 8 }] }])]);

    const ctx = await buildCoachContext({ user: USER });

    expect(ctx.training.recentSessions[0]).toMatchObject({ date: '2026-08-05', daysAgo: 2 });
  });

  it('counts today as 0 so the model can say "today" rather than "0 days ago"', async () => {
    filter.mockResolvedValue([workout('2026-08-07', [{ name: 'Squat', sets: [{ weight: 225, reps: 5 }] }])]);

    const ctx = await buildCoachContext({ user: USER });

    expect(ctx.topLifts[0].daysAgo).toBe(0);
    expect(ctx.training.daysSinceLastSession).toBe(0);
  });

  it('drops a row with an unusable date rather than shipping NaN', async () => {
    filter.mockResolvedValue([
      workout('not-a-date', [{ name: 'Curl',  sets: [{ weight: 30,  reps: 10 }] }]),
      workout('2026-08-04', [{ name: 'Squat', sets: [{ weight: 225, reps: 5 }] }]),
    ]);

    const ctx = await buildCoachContext({ user: USER });

    // A NaN day count would render as "NaN days ago" in the reply. The bad
    // row is filtered at the fetch, so nothing downstream has to defend
    // against it — and the good row beside it still comes through.
    expect(ctx.topLifts.map(l => l.name)).toEqual(['Squat']);
    expect(ctx.topLifts[0].daysAgo).toBe(3);
  });

  it('reads a bare YYYY-MM-DD as a local calendar day, not UTC midnight', async () => {
    // The regression this whole helper exists for. `new Date('2026-08-07')`
    // is UTC midnight, which is the previous LOCAL day anywhere west of
    // Greenwich — so a session logged today reported as yesterday, and every
    // "N days ago" ran one high, for most of the userbase. This test only
    // means something when the runner is not on UTC; it is written to be
    // correct either way.
    filter.mockResolvedValue([workout('2026-08-07', [{ name: 'Squat', sets: [{ weight: 225, reps: 5 }] }])]);

    const ctx = await buildCoachContext({ user: USER });

    expect(ctx.topLifts[0].daysAgo).toBe(0);
    // And the date it echoes back is the day the user actually trained.
    expect(ctx.topLifts[0].date).toBe('2026-08-07');
  });
});

describe('buildCoachContext — degrades rather than blanking', () => {
  it('never throws when every source is empty, and still reports the units', async () => {
    filter.mockResolvedValue([]);

    const ctx = await buildCoachContext({ user: USER, profile: { weight_unit: 'kg' } });

    expect(ctx.units).toBe('kg');
    expect(ctx.topLifts).toEqual([]);
    expect(ctx.training.sessionsLast7).toBe(0);
  });

  it('survives a data source that throws, without losing the other sections', async () => {
    filter.mockRejectedValue(new Error('table gone'));

    const ctx = await buildCoachContext({
      user: USER,
      profile: { gender: 'female', age: 31, fitness_goals: ['strength'] },
      excludeMuscleGroups: ['shoulders'],
    });

    // The profile and injury sections come from the caller, so a dead
    // workouts table must not take them down with it.
    expect(ctx.profile).toMatchObject({ sex: 'female', age: 31, goals: ['strength'] });
    expect(ctx.injuries.avoidMuscleGroups).toEqual(['shoulders']);
  });

  it('carries the injury exclusions the model must not program around', async () => {
    filter.mockResolvedValue([]);

    const ctx = await buildCoachContext({ user: USER, excludeMuscleGroups: ['shoulders', 'chest'] });

    expect(ctx.injuries.avoidMuscleGroups).toEqual(['shoulders', 'chest']);
  });

  it('carries dietary restrictions, which gate every food the coach may name', async () => {
    filter.mockResolvedValue([]);

    const ctx = await buildCoachContext({
      user: USER,
      profile: { dietary_restrictions: ['lactose', 'shellfish'] },
    });

    expect(ctx.profile.dietaryRestrictions).toEqual(['lactose', 'shellfish']);
  });
});
