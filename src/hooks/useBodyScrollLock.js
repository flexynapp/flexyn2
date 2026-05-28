// src/hooks/useBodyScrollLock.js
//
// Stops the page underneath a modal/sheet from scrolling while the modal
// is open. Mount-time: snapshot the current `body.overflow` and clamp it
// to `hidden`. Unmount: restore. Same idea Radix Dialog uses internally —
// we just need it for the modals we built ourselves (custom `fixed inset-0`
// overlays that aren't Radix Dialogs).
//
// Pass `active=false` to no-op (e.g. when the modal isn't visible yet).

import { useEffect } from 'react';

export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [active]);
}
