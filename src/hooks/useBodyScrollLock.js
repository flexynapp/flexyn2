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
// sheet opened from inside another sheet is safe: the page stays held until
// the outermost one closes.
//
// The overlay's OWN scrolling keeps working — the lock cancels a gesture
// only when it has nowhere left to go. So a sheet scrolls normally, and the
// drag that runs it to either end stops there instead of taking the page
// with it. The page's scroll position is never moved, so nothing that reads
// `window.scrollY` (Layout's auto-hiding nav, BackToTopButton) sees a lie
// while an overlay is open.
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
