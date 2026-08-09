// Tests for src/lib/rewardQueue.js — serial celebration scheduler.
//
// The hold used to be a flat 700ms while celebration toasts live 4500–8000ms,
// so the second celebration always appeared on top of the first and sonner
// stacked them (collapsed, and it only expands on hover — which a phone does
// not have). These tests encode the contract that replaced it: a helper
// returns its toast duration, and the queue holds for exactly that long.
//
// The literals below are the queue's MIN_HOLD_MS (700) and DEFAULT_HOLD_MS
// (8000). They are intentionally not exported — a test that reads the
// constant it is checking proves only that the constant equals itself.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enqueueReveal, _clearRewardQueue } from '../rewardQueue';

beforeEach(() => {
  vi.useFakeTimers();
  _clearRewardQueue();
});
afterEach(() => {
  vi.useRealTimers();
  _clearRewardQueue();
});

describe('enqueueReveal', () => {
  it('fires a single enqueued function synchronously', () => {
    const fn = vi.fn();
    enqueueReveal(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('holds for the duration the celebration returns, not a fixed window', () => {
    const pr = vi.fn(() => 8000);          // firePRCelebration
    const firstWorkout = vi.fn(() => 6000); // fireFirstWorkoutCelebration
    enqueueReveal(pr);
    enqueueReveal(firstWorkout);

    expect(pr).toHaveBeenCalledTimes(1);
    expect(firstWorkout).toHaveBeenCalledTimes(0);

    // This is the whole point: at the OLD 700ms spacing the second
    // celebration would already have fired here, on top of a toast with
    // 7.3s still to run.
    vi.advanceTimersByTime(700);
    expect(firstWorkout).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(7299); // t = 7999
    expect(firstWorkout).toHaveBeenCalledTimes(0);

    vi.advanceTimersByTime(1);    // t = 8000, the PR toast has cleared
    expect(firstWorkout).toHaveBeenCalledTimes(1);
  });

  it('falls back to the longest toast duration when a helper declares nothing', () => {
    const legacy = vi.fn();       // returns undefined
    const next = vi.fn();
    enqueueReveal(legacy);
    enqueueReveal(next);

    vi.advanceTimersByTime(7999);
    expect(next).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // firePRCelebration returns 0 when there were no PRs to show. Holding a
  // full 8s for a toast that never rendered would be pure dead air.
  it('drops to the confetti floor when a helper bails without showing a toast', () => {
    const bailed = vi.fn(() => 0);
    const next = vi.fn();
    enqueueReveal(bailed);
    enqueueReveal(next);

    vi.advanceTimersByTime(699);
    expect(next).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // The floor exists for the confetti and haptics: two bursts closer than
  // ~700ms read as one mess rather than two moments.
  it('never holds less than the confetti floor', () => {
    const brief = vi.fn(() => 50);
    const next = vi.fn();
    enqueueReveal(brief);
    enqueueReveal(next);

    vi.advanceTimersByTime(699);
    expect(next).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // A helper that returns a promise must not stall the queue — the queue
  // reads the hold synchronously and lets the promise settle on its own.
  it('does not await a promise-returning helper', () => {
    let settle;
    const slow = vi.fn(() => new Promise(r => { settle = r; }));
    const next = vi.fn();
    enqueueReveal(slow);
    enqueueReveal(next);

    vi.advanceTimersByTime(8000);
    expect(next).toHaveBeenCalledTimes(1); // fired without the promise settling
    settle?.();
  });

  it('ignores non-function inputs without throwing', () => {
    enqueueReveal(null);
    enqueueReveal(undefined);
    enqueueReveal(42);
    enqueueReveal('hello');
    // No assertion — just verifying no throw.
  });

  it('swallows errors from the enqueued function and still drains the next', () => {
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    enqueueReveal(bad);
    enqueueReveal(good);

    expect(bad).toHaveBeenCalledTimes(1);
    // A throw leaves no declared duration, so the default applies.
    vi.advanceTimersByTime(8000);
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('_clearRewardQueue cancels pending items and their timer', () => {
    const a = vi.fn(() => 6000);
    const b = vi.fn();
    enqueueReveal(a);
    enqueueReveal(b);
    _clearRewardQueue();

    vi.advanceTimersByTime(60000);
    expect(a).toHaveBeenCalledTimes(1); // already fired
    expect(b).toHaveBeenCalledTimes(0); // never will
  });
});
