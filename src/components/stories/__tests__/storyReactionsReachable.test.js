/**
 * Story reactions could not be tapped. Not "were awkward" — could not.
 *
 * StoryViewer's three tap zones (previous / pause / next) are absolutely
 * positioned with `bottom: 90px`, so they cover the whole screen down to 90px
 * off the bottom. They are LATER SIBLINGS of the bottom bar and neither
 * carries a z-index, and positioned elements at `z-index: auto` paint in DOM
 * order — so the tap zones sat on top of everything in the bar that reached
 * above that 90px floor. The emoji picker row is one of those things. Every
 * reaction tap was delivered to "next story", so migration 097's feature had
 * never fired once from this screen.
 *
 * The fix raises the individual rows rather than the bar. The bar is
 * full-width and mostly empty space; a z-index on the container would take
 * roughly 100px of blank screen either side of the controls out of
 * tap-to-advance, which is a second bug traded for the first.
 *
 * jsdom computes no layout and loads no Tailwind, so neither the overlap nor
 * its repair is observable in a render test — asserting on the classes is the
 * honest option and it is stated as such. The floor is pinned alongside,
 * because these two facts are only meaningful together: if someone moves the
 * tap zones down to `bottom: 200px`, the z-index is no longer what is holding
 * the reactions up and this file should be re-read rather than stay green.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REL = 'src/components/stories/StoryViewer.jsx';
const src = readFileSync(resolve(process.cwd(), REL), 'utf8');

describe('StoryViewer bottom bar sits above the tap zones', () => {
  it('raises the reaction picker row', () => {
    // The wrapper immediately above <StoryReactionPicker>.
    const m = src.match(/<div className="([^"]*)">\s*\n\s*<StoryReactionPicker/);
    expect(m, 'the reaction picker wrapper moved — re-check the overlap').toBeTruthy();
    expect(m[1], 'the tap zones will swallow every reaction tap without this').toContain('z-10');
    expect(m[1]).toContain('relative'); // z-index does nothing on a static box
  });

  it('raises the reply and like row, and the story thumbnail', () => {
    expect(src).toMatch(/className="relative z-10 flex items-center justify-center gap-10"/);
    expect(src).toMatch(/className="relative z-10 flex items-center gap-2 mb-2\.5 ms-1"/);
  });

  it('leaves the bar itself unraised, so blank space still advances the story', () => {
    const bar = src.match(/\{!currentGroup\.isOwn && \(\s*\n\s*<div className="([^"]*)"/);
    expect(bar, 'the non-own bottom bar moved').toBeTruthy();
    expect(bar[1], 'raise the rows, not the full-width container').not.toContain('z-10');
  });

  it('still has the 90px tap-zone floor these z-indexes are compensating for', () => {
    const zones = src.match(/bottom: '90px'/g) || [];
    expect(zones.length, 'three tap zones: previous, centre, next').toBe(3);
  });
});
