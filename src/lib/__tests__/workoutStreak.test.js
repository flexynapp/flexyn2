import { describe, it, expect } from 'vitest';
import {
  coinsForWorkoutStreakDay,
  eliteCapsuleOnWorkoutStreakDay,
} from '../data/workoutStreak';

describe('coinsForWorkoutStreakDay', () => {
  it('returns 0 for non-positive days', () => {
    expect(coinsForWorkoutStreakDay(0)).toBe(0);
    expect(coinsForWorkoutStreakDay(-1)).toBe(0);
  });

  it('milestone days award the table value', () => {
    expect(coinsForWorkoutStreakDay(3)).toBe(25);
    expect(coinsForWorkoutStreakDay(7)).toBe(100);
    expect(coinsForWorkoutStreakDay(30)).toBe(600);
    expect(coinsForWorkoutStreakDay(100)).toBe(2000);
  });

  it('non-milestone days award 0 (workout streak is harder, milestone-only rewards)', () => {
    expect(coinsForWorkoutStreakDay(1)).toBe(0);
    expect(coinsForWorkoutStreakDay(2)).toBe(0);
    expect(coinsForWorkoutStreakDay(4)).toBe(0);
    expect(coinsForWorkoutStreakDay(50)).toBe(0);
  });

  it('reward curve is monotonically non-decreasing across milestones', () => {
    const milestones = [3, 5, 7, 14, 21, 30, 60, 100];
    let prev = 0;
    milestones.forEach(d => {
      const c = coinsForWorkoutStreakDay(d);
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    });
  });
});

describe('eliteCapsuleOnWorkoutStreakDay', () => {
  it('drops on day 30, 60, 100', () => {
    expect(eliteCapsuleOnWorkoutStreakDay(30)).toBe(true);
    expect(eliteCapsuleOnWorkoutStreakDay(60)).toBe(true);
    expect(eliteCapsuleOnWorkoutStreakDay(100)).toBe(true);
  });

  it('does not drop on other days', () => {
    [1, 7, 14, 21, 29, 31, 50, 99, 101].forEach(d => {
      expect(eliteCapsuleOnWorkoutStreakDay(d), `day ${d}`).toBe(false);
    });
  });
});
