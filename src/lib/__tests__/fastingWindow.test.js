// Tests for src/lib/fastingWindow.js — the pure helpers driving the
// IF tracker (start/end persist to localStorage; computeProgress +
// formatCountdown are pure).

import { describe, it, expect, beforeEach } from 'vitest';
import {
  readState,
  startFast,
  endFast,
  computeProgress,
  formatCountdown,
} from '../fastingWindow';

beforeEach(() => {
  localStorage.clear();
});

describe('startFast / readState / endFast', () => {
  it('returns null when nothing is stored', () => {
    expect(readState('me@x.com')).toBeNull();
  });

  it('persists + reads a fast state', () => {
    const now = new Date('2025-05-21T08:00:00');
    startFast('me@x.com', 16, now);
    const out = readState('me@x.com');
    expect(out.targetHours).toBe(16);
    expect(out.startedAt).toBe(now.toISOString());
  });

  it('endFast clears the saved state', () => {
    startFast('me@x.com', 16, new Date());
    endFast('me@x.com');
    expect(readState('me@x.com')).toBeNull();
  });

  it('returns null on malformed stored JSON', () => {
    localStorage.setItem('flexyn.fastingWindow.me@x.com', '{bad json');
    expect(readState('me@x.com')).toBeNull();
  });

  it('returns null when stored shape is missing required fields', () => {
    localStorage.setItem('flexyn.fastingWindow.me@x.com', JSON.stringify({ startedAt: '2025-05-21' }));
    expect(readState('me@x.com')).toBeNull();
  });
});

describe('computeProgress', () => {
  const start = new Date('2025-05-21T08:00:00').toISOString();
  const startMs = Date.parse(start);

  it('returns target as remaining when no time has passed', () => {
    const out = computeProgress(start, 16, startMs);
    expect(out.elapsedMs).toBe(0);
    expect(out.pct).toBe(0);
    expect(out.done).toBe(false);
  });

  it('clamps elapsed to 0 for a future startedAt (clock skew)', () => {
    const out = computeProgress(start, 16, startMs - 60_000);
    expect(out.elapsedMs).toBe(0);
  });

  it('flips done = true once elapsed reaches target', () => {
    const out = computeProgress(start, 16, startMs + 16 * 3600_000 + 1);
    expect(out.done).toBe(true);
    expect(out.remainingMs).toBe(0);
  });

  it('returns 50% at halfway', () => {
    const out = computeProgress(start, 16, startMs + 8 * 3600_000);
    expect(out.pct).toBe(50);
  });

  it('defaults targetMs to 16h when targetHours is invalid', () => {
    const out = computeProgress(start, 'oops', startMs);
    expect(out.targetMs).toBe(16 * 3600_000);
  });
});

describe('formatCountdown', () => {
  it('renders HH:MM:SS for any positive ms', () => {
    expect(formatCountdown(0)).toBe('0:00:00');
    expect(formatCountdown(45 * 1000)).toBe('0:00:45');
    expect(formatCountdown(75 * 60_000)).toBe('1:15:00');
    expect(formatCountdown((16 * 3600 + 30 * 60 + 5) * 1000)).toBe('16:30:05');
  });

  it('clamps negative ms to 0:00:00', () => {
    expect(formatCountdown(-1000)).toBe('0:00:00');
  });
});
