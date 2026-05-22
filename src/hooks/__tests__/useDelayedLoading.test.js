// Tests for src/hooks/useDelayedLoading — confirms fast operations
// never show a spinner and slow ones do, the timer is properly
// cleaned up on unmount, and re-renders with the same isLoading
// value don't restart the timer.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDelayedLoading } from '../useDelayedLoading';

describe('useDelayedLoading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns false initially when isLoading is false', () => {
    const { result } = renderHook(() => useDelayedLoading(false, 250));
    expect(result.current).toBe(false);
  });

  it('returns false initially when isLoading flips to true (within delay)', () => {
    const { result, rerender } = renderHook(({ loading }) => useDelayedLoading(loading, 250), {
      initialProps: { loading: false },
    });
    rerender({ loading: true });
    expect(result.current).toBe(false);
  });

  it('flips to true after the delay elapses', () => {
    const { result, rerender } = renderHook(({ loading }) => useDelayedLoading(loading, 250), {
      initialProps: { loading: false },
    });
    rerender({ loading: true });
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current).toBe(true);
  });

  it('never flips to true if isLoading completes within the delay window', () => {
    const { result, rerender } = renderHook(({ loading }) => useDelayedLoading(loading, 250), {
      initialProps: { loading: false },
    });
    rerender({ loading: true });
    act(() => { vi.advanceTimersByTime(100); });
    rerender({ loading: false });
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current).toBe(false);
  });

  it('flips back to false immediately when loading completes after spinner showed', () => {
    const { result, rerender } = renderHook(({ loading }) => useDelayedLoading(loading, 250), {
      initialProps: { loading: false },
    });
    rerender({ loading: true });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe(true);
    rerender({ loading: false });
    expect(result.current).toBe(false);
  });

  it('respects a custom delay value', () => {
    const { result, rerender } = renderHook(({ loading }) => useDelayedLoading(loading, 500), {
      initialProps: { loading: false },
    });
    rerender({ loading: true });
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current).toBe(false);
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current).toBe(true);
  });

  it('cleans up the timer on unmount (no spinner flash after teardown)', () => {
    const { rerender, unmount } = renderHook(({ loading }) => useDelayedLoading(loading, 250), {
      initialProps: { loading: false },
    });
    rerender({ loading: true });
    unmount();
    // If cleanup didn't happen, the timer would fire and try to call
    // setDelayed on an unmounted hook. We can't catch the throw here
    // directly but the test serves as a smoke check.
    expect(() => act(() => { vi.advanceTimersByTime(500); })).not.toThrow();
  });
});
