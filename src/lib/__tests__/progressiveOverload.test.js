// Tests for src/lib/progressiveOverload.js — heuristic next-session
// suggestion based on the user's last few logs.

import { describe, it, expect } from 'vitest';
import { suggestNext } from '../progressiveOverload';

function log({ date, exercise, sets }) {
  return { date, exercises: [{ name: exercise, sets }] };
}

const NOW = new Date('2025-05-21T19:00:00');

describe('suggestNext', () => {
  it('returns null when no prior session exists', () => {
    expect(suggestNext('Bench Press', [], { now: NOW })).toBeNull();
    expect(suggestNext('Bench Press', null, { now: NOW })).toBeNull();
  });

  it('returns null for empty exercise name', () => {
    expect(suggestNext('', [log({ date: '2025-05-20', exercise: 'Bench Press', sets: [{ weight: 135, reps: 8 }] })], { now: NOW })).toBeNull();
  });

  it('suggests +5 for a smooth upper-body session', () => {
    const out = suggestNext('Bench Press', [
      log({ date: '2025-05-20', exercise: 'Bench Press', sets: [
        { weight: 135, reps: 8 },
        { weight: 135, reps: 8 },
        { weight: 135, reps: 8 },
      ] }),
    ], { now: NOW });
    expect(out).toMatchObject({ kind: 'bump', weight: 140 });
    expect(out.message).toMatch(/140/);
  });

  it('suggests +10 for a smooth lower-body session', () => {
    const out = suggestNext('Back Squat', [
      log({ date: '2025-05-20', exercise: 'Back Squat', sets: [
        { weight: 225, reps: 5 },
        { weight: 225, reps: 5 },
        { weight: 225, reps: 5 },
      ] }),
    ], { now: NOW });
    expect(out).toMatchObject({ kind: 'bump', weight: 235 });
  });

  it('suggests holding when last session had a failed set', () => {
    const out = suggestNext('Bench Press', [
      log({ date: '2025-05-20', exercise: 'Bench Press', sets: [
        { weight: 135, reps: 8 },
        { weight: 135, reps: 6, is_failed: true },
      ] }),
    ], { now: NOW });
    expect(out).toMatchObject({ kind: 'hold', weight: 135 });
  });

  it('suggests a regression when the user has been away 14+ days', () => {
    const out = suggestNext('Bench Press', [
      log({ date: '2025-05-01', exercise: 'Bench Press', sets: [
        { weight: 200, reps: 5 },
      ] }),
    ], { now: NOW });
    expect(out.kind).toBe('regress');
    expect(out.weight).toBeLessThan(200);
  });

  it('excludes warmups from the top-weight calculation', () => {
    const out = suggestNext('Bench Press', [
      log({ date: '2025-05-20', exercise: 'Bench Press', sets: [
        { weight: 95,  reps: 8, is_warmup: true },
        { weight: 115, reps: 5, is_warmup: true },
        { weight: 135, reps: 8 },
        { weight: 135, reps: 8 },
      ] }),
    ], { now: NOW });
    expect(out.weight).toBe(140); // 135 + 5, not 115 + 5
  });

  it('falls back to a 5% bump for unknown body region', () => {
    const out = suggestNext('Farmers Carry', [
      log({ date: '2025-05-20', exercise: 'Farmers Carry', sets: [
        { weight: 100, reps: 1 },
      ] }),
    ], { now: NOW });
    expect(out.kind).toBe('bump');
    expect(out.weight).toBeGreaterThan(100);
  });
});
