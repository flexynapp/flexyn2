import { describe, it, expect } from 'vitest';
import {
  pickLift, strengthTrend, weightTrend, heroTrendSlides, summarize, MAX_HORIZON_DAYS,
} from '@/lib/heroTrends';

const NOW = new Date(2026, 9, 2); // Oct 2 2026, local
const day = (offset) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const session = (offset, name, weight, reps = 5) => ({
  date: day(offset),
  exercises: [{ name, sets: [{ weight, reps }] }],
});

describe('pickLift', () => {
  it('picks the lift with the most weighted sessions, ties to the most recent', () => {
    const logs = [
      session(-20, 'Bench Press', 135), session(-10, 'Bench Press', 145),
      session(-15, 'Squat', 185), session(-2, 'Squat', 195),
      session(-1, 'Push-Up', 0, 20),
    ];
    expect(pickLift(logs, NOW)).toEqual({ name: 'Squat', sessions: 2 });
  });

  it('ignores bodyweight and high-rep work that resolves no max', () => {
    expect(pickLift([session(-1, 'Push-Up', 0, 20), session(-2, 'Curl', 20, 30)], NOW)).toBeNull();
  });
});

describe('strengthTrend', () => {
  it('is not ready under three sessions and draws nothing', () => {
    const t = strengthTrend([session(-20, 'Bench Press', 135), session(-5, 'Bench Press', 145)], NOW);
    expect(t.ready).toBe(false);
    expect(t.have).toBe(2);
    expect(t.projection).toBeNull();
    expect(t.lift).toBe('Bench Press');
  });

  it('is not ready when three sessions cover too few days', () => {
    const t = strengthTrend([0, -1, -2].map((o) => session(o, 'Bench Press', 135 + o)), NOW);
    expect(t.have).toBe(3);
    expect(t.ready).toBe(false);
  });

  it('draws real points and projects no further than the data spans', () => {
    const logs = [session(-21, 'Bench Press', 135), session(-14, 'Bench Press', 140), session(-7, 'Bench Press', 145), session(0, 'Bench Press', 150)];
    const t = strengthTrend(logs, NOW);
    expect(t.ready).toBe(true);
    expect(t.direction).toBe('up');
    expect(t.points.map((p) => p.v)).toEqual(logs.map((l) => Math.round(l.exercises[0].sets[0].weight * (1 + 5 / 30))));
    // 21 day span, so a 21 day horizon (under the 28 day cap).
    expect((t.projection.t - t.last.t) / 86_400_000).toBe(21);
    // Continues from the last real point, at the fitted slope.
    expect(t.projection.v).toBeGreaterThan(t.last.v);
  });

  it('gives a falling strength trend no projection', () => {
    const logs = [session(-21, 'Bench Press', 160), session(-14, 'Bench Press', 150), session(0, 'Bench Press', 140)];
    const t = strengthTrend(logs, NOW);
    expect(t.direction).toBe('down');
    expect(t.projection).toBeNull();
  });
});

describe('weightTrend', () => {
  it('keeps the latest entry on a day and projects either direction', () => {
    const rows = [
      { date: day(0), weight_lbs: '180' },
      { date: day(-7), weight_lbs: 182 },
      { date: day(-7), weight_lbs: 190 }, // older entry same day, list is newest first
      { date: day(-14), weight_lbs: 184 },
    ];
    const t = weightTrend(rows, NOW);
    expect(t.points.map((p) => p.v)).toEqual([184, 182, 180]);
    expect(t.direction).toBe('down');
    expect(t.projection.v).toBeLessThan(180);
  });
});

describe('summarize', () => {
  it('caps the horizon at four weeks', () => {
    const pts = [0, 30, 60, 90].map((d, i) => ({ t: d * 86_400_000, v: 100 + i * 10 }));
    const s = summarize(pts, 'strength');
    expect((s.projection.t - s.last.t) / 86_400_000).toBe(MAX_HORIZON_DAYS);
  });

  it('calls a flat line steady and projects it flat', () => {
    const pts = [0, 7, 14].map((d) => ({ t: d * 86_400_000, v: 200 }));
    const s = summarize(pts, 'weight');
    expect(s.direction).toBe('steady');
    expect(s.projection.v).toBe(200);
  });
});

describe('heroTrendSlides', () => {
  it('shows one honest not-yet slide when nothing is ready', () => {
    const slides = heroTrendSlides({ logs: [], bodyMetrics: [], now: NOW });
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({ kind: 'strength', ready: false, have: 0 });
  });

  it('shows only ready trends once any is ready, never a weight nag', () => {
    const logs = [session(-21, 'Squat', 185), session(-10, 'Squat', 195), session(0, 'Squat', 205)];
    const slides = heroTrendSlides({ logs, bodyMetrics: [{ date: day(0), weight_lbs: 180 }], now: NOW });
    expect(slides.map((s) => s.kind)).toEqual(['strength']);
  });
});
