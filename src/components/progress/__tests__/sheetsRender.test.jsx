// Mounts both new sheets and asserts on what they actually render.
//
// This exists because the browser could not: a worktree dev server is a
// different origin from the one holding the signed-in session, and these
// sheets only exist behind auth. Rather than ship two brand-new surfaces on
// "lint and build passed", they get mounted here — which is weaker than a
// screenshot for layout and STRONGER than one for the conditional rules,
// since those only appear on data shapes a healthy account never has.
//
// The three rules under test are the ones that are decisions, not markup:
// zero rows drop rather than render 0, the list is heaviest-first, and the
// filter only appears once it is earned.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    // Interpolates like the real tFallback, so a dropped var shows up here
    // rather than as a literal {n} in a non-English locale later.
    t: (k) => k,
    tFallback: (_k, english, vars) => {
      let s = english;
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
      return s;
    },
  }),
}));
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs' }) }));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));

const AdvancedAnalyticsSheet = (await import('@/components/progress/AdvancedAnalyticsSheet')).default;
const PersonalBestsSheet = (await import('@/components/progress/PersonalBestsSheet')).default;

const log = (date, exercises, extra = {}) => ({ date, exercises, ...extra });
const set = (weight, reps) => ({ weight, reps });

describe('AdvancedAnalyticsSheet', () => {
  const withDuration = [
    log('2026-08-01', [{ name: 'Bench Press', muscle_group: 'Chest', sets: [set(185, 5)] }], { duration_min: 60 }),
    log('2026-08-03', [{ name: 'Bench Press', muscle_group: 'Chest', sets: [set(175, 8)] }], { duration_min: 45 }),
  ];

  it('groups the rows instead of listing them flat', () => {
    render(<AdvancedAnalyticsSheet open onClose={() => {}} logs={withDuration} />);
    expect(screen.getByText('LOAD')).toBeTruthy();
    expect(screen.getByText('CONSISTENCY')).toBeTruthy();
    expect(screen.getByText('RANGE')).toBeTruthy();
  });

  it('renders the duration rows when sessions carry a duration', () => {
    render(<AdvancedAnalyticsSheet open onClose={() => {}} logs={withDuration} />);
    expect(screen.getByText('Total time')).toBeTruthy();
    expect(screen.getByText('Avg session')).toBeTruthy();
    // 60 + 45 = 105 min -> 1 h 45 m, and the average is over the sessions
    // that HAVE a duration, not over every log.
    expect(screen.getByText('1 h 45 m')).toBeTruthy();
  });

  it('DROPS the duration rows entirely when nothing carries one', () => {
    // The pre-fix shape: rows saved before d0a15d2b have no duration and
    // cannot be backfilled. The old dialog rendered "0 min" twice at these
    // users. Nothing is the honest answer.
    const noDuration = [log('2026-08-01', [{ name: 'Squat', muscle_group: 'Legs', sets: [set(225, 5)] }])];
    render(<AdvancedAnalyticsSheet open onClose={() => {}} logs={noDuration} />);
    expect(screen.queryByText('Total time')).toBeNull();
    expect(screen.queryByText('Avg session')).toBeNull();
    expect(screen.queryByText('0 min')).toBeNull();
    // …while the group that still has a row survives.
    expect(screen.getByText('Total workouts')).toBeTruthy();
  });

  it('renders nothing at all when closed', () => {
    const { container } = render(<AdvancedAnalyticsSheet open={false} onClose={() => {}} logs={withDuration} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('PersonalBestsSheet', () => {
  const three = [
    log('2026-08-01', [
      { name: 'Bench Press', sets: [set(185, 5)] },
      { name: 'Deadlift', sets: [set(315, 3)] },
      { name: 'Curl', sets: [set(40, 12)] },
    ]),
  ];

  it('sorts heaviest first, not alphabetically', () => {
    render(<PersonalBestsSheet open onClose={() => {}} logs={three} />);
    const names = [...document.querySelectorAll('p.text-sm.font-semibold')].map(n => n.textContent);
    // Alphabetical would be Bench Press, Curl, Deadlift.
    expect(names).toEqual(['Deadlift', 'Bench Press', 'Curl']);
  });

  it('leads with the heaviest lift as the hero', () => {
    render(<PersonalBestsSheet open onClose={() => {}} logs={three} />);
    expect(screen.getByText('Deadlift — your heaviest lift')).toBeTruthy();
    expect(screen.getByText('3 exercises with a recorded best')).toBeTruthy();
  });

  it('hides the filter until the list is long enough to need it', () => {
    render(<PersonalBestsSheet open onClose={() => {}} logs={three} />);
    expect(screen.queryByPlaceholderText('Filter exercises')).toBeNull();
  });

  it('shows the filter past the threshold', () => {
    const many = [log('2026-08-01', Array.from({ length: 20 }, (_, i) => ({
      name: `Exercise ${i}`, sets: [set(100 + i, 5)],
    })))];
    render(<PersonalBestsSheet open onClose={() => {}} logs={many} />);
    expect(screen.getByPlaceholderText('Filter exercises')).toBeTruthy();
  });

  it('shows its own empty state rather than an empty sheet', () => {
    render(<PersonalBestsSheet open onClose={() => {}} logs={[]} />);
    expect(screen.getByText('progress.noData')).toBeTruthy();
  });
});
