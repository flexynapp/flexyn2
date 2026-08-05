// src/components/__tests__/animatedNumber.test.jsx
//
// AnimatedNumber gained a `from` prop so HeroSlideshow could delete its
// private fork of it, and it now has six consumers across the Dashboard,
// Hub and Leaderboards. The two behaviours worth pinning are the ones the
// fork existed to provide and the one the fork had that the shared copy
// didn't:
//
//   • WITHOUT `from`, the first render must SNAP. Streak banners and the
//     leaderboard rank render a value that is already true when the
//     component mounts; rolling it up from zero would animate a number
//     that never changed.
//   • WITH `from`, the first render must ANIMATE. A hero slide appears
//     with its number counting up; that is the entire effect.
//
// Those two are the same code path distinguished only by whether a prop
// was passed, which is exactly the kind of thing a refactor silently
// inverts.

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import AnimatedNumber from '@/components/AnimatedNumber';

// Drive requestAnimationFrame by hand. The component reads
// performance.now() for its own clock, so the two have to move together
// or the eased value never advances.
let now = 0;
let frames = [];

function flushFrame(deltaMs) {
  now += deltaMs;
  const due = frames;
  frames = [];
  act(() => { due.forEach((cb) => cb(now)); });
}

// Reset window.matchMedia to "no preference" before every test.
//
// setup.js installs it as a module-scoped vi.fn(), and vi.restoreAllMocks()
// only undoes vi.spyOn — so a .mockImplementation() applied in one test
// leaks into every test after it. The reduced-motion case below sets
// `matches: true`, which silently turned the NEXT test's animation into a
// snap and made it look like `format` wasn't running on tweened values.
function matchMediaNoPreference(query) {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
}

beforeEach(() => {
  now = 0;
  frames = [];
  window.matchMedia.mockImplementation(matchMediaNoPreference);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (cb) => { frames.push(cb); return frames.length; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AnimatedNumber', () => {
  it('snaps on first render when no `from` is given', () => {
    render(<AnimatedNumber value={42} />);
    // No tween was ever scheduled — this is the assertion that matters.
    // A rendered "42" alone would also pass if the component animated
    // 0 → 42 and we happened to read it at the end.
    expect(frames).toHaveLength(0);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('animates from `from` on first render', () => {
    render(<AnimatedNumber value={100} from={0} duration={1000} />);
    expect(screen.getByText('0')).toBeInTheDocument();

    flushFrame(500);
    const mid = Number(screen.getByText(/^\d+$/).textContent);
    // Ease-out cubic is past the halfway mark at t=0.5 (7/8 of the way),
    // so assert on the bracket rather than a specific number.
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(100);

    flushFrame(600); // past `duration` — settles on the exact target
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('rolls up from the previous value when `value` changes', () => {
    const { rerender } = render(<AnimatedNumber value={10} duration={1000} />);
    expect(screen.getByText('10')).toBeInTheDocument();

    rerender(<AnimatedNumber value={20} duration={1000} />);
    flushFrame(100);
    const mid = Number(screen.getByText(/^\d+$/).textContent);
    expect(mid).toBeGreaterThan(10);
    expect(mid).toBeLessThan(20);

    flushFrame(1000);
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('snaps and schedules nothing under prefers-reduced-motion', () => {
    window.matchMedia.mockImplementation((query) => ({
      ...matchMediaNoPreference(query),
      matches: query.includes('prefers-reduced-motion'),
    }));

    render(<AnimatedNumber value={100} from={0} />);
    // `from` normally forces an animation; reduced motion has to win over
    // it, or the opt-out does nothing on the surfaces that use `from`.
    expect(frames).toHaveLength(0);
    expect(screen.getByText('100')).toBeInTheDocument();
  });

  it('renders 0 rather than NaN for a null or undefined value', () => {
    // Aggregate queries return null on an empty account, and this
    // component sits on first-run surfaces. The old shared copy had no
    // guard and rendered the literal string "NaN"; HeroSlideshow's fork
    // did guard, so the same user saw different output on two screens.
    const { rerender } = render(<AnimatedNumber value={null} />);
    expect(screen.getByText('0')).toBeInTheDocument();

    rerender(<AnimatedNumber value={undefined} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('applies `format` to the tweened value, not just the final one', () => {
    render(
      <AnimatedNumber
        value={4}
        from={0}
        duration={1000}
        format={(n) => `${n.toFixed(1)} kg`}
      />,
    );
    expect(screen.getByText('0.0 kg')).toBeInTheDocument();
    flushFrame(1500);
    expect(screen.getByText('4.0 kg')).toBeInTheDocument();
  });
});
