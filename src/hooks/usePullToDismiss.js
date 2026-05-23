// src/hooks/usePullToDismiss.js
//
// iOS-style "drag the sheet down to dismiss" gesture for bottom-sheet
// modals. Returns props to spread onto the modal's grab-handle area;
// when the user drags down past the threshold (180px) and releases,
// `onDismiss` fires. Below the threshold, the sheet snaps back.
//
// Caller decides where to apply containerProps — typically a top "grab
// bar" or the modal's header — so an input scroll inside the sheet
// doesn't accidentally trigger the dismiss gesture.
//
// Touch-only. Desktop users get the X / Cancel button as usual.
//
// Usage:
//   const pull = usePullToDismiss({ onDismiss: () => setOpen(false) });
//   <div {...pull.handleProps}>
//     <div className="grab-bar" />
//   </div>
//   <div style={pull.contentStyle}> …modal content… </div>

import { useCallback, useRef, useState } from 'react';

const COMMIT_PX = 180;

export function usePullToDismiss({ onDismiss, enabled = true } = {}) {
  const [dy, setDy] = useState(0);
  const startYRef  = useRef(0);
  const draggingRef = useRef(false);

  const onTouchStart = useCallback((e) => {
    if (!enabled) return;
    const t = e.touches?.[0];
    if (!t) return;
    startYRef.current = t.clientY;
    draggingRef.current = true;
  }, [enabled]);

  const onTouchMove = useCallback((e) => {
    if (!enabled || !draggingRef.current) return;
    const t = e.touches?.[0];
    if (!t) return;
    // Clamp downward-only; upward drag does nothing (the sheet was
    // already at rest, lifting it would just open it past the natural
    // top — visually awkward).
    const delta = Math.max(0, t.clientY - startYRef.current);
    setDy(Math.min(delta, COMMIT_PX + 60));
  }, [enabled]);

  const onTouchEnd = useCallback(() => {
    if (!enabled || !draggingRef.current) return;
    draggingRef.current = false;
    if (dy >= COMMIT_PX) {
      setDy(0);
      try { onDismiss?.(); } catch { /* ignore */ }
    } else {
      setDy(0);
    }
  }, [enabled, dy, onDismiss]);

  return {
    handleProps: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      style: { touchAction: 'none' },
    },
    contentStyle: {
      transform: `translateY(${dy}px)`,
      transition: dy === 0 ? 'transform 0.25s ease-out' : 'none',
      willChange: 'transform',
    },
    dy,
  };
}
