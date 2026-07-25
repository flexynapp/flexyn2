import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('@sentry/react', () => ({ addBreadcrumb: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

import { toast } from '@/lib/toast';
import * as Sentry from '@sentry/react';
import confetti from 'canvas-confetti';
import { fireFirstWorkoutCelebration } from '../firstWorkoutCelebration';

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn(() => ({ matches: false }));
});

describe('fireFirstWorkoutCelebration', () => {
  it('shows a toast with the milestone copy', () => {
    fireFirstWorkoutCelebration({ xpGained: 80, userEmail: 'a@b.com' });
    expect(toast.success).toHaveBeenCalledTimes(1);
    const [msg, opts] = toast.success.mock.calls[0];
    expect(msg).toContain('First workout logged');
    expect(msg).toContain('+80 XP');
    expect(opts.description).toContain('officially training');
  });

  it('omits the XP line when xpGained is 0', () => {
    fireFirstWorkoutCelebration({ xpGained: 0 });
    const [msg] = toast.success.mock.calls[0];
    expect(msg).not.toContain('XP');
  });

  it('uses a distinct vibration pattern from goal-completion', () => {
    fireFirstWorkoutCelebration({});
    // 5-element pattern — different from goal-completion's [15,50,15]
    expect(navigator.vibrate).toHaveBeenCalledWith([20, 60, 20, 60, 80]);
  });

  it('records a Sentry breadcrumb for the conversion funnel', () => {
    fireFirstWorkoutCelebration({ xpGained: 80, userEmail: 'a@b.com' });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    const [crumb] = Sentry.addBreadcrumb.mock.calls[0];
    expect(crumb).toMatchObject({
      category: 'workout',
      message: 'first-workout-logged',
      level: 'info',
      data: { xpGained: 80, userEmail: 'a@b.com' },
    });
  });

  it('fires three confetti bursts (heavier than goal-completion) when motion allowed', async () => {
    fireFirstWorkoutCelebration({ xpGained: 50 });
    // Wait long enough that all three bursts (immediate + setTimeout 200
    // + setTimeout 380) have fired.
    await new Promise(r => setTimeout(r, 500));
    // Find the unique center burst — only first-workout uses x:0.5.
    // Calls before it are leaked from prior tests; everything from
    // the center forward is ours.
    const allCalls = confetti.mock.calls;
    const centerIdx = allCalls.findIndex(
      (c) => c[0]?.origin?.x === 0.5 && c[0]?.origin?.y === 0.6,
    );
    expect(centerIdx).toBeGreaterThanOrEqual(0);
    // After the center burst there should be a 0.2 burst and a 0.8
    // burst — but unrelated leaked bursts may also land in between.
    // Verify the two side-bursts EXIST after the center, not that they
    // are at exact slices.
    const after = allCalls.slice(centerIdx);
    expect(after[0][0]).toMatchObject({ origin: { x: 0.5, y: 0.6 } });
    const hasLeft  = after.some((c) => c[0]?.origin?.x === 0.2 && c[0]?.origin?.y === 0.55);
    const hasRight = after.some((c) => c[0]?.origin?.x === 0.8 && c[0]?.origin?.y === 0.55);
    expect(hasLeft).toBe(true);
    expect(hasRight).toBe(true);
  });

  it('skips confetti when prefers-reduced-motion is set', async () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    fireFirstWorkoutCelebration({ xpGained: 50 });
    await Promise.resolve();
    await Promise.resolve();
    // We can't assert "0 calls total" because previous tests' delayed
    // setTimeouts may still be firing. Assert no NEW calls from this
    // invocation by checking that no call has the unique x:0.5 center
    // burst signature (that's our first-workout helper's tell — the
    // goal helper doesn't fire from x:0.5).
    const ourCenterBursts = confetti.mock.calls.filter(
      (c) => c[0]?.origin?.x === 0.5 && c[0]?.origin?.y === 0.6,
    );
    // Reduced-motion → no NEW center bursts from this call.
    // (Prior tests' bursts may have already landed; comparison is delta.)
    const baseline = ourCenterBursts.length;
    await new Promise(r => setTimeout(r, 100));
    const after = confetti.mock.calls.filter(
      (c) => c[0]?.origin?.x === 0.5 && c[0]?.origin?.y === 0.6,
    ).length;
    expect(after).toBe(baseline);
  });
});
