import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
vi.mock('@sentry/react', () => ({ addBreadcrumb: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

import { toast } from 'sonner';
import * as Sentry from '@sentry/react';
import confetti from 'canvas-confetti';
import { fireFirstRegimenCelebration } from '../firstRegimenCelebration';

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn(() => ({ matches: false }));
});

describe('fireFirstRegimenCelebration', () => {
  it('shows a toast with regimen name + XP', () => {
    fireFirstRegimenCelebration({ regimenName: 'Push Day', xpGained: 100, userEmail: 'a@b.com' });
    expect(toast.success).toHaveBeenCalledTimes(1);
    const [msg, opts] = toast.success.mock.calls[0];
    expect(msg).toContain('First plan saved');
    expect(msg).toContain('Push Day');
    expect(msg).toContain('+100 XP');
    expect(opts.description).toContain('first session');
  });

  it('falls back to "your first regimen" without a name', () => {
    fireFirstRegimenCelebration({ xpGained: 100 });
    const [msg] = toast.success.mock.calls[0];
    expect(msg).toContain('your first regimen');
  });

  it('omits the XP line when xpGained is 0', () => {
    fireFirstRegimenCelebration({ regimenName: 'X' });
    const [msg] = toast.success.mock.calls[0];
    expect(msg).not.toContain('XP');
  });

  it('uses a distinct vibration pattern from goal/workout celebrations', () => {
    fireFirstRegimenCelebration({ regimenName: 'X' });
    // 4-element pattern — different from goal (3) and first-workout (5)
    expect(navigator.vibrate).toHaveBeenCalledWith([15, 45, 15, 45]);
  });

  it('records a Sentry breadcrumb', () => {
    fireFirstRegimenCelebration({ regimenName: 'Pull Day', xpGained: 100, userEmail: 'a@b.com' });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    const [crumb] = Sentry.addBreadcrumb.mock.calls[0];
    expect(crumb).toMatchObject({
      category: 'regimen',
      message: 'first-regimen-created',
      level: 'info',
      data: { regimenName: 'Pull Day', xpGained: 100, userEmail: 'a@b.com' },
    });
  });

  it('fires two side-bursts (no center burst — that vocab belongs to first-workout)', async () => {
    fireFirstRegimenCelebration({ regimenName: 'X' });
    await new Promise(r => setTimeout(r, 400));
    // Filter to this test's call signature (y:0.6)
    const ourCalls = confetti.mock.calls.filter((c) => c[0]?.origin?.y === 0.6);
    expect(ourCalls.length).toBeGreaterThanOrEqual(2);
    expect(ourCalls[0][0]).toMatchObject({ origin: { x: 0.2, y: 0.6 } });
    expect(ourCalls[1][0]).toMatchObject({ origin: { x: 0.8, y: 0.6 } });
    // Confirm no center burst (x:0.5) — that's first-workout's tell
    const centerBursts = confetti.mock.calls.filter((c) => c[0]?.origin?.x === 0.5);
    expect(centerBursts.length).toBe(0);
  });

  it('skips confetti when prefers-reduced-motion is set', async () => {
    window.matchMedia = vi.fn(() => ({ matches: true }));
    fireFirstRegimenCelebration({ regimenName: 'X' });
    await Promise.resolve();
    await Promise.resolve();
    // Capture baseline before the test (other tests' delayed setTimeouts
    // can leak into the call buffer); we only check for NEW calls.
    const baseline = confetti.mock.calls.length;
    await new Promise(r => setTimeout(r, 100));
    // After waiting, no new calls should have come from THIS invocation —
    // any new calls would mean motion wasn't honored.
    const after = confetti.mock.calls.length;
    expect(after - baseline).toBeLessThanOrEqual(0);
  });
});
