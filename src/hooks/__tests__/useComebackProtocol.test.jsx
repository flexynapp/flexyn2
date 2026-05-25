import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useComebackProtocol } from '../useComebackProtocol';

// Compute a date N days ago as a LOCAL-CALENDAR YYYY-MM-DD string.
//
// We deliberately don't use `.toISOString().split('T')[0]` here: that
// produces a UTC date, which is 1 day AHEAD of the user's local
// calendar date for any negative UTC offset (Americas) once the local
// clock is late enough in the day. The hook under test parses these
// strings as LOCAL dates (parseLocalDate in useComebackProtocol.js),
// so a UTC-based test fixture caused `daysAgoISO(7)` to evaluate to
// 6 days ago in local-time arithmetic — making the "7 days inclusive"
// case fail late in the day in the Americas. The fix is to mirror the
// hook's local-date convention here.
function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('useComebackProtocol — happy path', () => {
  it('triggers when last workout was 7+ days ago', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [{ date: daysAgoISO(8) }],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(true);
    expect(result.current.daysSince).toBeGreaterThanOrEqual(7);
  });

  it('does NOT trigger when last workout is recent (<7 days)', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [{ date: daysAgoISO(3) }],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(false);
  });

  it('exactly 7 days triggers (threshold inclusive)', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [{ date: daysAgoISO(7) }],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(true);
  });
});

describe('useComebackProtocol — guards', () => {
  it('never triggers when an active session exists', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [{ date: daysAgoISO(30) }],
      hasActiveSession: true,
    }));
    expect(result.current.triggered).toBe(false);
  });

  it('never triggers for brand-new users (no workout history)', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(false);
  });

  it('does not trigger again after being dismissed in the same session', () => {
    const { result, rerender } = renderHook(({ logs }) => useComebackProtocol({
      workoutLogs: logs,
      hasActiveSession: false,
    }), { initialProps: { logs: [{ date: daysAgoISO(10) }] } });

    expect(result.current.triggered).toBe(true);

    act(() => { result.current.dismiss(); });
    // Force a re-render with the same inputs — should now be silent
    rerender({ logs: [{ date: daysAgoISO(10) }] });
    expect(result.current.triggered).toBe(false);
  });

  it('returns daysSince=0 when no log date is present', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [{ /* no date */ }],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(false);
    expect(result.current.daysSince).toBe(0);
  });
});

describe('useComebackProtocol — dismiss()', () => {
  it('exposes a callable dismiss function', () => {
    const { result } = renderHook(() => useComebackProtocol({ workoutLogs: [] }));
    expect(typeof result.current.dismiss).toBe('function');
    expect(() => result.current.dismiss()).not.toThrow();
  });

  it('writes the dismissal flag to sessionStorage', () => {
    const { result } = renderHook(() => useComebackProtocol({ workoutLogs: [] }));
    act(() => { result.current.dismiss(); });
    expect(sessionStorage.getItem('fn_comeback_dismissed')).toBe('true');
  });

  it('survives a sessionStorage write failure (private mode / quota)', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => useComebackProtocol({ workoutLogs: [] }));
    expect(() => result.current.dismiss()).not.toThrow();
    setItemSpy.mockRestore();
  });
});

describe('useComebackProtocol — uses the most-recent log only', () => {
  it('takes the first log in the list (caller responsibility: pre-sorted)', () => {
    const { result } = renderHook(() => useComebackProtocol({
      // First log is recent — should NOT trigger
      workoutLogs: [{ date: daysAgoISO(2) }, { date: daysAgoISO(100) }],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(false);
  });
});
