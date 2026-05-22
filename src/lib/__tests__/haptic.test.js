// Tests for src/lib/haptic.js — the centralized haptic feedback
// utility. Verifies (a) it doesn't throw on platforms without
// navigator.vibrate, (b) the settings toggle silences it, (c) the
// 80ms rate-limit actually rate-limits, (d) reduced-motion users get
// warnings only, (e) pattern selection works.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('haptic', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Re-import per test so module-level lastFiredAt resets.
    vi.resetModules();
    // Default: real-ish navigator.vibrate that we can spy on.
    if (typeof navigator !== 'undefined') {
      navigator.vibrate = vi.fn(() => true);
    }
    // matchMedia stub — reduced-motion off by default.
    if (typeof window !== 'undefined') {
      window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    }
    try { localStorage.removeItem('flexyn.hapticsDisabled'); } catch { /* ignore */ }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the primary pattern by default', async () => {
    const { triggerHaptic } = await import('../haptic');
    triggerHaptic();
    expect(navigator.vibrate).toHaveBeenCalledWith([10]);
  });

  it('selects the correct pattern by intensity', async () => {
    const { triggerHaptic } = await import('../haptic');
    triggerHaptic('success');
    expect(navigator.vibrate).toHaveBeenLastCalledWith([18, 60, 18]);
    // Advance past the rate-limit window so the next call lands.
    vi.advanceTimersByTime(200);
    triggerHaptic('warning');
    expect(navigator.vibrate).toHaveBeenLastCalledWith([28]);
  });

  it('rate-limits to at most one call per 80ms', async () => {
    const { triggerHaptic } = await import('../haptic');
    triggerHaptic();
    triggerHaptic();
    triggerHaptic();
    expect(navigator.vibrate).toHaveBeenCalledTimes(1);
  });

  it('respects the localStorage disable flag', async () => {
    localStorage.setItem('flexyn.hapticsDisabled', '1');
    const { triggerHaptic } = await import('../haptic');
    triggerHaptic();
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  it('suppresses non-warning haptics when reduced-motion is on', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const { triggerHaptic } = await import('../haptic');
    triggerHaptic('primary');
    triggerHaptic('subtle');
    expect(navigator.vibrate).not.toHaveBeenCalled();
    // Warnings still fire — they're safety-critical and the
    // tradeoff favors letting the user know vs honoring the
    // motion preference perfectly.
    vi.advanceTimersByTime(200);
    triggerHaptic('warning');
    expect(navigator.vibrate).toHaveBeenCalledTimes(1);
  });

  it('does not throw when navigator.vibrate is unavailable', async () => {
    // navigator.vibrate is defined as a non-configurable property by
    // src/test/setup.js, so we can't `delete` it. Instead simulate the
    // "unavailable" path by stubbing it to a non-function value — the
    // util's `typeof navigator.vibrate !== 'function'` gate should
    // short-circuit before calling.
    const savedVibrate = navigator.vibrate;
    navigator.vibrate = undefined;
    const { triggerHaptic } = await import('../haptic');
    expect(() => triggerHaptic()).not.toThrow();
    navigator.vibrate = savedVibrate;
  });

  it('toggles via setHapticsDisabled / getHapticsDisabled', async () => {
    const { setHapticsDisabled, getHapticsDisabled, triggerHaptic } = await import('../haptic');
    expect(getHapticsDisabled()).toBe(false);
    setHapticsDisabled(true);
    expect(getHapticsDisabled()).toBe(true);
    triggerHaptic();
    expect(navigator.vibrate).not.toHaveBeenCalled();
    setHapticsDisabled(false);
    expect(getHapticsDisabled()).toBe(false);
  });
});
