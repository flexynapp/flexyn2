// Tests for streakRescue.js — the pure trigger logic behind the
// Dashboard "Keep your N-day streak alive — log 1 set?" prompt.
//
// Cover every branch of shouldShowStreakRescue:
//   • streak too small
//   • too early in the day
//   • already worked out today
//   • already logged a meal today
//   • already dismissed today
//   • happy path
//
// Plus the dismissed-today persistence helpers.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  shouldShowStreakRescue,
  markStreakRescueDismissedToday,
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
