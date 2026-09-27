/**
 * Today's hero (option D): the shared week focal and the one training
 * streak. The week sentence rules are tested in focalGoal.test.js and the
 * ring in focalHero.test.jsx; this covers what Today adds: the streak line's
 * threshold, its two sentences with their vars, and that WeekFocal renders
 * the same week Progress does from the same summary.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/lib/haptic', () => ({ triggerHaptic: vi.fn() }));
// Interpolating stub that IGNORES the English fallback: a missing var
// renders as a literal {placeholder} and fails the assertions below.
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    tFallback: (k, _en, vars = {}) => `[${k}${Object.keys(vars).length ? ' ' + Object.keys(vars).sort().map((v) => `${v}=${vars[v]}`).join(' ') : ''}]`,
  }),
}));

import TodayStreakLine from '@/components/dashboard/TodayStreakLine';
import WeekFocal from '@/components/glance/WeekFocal';
import { weekSummary } from '@/lib/focalGoal';

afterEach(cleanup);

describe('TodayStreakLine', () => {
  it('shows nothing below two days, and never a zero', () => {
    for (const n of [0, 1, null, undefined, NaN]) {
      const { container } = render(<TodayStreakLine streak={n} trainedToday />);
      expect(container).toBeEmptyDOMElement();
      cleanup();
    }
  });

  it('says the streak is in hand once today is trained', () => {
    render(<TodayStreakLine streak={4} trainedToday />);
    expect(screen.getByTestId('today-streak').textContent).toBe('[today.focal.streak n=4]');
  });

  it('says a session today keeps it when today is still open', () => {
    render(<TodayStreakLine streak={3} trainedToday={false} />);
    expect(screen.getByTestId('today-streak').textContent).toBe('[today.focal.streakKeep n=3]');
  });
});

describe('WeekFocal', () => {
  const THU = new Date(2026, 8, 24, 18);
  const lift = (date) => ({ id: date, date, exercises: [{ name: 'Bench', sets: [{ weight: 100, reps: 5 }] }] });
  const profile = { training_days: ['0', '2', '4', '5'] };

  it('renders the week against the target with every var filled', () => {
    const week = weekSummary({ logs: [lift('2026-09-22'), lift('2026-09-24')], profile, now: THU });
    render(<WeekFocal week={week} aside={<span data-testid="aside">x</span>} />);
    expect(screen.getByTestId('focal-headline').textContent).toBe('[progress.focal.week.more n=2]');
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('[progress.focal.ring.aria done=2 target=4]');
    expect(screen.getByTestId('aside')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\{\w+\}/);
  });

  it('shows the goal, not a zero, for someone who has never trained', () => {
    const week = weekSummary({ logs: [], profile, now: THU });
    render(<WeekFocal week={week} />);
    expect(screen.getByTestId('focal-headline').textContent).toBe('[progress.focal.week.first]');
    expect(screen.queryByTestId('focal-ring-arc')).toBeNull();
    expect(document.body.textContent).toContain('[progress.focal.ring.perWeek]');
  });
});
