/**
 * Activity grid on Progress — two defects found in the 2026-09-29 audit.
 *
 * ONE: it counted a day only when that day had load (`volume > 0`). A
 * bodyweight session is zero volume, so a lifter who trains push-ups and
 * pull-ups never saw the grid at all, and everyone else had those days
 * drawn as empty squares reading "no workout".
 *
 * TWO: 26 columns are wider than the card on every phone and the scroller
 * opened at its left edge, the OLDEST week, so the current week was
 * off-screen. jsdom has no layout, so the test fakes the widths and checks
 * the scroller is sent to its end.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { format, subDays } from 'date-fns';

vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs' }) }));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    tFallback: (_k, en, vars) => {
      let s = en;
      if (vars) Object.entries(vars).forEach(([k, v]) => { s = s.replace(`{${k}}`, String(v)); });
      return s;
    },
  }),
}));

import WorkoutCalendarGrid from '@/components/progress/WorkoutCalendarGrid';

const day = (n) => format(subDays(new Date(), n), 'yyyy-MM-dd');
const bodyweight = (n) => ({
  id: `bw${n}`,
  date: day(n),
  exercises: [{ name: 'Push-Up', sets: [{ weight: 0, reps: 12 }] }],
});

let scrollWidthSpy;
beforeEach(() => {
  scrollWidthSpy = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(395);
});
afterEach(() => { cleanup(); scrollWidthSpy.mockRestore(); });

describe('WorkoutCalendarGrid', () => {
  it('shows a bodyweight-only history instead of hiding the grid', () => {
    render(<WorkoutCalendarGrid logs={[bodyweight(3), bodyweight(10)]} />);
    expect(screen.getByText('2 days in last 6 months')).toBeTruthy();
  });

  it('says "1 day", not "1 days"', () => {
    render(<WorkoutCalendarGrid logs={[bodyweight(3)]} />);
    expect(screen.getByText('1 day in last 6 months')).toBeTruthy();
  });

  it('marks a bodyweight day as trained, not as "no workout"', () => {
    render(<WorkoutCalendarGrid logs={[bodyweight(3)]} />);
    const cell = screen.getAllByRole('button').find((b) => /workout logged/.test(b.getAttribute('aria-label') || ''));
    expect(cell).toBeTruthy();
    expect(cell.className).toMatch(/bg-success\/30/);
  });

  it('still hides when nothing was logged in the window', () => {
    const { container } = render(<WorkoutCalendarGrid logs={[bodyweight(400)]} />);
    expect(container.firstChild).toBeNull();
  });

  it('opens scrolled to the newest week', () => {
    render(<WorkoutCalendarGrid logs={[bodyweight(1)]} />);
    const scroller = screen.getByRole('img', { name: /heatmap/i }).parentElement;
    expect(scroller.scrollLeft).toBe(395);
  });
});
