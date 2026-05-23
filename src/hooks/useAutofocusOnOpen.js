// src/hooks/useAutofocusOnOpen.js
//
// Returns a ref. Attach it to the input element you want to focus when
// `open` becomes true. Skips on touch devices where surfacing the
// keyboard automatically is intrusive (lifts the viewport, hides
// content). On desktop and on stylus / external-keyboard setups,
// auto-focusing the first input shaves a tap off every modal open.
//
// Usage:
//   const ref = useAutofocusOnOpen(open);
//   <input ref={ref} … />

import { useEffect, useRef } from 'react';

function isTouchOnly() {
  if (typeof window === 'undefined') return false;
  try {
    // matchMedia(any-pointer: coarse) is true when ANY input device is
    // coarse (touch). matchMedia(pointer: fine) is true when the
    // primary device is fine (mouse/trackpad). We only auto-focus when
    // the primary input is fine OR there's a fine pointer available —
    // i.e. a real keyboard probably is present.
    if (window.matchMedia('(pointer: fine)').matches) return false;
    return window.matchMedia('(any-pointer: coarse)').matches;
  } catch { return false; }
}

export function useAutofocusOnOpen(open) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    if (isTouchOnly()) return undefined;
    // Wait a frame so the modal's open transition has started and the
    // input is actually painted in the DOM. Without the RAF, calling
    // focus() on a hidden / not-yet-painted element does nothing on
    // some browsers.
    const raf = requestAnimationFrame(() => {
      try { ref.current?.focus?.(); } catch { /* ignore */ }
    });
    return () => cancelAnimationFrame(raf);
  }, [open]);
  return ref;
}
