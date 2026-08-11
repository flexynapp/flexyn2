/**
 * Target date, the progress bar, and archive — the three sub-features
 * reworked on 2026-08-11.
 *
 * Two of the three did not exist before this change and so had no tests to
 * extend: `goals.deadline` was a column with 0 of 5 rows populated and no
 * input anywhere, and archive was absent entirely. The progress bar existed
 * and was untested.
 *
 * The clock is frozen because every deadline assertion is relative to today.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/lib/LanguageContext';

vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs' }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'mi' }) }));
vi.mock('@/lib/SettingsContext', () => ({ useSettings: () => ({ allowDeleteCompletedGoals: true }) }));
vi.mock('@/lib/haptic', () => ({ triggerHaptic: vi.fn() }));

import GoalsList from '@/components/goals/GoalsList';
import GoalProgressBar from '@/components/goals/GoalProgressBar';

const NOON = new Date(2026, 7, 11, 12, 0, 0);

const goal = (over = {}) => ({
  id: 'g-1',
  status: 'active',
  goal_type: 'strength',
  exercise_name: 'Bench Press',
  target_weight: 225,
  target_reps: null,
  ...over,
});

const show = (props = {}) => render(
  <MemoryRouter>
    <LanguageProvider>
      <GoalsList goals={[goal()]} logs={[]} cardioLogs={[]} {...props} />
    </LanguageProvider>
  </MemoryRouter>,
);

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOON); });
afterEach(() => { vi.useRealTimers(); cleanup(); });

// ── Progress bar ────────────────────────────────────────────────────────────

describe('GoalProgressBar', () => {
  const bar = (props) => render(<GoalProgressBar {...props} />);

  it('renders a real width for a normal value', () => {
    bar({ progress: 42, animated: false });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  });

  it('treats a non-finite progress as 0 rather than emitting width:"NaN%"', () => {
    // `Math.min(Math.max(NaN, 0), 100)` is NaN. A `width: "NaN%"` declaration
    // is dropped by the browser, so the bar silently keeps whatever width it
    // last had — which reads as another goal's progress, not as an error.
    bar({ progress: NaN, animated: false });
    const el = screen.getByRole('progressbar');
    expect(el).toHaveAttribute('aria-valuenow', '0');
    expect(el.innerHTML).not.toContain('NaN');
  });

  it('accepts a numeric string, which is how PostgREST hands back numerics', () => {
    bar({ progress: '65', animated: false });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '65');
  });

  it('clamps out-of-range values at both ends', () => {
    const { unmount } = bar({ progress: 250, animated: false });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    unmount();
    bar({ progress: -30, animated: false });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
  });

  it('exposes the bounds so the bar is not invisible to assistive tech', () => {
    bar({ progress: 10, animated: false, label: 'Bench Press' });
    const el = screen.getByRole('progressbar');
    expect(el).toHaveAttribute('aria-valuemin', '0');
    expect(el).toHaveAttribute('aria-valuemax', '100');
    expect(el).toHaveAttribute('aria-label', 'Bench Press');
  });

  it('uses the success token for completion, not a raw green', () => {
    // The four-hue rule. `bg-green-500` was the only raw Tailwind hue left in
    // the goals surface, and it sat next to `bg-success` siblings.
    const { container } = bar({ progress: 100, animated: false, complete: true });
    expect(container.querySelector('.bg-success')).toBeTruthy();
    expect(container.querySelector('.bg-green-500')).toBeNull();
  });

  it('carries no decorative gradient', () => {
    // CLAUDE.md bans gradient-as-decoration outright; this one also looped
    // `repeat: Infinity`, so a finished goal animated forever on a phone.
    const { container } = bar({ progress: 100, animated: false, complete: true });
    expect(container.querySelector('[class*="bg-gradient"]')).toBeNull();
  });
});

// ── Target date ─────────────────────────────────────────────────────────────

describe('Target date', () => {
  it('counts days remaining from local midnight, not from the current instant', () => {
    // `new Date('2026-08-16')` is UTC midnight — Aug 15 evening in the US — so
    // a naive parse reports one day fewer and a same-day goal reads overdue.
    show({ goals: [goal({ deadline: '2026-08-16' })] });
    expect(screen.getByText(/5 days left/)).toBeInTheDocument();
  });

  it('says "1 day left", not "1 days left"', () => {
    show({ goals: [goal({ deadline: '2026-08-12' })] });
    expect(screen.getByText(/1 day left/)).toBeInTheDocument();
    expect(screen.queryByText(/1 days left/)).toBeNull();
  });

  it('names today as today rather than as zero days', () => {
    show({ goals: [goal({ deadline: '2026-08-11' })] });
    expect(screen.getByText(/Target date is today/)).toBeInTheDocument();
  });

  it('flags an overdue goal without failing it', () => {
    // Advisory, not a deadline the app enforces: the goal stays active, keeps
    // its progress, and is never auto-completed or deleted.
    show({ goals: [goal({ deadline: '2026-08-04' })] });
    expect(screen.getByText(/7 days past target/)).toBeInTheDocument();
    expect(screen.queryByText(/failed/i)).toBeNull();
  });

  it('renders nothing at all when the goal has no target date', () => {
    // "A section with no data must not render as zeros" — a goal without a
    // date must not grow a row announcing its absence.
    show({ goals: [goal({ deadline: null })] });
    expect(screen.queryByText(/days left/)).toBeNull();
    expect(screen.queryByText(/past target/)).toBeNull();
    expect(screen.queryByText(/Target date/)).toBeNull();
  });

  it('does not show a target date on a completed goal', () => {
    // The date answered "will I make it?". Once the goal is done the question
    // is answered, and "3 days past target" under a trophy reads as a scold.
    show({ goals: [goal({ deadline: '2026-08-04', status: 'completed' })], isViewingCompleted: true });
    expect(screen.queryByText(/past target/)).toBeNull();
  });
});

// ── Archive ─────────────────────────────────────────────────────────────────

describe('Archive', () => {
  // Radix opens its menu on pointerdown, not click, so `fireEvent.click`
  // leaves it shut and every assertion below times out looking for items that
  // never mounted — including "Delete", which long predates this change.
  // userEvent issues the full pointer sequence.
  const openMenu = async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole('button', { name: /^Options for/ }));
    return user;
  };

  it('offers Archive on an active goal', async () => {
    show({ goals: [goal()], onArchive: vi.fn(), onDelete: vi.fn() });
    await openMenu();
    expect(await screen.findByText('Archive')).toBeInTheDocument();
  });

  it('offers Unarchive instead when viewing the archived list', async () => {
    show({
      goals: [goal({ status: 'archived' })],
      isViewingArchived: true,
      onArchive: vi.fn(),
      onDelete: vi.fn(),
    });
    await openMenu();
    expect(await screen.findByText('Unarchive')).toBeInTheDocument();
    expect(screen.queryByText('Archive')).toBeNull();
  });

  it('calls back with the goal id', async () => {
    const onArchive = vi.fn().mockResolvedValue(undefined);
    show({ goals: [goal()], onArchive, onDelete: vi.fn() });
    const user = await openMenu();
    await user.click(await screen.findByText('Archive'));
    expect(onArchive).toHaveBeenCalledWith('g-1');
  });

  it('does not offer archive on a completed goal', async () => {
    // Completing is an achievement that paid XP; archiving is housekeeping.
    // Letting a completed goal be archived would hide the record of a reward
    // that was already granted.
    show({
      goals: [goal({ status: 'completed' })],
      isViewingCompleted: true,
      onArchive: vi.fn(),
      onDelete: vi.fn(),
    });
    await openMenu();
    expect(await screen.findByText('Delete')).toBeInTheDocument();
    expect(screen.queryByText('Archive')).toBeNull();
  });

  it('omits the archive item entirely when no handler is wired', async () => {
    show({ goals: [goal()], onDelete: vi.fn() });
    await openMenu();
    expect(await screen.findByText('Delete')).toBeInTheDocument();
    expect(screen.queryByText('Archive')).toBeNull();
  });
});
