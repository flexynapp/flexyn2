import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useComebackProtocol } from '../useComebackProtocol';

// Build a log N hours in the past, carrying BOTH the date-only `date`
// column and the `created_at` timestamptz — the shape db.entities returns,
// since every entity read is a `select('*')`.
//
// The hook only trusts `created_at` when it falls on the same calendar day
// as `date` (a log recorded the day it happened); these fixtures satisfy
// that by construction.
function logHoursAgo(hours) {
  const d = new Date(Date.now() - hours * 3_600_000);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, created_at: d.toISOString() };
}

// A date-only log, no timestamp — the backfilled / legacy row shape.
//
// We deliberately don't use `.toISOString().split('T')[0]` here: that
// produces a UTC date, which is 1 day AHEAD of the user's local calendar
// date for any negative UTC offset (Americas) once the local clock is late
// enough in the day. The hook parses these strings as LOCAL dates
// (parseLocalDate), so a UTC-based fixture drifts by one day in the
// Americas and makes threshold cases fail late in the day.
function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const dd   = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('useComebackProtocol — the 72-hour threshold', () => {
  it('triggers when the last workout was more than 72h ago', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [logHoursAgo(73)],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(true);
  });

  it('does NOT trigger at 71 hours', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [logHoursAgo(71)],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(false);
  });

  it('does NOT trigger for a rest day (24h)', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [logHoursAgo(24)],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(false);
  });

  // A full weekend off is not a comeback. This is the case the threshold
  // moved from 48h to 72h to protect: someone who trains Friday and comes
  // back Monday morning must not be greeted as a returning lapsed user.
  it('does NOT trigger across a weekend off (60h)', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [logHoursAgo(60)],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(false);
  });

  it('still triggers on a long absence', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [logHoursAgo(24 * 9)],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(true);
    expect(result.current.daysSince).toBe(9);
  });

  // The threshold is posed in HOURS but `date` is a DATE column, so a
  // date-only row is ambiguous by 24 hours. The hook assumes end-of-day,
  // the latest the session could have been, so it can never claim an
  // absence that hasn't actually elapsed. THREE calendar days back is at
  // most 72h under that assumption, so it must stay silent — a row with no
  // usable timestamp needs a fourth calendar day to clear the bar.
  it('a date-only log three calendar days back does not trigger early', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [{ date: daysAgoISO(3) }],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(false);
  });

  it('a date-only log four calendar days back triggers', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [{ date: daysAgoISO(4) }],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(true);
  });

  // A backfilled log: recorded today, but for a session four days ago.
  // created_at must be ignored, or the absence collapses to zero.
  it('ignores created_at when it is a later calendar day than date', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [{ date: daysAgoISO(4), created_at: new Date().toISOString() }],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(true);
  });
});

describe('useComebackProtocol — guards', () => {
  it('never triggers when an active session exists', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [logHoursAgo(24 * 30)],
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

  it('returns daysSince=0 when no log date is present', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [{ /* no date */ }],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(false);
    expect(result.current.daysSince).toBe(0);
  });
});

