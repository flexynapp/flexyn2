// Guards for src/lib/tileRows.js.
//
// The point of the module is that nobody has to redo the gap arithmetic by
// hand, so the point of this file is to re-derive every width from its own key
// and fail when the two disagree. A wrong calc renders as a row that wraps one
// tile early or leaves a sliver of dead space — easy to ship, easy to miss in
// review, and invisible until someone happens to hold exactly the wrong number
// of items.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { tileRow, __TILE_ROWS_INTERNALS } from '../tileRows';

const { ROWS, ITEMS } = __TILE_ROWS_INTERNALS;

/** Tailwind gap step → rem. */
const GAP_REM = { 2: 0.5, 3: 0.75 };

/** 0.75 → "0.75", 1 → "1", 2.25 → "2.25" — matching how the classes are written. */
const rem = (n) => String(Number(n.toFixed(4)));

/**
 * What the width for `<gap>-<cols>` must be:
 *   (100% − (cols − 1) × gap) ÷ cols − 1px
 * with a single column pinned to basis-full — no second tile to round
 * against, and it keeps those rows identical to the grid-cols-1 they replaced.
 */
function expectedBasis(gap, cols, prefix = '') {
  if (cols === 1) return `${prefix}basis-full`;
  const total = rem((cols - 1) * GAP_REM[gap]);
  // Concatenated, not interpolated into one template. Tailwind scans test
  // files too, and a basis class written as one template literal with the
  // numbers substituted in gets extracted as a candidate and emitted as a junk
  // rule in the shipped stylesheet. No fragment below is a whole utility on
  // its own. (Spelling the bad pattern out here would itself be the bug — the
  // assertion at the bottom of this file catches exactly that.)
  return prefix + 'basis-' + '[calc((100%_-_' + total + 'rem)/' + cols + '_-_1px)]';
}

describe('tileRows — the width matches the key that names it', () => {
  it.each(Object.keys(ITEMS))('%s derives from its own gap and column count', (key) => {
    const [gap, cols, smCols] = key.split('-').map(Number);
    const parts = [
      'shrink-0',
      expectedBasis(gap, cols),
      ...(smCols === cols ? [] : [expectedBasis(gap, smCols, 'sm:')]),
    ];
    expect(ITEMS[key]).toBe(parts.join(' '));
  });

  it('covers every combination the app actually renders', () => {
    // Adding a call site with a new shape means adding its literal here; this
    // list is what stops one being dropped in a refactor.
    // '3-2-4' is the Nutrition page's macro / vitamin grids (2026-08-11).
    // They were `grid-cols-2 md:grid-cols-4` while their tile count was
    // fixed at eight; gating each tile on whether its nutrient has any data
    // made the count data-driven, which is exactly the condition this
    // module exists for.
    // '2-2-2' is BarcodeResultModal's two nutrient grids (2026-08-12), for
    // the same reason one round later: they were `grid-cols-2` over a fixed
    // eight rows, and dropping the nutrients a scanned label does not carry
    // made the count data-driven. It stays 2-up at `sm` because it renders
    // inside a `sm:max-w-md` sheet, not a page column.
    expect(Object.keys(ITEMS).sort()).toEqual(
      ['2-1-2', '2-2-2', '2-3-3', '2-3-5', '3-1-2', '3-2-3', '3-2-4', '3-3-4'],
    );
  });

  it('gives every tile shrink-0, so a full row cannot squeeze instead of wrapping', () => {
    for (const cls of Object.values(ITEMS)) expect(cls.split(' ')).toContain('shrink-0');
  });

  it('centres and wraps every row, at the gap its key names', () => {
    for (const [gap, cls] of Object.entries(ROWS)) {
      expect(cls).toContain('flex');
      expect(cls).toContain('flex-wrap');
      expect(cls).toContain('justify-center');
      expect(cls).toContain(`gap-${gap}`);
    }
  });
});

describe('tileRow()', () => {
  it('hands back both halves together', () => {
    const { row, item } = tileRow({ gap: 3, cols: 3, smCols: 4 });
    expect(row).toBe(ROWS[3]);
    expect(item).toBe(ITEMS['3-3-4']);
  });

  it('defaults smCols to cols — one column count at every width', () => {
    expect(tileRow({ gap: 2, cols: 3 }).item).toBe(ITEMS['2-3-3']);
  });

  it('adds items-start only when asked', () => {
    expect(tileRow({ gap: 3, cols: 2, smCols: 3 }).row).not.toContain('items-start');
    expect(tileRow({ gap: 3, cols: 2, smCols: 3, align: 'start' }).row).toContain('items-start');
  });

  it('throws in dev on a combo with no literal classes behind it', () => {
    // Silently returning nothing would ship a row of content-width tiles with
    // no clue as to why, so an unknown combo has to be loud where it is cheap
    // to fix. The message names the file and says why a runtime calc is not an
    // option.
    expect(() => tileRow({ gap: 3, cols: 7 })).toThrow(/tileRows\.js/);
    expect(() => tileRow({ gap: 5, cols: 2 })).toThrow(/cannot be built at runtime/);
  });
});

describe('the classes stay readable to Tailwind', () => {
  // Both files, and both directions of the same hazard:
  //
  //   in tileRows.js — an interpolated class emits NO css, so tiles collapse
  //   to their content with nothing in the console to explain it;
  //   in this test  — an interpolated class IS extracted as a candidate and
  //   ships a junk `calc((100% - ${gap` rule in the stylesheet.
  //
  // Both have happened. Tailwind scans `./src/**/*.{ts,tsx,js,jsx}`, which is
  // every file named here, comments included.
  it.each(['src/lib/tileRows.js', 'src/lib/__tests__/tileRows.test.js'])(
    '%s never puts a class name and an interpolation on the same line',
    (file) => {
      // Resolved from the vitest root rather than import.meta.url — the jsdom
      // environment does not hand back a file: URL.
      const src = readFileSync(resolve(process.cwd(), file), 'utf8');
      const offenders = src
        .split('\n')
        .map((line, i) => [i + 1, line])
        .filter(([, line]) => /basis-\[|gap-\d/.test(line) && line.includes('${'));
      expect(offenders).toEqual([]);
    },
  );
});
