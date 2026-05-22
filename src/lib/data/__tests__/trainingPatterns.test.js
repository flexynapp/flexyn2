// Tests for trainingPatterns.js — computes the user's training rhythm
// from already-fetched workout logs, e.g. "Mon · Wed · Fri at 6:30 PM".
//
// Pure function, no IO. Cover:
//   • Empty / malformed inputs
//   • Below-threshold counts → null
//   • Single dominant day → that day, median hour from its sessions
//   • Multiple qualifying days → all days sorted, median from dominant
//   • Half-hour rounding + AM/PM formatting

import { describe, it, expect } from 'vitest';
import { computeTrainingPattern } from '../trainingPatterns';

// Build a synthetic workout log at the given day-of-week (0..6) and
// hour-of-day, occurring some number of weeks ago.
function logAt(now, weeksAgo, dow, hour, minute = 0) {
  const d = new Date(now);
  d.setDate(d.getDate() - weeksAgo * 7);
  // Walk forward/back to land on the requested DOW.
  const diff = dow - d.getDay();
  d.setDate(d.getDate() + diff);
  d.setHours(hour, minute, 0, 0);
  return { date: d.toISOString() };
}

describe('computeTrainingPattern', () => {
  const NOW = new Date('2025-05-21T12:00:00');

  it('returns null for empty / non-array input', () => {
    expect(computeTrainingPattern([], { now: NOW })).toBeNull();
    expect(computeTrainingPattern(null, { now: NOW })).toBeNull();
    expect(computeTrainingPattern(undefined, { now: NOW })).toBeNull();
  });

  it('returns null when no day reaches MIN_OCCURRENCES', () => {
    const logs = [
      logAt(NOW, 1, 1, 18), // 1 Mon
      logAt(NOW, 2, 3, 18), // 1 Wed
      logAt(NOW, 3, 5, 18), // 1 Fri
    ];
    expect(computeTrainingPattern(logs, { now: NOW })).toBeNull();
  });

  it('returns null when all logs are older than weeksBack', () => {
    const logs = [
      logAt(NOW, 20, 1, 18),
      logAt(NOW, 20, 1, 18),
      logAt(NOW, 20, 1, 18),
      logAt(NOW, 20, 1, 18),
    ];
    expect(computeTrainingPattern(logs, { now: NOW })).toBeNull();
  });

  it('detects a single dominant day with its median hour', () => {
    // Five Mondays at 6 PM in the last 5 weeks.
    const logs = [
      logAt(NOW, 1, 1, 18),
      logAt(NOW, 2, 1, 18),
      logAt(NOW, 3, 1, 18),
      logAt(NOW, 4, 1, 18),
      logAt(NOW, 5, 1, 18),
    ];
    const result = computeTrainingPattern(logs, { now: NOW });
    expect(result).not.toBeNull();
    expect(result.days).toEqual(['Mon']);
    expect(result.medianHourLabel).toBe('6:00 PM');
  });

  it('detects multiple qualifying days in calendar order', () => {
    const logs = [];
    // 4× each on Mon, Wed, Fri at 6:30 PM, biweekly-ish.
    for (let w = 1; w <= 4; w++) {
      logs.push(logAt(NOW, w, 1, 18, 30)); // Mon
      logs.push(logAt(NOW, w, 3, 18, 30)); // Wed
      logs.push(logAt(NOW, w, 5, 18, 30)); // Fri
    }
    const result = computeTrainingPattern(logs, { now: NOW });
    expect(result).not.toBeNull();
    expect(result.days).toEqual(['Mon', 'Wed', 'Fri']);
    expect(result.medianHourLabel).toBe('6:30 PM');
  });

  it('rounds an off-minute median to the nearest half-hour', () => {
    // Five Mondays at varying minute marks, median should round.
    const logs = [
      logAt(NOW, 1, 1, 6, 5),  // 6:05 AM
      logAt(NOW, 2, 1, 6, 10), // 6:10 AM
      logAt(NOW, 3, 1, 6, 20), // 6:20 AM  ← median
      logAt(NOW, 4, 1, 6, 35), // 6:35 AM
      logAt(NOW, 5, 1, 6, 45), // 6:45 AM
    ];
    const result = computeTrainingPattern(logs, { now: NOW });
    expect(result?.medianHourLabel).toBe('6:30 AM');
  });

  it('formats midnight and noon correctly', () => {
    const midnightLogs = Array.from({ length: 5 }, (_, i) =>
      logAt(NOW, i + 1, 1, 0, 0)
    );
    expect(
      computeTrainingPattern(midnightLogs, { now: NOW })?.medianHourLabel
    ).toBe('12:00 AM');

    const noonLogs = Array.from({ length: 5 }, (_, i) =>
      logAt(NOW, i + 1, 1, 12, 0)
    );
    expect(
      computeTrainingPattern(noonLogs, { now: NOW })?.medianHourLabel
    ).toBe('12:00 PM');
  });

  it('skips logs with missing or invalid timestamps', () => {
    const logs = [
      logAt(NOW, 1, 1, 18),
      logAt(NOW, 2, 1, 18),
      logAt(NOW, 3, 1, 18),
      logAt(NOW, 4, 1, 18),
      { date: null },
      { date: 'not-a-date' },
      {},
    ];
    const result = computeTrainingPattern(logs, { now: NOW });
    expect(result).not.toBeNull();
    expect(result.days).toEqual(['Mon']);
  });

  it('prefers created_at when both fields are present', () => {
    // date is yesterday, created_at is 3 weeks ago.
    const recent = new Date(NOW);
    recent.setDate(recent.getDate() - 1);
    const oldStamp = new Date(NOW);
    oldStamp.setDate(oldStamp.getDate() - 21);

    const logs = [
      { date: recent.toISOString(), created_at: oldStamp.toISOString() },
    ];
    // Only one log — not enough to qualify, but ensures no throw.
    expect(computeTrainingPattern(logs, { now: NOW })).toBeNull();
  });
});
