// src/lib/tileRows.js
// Wrapped-and-centred tile rows — the shared replacement for `grid-cols-N`
// anywhere the child count is decided by data rather than by the design.
//
// WHY THIS EXISTS
//
// A CSS grid packs a partial row into its LEADING columns. That is correct
// for a table and wrong for a collection: two capsule pulls sat hard against
// the left edge of the reveal panel with a dead third column beside them, and
// so did the last row of any count that wasn't a multiple of the column count.
// The same defect was found in the collection catalog (once per rarity tier),
// five of the Bag's six grids, and four of the marketplace's seven. A flex row
// that wraps and centres puts every row under the middle at any count.
//
// A row and its tile width are two halves of ONE decision — a row with no tile
// width collapses every tile to its content, and a tile width with no row does
// nothing at all. They were being retyped per screen, with the gap and column
// arithmetic redone by hand each time, so this hands back both together and
// makes the arithmetic un-typoable. That is the whole job.
//
// ── THE RULE THAT CONSTRAINS THE DESIGN ─────────────────────────────────────
//
// Tailwind's scanner reads SOURCE TEXT. It has no idea what this module
// computes at runtime, so a basis class interpolated from a gap and a column
// count — a template literal with the numbers substituted in — is never
// emitted into the stylesheet, and the tile silently falls back to its content
// width with nothing in the console to say why. Every class below is therefore
// written out in full, and a new (gap, cols) combination means adding a
// literal entry here, not extending a formula.
//
// This comment deliberately does NOT spell that broken pattern out. The
// scanner reads comments too, and a pasted example of an interpolated class
// gets extracted as a candidate and shipped as a junk `calc((100% - ${gap`
// rule in the stylesheet — which is exactly how this note came to exist.
//
// ── WHY THE WIDTH IS A CALC AND NOT A PERCENTAGE ────────────────────────────
//
// Because the gap has to come out of the tile. At gap-3 a flat percentage low
// enough to survive a 320px phone is visibly thinner than the track it
// replaces, and one that matches the track on a big phone overflows a small
// one and silently drops 3-up to 2-up. The calc reproduces the grid column
// exactly at every container width.
//
// The trailing `- 1px` is the anti-wrap margin. Without it a full row sums to
// exactly 100% and sub-pixel rounding can push its last tile onto its own
// line. Chrome tolerates the exact fit; Safari's flex rounding is not the same
// code and is not testable from here, and a wrapped row is a visible bug for
// a 1px saving. Single-column rows use `basis-full` rather than `100% - 1px`
// — there is no second tile to round against, and it keeps those rows
// pixel-identical to the `grid-cols-1` they replaced.

/** Row classes. The gap has to be literal too — see the scanner note above. */
const ROWS = {
  2: 'flex flex-wrap justify-center gap-2',
  3: 'flex flex-wrap justify-center gap-3',
};

/**
 * Tile widths, keyed `<gap>-<cols>-<smCols>`.
 *
 * Read an entry as: (100% − (cols − 1) × gap) ÷ cols − 1px, where gap-2 is
 * 0.5rem and gap-3 is 0.75rem. `tileRows.test.js` re-derives every one of
 * these from its key and fails if the arithmetic drifts, so a wrong calc
 * cannot land — that guard is the reason to add entries here rather than
 * inline a new one at a call site.
 */
const ITEMS = {
  // gap-2 (0.5rem)
  '2-3-5': 'shrink-0 basis-[calc((100%_-_1rem)/3_-_1px)] sm:basis-[calc((100%_-_2rem)/5_-_1px)]',
  '2-3-3': 'shrink-0 basis-[calc((100%_-_1rem)/3_-_1px)]',
  '2-4-6': 'shrink-0 basis-[calc((100%_-_1.5rem)/4_-_1px)] sm:basis-[calc((100%_-_2.5rem)/6_-_1px)]',
  '2-2-2': 'shrink-0 basis-[calc((100%_-_0.5rem)/2_-_1px)]',
  '2-1-2': 'shrink-0 basis-full sm:basis-[calc((100%_-_0.5rem)/2_-_1px)]',
  // gap-3 (0.75rem)
  '3-3-4': 'shrink-0 basis-[calc((100%_-_1.5rem)/3_-_1px)] sm:basis-[calc((100%_-_2.25rem)/4_-_1px)]',
  '3-2-3': 'shrink-0 basis-[calc((100%_-_0.75rem)/2_-_1px)] sm:basis-[calc((100%_-_1.5rem)/3_-_1px)]',
  '3-2-4': 'shrink-0 basis-[calc((100%_-_0.75rem)/2_-_1px)] sm:basis-[calc((100%_-_2.25rem)/4_-_1px)]',
  '3-1-2': 'shrink-0 basis-full sm:basis-[calc((100%_-_0.75rem)/2_-_1px)]',
};

/** One tile per row: the degraded-but-legible fallback for an unknown combo. */
const FALLBACK = 'shrink-0 basis-full';

/**
 * Class pair for a wrapped, centred tile row.
 *
 * @param {object}  spec
 * @param {2|3}     spec.gap      Tailwind gap step. 2 → 8px, 3 → 12px.
 * @param {number}  spec.cols     Tiles per row on a phone.
 * @param {number} [spec.smCols]  Tiles per row from `sm` up. Defaults to cols.
 * @param {'start'} [spec.align]  `items-start` — stops a tile stretching to
 *                                the tallest tile on its line. Only worth it
 *                                where cards genuinely differ in height.
 * @returns {{row: string, item: string}} `row` goes on the container, `item`
 *          on every direct child. Both, or neither works.
 *
 * @example
 *   const { row, item } = tileRow({ gap: 3, cols: 3, smCols: 4 });
 *   <div className={row}>{xs.map(x => <Card key={x.id} className={item} />)}</div>
 */
export function tileRow({ gap, cols, smCols = cols, align } = {}) {
  const row  = ROWS[gap];
  const item = ITEMS[`${gap}-${cols}-${smCols}`];

  if (!row || !item) {
    // A missing entry means Tailwind emitted no width for this combo, so the
    // tiles would shrink to their content and the row would look broken in a
    // way that reads as a styling accident rather than a missing constant.
    // Loud in dev, survivable in production: nobody's Bag should be a white
    // screen because a layout constant is absent.
    const msg =
      `tileRow: no entry for gap-${gap} ${cols}-up/${smCols}-up. Add the literal ` +
      `classes to ITEMS in src/lib/tileRows.js — they cannot be built at runtime, ` +
      `Tailwind only emits classes it can read in the source.`;
    if (import.meta.env?.DEV) throw new Error(msg);
    return { row: ROWS[gap] ?? ROWS[3], item: FALLBACK };
  }

  return { row: align === 'start' ? `${row} items-start` : row, item };
}

// Exported for the test, which re-derives every width from its key.
export const __TILE_ROWS_INTERNALS = { ROWS, ITEMS, FALLBACK };
