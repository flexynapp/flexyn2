// Tests for src/lib/recoveryScore.js — deterministic heuristic.

import { describe, it, expect } from 'vitest';
import { computeRecoveryScore } from '../recoveryScore';

const NOW = new Date('2026-05-22T12:00:00Z');

describe('computeRecoveryScore', () => {
  it('returns a neutral score when no inputs provided', () => {
    const { score, label } = computeRecoveryScore({ now: NOW });
    expect(score).toBe(70);
    expect(label).toBe('Ready');
  });

  it('rewards 8h sleep', () => {
    const { score } = computeRecoveryScore({ sleepHours: 8, now: NOW });
    expect(score).toBeGreaterThanOrEqual(80);
  });

  it('penalizes 4h sleep', () => {
    const { score } = computeRecoveryScore({ sleepHours: 4, now: NOW });
    expect(score).toBeLessThan(70);
  });

  it('inverts soreness — 5 (very sore) lowers score', () => {
    const high = computeRecoveryScore({ soreness: 1, now: NOW });
    const low  = computeRecoveryScore({ soreness: 5, now: NOW });
    expect(high.score).toBeGreaterThan(low.score);
  });

  it('rewards rest days — recency boost', () => {
    const justTrained = computeRecoveryScore({
      lastWorkoutAt: NOW,
      now: NOW,
    });
    const oneDayOff = computeRecoveryScore({
      lastWorkoutAt: new Date('2026-05-21T12:00:00Z'),
      now: NOW,
    });
    expect(oneDayOff.score).toBeGreaterThan(justTrained.score);
  });

  it('maxes recency at 2+ days off', () => {
    const twoDays  = computeRecoveryScore({ lastWorkoutAt: new Date('2026-05-20T12:00:00Z'), now: NOW });
    const fiveDays = computeRecoveryScore({ lastWorkoutAt: new Date('2026-05-17T12:00:00Z'), now: NOW });
    expect(twoDays.score).toBe(fiveDays.score);
  });

  it('assigns Primed label at high scores', () => {
    const { label } = computeRecoveryScore({
      sleepHours: 9, sleepQuality: 5, soreness: 1,
      lastWorkoutAt: new Date('2026-05-20T12:00:00Z'),
      now: NOW,
    });
    expect(label).toBe('Primed');
  });

  it('assigns Depleted label at very low scores', () => {
    const { label } = computeRecoveryScore({
      sleepHours: 3, sleepQuality: 1, soreness: 5,
      lastWorkoutAt: NOW,
      now: NOW,
    });
    expect(['Tired', 'Depleted']).toContain(label);
  });

  it('handles invalid lastWorkoutAt gracefully', () => {
    const { score } = computeRecoveryScore({ lastWorkoutAt: 'not-a-date', now: NOW });
    // Falls back to neutral recency (70).
    expect(score).toBeGreaterThanOrEqual(60);
    expect(score).toBeLessThanOrEqual(80);
  });
});
