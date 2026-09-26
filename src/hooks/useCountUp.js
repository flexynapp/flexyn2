// src/hooks/useCountUp.js
//
// The count up behind AnimatedNumber, as a hook, so a number that is not a
// bare <span> (a ring's stroke offset, a bar's width, a "3/5" label) can
// roll to its value too.
//
//   const shown = useCountUp(steps, { duration: 700 });
//
// Behaviour:
//   • First mount animates from 0 (or `from`) to the value. Pass
//     `animateOnMount: false` to snap on mount and animate only CHANGES,
//     which is what a streak banner wants: that number was already true.
//   • A later change animates from wherever the number visibly is, so a
//     value that moves mid tween continues rather than snapping back.
//   • `from` pins the start of EVERY animation, not just the first.
//   • prefers-reduced-motion returns the value immediately and schedules no
//     frames at all.
//   • null, undefined and NaN come back unchanged. Callers use those to mean
//     "no data", and a count up must not turn an absent reading into a zero.
//
// The returned number is unrounded; format it at the call site.

import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/reducedMotion';

export const DEFAULT_COUNT_UP_MS = 800;

// Ease-out cubic: the number arrives quickly and settles onto its value.
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

export default function useCountUp(value, {
  duration = DEFAULT_COUNT_UP_MS,
  from,
  animateOnMount = true,
} = {}) {
  const hasFrom = isNum(from);
  const reduced = prefersReducedMotion();

  const initial = () => {
    if (!isNum(value) || reduced) return value;
    if (hasFrom) return from;
    return animateOnMount ? 0 : value;
  };

  const [display, setDisplay] = useState(initial);
  const prevRef = useRef(null);
  if (prevRef.current === null) prevRef.current = initial();
  const rafRef = useRef(null);

  useEffect(() => {
    if (!isNum(value)) {
      prevRef.current = value;
      setDisplay(value);
      return undefined;
    }

    let start;
    if (hasFrom) start = from;
    else if (isNum(prevRef.current)) start = prevRef.current;
    else start = animateOnMount ? 0 : value;

    // Nothing to tween, or the user asked for less motion. The equality
    // check matters: a 0 to 0 tween would schedule ~50 frames of renders to
    // land where it started, and brand new accounts hit that everywhere.
    if (start === value || prefersReducedMotion() || !(duration > 0)) {
      prevRef.current = value;
      setDisplay(value);
      return undefined;
    }

    const t0 = performance.now();
    const tick = (now) => {
      const elapsed = Math.min(duration, now - t0);
      const cur = start + (value - start) * easeOutCubic(elapsed / duration);
      prevRef.current = cur;
      setDisplay(cur);
      if (elapsed < duration) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = value;
        setDisplay(value);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // `from`/`hasFrom` are included so a changed start restarts the tween.
  }, [value, from, hasFrom, duration, animateOnMount]);

  // Reduced motion wins over any state left behind by an earlier render.
  if (reduced || !isNum(value)) return value;
  return display;
}

export { useCountUp };
