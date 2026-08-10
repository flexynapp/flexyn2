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

  // ── sleep quality stopped being a signal (2026-08-09) ────────────────
  //
  // Its input was removed on 2026-07-12 while its 20% weight stayed, so it
  // sat at the neutral 70 forever: a fixed +14 on every score, a ceiling of
  // 94 that no behaviour could beat, and a permanent "not logged" row in
  // the Readiness sheet pointing at a deleted control. The weight folded
  // into sleep duration, which is what that commit said was already true.

  it('a perfect day reaches 100 — the old constant capped it at 94', () => {
    const { score } = computeRecoveryScore({
      sleepHours: 8,                                     // 100
      soreness: 1,                                       // 100 (inverted)
      lastWorkoutAt: new Date('2026-05-19T12:00:00Z'),   // 2+ days → 100
      now: NOW,
    });
    expect(score).toBe(100);
  });

  it('a worst-case day drops below the old floor of 14', () => {
    const { score } = computeRecoveryScore({
      sleepHours: 0,
      soreness: 5,          // inverted → 20, NOT 0: the scale bottoms at 20
      lastWorkoutAt: NOW,   // trained today → 40, the lowest recency gives
      now: NOW,
    });
    // 0*0.60 + 20*0.25 + 40*0.15 = 11. The formula's absolute minimum is 0,
    // but no real input reaches it — soreness bottoms at 20 and recency at
    // 40 — so 11 is the reachable floor. It was 14 + those same terms before.
    expect(score).toBe(11);
    expect(score).toBeLessThan(14);
  });

  it('ignores a quality value entirely, however it is passed', () => {
    const base = computeRecoveryScore({ sleepHours: 8, now: NOW });
    for (const q of [1, 3, 5, null, undefined]) {
      expect(computeRecoveryScore({ sleepHours: 8, sleepQuality: q, now: NOW }).score)
        .toBe(base.score);
    }
  });

  it('breaks down into three signals, and sleep now carries 60%', () => {
    const { breakdown } = computeRecoveryScore({ sleepHours: 8, now: NOW });
    const keys = Object.keys(breakdown);
    expect(keys).toEqual(['sleep', 'soreness', 'recency']);
    expect(keys).not.toContain('quality');
    expect(breakdown.sleep.weight).toBe(0.60);
  });

  it('keeps the contributions summing EXACTLY to the score', () => {
    // The largest-remainder apportionment now runs over three parts, not
    // four. Rows that add to 71 under a headline of 70 is the confusion the
    // breakdown exists to kill.
    for (const h of [4, 5.5, 6, 7, 7.5, 8, 9.5]) {
      for (const so of [1, 2, 3, 4, 5]) {
        const { score, breakdown } = computeRecoveryScore({ sleepHours: h, soreness: so, now: NOW });
        const sum = Object.values(breakdown).reduce((a, p) => a + p.contribution, 0);
        expect(sum).toBe(score);
      }
    }
  });
});

