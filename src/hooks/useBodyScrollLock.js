// src/hooks/useBodyScrollLock.js
//
// Stops the page underneath a menu / sheet / modal from scrolling while it
// is open. This is the ONLY thing a hand-rolled overlay should call — the
// mechanics (and the long explanation of why `body { overflow: hidden }`
// isn't enough) live in `@/lib/scrollLock`.
//
//   useBodyScrollLock(open);
//
// Pass the overlay's own visibility as `active`, not a bare `true`, unless
// the component unmounts when it closes. Locks are reference-counted, so a
// sheet opened from inside another sheet is safe: the page stays pinned
// until the outermost one closes, and lands back on the same scroll
// position it started from.
//
// Hook order rule: this is a hook, so it has to run above any early
// `if (!open) return null`. That's what the `active` argument is for.

import { useEffect } from 'react';
import { lockBodyScroll, unlockBodyScroll } from '@/lib/scrollLock';

export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [active]);
}

export default useBodyScrollLock;
