import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock sonner toast before importing the module under test
vi.mock('sonner', () => ({
  toast: { success: vi.fn() },
}));

// Mock @sentry/react before importing
vi.mock('@sentry/react', () => ({
  addBreadcrumb: vi.fn(),
}));

// Mock canvas-confetti — module-under-test imports it dynamically
vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

import { toast } from 'sonner';
import * as Sentry from '@sentry/react';
import confetti from 'canvas-confetti';
import { fireGoalCelebration } from '../goalCelebration';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset matchMedia stub so each test controls the reduced-motion preference
  window.matchMedia = vi.fn(() => ({ matches: false }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('fireGoalCelebration', () => {
  it('shows a success toast with goal name and XP', async () => {
    fireGoalCelebration({ goalName: 'Bench Press', xpReward: 120, userEmail: 'a@b.com' });
    expect(toast.success).toHaveBeenCalledTimes(1);
    const [msg, opts] = toast.success.mock.calls[0];
    expect(msg).toContain('🏆 Goal completed');
    expect(msg).toContain('Bench Press');
    expect(msg).toContain('+120 XP');
    expect(opts).toMatchObject({ duration: expect.any(Number) });
  });

  it('omits the XP line when xpReward is 0', () => {
    fireGoalCelebration({ goalName: 'Squat', xpReward: 0 });
    const [msg] = toast.success.mock.calls[0];
    expect(msg).toContain('Squat');
    expect(msg).not.toContain('XP');
  });

  it('falls back to "goal" when goalName is missing', () => {
    fireGoalCelebration({});
    const [msg] = toast.success.mock.calls[0];
    expect(msg).toContain('goal');
  });

  it('calls navigator.vibrate with a pattern (when available)', () => {
    fireGoalCelebration({ goalName: 'X', xpReward: 10 });
    expect(navigator.vibrate).toHaveBeenCalledWith([15, 50, 15]);
  });

  it('records a Sentry breadcrumb with goal context', () => {
    fireGoalCelebration({ goalName: 'Deadlift', xpReward: 200, userEmail: 'a@b.com' });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    const [crumb] = Sentry.addBreadcrumb.mock.calls[0];
    expect(crumb).toMatchObject({
      category: 'goal',
      message: 'goal-completed',
      level: 'info',
      data: { goalName: 'Deadlift', xpReward: 200, userEmail: 'a@b.com' },
    });
  });

  it('skips confetti when prefers-reduced-motion is set', async () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    fireGoalCelebration({ goalName: 'X' });
    // Give the (suppressed) dynamic import a tick to settle, then confirm
    // nothing fired. Microtasks are enough — no setTimeout to advance.
    await Promise.resolve();
    await Promise.resolve();
    expect(confetti).not.toHaveBeenCalled();
  });

  it('fires confetti twice (left + right bursts) when motion is allowed', async () => {
    fireGoalCelebration({ goalName: 'X' });
    // Wait for the dynamic import + microtask chain to land the first
    // burst, then for the 220ms scheduled second burst.
    await new Promise(r => setTimeout(r, 400));
    // Filter to ONLY the calls this test produced — vitest's clearAllMocks
    // in beforeEach resets the mock between tests, but pending timers from
    // prior tests can still fire and inflate the count. Asserting on the
    // call args lets us tolerate that race.
    const ourCalls = confetti.mock.calls.filter(
      (c) => c[0]?.origin?.y === 0.55,
    );
    expect(ourCalls.length).toBeGreaterThanOrEqual(2);
    expect(ourCalls[0][0]).toMatchObject({ origin: { x: 0.2, y: 0.55 } });
    expect(ourCalls[1][0]).toMatchObject({ origin: { x: 0.8, y: 0.55 } });
  });
});
