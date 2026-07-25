// Tests for src/lib/prCelebration.js — the 6th-family PR celebration.
//
// Verifies:
//   • toast copy includes the top exercise + delta
//   • multiple simultaneous PRs collapse into one toast with a count
//   • haptic pattern is the distinctive heavy-thud signature
//   • no-op when prs array is empty
//   • Sentry breadcrumb fires with the PR count + top exercise

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn() } }));
vi.mock('@sentry/react', () => ({ addBreadcrumb: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

import { toast } from '@/lib/toast';
import * as Sentry from '@sentry/react';
import { firePRCelebration } from '../prCelebration';

beforeEach(() => {
  vi.clearAllMocks();
  window.matchMedia = vi.fn(() => ({ matches: false }));
});

describe('firePRCelebration', () => {
  it('is a no-op when prs is empty', () => {
    firePRCelebration({ prs: [] });
    expect(toast.success).not.toHaveBeenCalled();
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  it('is a no-op when prs is missing', () => {
    firePRCelebration({});
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('shows a toast with the top PR exercise and new value', () => {
    firePRCelebration({
      prs: [{ displayName: 'Bench Press', oldPR: 220, newPR: 235, delta: 15 }],
      unit: 'lb',
    });
    expect(toast.success).toHaveBeenCalledTimes(1);
    const [msg, opts] = toast.success.mock.calls[0];
    expect(msg).toContain('🏋️');
    expect(msg).toContain('Bench Press');
    expect(msg).toContain('235');
    expect(msg).toContain('lb');
    expect(opts.description).toContain('+15');
  });

  it('uses the heavy-thud haptic signature (distinct from other celebrations)', () => {
    firePRCelebration({ prs: [{ displayName: 'Squat', oldPR: 200, newPR: 210, delta: 10 }] });
    // [40,80,40,80,40,80] — not the same as goal/first-workout/etc.
    expect(navigator.vibrate).toHaveBeenCalledWith([40, 80, 40, 80, 40, 80]);
  });

  it('collapses multiple simultaneous PRs into one toast with a count', () => {
    firePRCelebration({
      prs: [
        { displayName: 'Bench Press', oldPR: 220, newPR: 235, delta: 15 },
        { displayName: 'Squat',       oldPR: 300, newPR: 320, delta: 20 },
        { displayName: 'Deadlift',    oldPR: 400, newPR: 405, delta:  5 },
      ],
      unit: 'lb',
    });
    expect(toast.success).toHaveBeenCalledTimes(1);
    const [msg] = toast.success.mock.calls[0];
    // Top PR (largest delta) → Squat with +20
    expect(msg).toContain('Squat');
    expect(msg).toContain('320');
    // Count of additional PRs
    expect(msg).toContain('+2 more PRs');
  });

  it('uses singular "more PR" when exactly one extra', () => {
    firePRCelebration({
      prs: [
        { displayName: 'Bench Press', oldPR: 220, newPR: 235, delta: 15 },
        { displayName: 'Squat',       oldPR: 300, newPR: 305, delta:  5 },
      ],
      unit: 'lb',
    });
    const [msg] = toast.success.mock.calls[0];
    expect(msg).toContain('+1 more PR');
    expect(msg).not.toContain('+1 more PRs');
  });

  it('records a Sentry breadcrumb with PR count + top exercise', () => {
    firePRCelebration({
      prs: [
        { displayName: 'Bench Press', oldPR: 220, newPR: 235, delta: 15 },
        { displayName: 'Squat',       oldPR: 300, newPR: 320, delta: 20 },
      ],
      userEmail: 'a@b.com',
    });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    const [bc] = Sentry.addBreadcrumb.mock.calls[0];
    expect(bc.category).toBe('workout');
    expect(bc.message).toBe('pr-hit');
    expect(bc.data.prCount).toBe(2);
    expect(bc.data.topExercise).toBe('Squat');
    expect(bc.data.userEmail).toBe('a@b.com');
  });

  it('handles kg unit correctly in the toast copy', () => {
    firePRCelebration({
      prs: [{ displayName: 'Squat', oldPR: 100, newPR: 110, delta: 10 }],
      unit: 'kg',
    });
    const [msg, opts] = toast.success.mock.calls[0];
    expect(msg).toContain('kg');
    expect(opts.description).toContain('kg');
  });
});
