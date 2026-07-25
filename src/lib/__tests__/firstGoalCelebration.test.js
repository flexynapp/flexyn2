import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('@sentry/react', () => ({ addBreadcrumb: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

import { toast } from '@/lib/toast';
import * as Sentry from '@sentry/react';
import confetti from 'canvas-confetti';
import { fireFirstGoalCelebration } from '../firstGoalCelebration';

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn(() => ({ matches: false }));
});

describe('fireFirstGoalCelebration', () => {
  it('shows a toast with the target summary', () => {
    fireFirstGoalCelebration({ targetSummary: 'Bench Press 225×5', userEmail: 'a@b.com' });
    expect(toast.success).toHaveBeenCalledTimes(1);
    const [msg, opts] = toast.success.mock.calls[0];
    expect(msg).toContain('First goal set');
    expect(msg).toContain('Bench Press 225×5');
    expect(opts.description).toContain('track your progress');
  });

  it('falls back to a generic phrase without targetSummary', () => {
    fireFirstGoalCelebration({});
    const [msg] = toast.success.mock.calls[0];
    expect(msg).toContain('First goal set');
    expect(msg).not.toContain(':');
  });

  it('uses a distinct vibration pattern', () => {
    fireFirstGoalCelebration({});
    // 3-element pattern — distinct from goal-completion [15,50,15],
    // first-workout [20,60,20,60,80], first-regimen [15,45,15,45].
    expect(navigator.vibrate).toHaveBeenCalledWith([10, 30, 80]);
  });

  it('records a Sentry breadcrumb with goal context', () => {
    fireFirstGoalCelebration({ targetSummary: 'Deadlift 405', userEmail: 'a@b.com' });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    const [crumb] = Sentry.addBreadcrumb.mock.calls[0];
    expect(crumb).toMatchObject({
      category: 'goal',
      message: 'first-goal-created',
      level: 'info',
      data: { targetSummary: 'Deadlift 405', userEmail: 'a@b.com' },
    });
  });

  it('fires a single top-of-screen burst (distinct from side-bursts)', async () => {
    fireFirstGoalCelebration({ targetSummary: 'X' });
    await new Promise(r => setTimeout(r, 300));
    // Find our specific signature: x:0.5 + y:0.3 (top-of-screen center)
    const ourBursts = confetti.mock.calls.filter(
      (c) => c[0]?.origin?.x === 0.5 && c[0]?.origin?.y === 0.3
    );
    expect(ourBursts.length).toBeGreaterThanOrEqual(1);
    expect(ourBursts[0][0]).toMatchObject({
      origin: { x: 0.5, y: 0.3 },
      spread: 100,
    });
  });

  it('skips confetti when prefers-reduced-motion is set', async () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    const baseline = confetti.mock.calls.length;
    fireFirstGoalCelebration({});
    await new Promise(r => setTimeout(r, 50));
    // No NEW calls with our signature should appear
    const after = confetti.mock.calls.filter(
      (c) => c[0]?.origin?.x === 0.5 && c[0]?.origin?.y === 0.3
    ).length;
    const baselineWithSig = confetti.mock.calls.slice(0, baseline).filter(
      (c) => c[0]?.origin?.x === 0.5 && c[0]?.origin?.y === 0.3
    ).length;
    expect(after).toBe(baselineWithSig);
  });
});
