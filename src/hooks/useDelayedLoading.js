// src/hooks/useDelayedLoading.js
//
// Wraps a boolean `isLoading` so spinners only appear when the
// underlying operation actually takes long enough to notice. Anything
// faster than the delay threshold (default 250ms) is rendered
// "instant" — no spinner flash. Operations that exceed the threshold
// get the spinner with no extra delay after that.
//
// Studies (Nielsen Norman Group, others) consistently show users
// perceive sub-300ms responses as instant. The flash of a spinner
// for a 100ms request actually makes the app feel slower than not
// showing one at all — it's a flicker that draws attention to the
// latency. Removing those flickers makes the app feel snappy without
// any real speed change.
//
// Skeleton screens (content shape placeholders) do NOT route through
// this hook — they're content, not loading affordances, and should
// render immediately.

import { useEffect, useState, useRef } from 'react';

export function useDelayedLoading(isLoading, delayMs = 250) {
  const [delayed, setDelayed] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    // Clean up any pending timer when the state changes (or component
    // unmounts) — avoids a stale `setDelayed(true)` after the operation
    // already finished or the component disappeared.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!isLoading) {
      // Operation completed (or was never loading). Hide spinner
      // immediately — no fade-out delay; the actual content reveal
      // is the user's visual confirmation.
      setDelayed(false);
      return undefined;
    }

    // Operation just started. Wait `delayMs` before exposing the
    // spinner. If it completes within that window, the spinner never
    // renders.
    timerRef.current = setTimeout(() => {
      setDelayed(true);
      timerRef.current = null;
    }, delayMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isLoading, delayMs]);

  return delayed;
}
