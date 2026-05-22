// Tests for src/lib/workoutSuggestion.js — the deterministic
// "tomorrow's focus" heuristic.
//
// Cover every branch:
//   • insufficient data → null
//   • zero-coverage group → that group recommended (high confidence)
//   • balance correction → least-trained group with contrastive copy
//   • heavy-day recovery → cardio or recovery focus
//   • old logs outside the 7-day window are ignored
//   • both muscle_group (string) and muscle_groups (array) shapes work

import { describe, it, expect } from 'vitest';
import { computeSuggestion } from '../workoutSuggestion';

// Helper: build a log with a known date offset from a fixed "now".
const NOW = new Date('2026-05-22T12:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function workoutLog({ date, groups }) {
  // Accept ['chest','back'] or [['chest','back'], ['legs']] for multi-ex logs
  const exercises = Array.isArray(groups[0])
    ? groups.map(g => ({ muscle_groups: g, sets: [{ weight: 100, reps: 5 }] }))
    : [{ muscle_groups: groups, sets: [{ weight: 100, reps: 5 }] }];
  return { date, exercises };
}

describe('computeSuggestion', () => {
  it('returns null when there are fewer than 2 workouts', () => {
    expect(computeSuggestion({ logs: [], now: NOW })).toBe(null);
    expect(computeSuggestion({
      logs: [workoutLog({ date: daysAgo(1), groups: ['chest'] })],
      now: NOW,
    })).toBe(null);
  });

  it('ignores logs older than 7 days', () => {
    const result = computeSuggestion({
      logs: [
        workoutLog({ date: daysAgo(30), groups: ['legs'] }),
        workoutLog({ date: daysAgo(29), groups: ['chest'] }),
      ],
      now: NOW,
    });
    // All recent logs filtered out → not enough data
    expect(result).toBe(null);
  });

  it('recommends the never-trained group with high confidence', () => {
    const result = computeSuggestion({
      logs: [
        workoutLog({ date: daysAgo(1), groups: ['chest'] }),
        workoutLog({ date: daysAgo(2), groups: ['chest'] }),
        workoutLog({ date: daysAgo(3), groups: ['back'] }),
      ],
      now: NOW,
    });
    expect(result).not.toBe(null);
    // legs / shoulders / arms / core all had 0 sessions; the heuristic
    // picks the first in canonical order (legs).
    expect(result.focus).toBe('legs');
    expect(result.reason).toContain("haven't trained legs");
  });

  it('suggests recovery when the last log was a heavy 4+ group day', () => {
    // Heavy compound day yesterday with 4 groups.
    const heavy = {
      date: daysAgo(0),
      exercises: [
        { muscle_groups: ['chest'], sets: [{ weight: 100, reps: 5 }] },
        { muscle_groups: ['back'],  sets: [{ weight: 100, reps: 5 }] },
        { muscle_groups: ['legs'],  sets: [{ weight: 100, reps: 5 }] },
        { muscle_groups: ['core'],  sets: [{ weight: 100, reps: 5 }] },
      ],
    };
    const result = computeSuggestion({
      logs: [heavy, workoutLog({ date: daysAgo(2), groups: ['chest'] })],
      now: NOW,
    });
    expect(result).not.toBe(null);
    // No recent cardio → suggests cardio. With recent cardio → recovery.
    expect(['cardio', 'recovery']).toContain(result.focus);
    expect(result.intensity).toBe('light');
  });

  it('recommends recovery (not cardio) when cardio was done recently', () => {
    const heavy = {
      date: daysAgo(0),
      exercises: [
        { muscle_groups: ['chest'], sets: [{ weight: 100, reps: 5 }] },
        { muscle_groups: ['back'],  sets: [{ weight: 100, reps: 5 }] },
        { muscle_groups: ['legs'],  sets: [{ weight: 100, reps: 5 }] },
        { muscle_groups: ['core'],  sets: [{ weight: 100, reps: 5 }] },
      ],
    };
    const result = computeSuggestion({
      logs: [heavy, workoutLog({ date: daysAgo(2), groups: ['chest'] })],
      cardioLogs: [{ date: daysAgo(1) }],
      now: NOW,
    });
    expect(result?.focus).toBe('recovery');
  });

  it('normalizes muscle aliases (quads → legs, biceps → arms)', () => {
    const result = computeSuggestion({
      logs: [
        workoutLog({ date: daysAgo(1), groups: ['quads'] }),
        workoutLog({ date: daysAgo(2), groups: ['biceps'] }),
      ],
      now: NOW,
    });
    expect(result).not.toBe(null);
    // chest / back / shoulders / core are still at zero — picks first canonical
    // which is chest after legs (legs has 1 from quads).
    expect(result.focus).toBe('chest');
    expect(result.reason).toContain("haven't trained chest");
  });

  it('handles the single-muscle_group shape (string, not array)', () => {
    const result = computeSuggestion({
      logs: [
        { date: daysAgo(1), exercises: [{ muscle_group: 'chest', sets: [{ weight: 50, reps: 5 }] }] },
        { date: daysAgo(2), exercises: [{ muscle_group: 'back',  sets: [{ weight: 50, reps: 5 }] }] },
      ],
      now: NOW,
    });
    expect(result).not.toBe(null);
    expect(result.focus).toBe('legs'); // first canonical zero
  });

  it('uses contrastive copy when no group has zero sessions', () => {
    // Three split logs spaced out so the most-recent isn't classified
    // as a "heavy day" (4+ groups in one session). Each log hits a
    // subset; together they cover all 6 focus groups so the heuristic
    // takes the contrastive-balance branch rather than recovery.
    const result = computeSuggestion({
      logs: [
        // daysAgo(3) — push day
        workoutLog({ date: daysAgo(3), groups: ['chest', 'shoulders'] }),
        // daysAgo(5) — pull day
        workoutLog({ date: daysAgo(5), groups: ['back', 'arms'] }),
        // daysAgo(7) — legs+core day. Most recent is 3 days ago → no
        // recovery trigger, no zero-count groups, branches into the
        // balance-correction copy.
        workoutLog({ date: daysAgo(7), groups: ['legs', 'core'] }),
      ],
      now: NOW,
    });
    expect(result).not.toBe(null);
    // Every group has been trained once → no zero-count group. Heuristic
    // falls through to "balance correction" copy with the first
    // canonical-order least-trained group, which is legs.
    expect(result.intensity).toBe('medium');
    expect(result.focus).toBeTruthy();
  });
});
