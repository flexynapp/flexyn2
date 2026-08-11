/**
 * Dashboard row composition — which sections share a row, and in what order.
 *
 * Two consecutive 'half' sections share a row (a "hotdog"); everything else
 * stands alone full-width (a "hamburger"). A lone 'half' degrades to
 * full-width rather than leaving an orphan half a row wide.
 *
 * WHY THIS IS A MODULE AND NOT A useMemo IN THE PAGE.
 *
 * Pairing depends on ADJACENCY, so the row list is a function of the order —
 * which means reordering can create and destroy rows, not just move them.
 * Dragging one section past a pair splits that pair into two rows and then
 * re-merges it, so the list framer is animating changes MEMBERSHIP in the
 * middle of the gesture:
 *
 *   at rest         week+muscles | actions | streak+quote | discover   (4)
 *   one crossing    week+muscles | streak | actions | quote | discover (5)
 *   two crossings   week+muscles | streak+quote | actions | discover   (4)
 *
 * `Reorder.Item` projects layout from an item's previous box to its next one.
 * Project across two different lists and a row can be left holding a delta it
 * never resolves — it keeps its flow box while painting somewhere else. That
 * is the documented overlap bug in CLAUDE.md, and during a drag it is worse
 * than the async-data case that comment describes: if the row being DRAGGED
 * is the one that merges or splits, its React key changes, the element is
 * unmounted mid-gesture, and framer's drag is left pointing at nothing. That
 * is the "it glitches the card I originally selected" report.
 *
 * The fix is `freezeRows` + `reorderFrozen`: take the row list once when the
 * drag begins and reorder THOSE units for the length of the gesture, so the
 * list only ever changes order. Re-pair on drop, when nothing is animating.
 * Extracted here so that property is unit-testable without a browser — the
 * gesture itself needs a real one, the composition rules do not.
 */

/** A section id → 'full' | 'half'. Anything unset is 'full'. */
const layoutOf = (sectionLayouts, id) => sectionLayouts[id] || 'full';

/**
 * Build the row list from a visible section order.
 * @returns {{rowKey: string, sections: string[]}[]}
 */
export function buildDashboardRows(visibleOrder, sectionLayouts = {}) {
  const rows = [];
  let i = 0;
  while (i < visibleOrder.length) {
    const id = visibleOrder[i];
    const nextId = visibleOrder[i + 1];
    const pairs =
      layoutOf(sectionLayouts, id) === 'half' &&
      nextId != null &&
      layoutOf(sectionLayouts, nextId) === 'half';
    if (pairs) {
      rows.push({ rowKey: `${id}+${nextId}`, sections: [id, nextId] });
      i += 2;
    } else {
      rows.push({ rowKey: id, sections: [id] });
      i += 1;
    }
  }
  return rows;
}

/**
 * Reorder a FROZEN row list to match the key order framer reports.
 *
 * Keys that framer does not mention are dropped and unknown keys ignored, so
 * a stale callback arriving after the gesture cannot resurrect a row. The
 * units themselves are passed through by reference — same object, same
 * rowKey, so React keeps the same element and framer keeps the same
 * projection subject.
 */
export function reorderFrozen(rows, rowKeys) {
  const byKey = new Map(rows.map((r) => [r.rowKey, r]));
  return rowKeys.map((k) => byKey.get(k)).filter(Boolean);
}

/**
 * Flatten a row list back to the section order to persist.
 *
 * `hiddenOrder` is the part of the saved order this list never represented —
 * hidden sections and anything filtered out before pairing. It is appended so
 * a reorder does not erase a hidden section's existence from the saved order.
 */
export function flattenRows(rows, hiddenOrder = []) {
  return [...rows.flatMap((r) => r.sections), ...hiddenOrder];
}
