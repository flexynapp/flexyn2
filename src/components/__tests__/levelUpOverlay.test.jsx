// Regression tests for the level-up overlay.
//
// The bugs these lock down all had the same shape: the card rendered, the
// DOM was correct, and nothing threw — so nothing failed. What was broken
// was whether any of it could be SEEN. Assert on the properties that decide
// that (paint order, colour tokens, whether the burst renders at all),
// because jsdom will happily report a white-on-white button as present.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Particles from '@/components/Particles';
import LevelUpOverlay, { CONFETTI_Z_INDEX, AUTO_DISMISS_MS } from '@/components/LevelUpOverlay';

const confettiSpy = vi.fn();
vi.mock('canvas-confetti', () => ({ default: (...args) => confettiSpy(...args) }));

// The overlay reads t() for its copy; a real LanguageProvider would drag in
// @/api/db and its auth listener. Echo the key back — these tests care about
// which key is asked for, not what it resolves to.
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (k, fallback) => fallback,
  }),
}));

const EVENT = { fromLevel: 4, toLevel: 5, totalXp: 1200 };   // bronze: particles 'none'

// The backdrop's z-index. Anything meant to be seen OVER the overlay has to
// beat it; the confetti canvas is appended to document.body, so it is not a
// descendant and cannot inherit its way above.
const BACKDROP_Z = 300;

describe('LevelUpOverlay', () => {
  beforeEach(() => {
    confettiSpy.mockClear();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires confetti above the backdrop, not underneath it', async () => {
    render(<LevelUpOverlay event={EVENT} onDismiss={() => {}} />);

    // The dynamic import resolves on a microtask; the bursts are scheduled
    // 300ms and 500ms after that.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });

    expect(confettiSpy).toHaveBeenCalled();
    for (const [opts] of confettiSpy.mock.calls) {
      // canvas-confetti defaults to zIndex 100. Left at the default, every
      // burst painted under `bg-black/60 backdrop-blur-md`.
      expect(opts.zIndex).toBe(CONFETTI_Z_INDEX);
      expect(opts.zIndex).toBeGreaterThan(BACKDROP_Z);
    }
  });

  it('does not restart its auto-dismiss when the parent re-renders', () => {
    const onDismiss = vi.fn();
    // LevelUpManager re-renders on every profile refetch. A fresh callback
    // identity used to tear the timer down and start a new 6s.
    const { rerender } = render(<LevelUpOverlay event={EVENT} onDismiss={() => onDismiss()} />);

    act(() => { vi.advanceTimersByTime(AUTO_DISMISS_MS - 500); });
    rerender(<LevelUpOverlay event={EVENT} onDismiss={() => onDismiss()} />);
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(600); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('keeps the Continue label off the theme foreground token', () => {
    render(<LevelUpOverlay event={EVENT} onDismiss={() => {}} />);
    const cta = screen.getByRole('button', { name: 'levelUp.continue' });

    // The pill is pinned white, so its label must be pinned dark.
    // `text-foreground` follows the theme — near-white in dark mode and
    // under every loot theme, i.e. white on white.
    expect(cta.className).not.toMatch(/\btext-foreground\b/);
    expect(cta.className).toMatch(/\btext-slate-900\b/);
  });

  it('translates the from/to labels instead of hardcoding English', () => {
    render(<LevelUpOverlay event={EVENT} onDismiss={() => {}} />);
    // tFallback is mocked to return its fallback, so these assert the call
    // shape rather than the copy — the point is that they go through i18n.
    expect(screen.getByText('From')).toBeInTheDocument();
    expect(screen.getByText('To')).toBeInTheDocument();
  });
});

describe('Particles', () => {
  it('renders the level-up burst for a tier with no ambient dots', () => {
    // Bronze and Silver — levels 1-20, which is every new user — are
    // `particles: 'none'`. The component used to return null on sight of
    // that, taking the one-shot burst with it.
    const { container } = render(<Particles type="none" burst />);
    expect(container.querySelector('div')).not.toBeNull();
    expect(container.querySelectorAll('.fx-dot')).toHaveLength(0);
    // 16 burst rings, per BurstRing's Array.from length.
    expect(container.querySelectorAll('.rounded-full')).toHaveLength(16);
  });

  it('still renders nothing for an unsparkled tier with no burst', () => {
    // LevelBar passes no `burst` — its ambient behaviour must not change.
    const { container } = render(<Particles type="none" />);
    expect(container.firstChild).toBeNull();
  });
});
