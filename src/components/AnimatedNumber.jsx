// src/components/AnimatedNumber.jsx
//
// Tick-up number animation. TikTok-style — when a stat value changes,
// instead of snapping from "1,245" to "1,387", we roll up through
// the intermediate values over ~0.8s so the gain feels earned.
//
// Pure component. Pass `value` and (optionally) `format` to control
// the rendered string. Respects prefers-reduced-motion: snap-cut for
// users who've opted out of animations.
//
// Usage:
//   <AnimatedNumber value={totalVolume} format={n => `${Math.round(n).toLocaleString()} lbs`} />
//
// ── `from` ──────────────────────────────────────────────────────────────
//
// By default the tween starts wherever the number currently sits, which
// means the FIRST render snaps: there is no previous value to roll up
// from. That's right for a stat that's already on screen and changes
// underneath the user, and wrong for a card that animates in — a hero
// slide wants 0 → 47 every time it appears, not 47.
//
// Passing `from` opts into that: each animation starts at `from` rather
// than at the previous displayed value, including on mount. HeroSlideshow
// carried its own copy of this component for a year purely because the
// shared one couldn't do it.
//
// ── One implementation, on purpose ──────────────────────────────────────
//
// There used to be three: this one, a near-identical private copy in
// HeroSlideshow.jsx, and a third in LiveVolumePill.jsx. Two of them had
// finite-value guards this one lacked (a NaN `value` rendered "NaN" here
// and 0 there), and only two honoured prefers-reduced-motion, so the same
// user got different behaviour on different screens. The guards are folded
// in below.
//
// LiveVolumePill's is deliberately NOT merged — see the comment there.
// It is a Framer-Motion motion-value subscriber, a different mechanism
// solving a different problem, and it has been renamed so the name no
// longer implies it's a fork of this.

import React, { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/reducedMotion';

const DEFAULT_DURATION_MS = 800;

// A non-finite value renders as "NaN" if it reaches format(). Callers pass
// values straight out of aggregate queries, which are null on an empty
// account, so this is a live path rather than a defensive nicety.
const finite = (n, fallback = 0) => (Number.isFinite(Number(n)) ? Number(n) : fallback);

// Ease-out cubic — feels like the number "settles" toward the final
// value rather than crawling linearly.
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export default function AnimatedNumber({
  value,
  from,
  format = (n) => String(Math.round(n)),
  duration = DEFAULT_DURATION_MS,
  className = '',
}) {
  const to = finite(value);
  const hasFrom = from !== undefined && from !== null;

  const [display, setDisplay] = useState(hasFrom ? finite(from) : to);
  const prevRef = useRef(hasFrom ? finite(from) : to);
  const rafRef = useRef(null);

  useEffect(() => {
    const start = hasFrom ? finite(from) : finite(prevRef.current);

    // Reduced motion, or nothing to tween. The equality check isn't just an
    // optimization: a 0 → 0 tween schedules ~50 frames of re-renders to
    // arrive back where it started, and the hero slides hit that on every
    // brand-new account.
    if (start === to || prefersReducedMotion()) {
      setDisplay(to);
      prevRef.current = to;
      return undefined;
    }

    const t0 = performance.now();
    const tick = (now) => {
      const elapsed = Math.min(duration, now - t0);
      const t = easeOutCubic(elapsed / duration);
      const cur = start + (to - start) * t;
      // Track the tween as it runs, so a value that changes mid-flight
      // continues from where the number visibly is rather than snapping
      // back to the last completed target.
      prevRef.current = cur;
      setDisplay(cur);
      if (elapsed < duration) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(to);
        prevRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [to, from, hasFrom, duration]);

  return <span className={`tabular-nums ${className}`}>{format(display)}</span>;
}
