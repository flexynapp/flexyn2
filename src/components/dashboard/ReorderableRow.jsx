import React from 'react';
import { Reorder, useDragControls } from 'framer-motion';
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
export function ReorderableRow({
  value, layout, className, children, onDragStart, onDragEnd, ...motionProps
}) {
  const dragControls = useDragControls();
  return (
    <Reorder.Item
      value={value}
      as="div"
      dragListener={false}
      dragControls={dragControls}
      layout={layout}
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
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
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
