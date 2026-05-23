// src/hooks/useSwipeToDelete.js
//
// Mail/Slack-style swipe-to-delete gesture. Returns props to spread
// onto a row container. When the user drags left past the threshold,
// the row reveals a red delete affordance; releasing past the action
// threshold fires `onDelete`. Below the threshold the row snaps back.
//
// Touch-only — desktop users get a normal delete button via the
// `secondaryAction` slot (caller decides). We don't try to handle
// pointer-mouse swipes; the affordance reads as "weird drag" outside
// touch contexts.
//
// Usage:
//   const swipe = useSwipeToDelete({ onDelete: () => deleteRow(id) });
//   <li {...swipe.containerProps}>
//     <div style={swipe.actionStyle}>Delete</div>
//     <div {...swipe.contentProps}>…row content…</div>
//   </li>

import { useCallback, useRef, useState } from 'react';

const REVEAL_PX = 60;     // distance at which the delete affordance is fully shown
const COMMIT_PX = 140;    // release past this = fire onDelete

export function useSwipeToDelete({ onDelete, enabled = true } = {}) {
  const [dx, setDx] = useState(0);
  const startXRef = useRef(0);
  const draggingRef = useRef(false);

  const onTouchStart = useCallback((e) => {
    if (!enabled) return;
    const t = e.touches?.[0];
    if (!t) return;
    startXRef.current = t.clientX;
    draggingRef.current = true;
  }, [enabled]);

  const onTouchMove = useCallback((e) => {
    if (!enabled || !draggingRef.current) return;
    const t = e.touches?.[0];
    if (!t) return;
    const delta = Math.min(0, t.clientX - startXRef.current);
    setDx(Math.max(delta, -COMMIT_PX - 40));
  }, [enabled]);

  const onTouchEnd = useCallback(() => {
    if (!enabled || !draggingRef.current) return;
    draggingRef.current = false;
    if (dx <= -COMMIT_PX) {
      setDx(0);
      try { onDelete?.(); } catch { /* ignore */ }
    } else {
      setDx(0);
    }
  }, [enabled, dx, onDelete]);

  const revealAmount = Math.min(1, Math.abs(dx) / REVEAL_PX);
  const committing = dx <= -COMMIT_PX;

  return {
    containerProps: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      style: { position: 'relative', overflow: 'hidden', touchAction: 'pan-y' },
    },
    contentProps: {
      style: {
        transform: `translateX(${dx}px)`,
        transition: dx === 0 ? 'transform 0.2s ease-out' : 'none',
        willChange: 'transform',
      },
    },
    actionStyle: {
      position: 'absolute',
      top: 0, right: 0, bottom: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingRight: 16,
      opacity: revealAmount,
      background: committing
        ? 'linear-gradient(90deg, rgba(220,38,38,0.85), rgba(220,38,38,1))'
        : 'rgba(220,38,38,0.85)',
      color: '#fff',
      fontWeight: 700,
      fontSize: 12,
      letterSpacing: '0.05em',
      textTransform: 'uppercase',
      pointerEvents: 'none',
    },
    dx,
    committing,
  };
}
