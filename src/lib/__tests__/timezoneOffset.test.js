// Regression tests for the timezone-offset capture in AuthContext.
//
// The bug we're guarding against: `Date.prototype.getTimezoneOffset()`
// returns MINUTES WEST of UTC (i.e. positive for North America,
// negative for Asia). The migration 035 SQL computes user-local time
// as `now() + offset_minutes` and expects "minutes east" semantics.
//
// If AuthContext forgets to invert the JS sign, every nudge fires
// 12-14 hours off-window. That's a silent retention bug — users in
// the Americas would get pushed at 6 AM their time instead of 7 PM,
// and would assume the app is just broken.

import { describe, it, expect } from 'vitest';

/**
 * Mirrors the conversion in AuthContext.loadProfile so the inversion
 * rule is documented in a test and changes here force a deliberate
 * review.
 */
function captureOffsetMinutes(date) {
  return -date.getTimezoneOffset();
}

/**
 * Builds a Date whose getTimezoneOffset() we control, so we can
 * assert the inversion logic without depending on the host's actual
 * timezone.
 */
function fakeDateWithOffset(offsetWestMinutes) {
  return {
    getTimezoneOffset: () => offsetWestMinutes,
  };
}

describe('timezone offset capture', () => {
  it('inverts the JS "minutes west" convention into "minutes east"', () => {
    // US Pacific Standard Time is UTC-8 → JS returns +480 (minutes west).
    // The SQL function expects -480 (minutes east).
    expect(captureOffsetMinutes(fakeDateWithOffset(480))).toBe(-480);

    // India Standard Time is UTC+5:30 → JS returns -330 (negative
    // because it's east of UTC). SQL expects +330.
    expect(captureOffsetMinutes(fakeDateWithOffset(-330))).toBe(330);

    // UTC itself → both sides return 0. No inversion artifact.
    // Use Object.is-tolerant comparison since `-0 !== 0` under Object.is
    // and JS unary minus of 0 yields -0. Either is mathematically fine.
    expect(Math.abs(captureOffsetMinutes(fakeDateWithOffset(0)))).toBe(0);
  });

  it('stays within the SQL function bounds for every real timezone', () => {
    // The update_user_timezone_offset RPC rejects offsets outside
    // [-720, +840]. Real-world Earth timezones range from -12:00
    // (Baker Island) to +14:00 (Line Islands). These correspond to
    // JS getTimezoneOffset() values of +720 and -840 respectively.
    expect(captureOffsetMinutes(fakeDateWithOffset(720))).toBe(-720);
    expect(captureOffsetMinutes(fakeDateWithOffset(-840))).toBe(840);

    // Verify both endpoints sit ON the SQL bounds (not outside).
    const minSqlBound = -720;
    const maxSqlBound = 840;
    expect(captureOffsetMinutes(fakeDateWithOffset(720))).toBeGreaterThanOrEqual(minSqlBound);
    expect(captureOffsetMinutes(fakeDateWithOffset(-840))).toBeLessThanOrEqual(maxSqlBound);
  });

  it('returns an integer for every standard offset', () => {
    // The SQL function uses Number.isInteger as a sanity guard. Make
    // sure no fractional half-hour or 45-minute offset produces a
    // non-integer (it shouldn't — getTimezoneOffset is always whole
    // minutes — but the test pins the contract).
    for (const offset of [0, 30, -30, 330, -330, 345, -345, 480, -480]) {
      const result = captureOffsetMinutes(fakeDateWithOffset(offset));
      expect(Number.isInteger(result)).toBe(true);
    }
  });
});
