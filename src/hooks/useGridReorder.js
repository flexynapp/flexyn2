import { useCallback, useRef, useState } from 'react';

/**
 * Drag-to-reorder for a CSS grid, driven by Pointer Events.
 *
 * WHY THIS EXISTS. The Workout page's card grid used the HTML5 drag-and-drop
 * API — `draggable`, `dataTransfer`, `dragstart` / `dragover` / `drop`. That
 * API is mouse-only: neither iOS Safari nor Chrome on Android synthesises
 * those events from a touch, and there is no flag or polyfill switch that
 * makes them. Flexyn ships to iOS and Android only, so the customiser had
 * never once worked for a real user. It looked live — the button opened a
 * Save/Reset toolbar and every card took `cursor: grab` — and then nothing
 * could be moved. A feature that is visibly present and inert reads as the
 * app being broken, which is worse than not shipping it.
 *
 * Pointer Events are the replacement because ONE code path covers mouse,
 * touch and pen. No branching on input type, and nothing to keep in sync.
 *
 * WHY HIT-TESTING RATHER THAN framer's Reorder. `Reorder.Group` is
 * one-dimensional: with `axis="y"` it compares midpoints along a single
 * axis. In a two-column grid the cards in a row share a y, so a sideways
 * drag reorders nothing and a vertical one jumps two positions. This grid
 * also carries a `col-span-2` card, and CLAUDE.md's rule about col-span
 * applies — it is a grid-only property, so the layout cannot move to the
 * flex container Reorder would want. `elementFromPoint` sidesteps all of
 * it: ask the browser what is under the finger and the answer is correct
 * for any layout, including the full-width row.
 *
 * USAGE — the parent owns the order, the hook owns the gesture:
 *
 *   const { dragIdx, overIdx, handleProps, reset } = useGridReorder(order, setOrder);
 *   …
 *   <div data-reorder-idx={i}>              // the SLOT, must carry the index
 *     <button {...handleProps(i)} className="touch-none" />
 *   </div>
 *
 * `touch-action: none` on the handle is load-bearing and is the caller's job
 * (it is a class in this codebase, not a style). Without it the browser pans
 * the page with the same touch that is dragging the card. It belongs on the
 * handle ALONE — putting it on the slot is what made the dashboard rows
 * unscrollable, see components/dashboard/ReorderableRow.jsx.
 */
export function useGridReorder(order, onReorder) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);

  // The pointer handlers are attached once per render but fire many times
  // between renders, so they cannot read the state they are also setting —
  // they would see the value from the render that created them. The ref is
  // the live copy; the state exists only to repaint.
  const live = useRef({ dragIdx: null, overIdx: null });

  const reset = useCallback(() => {
    live.current = { dragIdx: null, overIdx: null };
    setDragIdx(null);
    setOverIdx(null);
  }, []);

  const commit = useCallback(() => {
    const { dragIdx: from, overIdx: to } = live.current;
    reset();
    if (from == null || to == null || from === to) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  }, [order, onReorder, reset]);

  const handleProps = useCallback((idx) => ({
    onPointerDown: (e) => {
      // Only the primary button — a right-click drag is not a reorder.
      if (e.button != null && e.button !== 0) return;
      // Stops the browser turning the press into a text selection or a
      // native image drag before the pointer handlers ever run.
      e.preventDefault();
      // Capture so the drag survives the pointer leaving the handle, which
      // it does immediately — the whole gesture happens elsewhere. Without
      // this the move events stop at the first card boundary.
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
      live.current = { dragIdx: idx, overIdx: idx };
      setDragIdx(idx);
      setOverIdx(idx);
    },

    onPointerMove: (e) => {
      if (live.current.dragIdx == null) return;
      // Capture redirects the EVENTS to the handle but does not change
      // hit-testing, so this still reports the card actually under the
      // finger. That is what makes the grid layout irrelevant here.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const slot = el?.closest?.('[data-reorder-idx]');
      const next = slot ? Number(slot.dataset.reorderIdx) : null;
      if (next !== live.current.overIdx) {
        live.current.overIdx = next;
        setOverIdx(next);
      }
    },

    onPointerUp: commit,
    // Fires when the OS takes the gesture away — a system swipe, a phone
    // call. Dropping the card where it started is the safe reading of an
    // interrupted drag; committing would move it somewhere never chosen.
    onPointerCancel: reset,
  }), [commit, reset]);

  return { dragIdx, overIdx, handleProps, reset };
}

export default useGridReorder;