describe('useComebackProtocol — dismiss() takes the screen down', () => {
  // THE REGRESSION TEST. Both buttons on the comeback screen were dead in
  // production, and this suite passed the whole time.
  //
  // dismiss() wrote sessionStorage and nothing else, while `triggered` came
  // from a useMemo whose deps were [workoutLogs, hasActiveSession]. Neither
  // moves when you dismiss. The old version of this test re-rendered with a
  // FRESH array literal, which changed the reference and forced the memo to
  // recompute and re-read storage — so it went green. Workout.jsx passes a
  // memoized `logs` array with a STABLE reference, so the memo never re-ran,
  // `triggered` stayed true, and the overlay never came down.
  //
  // Holding one array across the re-render is the entire point here. Do not
  // "tidy" this into an inline literal.
  it('goes silent after dismiss() even when the logs array is referentially stable', () => {
    const logs = [logHoursAgo(24 * 10)];

    const { result, rerender } = renderHook(() => useComebackProtocol({
      workoutLogs: logs,
      hasActiveSession: false,
    }));

    expect(result.current.triggered).toBe(true);

    act(() => { result.current.dismiss(); });
    expect(result.current.triggered).toBe(false);

    rerender();
    expect(result.current.triggered).toBe(false);
  });

  it('writes the dismissal to localStorage, scoped to the user and keyed to the last session', () => {
    const log = logHoursAgo(24 * 10);
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [log], userId: 'user-a',
    }));
    act(() => { result.current.dismiss(); });
    expect(localStorage.getItem('flexyn.comebackDismissed.user-a'))
      .toBe(new Date(log.created_at).toISOString());
  });

  // One tab, two accounts: signing out and back in used to inherit the
  // previous user's dismissal off a single global key, suppressing a screen
  // the second user never dismissed.
  it("one user's dismissal does not suppress another user's screen", () => {
    const logsA = [logHoursAgo(24 * 10)];
    const { result: a } = renderHook(() => useComebackProtocol({
      workoutLogs: logsA, userId: 'user-a',
    }));
    act(() => { a.current.dismiss(); });
    expect(a.current.triggered).toBe(false);

    const logsB = [logHoursAgo(24 * 10)];
    const { result: b } = renderHook(() => useComebackProtocol({
      workoutLogs: logsB, userId: 'user-b',
    }));
    expect(b.current.triggered).toBe(true);
  });

  it('survives a storage write failure (private mode / quota)', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => useComebackProtocol({ workoutLogs: [logHoursAgo(24 * 10)] }));
    expect(() => act(() => { result.current.dismiss(); })).not.toThrow();
    setItemSpy.mockRestore();
  });
});

describe('useComebackProtocol — picks the most recent session', () => {
  // The caller sorts by `-date`, which is a DATE sort with arbitrary
  // ordering inside a day. Taking logs[0] on trust let an out-of-order list
  // claim a months-long absence from a user who trained yesterday.
  it('uses the newest log regardless of list order', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [logHoursAgo(24 * 100), logHoursAgo(5)],
      hasActiveSession: false,
    }));
    expect(result.current.triggered).toBe(false);
  });
});

// THE "ODD TIMES" BUG (2026-09-27). The dismissal lived in sessionStorage,
// which an installed PWA loses every time the OS kills and relaunches it.
// "Go to my dashboard" therefore held only until the next relaunch, and the
// screen reappeared on the next visit to the Workout tab, for the same
// absence the user had already answered. A remount with sessionStorage
// cleared is exactly what a relaunch looks like to this hook.
describe('useComebackProtocol — one screen per absence, across relaunches', () => {
  it('stays dismissed after an app relaunch (fresh sessionStorage)', () => {
    const logs = [logHoursAgo(24 * 10)];
    const first = renderHook(() => useComebackProtocol({ workoutLogs: logs, userId: 'u' }));
    expect(first.result.current.triggered).toBe(true);
    act(() => { first.result.current.dismiss(); });
    first.unmount();

    sessionStorage.clear();
    const relaunched = renderHook(() => useComebackProtocol({ workoutLogs: logs, userId: 'u' }));
    expect(relaunched.result.current.triggered).toBe(false);
  });

  it('re-arms for the NEXT absence once the user has trained again', () => {
    const old = logHoursAgo(24 * 20);
    const first = renderHook(() => useComebackProtocol({ workoutLogs: [old], userId: 'u' }));
    act(() => { first.result.current.dismiss(); });
    first.unmount();

    // Trained 10 days ago, after the dismissed absence, then went away again.
    const again = renderHook(() => useComebackProtocol({
      workoutLogs: [old, logHoursAgo(24 * 10)], userId: 'u',
    }));
    expect(again.result.current.triggered).toBe(true);
  });
});

describe('useComebackProtocol — cardio counts as training', () => {
  it('a run yesterday means no comeback screen, however old the last lift', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [logHoursAgo(24 * 30)],
      cardioLogs: [logHoursAgo(24)],
    }));
    expect(result.current.triggered).toBe(false);
  });

  it('measures the absence from the newer of the two', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [logHoursAgo(24 * 30)],
      cardioLogs: [logHoursAgo(24 * 5)],
    }));
    expect(result.current.triggered).toBe(true);
    expect(result.current.daysSince).toBe(5);
  });

  it('cardio alone does not make a brand-new lifter a returning one', () => {
    const { result } = renderHook(() => useComebackProtocol({
      workoutLogs: [],
      cardioLogs: [logHoursAgo(24 * 30)],
    }));
    expect(result.current.triggered).toBe(false);
  });
});
