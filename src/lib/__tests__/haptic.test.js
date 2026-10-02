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

  it('haptic() maps light / medium to the existing patterns', async () => {
    const { haptic } = await import('../haptic');
    haptic('light');
    expect(navigator.vibrate).toHaveBeenLastCalledWith([6]);
    vi.advanceTimersByTime(200);
    haptic('medium');
    expect(navigator.vibrate).toHaveBeenLastCalledWith([10]);
    vi.advanceTimersByTime(200);
    haptic('success');
    expect(navigator.vibrate).toHaveBeenLastCalledWith([18, 60, 18]);
  });

  it('triggerHaptic resolves light / medium / heavy instead of falling back to primary', async () => {
    const { triggerHaptic } = await import('../haptic');
    triggerHaptic('light');
    expect(navigator.vibrate).toHaveBeenLastCalledWith([6]);
    vi.advanceTimersByTime(200);
    triggerHaptic('heavy');
    expect(navigator.vibrate).toHaveBeenLastCalledWith([28]);
    vi.advanceTimersByTime(200);
    triggerHaptic('nonsense');
    expect(navigator.vibrate).toHaveBeenLastCalledWith([10]);
  });
});

describe('haptic inside the native app', () => {
  const impact = vi.fn(() => Promise.resolve());
  const notification = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    impact.mockClear();
    notification.mockClear();
    navigator.vibrate = vi.fn(() => true);
    window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    try { localStorage.removeItem('flexyn.hapticsDisabled'); } catch { /* ignore */ }
    vi.doMock('../native', () => ({ isNative: () => true }));
    vi.doMock('@capacitor/haptics', () => ({
      Haptics: { impact, notification },
      ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' },
      NotificationType: { Success: 'SUCCESS', Warning: 'WARNING', Error: 'ERROR' },
    }));
  });

  afterEach(() => {
    vi.doUnmock('../native');
    vi.doUnmock('@capacitor/haptics');
    vi.useRealTimers();
  });

  it('uses the plugin, not navigator.vibrate', async () => {
    const { triggerHaptic } = await import('../haptic');
    triggerHaptic('subtle');
    expect(impact).toHaveBeenLastCalledWith({ style: 'LIGHT' });
    vi.advanceTimersByTime(200);
    triggerHaptic('success');
    expect(notification).toHaveBeenLastCalledWith({ type: 'SUCCESS' });
    vi.advanceTimersByTime(200);
    triggerHaptic('warning');
    expect(notification).toHaveBeenLastCalledWith({ type: 'WARNING' });
    expect(navigator.vibrate).not.toHaveBeenCalled();
  });

  it('works on iOS, where navigator.vibrate does not exist', async () => {
    navigator.vibrate = undefined;
    const { triggerHaptic } = await import('../haptic');
    triggerHaptic('primary');
    expect(impact).toHaveBeenLastCalledWith({ style: 'MEDIUM' });
  });

  it('keeps the settings toggle, reduced motion and rate limit', async () => {
    const { triggerHaptic, setHapticsDisabled } = await import('../haptic');
    setHapticsDisabled(true);
    triggerHaptic();
    expect(impact).not.toHaveBeenCalled();
    setHapticsDisabled(false);
    triggerHaptic();
    triggerHaptic();
    expect(impact).toHaveBeenCalledTimes(1);
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.advanceTimersByTime(200);
    triggerHaptic('subtle');
    expect(impact).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejection from an app build without the plugin', async () => {
    impact.mockImplementationOnce(() => Promise.reject(new Error('not implemented')));
    const { triggerHaptic } = await import('../haptic');
    expect(() => triggerHaptic('primary')).not.toThrow();
    await Promise.resolve();
  });
});
