// src/hooks/useLongPress.js
//
// Detects long-press (hold) gestures on touch and mouse. Used by the
// bottom-tab quick-action menus and other "hold for shortcut" surfaces.
//
// Returns a set of event handlers to spread onto the target element.
// Calls `onLongPress` once after `ms` ms of continuous press, then
// stops listening until the user releases and presses again.
//
// Important properties:
//   • Cancels the timer on movement past `tolerance` px — prevents the
//     gesture from firing during scroll attempts.
//   • Cancels on contextmenu (iOS Safari's native long-press preview
//     should not double-fire with our handler).
//   • Cancels on pointerleave / pointerup.
//   • Calls preventDefault on the firing pointerdown to suppress the
//     native context menu when the gesture succeeds.
//   • Returns `wasLongPress` from the click handler so the caller can
//     suppress the synthesized click after a long-press.
//
// USAGE
//
//   const longPress = useLongPress(() => openMenu(), { ms: 400 });
//   <button {...longPress.bind} onClick={(e) => longPress.consumeClick(e) && navigate(...)}>

import { useCallback, useRef } from 'react';

const DEFAULT_MS = 400;
const DEFAULT_TOLERANCE = 8;

export function useLongPress(onLongPress, { ms = DEFAULT_MS, tolerance = DEFAULT_TOLERANCE } = {}) {
  const timerRef = useRef(null);
  const startedAtRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startedAtRef.current = null;
  }, []);

  const start = useCallback((e) => {
    cancel();
    firedRef.current = false;
    startedAtRef.current = Date.now();
    const p = ('touches' in e && e.touches?.[0]) || e;
    startPosRef.current = { x: p.clientX ?? 0, y: p.clientY ?? 0 };
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      try { onLongPress(e); } catch { /* ignore */ }
      timerRef.current = null;
    }, ms);
  }, [cancel, ms, onLongPress]);

  const move = useCallback((e) => {
    if (!startedAtRef.current) return;
    const p = ('touches' in e && e.touches?.[0]) || e;
    const dx = (p.clientX ?? 0) - startPosRef.current.x;
    const dy = (p.clientY ?? 0) - startPosRef.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > tolerance) {
      cancel();
    }
  }, [cancel, tolerance]);

  /**
   * Wrap your onClick handler:
   *   onClick={(e) => longPress.consumeClick(e) && doTheNav(e)}
   * Returns false (and the click is consumed) if a long-press just
   * fired; otherwise returns true so the click flow continues.
   */
  const consumeClick = useCallback(() => {
    if (firedRef.current) {
      firedRef.current = false;
      return false;
    }
    return true;
  }, []);

  const bind = {
    onPointerDown: start,
    onPointerMove: move,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e) => {
      // Suppress browser's own long-press context menu when we caught
      // the gesture (otherwise iOS shows "Copy / Share" over our menu).
      if (firedRef.current) e.preventDefault();
    },
  };

  return { bind, consumeClick };
}
