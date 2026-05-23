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

import React, { useEffect, useRef, useState } from 'react';

const DEFAULT_DURATION_MS = 800;

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
}

// Ease-out cubic — feels like the number "settles" toward the final
// value rather than crawling linearly.
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

export default function AnimatedNumber({
  value,
  format = (n) => String(Math.round(n)),
  duration = DEFAULT_DURATION_MS,
  className = '',
}) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const rafRef = useRef(null);

  useEffect(() => {
    // First render OR reduced-motion: snap to the new value.
    if (prefersReducedMotion()) {
      setDisplay(value);
      prevRef.current = value;
      return undefined;
    }
    const from = Number(prevRef.current) || 0;
    const to   = Number(value) || 0;
    if (from === to) return undefined;

    const start = performance.now();
    const tick = (now) => {
      const elapsed = Math.min(duration, now - start);
      const t = easeOutCubic(elapsed / duration);
      setDisplay(from + (to - from) * t);
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
  }, [value, duration]);

  return <span className={`tabular-nums ${className}`}>{format(display)}</span>;
}
