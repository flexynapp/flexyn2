// The watermark / next-button separation, as arithmetic rather than as a
// screenshot.
//
// The bug: the next-slide chevron was vertically centred, and the watermark
// occupies the top-right 72px of the slide box. On a ~190px card the button
// spanned roughly y 79-111 and the watermark y 16-88, so the chevron sat on
// top of the icon — visible on Progress as an arrow over the dumbbell.
//
// This is tested as numbers because the failure is geometric and a jsdom
// render cannot see it: jsdom lays nothing out, so a DOM test would pass
// with the two elements on top of each other. The real viewport check is a
// screenshot, which nobody re-runs. The arithmetic is what actually holds.

import { describe, it, expect } from 'vitest';
import { HERO_WATERMARK_PX, HERO_NEXT_BUTTON, HERO_SLIDE_MIN_H, HERO_GEOMETRY, heroWatermarkStyle } from '@/lib/heroChrome';

describe('the next-slide button cannot reach the watermark', () => {
  const { cardPadPx, cardMinHeightPx, buttonPx, buttonInsetPx } = HERO_GEOMETRY;

  const watermarkBottom = cardPadPx + HERO_WATERMARK_PX;
  const buttonTop = cardMinHeightPx - buttonInsetPx - buttonPx;

  it('clears it at the card MINIMUM height, which is the worst case', () => {
    // Bottom-anchored, so the button only moves further away as the card
    // grows — the minimum is the only height that can fail.
    expect(buttonTop).toBeGreaterThan(watermarkBottom);
  });

  it('leaves the icon room to breathe, not merely room to not overlap', () => {
    // Not overlapping was the first fix and it was not enough: at the old
    // 150px min-height these sat 18px apart, and the corner still read as
    // packed. The threshold is the point — a test that only asserts
    // "> 0" would have passed the version that looked wrong.
    // (kegan, 2026-08-10: "add more grey space so the icon has room to
    // breathe".)
    expect(buttonTop - watermarkBottom).toBeGreaterThanOrEqual(48);
  });

  it('is anchored to the bottom, not centred', () => {
    // `top-1/2 -translate-y-1/2` is what put it through the watermark. If
    // someone re-centres it this fails rather than waiting for a screenshot.
    expect(HERO_NEXT_BUTTON).toContain('bottom-3');
    expect(HERO_NEXT_BUTTON).not.toContain('top-1/2');
    expect(HERO_NEXT_BUTTON).not.toContain('-translate-y-1/2');
  });

  it('keeps the watermark hard in the top-right corner', () => {
    // The other half of the ask: the fix moves the BUTTON, never the icon.
    const style = heroWatermarkStyle();
    expect(style.top).toBe(0);
    expect(style.right).toBe(0);
    expect(style.width).toBe(HERO_WATERMARK_PX);
    expect(style.transform).toBe('none');
  });

  it('states its height as a class the pages share', () => {
    expect(HERO_SLIDE_MIN_H).toBe(`min-h-[${cardMinHeightPx}px]`);
  });

  it('keeps the button clear of the right edge by the same inset it uses below', () => {
    // end-3 / bottom-3 — a control that hugs one edge harder than the other
    // reads as misplaced rather than as anchored.
    expect(HERO_NEXT_BUTTON).toContain('end-3');
    expect(buttonInsetPx).toBe(12);
  });
});

describe('both carousels use the shared button, so they cannot drift', () => {
  // Progress and Nutrition had byte-identical copies of the class string,
  // and therefore identical bugs. One of them would have been fixed alone.
  const PAGES = ['src/pages/Progress.jsx', 'src/pages/Nutrition.jsx'];

  it.each(PAGES)('%s uses HERO_NEXT_BUTTON and HERO_SLIDE_MIN_H', async (file) => {
    const fs = await import('fs');
    const src = fs.readFileSync(file, 'utf8');
    expect(src, `${file} re-inlines the button classes`).not.toMatch(/absolute end-3 top-1\/2/);
    expect(src).toMatch(/HERO_NEXT_BUTTON/);
    // The height is half the clearance calculation, so a page that pins its
    // own hero min-h silently opts out of the guarantee above. Anchored to
    // the slide container's padding rather than to any `min-h-[…]`: the tab
    // bar's `min-h-[48px]` is the Apple HIG tap-target floor and has nothing
    // to do with this. A blanket match flagged it, which is the test being
    // too broad rather than the code being wrong.
    expect(src, `${file} hardcodes its own hero height`).not.toMatch(/p-4 md:p-5 min-h-\[/);
    expect(src).toMatch(/HERO_SLIDE_MIN_H/);
  });
});
