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

// The tween itself now lives in `useCountUp` (src/hooks/useCountUp.js) so
// rings, bars and labels can share it; this component is the span wrapper
// with the finite guard and the snap on mount default.

import React from 'react';
import useCountUp, { DEFAULT_COUNT_UP_MS } from '@/hooks/useCountUp';

// A non-finite value renders as "NaN" if it reaches format(). Callers pass
// values straight out of aggregate queries, which are null on an empty
// account, so this is a live path rather than a defensive nicety.
const finite = (n, fallback = 0) => (Number.isFinite(Number(n)) ? Number(n) : fallback);

export default function AnimatedNumber({
  value,
  from,
  format = (n) => String(Math.round(n)),
  duration = DEFAULT_COUNT_UP_MS,
  animateOnMount = false,
  className = '',
}) {
  const hasFrom = from !== undefined && from !== null;
  const display = useCountUp(finite(value), {
    duration,
    from: hasFrom ? finite(from) : undefined,
    // Without `from` the first render snaps by default: the number was
    // already true when the component mounted. With it, every appearance
    // counts up. `animateOnMount` is the third option: count up from zero
    // on first paint, then roll from the previous value on later changes
    // (a stat tile whose timeframe the user switches).
    animateOnMount: hasFrom || animateOnMount,
  });

  return <span className={`tabular-nums ${className}`}>{format(display)}</span>;
}
