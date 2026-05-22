// Tests for src/lib/rewardQueue.js — serial celebration scheduler.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enqueueReveal, _clearRewardQueue } from '../rewardQueue';

beforeEach(() => {
  vi.useFakeTimers();
  _clearRewardQueue();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('enqueueReveal', () => {
  it('fires a single enqueued function synchronously then advances', () => {
    const fn = vi.fn();
    enqueueReveal(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('serializes multiple enqueues with ~700ms spacing', () => {
    const a = vi.fn();
    const b = vi.fn();
    const c = vi.fn();
    enqueueReveal(a);
    enqueueReveal(b);
    enqueueReveal(c);
    // First fires immediately.
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(0);
    expect(c).toHaveBeenCalledTimes(0);

    // After spacing window, the second drains.
    vi.advanceTimersByTime(700);
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(0);

    // Another window, the third drains.
    vi.advanceTimersByTime(700);
    expect(c).toHaveBeenCalledTimes(1);
  });

  it('ignores non-function inputs without throwing', () => {
    enqueueReveal(null);
    enqueueReveal(undefined);
    enqueueReveal(42);
    enqueueReveal('hello');
    // No assertion — just verifying no throw.
  });

  it('swallows errors from the enqueued function', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    enqueueReveal(bad);
    enqueueReveal(good);
    expect(bad).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(700);
    // Good still fires after bad.
    expect(good).toHaveBeenCalledTimes(1);
  });
});
