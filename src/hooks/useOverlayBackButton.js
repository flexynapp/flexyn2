// src/hooks/useOverlayBackButton.js
//
// Makes the hardware / browser BACK gesture dismiss a full-screen
// overlay instead of navigating the page underneath it.
//
//   useOverlayBackButton(open, onClose);
//
// ── Why this is needed ────────────────────────────────────────────
//
// The vault-style overlays are `position: fixed; inset: 0` portals owned
// by ProfileMenu, which lives in the persistent Layout header. They are
// not routes, so they put nothing on the history stack. Press back with
// one open and the router changes page while the overlay keeps covering
// the screen at z-200 — so the app looks like it ignored you, or worse,
// like back is broken. Reported from the Achievements vault: "I hit the
// back arrow and it brought me back to achievements instead of the
// dashboard."
//
// ProfileMenu already had half of this fix for the journal overlay, with
// a comment reading "an overlay that outlives the page it was opened
// from has to be told when the page goes away. Nothing else in the menu
// has this problem because every other entry navigates." That stopped
// being true once Achievements, Debrief Vault and Injury Form became
// non-navigating overlays.
//
// A pathname reset alone is NOT the fix. It stops the overlay outliving
// the page, but back would still navigate away from the page you opened
// the overlay from, when what you wanted was to close the sheet and be
// back where you were. Pushing a history entry gets that: back pops our
// own entry, we close, and the route never changes.
//
// ── Safety ────────────────────────────────────────────────────────
//
// The pushed entry carries the SAME url, so react-router sees a popstate
// with an unchanged pathname and does not navigate.
//
// The cleanup calls history.back() to drop our entry when the overlay is
// closed from inside the app (the back chevron). It must NOT do that
// when the close came FROM a popstate — the browser has already removed
// the entry, and a second back would navigate the real page away. Hence
// the `popped` flag.
//
// `onClose` is held in a ref: callers pass an inline arrow, so depending
// on it directly would re-run this effect on every render and push a new
// history entry each time.

import { useEffect, useRef } from 'react';

// ── Nesting ───────────────────────────────────────────────────────
//
// Overlays stack: the Debrief Vault opens a list at z-200 and expanding
// a week puts a second overlay over it at z-300. Back has to close the
// TOP one and leave the one underneath alone.
//
// That does not happen by itself. A popstate is delivered to every
// listener on the window, so two mounted instances would both close on
// one press — you would tap back on an expanded debrief and land outside
// the vault entirely, skipping the list.
//
// So instances register here, innermost last, and a popstate is handled
// only by whichever is on top. Module scope is right for this: it is one
// browser history and one back button, so there is exactly one stack.
const stack = [];

export function useOverlayBackButton(active, onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return undefined;
    if (typeof window === 'undefined' || !window.history) return undefined;

    let popped = false;
    const entry = {};
    try {
      window.history.pushState({ __flexynOverlay: true }, '');
    } catch {
      // History is unavailable (rare, but a sandboxed webview will do
      // this). Degrade to no back handling rather than breaking the
      // overlay entirely.
      return undefined;
    }
    stack.push(entry);

    const onPop = () => {
      // Not the top overlay? The press belongs to whoever is above us.
      if (stack[stack.length - 1] !== entry) return;
      popped = true;
      stack.pop();
      try { onCloseRef.current?.(); } catch { /* caller's problem */ }
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
      if (!popped) {
        try { window.history.back(); } catch { /* nothing to undo */ }
      }
    };
  }, [active]);
}

export default useOverlayBackButton;
