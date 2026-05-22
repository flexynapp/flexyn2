// Tests for src/hooks/useFormDraft — verifies (a) restore-on-mount
// invokes the callback and writes to localStorage, (b) value changes
// debounce-persist, (c) empty form clears the draft, (d) stale drafts
// auto-evict, (e) clear() wipes the entry, (f) hook is a no-op when
// disabled.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFormDraft } from '../useFormDraft';

const KEY = 'flexyn.test.useFormDraft';

describe('useFormDraft', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  });
  afterEach(() => {
    vi.useRealTimers();
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  });

  it('does nothing when enabled is false', () => {
    const onRestore = vi.fn();
    localStorage.setItem(KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      value: { body: 'restored content' },
    }));
    renderHook(() => useFormDraft({ key: KEY, value: { body: '' }, onRestore, enabled: false }));
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('does nothing when no key is provided', () => {
    const onRestore = vi.fn();
    renderHook(() => useFormDraft({ value: { body: '' }, onRestore, enabled: true }));
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('restores from localStorage on mount and calls onRestore', () => {
    localStorage.setItem(KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      value: { body: 'old draft' },
    }));
    const onRestore = vi.fn();
    renderHook(() => useFormDraft({ key: KEY, value: { body: '' }, onRestore }));
    expect(onRestore).toHaveBeenCalledWith({ body: 'old draft' });
  });

  it('debounces persistence on value change', () => {
    const onRestore = vi.fn();
    const { rerender } = renderHook(
      ({ value }) => useFormDraft({ key: KEY, value, onRestore }),
      { initialProps: { value: { body: '' } } }
    );
    // Initial mount fires restore branch (no draft → no-op).
    // The persist effect is gated by restoredRef which only flips
    // after a restore attempt — so first non-empty value AFTER the
    // restore branch should persist.
    rerender({ value: { body: 'first change' } });
    expect(localStorage.getItem(KEY)).toBe(null); // not yet — debounced
    act(() => { vi.advanceTimersByTime(500); });
    const saved = JSON.parse(localStorage.getItem(KEY));
    expect(saved.value).toEqual({ body: 'first change' });
  });

  it('clears the draft when the form becomes empty', () => {
    const onRestore = vi.fn();
    localStorage.setItem(KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      value: { body: 'something' },
    }));
    const { rerender } = renderHook(
      ({ value }) => useFormDraft({ key: KEY, value, onRestore }),
      { initialProps: { value: { body: 'something' } } }
    );
    rerender({ value: { body: '' } });
    expect(localStorage.getItem(KEY)).toBe(null);
  });

  it('auto-evicts stale drafts older than staleMs', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(KEY, JSON.stringify({
      savedAt: eightDaysAgo,
      value: { body: 'ancient' },
    }));
    const onRestore = vi.fn();
    renderHook(() => useFormDraft({ key: KEY, value: { body: '' }, onRestore }));
    expect(onRestore).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe(null);
  });

  it('clear() returns from the hook wipes the storage entry', () => {
    localStorage.setItem(KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      value: { body: 'soon-gone' },
    }));
    // Pass a non-empty value so the empty-form auto-clear branch
    // doesn't fire before our clear() call runs.
    const { result } = renderHook(() => useFormDraft({ key: KEY, value: { body: 'still here' }, onRestore: () => {} }));
    expect(localStorage.getItem(KEY)).not.toBe(null);
    act(() => { result.current.clear(); });
    expect(localStorage.getItem(KEY)).toBe(null);
  });

  it('returns hasRestored=true when a draft was restored', () => {
    localStorage.setItem(KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      value: { body: 'something' },
    }));
    const { result } = renderHook(() => useFormDraft({ key: KEY, value: { body: '' }, onRestore: () => {} }));
    expect(result.current.hasRestored).toBe(true);
  });

  it('does not restore (or toast) when no draft exists', () => {
    const onRestore = vi.fn();
    const { result } = renderHook(() => useFormDraft({ key: KEY, value: { body: '' }, onRestore }));
    expect(onRestore).not.toHaveBeenCalled();
    expect(result.current.hasRestored).toBe(false);
  });
});
