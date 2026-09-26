// src/hooks/__tests__/useCountUp.test.jsx
//
// useCountUp drives every count up and bar fill added in the 2026-09-26
// "feel" pass. The behaviours pinned here are the ones a refactor would
// silently invert: mount animates from zero, a change animates from where
// the number visibly is, reduced motion returns the value immediately with
// no frames scheduled, and "no data" (null / undefined) is never turned
// into a zero.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useCountUp from '@/hooks/useCountUp';

let now = 0;
let frames = [];

function flushFrame(deltaMs) {
  now += deltaMs;
  const due = frames;
  frames = [];
  act(() => { due.forEach((cb) => cb(now)); });
}

// setup.js's matchMedia is a module scoped vi.fn(); reset it every test so
// the reduced motion case cannot leak into the next one.
function mediaNoPreference(query) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

beforeEach(() => {
  now = 0;
  frames = [];
  window.matchMedia = vi.fn(mediaNoPreference);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useCountUp', () => {
  it('starts from 0 on first mount and lands exactly on the value', () => {
    const { result } = renderHook(() => useCountUp(100, { duration: 1000 }));
    expect(result.current).toBe(0);

    flushFrame(500);
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(100);
    // Ease out: past the linear midpoint at t = 0.5.
    expect(result.current).toBeGreaterThan(50);

    flushFrame(600);
    expect(result.current).toBe(100);
  });

  it('animates from the previous value when the value changes', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useCountUp(v, { duration: 1000 }),
      { initialProps: { v: 10 } },
    );
    flushFrame(1100);
    expect(result.current).toBe(10);

    rerender({ v: 20 });
    flushFrame(100);
    expect(result.current).toBeGreaterThan(10);
    expect(result.current).toBeLessThan(20);

    flushFrame(1000);
    expect(result.current).toBe(20);
  });

  it('snaps on mount when animateOnMount is false', () => {
    const { result } = renderHook(() => useCountUp(42, { animateOnMount: false }));
    expect(result.current).toBe(42);
    expect(frames).toHaveLength(0);
  });

  it('starts every animation at `from` when given', () => {
    const { result } = renderHook(() => useCountUp(50, { from: 40, duration: 1000 }));
    expect(result.current).toBe(40);
    flushFrame(1100);
    expect(result.current).toBe(50);
  });

  it('returns the final value immediately and schedules nothing under reduced motion', () => {
    window.matchMedia = vi.fn((q) => ({ ...mediaNoPreference(q), matches: q.includes('prefers-reduced-motion') }));
    const { result, rerender } = renderHook(
      ({ v }) => useCountUp(v, { duration: 1000 }),
      { initialProps: { v: 100 } },
    );
    expect(result.current).toBe(100);
    expect(frames).toHaveLength(0);

    rerender({ v: 250 });
    expect(result.current).toBe(250);
    expect(frames).toHaveLength(0);
  });

  it('passes null and undefined through unchanged', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useCountUp(v),
      { initialProps: { v: null } },
    );
    expect(result.current).toBeNull();
    expect(frames).toHaveLength(0);

    rerender({ v: undefined });
    expect(result.current).toBeUndefined();
  });

  it('counts up from 0 when a value arrives after null', () => {
    const { result, rerender } = renderHook(
      ({ v }) => useCountUp(v, { duration: 1000 }),
      { initialProps: { v: null } },
    );
    rerender({ v: 8 });
    flushFrame(10);
    expect(result.current).toBeGreaterThanOrEqual(0);
    expect(result.current).toBeLessThan(8);
    flushFrame(1100);
    expect(result.current).toBe(8);
  });

  it('schedules no frames for a 0 to 0 mount', () => {
    const { result } = renderHook(() => useCountUp(0));
    expect(result.current).toBe(0);
    expect(frames).toHaveLength(0);
  });
});
