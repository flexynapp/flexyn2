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
let seq = 0;

// ── Our own history.back() must not close the next overlay ──────────
//
// history.back() is ASYNC: the popstate it causes arrives after the
// current task. When one overlay closes and another opens in the same
// commit (tap Save Workout in the Finish sheet, and saveWorkout() opens a
// warning dialog), the sheet's cleanup calls back(), the dialog pushes
// its entry and registers on top of the stack, and THEN the sheet's
// popstate lands and is handled by the dialog, which closes. The user saw
// the sheet close and nothing else: no warning, no save.
//
// Two parts to the fix, both measured in Chromium:
//   1. Every back() this hook issues is recorded, and the popstate it
//      produces is consumed here instead of reaching the top overlay.
//   2. An overlay that opens while one of those is pending waits for it
//      before pushing its own entry. Pushed straight away, Chromium lands
//      the pending back() BELOW the new entry, so the dialog stayed open
//      with no entry of its own and the next Back left the page.
// Pending backs expire, so one that never produces a popstate (a
// sandboxed webview) cannot swallow a real Back press or strand a push.
const SELF_BACK_TTL_MS = 1000;
let selfBacks = [];
let deferredPushes = [];
let expiryTimer = null;
let listening = false;

function flushDeferredPushes() {
  const run = deferredPushes;
  deferredPushes = [];
  run.forEach(fn => fn());
}

function dropExpiredSelfBacks() {
  const now = Date.now();
  selfBacks = selfBacks.filter(t => now - t < SELF_BACK_TTL_MS);
  if (selfBacks.length === 0) flushDeferredPushes();
}

function handlePopState() {
  dropExpiredSelfBacks();
  if (selfBacks.length > 0) {
    selfBacks.shift();
    if (selfBacks.length === 0) flushDeferredPushes();
    return;
  }
  const top = stack[stack.length - 1];
  if (top) top.onPop();
}

function ensureListening() {
  if (listening) return;
  window.addEventListener('popstate', handlePopState);
  listening = true;
}

function recordSelfBack() {
  selfBacks.push(Date.now());
  clearTimeout(expiryTimer);
  expiryTimer = setTimeout(dropExpiredSelfBacks, SELF_BACK_TTL_MS);
}

export function useOverlayBackButton(active, onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return undefined;
    if (typeof window === 'undefined' || !window.history) return undefined;

    let popped = false;
    let pushed = false;
    const entry = {};
    const token = `ov-${++seq}`;
    // Keep the router's own state (key, idx, usr) on our entry. A bare
    // object here made the entry look like a page with no router state,
    // which goBack() and anything else reading history.state would
    // misread while an overlay is open.
    const push = () => {
      const base = (window.history.state && typeof window.history.state === 'object') ? window.history.state : {};
      window.history.pushState({ ...base, __flexynOverlay: token }, '');
      pushed = true;
    };
    const removeFromStack = () => {
      const i = stack.indexOf(entry);
      if (i !== -1) stack.splice(i, 1);
    };
    const deferredPush = () => {
      try { push(); } catch { removeFromStack(); }
    };

    if (selfBacks.length > 0) {
      deferredPushes.push(deferredPush);
    } else {
      try {
        push();
      } catch {
        // History is unavailable (rare, but a sandboxed webview will do
        // this). Degrade to no back handling rather than breaking the
        // overlay entirely.
        return undefined;
      }
    }
    // One module listener hands each popstate to the top overlay only,
    // so a press closes the innermost one and leaves the rest alone.
    entry.onPop = () => {
      popped = true;
      stack.pop();
      try { onCloseRef.current?.(); } catch { /* caller's problem */ }
    };
    stack.push(entry);
    ensureListening();

    return () => {
      removeFromStack();
      if (!pushed) {
        deferredPushes = deferredPushes.filter(fn => fn !== deferredPush);
        return;
      }
      // Only undo our entry if it is still the current one. When a sheet
      // closes BECAUSE something inside it navigated (tap a row, go to a
      // page), the router has pushed a new entry on top of ours by the time
      // this runs, and history.back() would undo that navigation. Every
      // sheet in the app uses this hook now, so that case is common, not
      // hypothetical. Leaving the stale entry costs one extra Back press
      // later on the same URL, which the router treats as a no-op.
      let ours = false;
      try { ours = window.history.state?.__flexynOverlay === token; } catch { /* treat as not ours */ }
      if (!popped && ours) {
        recordSelfBack();
        try { window.history.back(); } catch { selfBacks.pop(); }
      }
    };
  }, [active]);
}

export default useOverlayBackButton;
