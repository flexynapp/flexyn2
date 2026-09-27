// Tests for src/hooks/useOptimisticDelete — covers the core flow:
// optimistic remove, undo path (no server call), commit path (server
// call fires after timeout), and unmount-flushes-pending.
//
// The feedback pill's store is mocked to capture the action callback so we can
// simulate the Undo tap directly.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOptimisticDelete } from '../useOptimisticDelete';

// Capture every toast() call so tests can pull out the action callback.
const toastCalls = [];
vi.mock('@/lib/feedbackStore', () => ({
  show: (kind, label, options) => {
    if (kind === 'default') toastCalls.push({ label, options });
    return Math.random();
  },
  dismiss: vi.fn(),
}));

function wrap(client) {
  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useOptimisticDelete', () => {
  let qc;

  beforeEach(() => {
    vi.useFakeTimers();
    toastCalls.length = 0;
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(['list'], [
      { id: 'a', name: 'Alpha' },
      { id: 'b', name: 'Bravo' },
      { id: 'c', name: 'Charlie' },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
    qc.clear();
  });

  it('removes the item from the cache immediately on deleteWithUndo', () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () => useOptimisticDelete({
        queryKey: ['list'],
        identify: (item) => item.id,
        deleteFn,
        label: 'Deleted',
      }),
      { wrapper: wrap(qc) }
    );
    act(() => {
      result.current.deleteWithUndo({ id: 'b', name: 'Bravo' });
    });
    const live = qc.getQueryData(['list']);
    expect(live.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('commits the server delete after the undo window', () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () => useOptimisticDelete({
        queryKey: ['list'],
        identify: (item) => item.id,
        deleteFn,
        commitMs: 6000,
      }),
      { wrapper: wrap(qc) }
    );
    act(() => {
      result.current.deleteWithUndo({ id: 'b' });
    });
    expect(deleteFn).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(deleteFn).toHaveBeenCalledWith('b');
  });

  it('does NOT fire the server delete when the user taps Undo', () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () => useOptimisticDelete({
        queryKey: ['list'],
        identify: (item) => item.id,
        deleteFn,
        commitMs: 6000,
      }),
      { wrapper: wrap(qc) }
    );
    act(() => {
      result.current.deleteWithUndo({ id: 'b', name: 'Bravo' });
    });
    // Invoke the Undo action stored in the last toast call.
    const last = toastCalls[toastCalls.length - 1];
    act(() => { last.options.action.onClick(); });
    act(() => { vi.advanceTimersByTime(6000); });
    expect(deleteFn).not.toHaveBeenCalled();
    const live = qc.getQueryData(['list']);
    expect(live.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('restores at the original index on Undo', () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () => useOptimisticDelete({
        queryKey: ['list'],
        identify: (item) => item.id,
        deleteFn,
      }),
      { wrapper: wrap(qc) }
    );
    act(() => {
      result.current.deleteWithUndo({ id: 'a', name: 'Alpha' });
    });
    const last = toastCalls[toastCalls.length - 1];
    act(() => { last.options.action.onClick(); });
    const live = qc.getQueryData(['list']);
    // Should be back at index 0 since that's where we deleted from.
    expect(live[0].id).toBe('a');
  });

  it('flushPending commits all outstanding deletes immediately', () => {
    const deleteFn = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () => useOptimisticDelete({
        queryKey: ['list'],
        identify: (item) => item.id,
        deleteFn,
      }),
      { wrapper: wrap(qc) }
    );
    act(() => { result.current.deleteWithUndo({ id: 'a' }); });
    act(() => { result.current.deleteWithUndo({ id: 'b' }); });
    expect(deleteFn).not.toHaveBeenCalled();
    act(() => { result.current.flushPending(); });
    expect(deleteFn).toHaveBeenCalledTimes(2);
  });
});
