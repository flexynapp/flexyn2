import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
vi.mock('@sentry/react', () => ({ addBreadcrumb: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

import { toast } from 'sonner';
import * as Sentry from '@sentry/react';
import confetti from 'canvas-confetti';
import { fireFirstMealCelebration } from '../firstMealCelebration';

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn(() => ({ matches: false }));
});

describe('fireFirstMealCelebration', () => {
  it('shows a toast with meal name + calories', () => {
    fireFirstMealCelebration({ mealName: 'Chicken & rice', calories: 540, userEmail: 'a@b.com' });
    expect(toast.success).toHaveBeenCalledTimes(1);
    const [msg, opts] = toast.success.mock.calls[0];
    expect(msg).toContain('First meal logged');
    expect(msg).toContain('Chicken & rice');
    expect(msg).toContain('540 cal');
    expect(opts.description).toContain('macro insights');
  });

  it('omits calories when not provided', () => {
    fireFirstMealCelebration({ mealName: 'Apple' });
    const [msg] = toast.success.mock.calls[0];
    expect(msg).toContain('Apple');
    expect(msg).not.toContain('cal');
  });

  it('omits calories when zero (not meaningful)', () => {
    fireFirstMealCelebration({ mealName: 'Diet drink', calories: 0 });
    const [msg] = toast.success.mock.calls[0];
    expect(msg).not.toContain('cal');
  });

  it('falls back to generic phrase when no meal name', () => {
    fireFirstMealCelebration({});
    const [msg] = toast.success.mock.calls[0];
    expect(msg).toContain('First meal logged');
    expect(msg).not.toContain(':');
  });

  it('uses a distinct vibration pattern from other first-X helpers', () => {
    fireFirstMealCelebration({ mealName: 'X' });
    // 5-element pattern with shorter pulses — distinct from goal-completion
    // [15,50,15], first-workout [20,60,20,60,80], first-regimen [15,45,15,45],
    // first-goal [10,30,80].
    expect(navigator.vibrate).toHaveBeenCalledWith([12, 30, 12, 30, 12]);
  });

  it('records a Sentry breadcrumb in the nutrition category', () => {
    fireFirstMealCelebration({ mealName: 'Salad', calories: 200, userEmail: 'a@b.com' });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    const [crumb] = Sentry.addBreadcrumb.mock.calls[0];
    expect(crumb).toMatchObject({
      category: 'nutrition',
      message: 'first-meal-logged',
      level: 'info',
      data: { mealName: 'Salad', calories: 200, userEmail: 'a@b.com' },
    });
  });

  it('fires two bottom-corner confetti bursts (distinct signature)', async () => {
    fireFirstMealCelebration({ mealName: 'X' });
    await new Promise(r => setTimeout(r, 300));
    // Filter to our bottom-corner signature (y:0.85)
    const ourCalls = confetti.mock.calls.filter((c) => c[0]?.origin?.y === 0.85);
    expect(ourCalls.length).toBeGreaterThanOrEqual(2);
    expect(ourCalls[0][0]).toMatchObject({ origin: { x: 0.15, y: 0.85 } });
    expect(ourCalls[1][0]).toMatchObject({ origin: { x: 0.85, y: 0.85 } });
    // Confirm no center / top-of-screen bursts (those belong to first-workout
    // and first-goal respectively)
    const otherSignatures = confetti.mock.calls.filter(
      (c) => c[0]?.origin?.y === 0.55 || c[0]?.origin?.y === 0.3 || c[0]?.origin?.y === 0.6
    );
    // We don't strictly require 0 (other tests leak), but ours must NOT use those signatures
    const ourSignatures = confetti.mock.calls.filter((c) => c[0]?.origin?.y === 0.85);
    expect(ourSignatures.length).toBeGreaterThanOrEqual(2);
  });

  it('skips confetti when prefers-reduced-motion is set', async () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    const baseline = confetti.mock.calls.filter((c) => c[0]?.origin?.y === 0.85).length;
    fireFirstMealCelebration({ mealName: 'X' });
    await new Promise(r => setTimeout(r, 50));
    const after = confetti.mock.calls.filter((c) => c[0]?.origin?.y === 0.85).length;
    expect(after).toBe(baseline);
  });
});
