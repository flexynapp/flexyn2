import React, { useLayoutEffect, useRef, useState } from 'react';
import { Reorder, useDragControls, useMotionValue } from 'framer-motion';
import { GripVertical } from 'lucide-react';

/* Handle-only drag for a customize-mode row.
 *
 * Dashboard and Nutrition both shipped their reorder rows as
 * `dragListener={editMode}`, which made the ENTIRE row a drag surface, and on
 * a phone that broke edit mode twice over:
 *
 *   1. Any touch that started on a card and moved reordered the page instead
 *      of scrolling it. The grip was decorative — nothing on screen said the
 *      rest of the row was live, so a scroll attempt rearranged the dashboard.
 *   2. framer writes `touch-action: pan-x` onto a `drag="y"` item whose
 *      listener is live (render/html/use-props.mjs — the same branch also
 *      writes `user-select: none` and `draggable=false`). That switches the
 *      browser's own vertical scrolling OFF across every row, so even a touch
 *      that did NOT trigger a drag couldn't scroll. The `touch-none` class
 *      those pages also carried was the same ban stated twice, not the cause.
 *
 * Between them the only way to scroll a page in edit mode was to find a gap
 * between rows. `dragListener={false}` + `dragControls` moves both onto the
 * grip: framer writes no touch-action at all, so rows scroll like any other
 * content, and a drag can only begin from the one control that looks like it
 * starts one. `DashboardWidgets.jsx`'s `ReorderableWidget` has always worked
 * this way — this is the page-level strips catching up with it.
 *
 * A render prop rather than props for the whole control strip: each page's
 * strip closes over ~10 values from its own body, and the hook is the only
 * thing that has to live down here.
 */
/* THE DRAGGED ROW STAYS UNDER THE FINGER. This is enforced here rather than
 * left to framer, and the difference matters.
 *
 * Kegan, after the freeze fix was live: "as soon as it moves multiple cards
 * down it just [shoots] off the screen since it's trying to snap to a new
 * location, which offsets the user's thumb location on the screen."
 *
 * That is the mechanism exactly. `Reorder.Item` positions the dragged element
 * with a drag offset applied ON TOP of its position in the flow. When a
 * reorder fires mid-gesture the element's flow position moves by a whole row,
 * while the drag offset — measured from where the drag began — does not. The
 * two compose, so the element paints a row away from the finger. Cross
 * several rows in one gesture and the error accumulates until it leaves the
 * screen.
 *
 * framer normally cancels this through layout projection, and it demonstrably
 * does: measured across a three-slot drag in a real browser with real touch,
 * the card tracked the finger to within 1px. It just as demonstrably does NOT
 * on a real phone, through four rounds of trying. Rather than keep guessing at
 * which projection subtlety differs, the invariant is now maintained directly:
 *
 *   · While dragging, `layout` is OFF for this row. Nothing but the drag
 *     offset may move it, so there is no projection to disagree with.
 *     The OTHER rows keep their layout animation — they are what slides
 *     around to make room, which is the part that should be animated.
 *   · After every render during a drag, the row's flow position is measured
 *     and any change is subtracted straight back out of the drag offset. A
 *     reorder, a sibling resizing, an image loading late — anything that
 *     moves the flow is cancelled in the same frame it happens.
 *
 * `Reorder.Item` reads `style.y` through `useDefaultMotionValue`, which keeps
 * a motion value the caller supplies instead of creating its own — so passing
 * one is a supported way in, not a workaround.
 *
 * A caller must therefore NOT animate `y` (framer will not own one property
 * twice — see components/ui/__tests__/bottomSheet.test.jsx for what that
 * looks like when it happens). Entry animations here use opacity and scale.
 */
export function ReorderableRow({
  value, layout, className, children, onDragStart, onDragEnd, ...motionProps
}) {
  const dragControls = useDragControls();
  const y = useMotionValue(0);
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  // The row's position in the flow, with the drag offset removed, as of the
  // last render. null when not dragging so the first measurement of a new
  // gesture establishes a baseline rather than correcting against a stale one.
  const flowTop = useRef(null);

  useLayoutEffect(() => {
    if (!dragging) { flowTop.current = null; return; }
    const el = ref.current;
    if (!el) return;
    // Subtracting y makes this independent of the offset we are about to
    // change, so the comparison is flow-to-flow.
    const top = el.getBoundingClientRect().top - y.get();
    if (flowTop.current !== null) {
      const moved = top - flowTop.current;
      // Cancel it. The row is where the finger left it; only the slot beneath
      // it changed.
      if (moved) y.set(y.get() - moved);
    }
    flowTop.current = top;
  });

  return (
    <Reorder.Item
      ref={ref}
      value={value}
      as="div"
      dragListener={false}
      dragControls={dragControls}
      style={{ y }}
      // Off for the row being dragged, on for every other row.
      layout={dragging ? false : layout}
      // Anything else the caller passes goes straight to the underlying
      // motion element — `initial` / `animate` for an entry animation, mostly.
      // RegimenForm's rows had one before they became reorderable and there is
      // no reason for them to lose it.
      {...motionProps}
      // The gesture's start and end, so a caller can hold the list still for
      // its duration. Dashboard needs this because its rows are COMPOSED from
      // the order — two half-width sections that become adjacent merge into
      // one row — so without freezing, a drag creates and destroys rows under
      // framer mid-gesture. See lib/dashboardRows.js.
      onDragStart={(e, info) => { setDragging(true); onDragStart?.(e, info); }}
      // `dragSnapToOrigin` is forced on by Reorder.Item, so releasing animates
      // y back to 0 — from wherever the corrections left it, into the slot the
      // row now occupies. That settle is the drop animation; don't zero it by
      // hand or the row teleports on release.
      onDragEnd={(e, info) => { setDragging(false); onDragEnd?.(e, info); }}
      className={className}
    >
      {children(dragControls)}
    </Reorder.Item>
  );
}

/* The only thing that starts a drag, so it has to be catchable with a thumb:
 * both pages had a bare 14–16px icon, smaller than the × beside it while being
 * the harder gesture. 32px of hit area around a 16px glyph.
 *
 * `touch-none` is load-bearing and belongs HERE rather than at the call site —
 * with the row scrolling normally again, this button is the one element that
 * has to claim the gesture, and a handle that forgets it drags one frame and
 * then hands the touch to the scroller. */
export function DragHandle({ dragControls, label, className = 'text-primary' }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => dragControls.start(e)}
      title={label}
      aria-label={label}
      className={`flex items-center justify-center w-8 h-8 -ms-1.5 shrink-0 rounded-sm touch-none cursor-grab active:cursor-grabbing hover:bg-primary/10 active:bg-primary/20 transition-colors ${className}`}
    >
      <GripVertical className="w-4 h-4" strokeWidth={2.5} />
    </button>
  );
}
