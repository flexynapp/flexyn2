// Tests for src/lib/elapsedClock.js — the pure helpers driving the
// live MM:SS chip + the duration auto-fill on workout save.

import { describe, it, expect } from 'vitest';
import { elapsedSeconds, formatElapsed, elapsedMinutes } from '../elapsedClock';

const NOW = new Date('2025-05-21T19:00:00').getTime();

describe('elapsedSeconds', () => {
  it('returns 0 when no start is provided', () => {
    expect(elapsedSeconds(null, NOW)).toBe(0);
    expect(elapsedSeconds(undefined, NOW)).toBe(0);
    expect(elapsedSeconds('', NOW)).toBe(0);
  });

  it('returns positive seconds for a past start', () => {
    const past = new Date(NOW - 90_000).toISOString(); // 90 seconds ago
    expect(elapsedSeconds(past, NOW)).toBe(90);
  });

  it('clamps a future start to 0 (clock skew safety)', () => {
    const future = new Date(NOW + 60_000).toISOString();
    expect(elapsedSeconds(future, NOW)).toBe(0);
  });

  it('handles a Date object as well as an ISO string', () => {
    expect(elapsedSeconds(new Date(NOW - 5000), NOW)).toBe(5);
  });

  it('returns 0 for an unparseable string', () => {
    expect(elapsedSeconds('not-a-date', NOW)).toBe(0);
  });
});

describe('formatElapsed', () => {
  it('renders MM:SS for sub-hour gaps', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(59)).toBe('0:59');
    expect(formatElapsed(60)).toBe('1:00');
    expect(formatElapsed(125)).toBe('2:05');
    expect(formatElapsed(3599)).toBe('59:59');
  });

  it('renders H:MM:SS once at or past one hour', () => {
    expect(formatElapsed(3600)).toBe('1:00:00');
    expect(formatElapsed(3660)).toBe('1:01:00');
    expect(formatElapsed(7325)).toBe('2:02:05');
  });

  it('floors fractional seconds', () => {
    expect(formatElapsed(125.9)).toBe('2:05');
  });

  it('clamps negative input to 0:00', () => {
    expect(formatElapsed(-30)).toBe('0:00');
  });
});

describe('elapsedMinutes', () => {
  it('rounds to whole minutes for the save field', () => {
    expect(elapsedMinutes(new Date(NOW - 90_000).toISOString(), NOW)).toBe(2);
    expect(elapsedMinutes(new Date(NOW - 30_000).toISOString(), NOW)).toBe(1);
    expect(elapsedMinutes(new Date(NOW - 1_000).toISOString(), NOW)).toBe(0);
  });

  it('returns 0 for missing start', () => {
    expect(elapsedMinutes(null, NOW)).toBe(0);
  });
});
