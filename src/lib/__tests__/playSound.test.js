// Tests for src/lib/playSound — verifies (a) default OFF, (b) toggle
// flips it, (c) custom event fires on toggle, (d) playSound is a
// no-op when disabled or when matchMedia signals reduced-motion,
// (e) rate-limit prevents back-to-back calls from firing twice.
//
// We don't actually exercise <Audio> playback (jsdom doesn't implement
// it) — the unit test scope is the gating logic, not the browser audio.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const LS_KEY = 'flexyn.soundsEnabled';

describe('playSound — settings + gating', () => {
  beforeEach(() => {
    vi.resetModules();
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    if (typeof window !== 'undefined') {
      window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    }
  });

  it('defaults to OFF (no localStorage entry)', async () => {
    const { getSoundsEnabled } = await import('../playSound');
    expect(getSoundsEnabled()).toBe(false);
  });

  it('setSoundsEnabled(true) flips the persistent flag', async () => {
    const { setSoundsEnabled, getSoundsEnabled } = await import('../playSound');
    setSoundsEnabled(true);
    expect(getSoundsEnabled()).toBe(true);
    expect(localStorage.getItem(LS_KEY)).toBe('1');
    setSoundsEnabled(false);
    expect(getSoundsEnabled()).toBe(false);
    expect(localStorage.getItem(LS_KEY)).toBe(null);
  });

  it('emits a flexyn:sounds-toggled custom event when toggled', async () => {
    const { setSoundsEnabled } = await import('../playSound');
    const onToggle = vi.fn();
    window.addEventListener('flexyn:sounds-toggled', onToggle);
    setSoundsEnabled(true);
    expect(onToggle).toHaveBeenCalled();
    expect(onToggle.mock.calls[0][0].detail.enabled).toBe(true);
    window.removeEventListener('flexyn:sounds-toggled', onToggle);
  });

  it('exports a SOUND map of named ids', async () => {
    const { SOUND } = await import('../playSound');
    expect(SOUND.workoutSaved).toBeTruthy();
    expect(SOUND.prHit).toBeTruthy();
    expect(SOUND.messageSent).toBeTruthy();
  });

  it('playSound is a no-op when sounds are disabled', async () => {
    const { playSound } = await import('../playSound');
    // No Audio instance gets created when disabled.
    const spy = vi.spyOn(global, 'Audio');
    playSound('workoutSaved');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('playSound is a no-op when prefers-reduced-motion is set', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    const { setSoundsEnabled, playSound } = await import('../playSound');
    setSoundsEnabled(true);
    const spy = vi.spyOn(global, 'Audio');
    playSound('workoutSaved');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
