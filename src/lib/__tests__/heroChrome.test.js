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
import { HERO_WATERMARK_PX, HERO_NEXT_BUTTON, HERO_GEOMETRY, heroWatermarkStyle } from '@/lib/heroChrome';

describe('the next-slide button cannot reach the watermark', () => {
  const { cardPadPx, cardMinHeightPx, buttonPx, buttonInsetPx } = HERO_GEOMETRY;

  it('clears it at the card MINIMUM height, which is the worst case', () => {
    // Bottom-anchored, so the button only moves further away as the card
    // grows — the minimum is the only height that can fail.
    const watermarkBottom = cardPadPx + HERO_WATERMARK_PX;
    const buttonTop = cardMinHeightPx - buttonInsetPx - buttonPx;
    expect(buttonTop).toBeGreaterThan(watermarkBottom);
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

  it.each(PAGES)('%s uses HERO_NEXT_BUTTON', async (file) => {
    const fs = await import('fs');
    const src = fs.readFileSync(file, 'utf8');
    expect(src, `${file} re-inlines the button classes`).not.toMatch(/absolute end-3 top-1\/2/);
    expect(src).toMatch(/HERO_NEXT_BUTTON/);
  });
});
