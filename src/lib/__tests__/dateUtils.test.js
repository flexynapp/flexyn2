// Tests for src/lib/dateUtils.js — the shared local-date helpers.
//
// The bug class under test: WorkoutLog.date / body-metric dates are
// LOCAL 'yyyy-MM-dd' strings, but `new Date('yyyy-MM-dd')` parses them
// as UTC midnight, which is the PREVIOUS local calendar day for anyone
// west of UTC. parseLocalDate must construct local midnight instead,
// and toLocalDateString must serialize from local parts (never
// toISOString, which returns the UTC day).
//
// All assertions here are timezone-agnostic — they compare local date
// parts / round-trips, so the suite passes in any runner TZ.

import { describe, it, expect } from 'vitest';
import {
  parseLocalDate,
  toLocalDateString,
  todayLocalDateString,
} from '../dateUtils';

describe('parseLocalDate', () => {
  it('parses a yyyy-MM-dd string as LOCAL midnight, not UTC', () => {
    const d = parseLocalDate('2026-06-10');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5); // June (0-based)
    expect(d.getDate()).toBe(10); // SAME local calendar day in every TZ
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it('matches an explicitly-constructed local Date', () => {
    expect(parseLocalDate('2025-01-05').getTime())
      .toBe(new Date(2025, 0, 5).getTime());
  });

  it('round-trips through toLocalDateString', () => {
    for (const s of ['2026-06-10', '2026-01-01', '2025-12-31', '2024-02-29']) {
      expect(toLocalDateString(parseLocalDate(s))).toBe(s);
    }
  });

  it('delegates full ISO timestamps to the native Date constructor', () => {
    const iso = '2026-06-10T12:34:56Z';
    expect(parseLocalDate(iso).getTime()).toBe(new Date(iso).getTime());
  });

  it('accepts Date instances', () => {
    const d = new Date(2026, 5, 10, 15, 30);
    expect(parseLocalDate(d).getTime()).toBe(d.getTime());
  });

  it('returns null for falsy / unparseable input', () => {
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate(undefined)).toBeNull();
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate('not-a-date')).toBeNull();
  });
});

describe('toLocalDateString', () => {
  it('serializes from LOCAL date parts with zero padding', () => {
    expect(toLocalDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toLocalDateString(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('keeps the local calendar day for late-evening times (the toISOString trap)', () => {
    // 23:30 local on June 8 is already June 9 in UTC for any TZ west of
    // UTC-0:30 — toISOString().slice(0,10) would flip the day there.
    expect(toLocalDateString(new Date(2026, 5, 8, 23, 30))).toBe('2026-06-08');
    // 00:15 local is the previous UTC day for TZs east of UTC+0:15.
    expect(toLocalDateString(new Date(2026, 5, 8, 0, 15))).toBe('2026-06-08');
  });

  it('returns null for missing or invalid input', () => {
    expect(toLocalDateString(null)).toBeNull();
    expect(toLocalDateString(undefined)).toBeNull();
    expect(toLocalDateString(new Date('nope'))).toBeNull();
    expect(toLocalDateString('2026-06-10')).toBeNull(); // strings are not Dates
  });
});

describe('todayLocalDateString', () => {
  it("matches today's LOCAL date parts", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    expect(todayLocalDateString()).toBe(expected);
  });
});
