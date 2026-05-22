// Tests for streakRescue.js — both the pure trigger logic behind the
// Dashboard "Keep your N-day streak alive — log 1 set?" prompt AND
// the server-backed post-break rescue RPC wrappers (migration 087).
//
// Cover every branch of shouldShowStreakRescue:
//   • streak too small
//   • too early in the day
//   • already worked out today
//   • already logged a meal today
//   • already dismissed today
//   • happy path
//
// Plus the dismissed-today persistence helpers, plus the new
// getStreakRescueStatus / spendStreakRescue RPC wrappers (which mock
// supabase.rpc).

import { describe, it, expect, beforeEach, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { rpc: (...args) => rpc(...args) },
}));

import {
  shouldShowStreakRescue,
  markStreakRescueDismissedToday,
  getStreakRescueStatus,
  spendStreakRescue,
} from '../streakRescue';

const EMAIL = 'user@example.com';

// Pick 7 PM local on a fixed date so getHours() / isSameDay() are stable.
const NIGHT = new Date('2025-05-21T19:00:00');
const MORNING = new Date('2025-05-21T08:00:00');

describe('shouldShowStreakRescue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns false when streak is < 2 days', () => {
    expect(
      shouldShowStreakRescue({
        streakDays: 1,
        userEmail: EMAIL,
        now: NIGHT,
      })
    ).toBe(false);
  });

  it('returns false when streak is 0 or undefined', () => {
    expect(
      shouldShowStreakRescue({ streakDays: 0, userEmail: EMAIL, now: NIGHT })
    ).toBe(false);
    expect(
      shouldShowStreakRescue({ userEmail: EMAIL, now: NIGHT })
    ).toBe(false);
  });

  it('returns false before 6 PM local', () => {
    expect(
      shouldShowStreakRescue({
        streakDays: 5,
        userEmail: EMAIL,
        now: MORNING,
      })
    ).toBe(false);
  });

  it('returns false when user already logged a workout today', () => {
    expect(
      shouldShowStreakRescue({
        streakDays: 5,
        lastWorkoutDate: NIGHT.toISOString(),
        userEmail: EMAIL,
        now: NIGHT,
      })
    ).toBe(false);
  });

  it('returns false when user already logged a meal today', () => {
    expect(
      shouldShowStreakRescue({
        streakDays: 5,
        lastMealDate: NIGHT.toISOString(),
        userEmail: EMAIL,
        now: NIGHT,
      })
    ).toBe(false);
  });

  it('returns true after 6 PM with active streak and no activity today', () => {
    // Workout/meal were yesterday.
    const yesterday = new Date('2025-05-20T18:00:00').toISOString();
    expect(
      shouldShowStreakRescue({
        streakDays: 5,
        lastWorkoutDate: yesterday,
        lastMealDate: yesterday,
        userEmail: EMAIL,
        now: NIGHT,
      })
    ).toBe(true);
  });

  it('returns false once user dismisses today', () => {
    markStreakRescueDismissedToday(EMAIL, NIGHT);
    expect(
      shouldShowStreakRescue({
        streakDays: 5,
        userEmail: EMAIL,
        now: NIGHT,
      })
    ).toBe(false);
  });

  it('forgets the dismissal on a new day', () => {
    markStreakRescueDismissedToday(EMAIL, NIGHT);
    const tomorrow = new Date('2025-05-22T19:00:00');
    expect(
      shouldShowStreakRescue({
        streakDays: 5,
        userEmail: EMAIL,
        now: tomorrow,
      })
    ).toBe(true);
  });

  it('keeps per-user dismissal isolated', () => {
    markStreakRescueDismissedToday('a@x.com', NIGHT);
    expect(
      shouldShowStreakRescue({
        streakDays: 5,
        userEmail: 'b@x.com',
        now: NIGHT,
      })
    ).toBe(true);
  });
});

// ── Post-break rescue RPC wrappers (migration 087) ─────────────────────

describe('getStreakRescueStatus', () => {
  beforeEach(() => rpc.mockReset());

  it('returns the status envelope on success', async () => {
    rpc.mockResolvedValue({
      data: { available: true, current_streak: 7, days_since: 2 },
      error: null,
    });
    const status = await getStreakRescueStatus();
    expect(status?.available).toBe(true);
    expect(status?.current_streak).toBe(7);
    expect(rpc).toHaveBeenCalledWith('streak_rescue_status');
  });

  it('returns null on pre-087 host (42883)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect(await getStreakRescueStatus()).toBe(null);
  });

  it('returns null on generic RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '50000' } });
    expect(await getStreakRescueStatus()).toBe(null);
  });

  it('returns null when supabase throws', async () => {
    // Use Once so the rejection is bounded to the single call below.
    // mockRejectedValue stays "armed" across calls which can leak
    // unhandled-rejection warnings into adjacent tests in vitest.
    rpc.mockRejectedValueOnce(new Error('network'));
    expect(await getStreakRescueStatus()).toBe(null);
  });
});

describe('spendStreakRescue', () => {
  beforeEach(() => rpc.mockReset());

  it('returns the success envelope', async () => {
    rpc.mockResolvedValue({
      data: { ok: true, streak_saved: 7, next_workout_continues_streak: true },
      error: null,
    });
    const res = await spendStreakRescue();
    expect(res.ok).toBe(true);
    expect(res.streak_saved).toBe(7);
    expect(rpc).toHaveBeenCalledWith('use_streak_rescue');
  });

  it('returns null on pre-087 host (42883)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect(await spendStreakRescue()).toBe(null);
  });

  it('returns ok:false on RPC error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '50000', message: 'db' } });
    const res = await spendStreakRescue();
    expect(res?.ok).toBe(false);
    expect(res?.reason).toBe('rpc_error');
  });

  it('returns ok:false on network throw', async () => {
    rpc.mockRejectedValueOnce(new Error('boom'));
    const res = await spendStreakRescue();
    expect(res?.ok).toBe(false);
    expect(res?.reason).toBe('network');
  });
});
