// src/lib/__tests__/journalEditWindow.test.js
//
// The window rule, pinned. It replaced `readOnly = !isToday` — the only
// genuinely open product call the My Journal audit surfaced — so the
// boundary itself is the thing worth testing, not the editor around it.
//
// Two traps live in here and neither is visible from the call site:
//   • the day count must come from the date STRINGS. Subtracting live
//     timestamps makes the window's width depend on the time of day.
//   • unparseable and future dates must fail CLOSED. Refusing an edit is
//     recoverable; silently writing to the wrong day is not.

import { describe, it, expect } from 'vitest';
import { editability, EDIT_WINDOW_DAYS } from '../journalEditWindow';

const TODAY = '2026-08-09';

describe('editability — the 7-day window', () => {
  it('treats today as writable and knows it is today', () => {
    expect(editability(TODAY, TODAY)).toEqual({ daysAgo: 0, readOnly: false, isToday: true });
  });

  it('opens yesterday, which is the case the whole change exists for', () => {
    const e = editability('2026-08-08', TODAY);
    expect(e).toEqual({ daysAgo: 1, readOnly: false, isToday: false });
  });

  it('is inclusive at the boundary and locks the day after it', () => {
    expect(editability('2026-08-02', TODAY).daysAgo).toBe(7);      // exactly the window
    expect(editability('2026-08-02', TODAY).readOnly).toBe(false);
    expect(editability('2026-08-01', TODAY).daysAgo).toBe(8);
    expect(editability('2026-08-01', TODAY).readOnly).toBe(true);
    expect(EDIT_WINDOW_DAYS).toBe(7);
  });

  it('counts across a month boundary', () => {
    expect(editability('2026-07-31', '2026-08-03').daysAgo).toBe(3);
    expect(editability('2026-07-31', '2026-08-03').readOnly).toBe(false);
  });

  it('counts across a DST change — the reason this is not a timestamp diff', () => {
    // US DST ends 2026-11-01: the 24h assumption breaks and a raw
    // millisecond division lands on 6.958 days, which floors to 6 and
    // silently widens the window by a day once a year.
    expect(editability('2026-10-26', '2026-11-02').daysAgo).toBe(7);
    expect(editability('2026-10-26', '2026-11-02').readOnly).toBe(false);
    expect(editability('2026-10-25', '2026-11-02').readOnly).toBe(true);
  });

  it('locks a future day — reachable only by a clock change, and not a day that happened', () => {
    const e = editability('2026-08-10', TODAY);
    expect(e.daysAgo).toBe(-1);
    expect(e.readOnly).toBe(true);
    expect(e.isToday).toBe(false);
  });

  it('fails CLOSED on anything it cannot parse', () => {
    for (const bad of ['', 'not-a-date', '2026-13-45', null, undefined]) {
      const e = editability(bad, TODAY);
      expect(e.readOnly).toBe(true);
      expect(e.isToday).toBe(false);
    }
    expect(editability(TODAY, 'nonsense').readOnly).toBe(true);
  });
});
