// The hero watermark, and the rule that nothing floats over it.
//
// History, because the rule is the interesting part rather than the numbers:
// Progress and Nutrition carried a floating next-slide chevron, vertically
// centred, and the watermark owns the top-right 72px of the slide box. The
// two overlapped. The first fix anchored the button to the bottom; the
// second grew the card so the gap was 58px rather than 18. Both worked —
// measured on the real component at 198px, watermark 17-89, button 153-185.
//
// Both were still the wrong shape of answer. "Keep this control out of the
// way of that icon" is a constraint you re-earn every time the card, the
// copy or the locale changes. The Dashboard hero never had the problem
// because it has no floating control at all — its chevrons sit inside
// in-flow CTA buttons. Progress and Nutrition now do the same.
//
// So this file no longer checks a gap. It checks that the thing which
// created the gap is gone, and that the watermark still owns its corner.

import { describe, it, expect } from 'vitest';
import { HERO_WATERMARK_PX, HERO_SLIDE_MIN_H, HERO_GEOMETRY, heroWatermarkStyle } from '@/lib/heroChrome';

describe('the watermark keeps its corner', () => {
  it('is pinned hard to the top-right, untransformed', () => {
    const style = heroWatermarkStyle();
    expect(style.top).toBe(0);
    expect(style.right).toBe(0);
    expect(style.width).toBe(HERO_WATERMARK_PX);
    expect(style.height).toBe(HERO_WATERMARK_PX);
    expect(style.transform).toBe('none');
  });

  it('states the slide height as a class both pages share', () => {
    expect(HERO_SLIDE_MIN_H).toBe(`min-h-[${HERO_GEOMETRY.cardMinHeightPx}px]`);
  });
});

describe('nothing floats over the hero', () => {
  const PAGES = ['src/pages/Progress.jsx', 'src/pages/Nutrition.jsx'];

  it.each(PAGES)('%s has no absolutely-positioned control on the card', async (file) => {
    const fs = await import('fs');
    const src = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')      // strip block comments
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');  // and JSX comments
    // The two shapes the arrow took across its two fixes. Either one
    // returning means a control is floating over the watermark again.
    expect(src, `${file} re-adds a centred floating control`).not.toMatch(/absolute end-3 top-1\/2/);
    expect(src, `${file} re-adds a bottom-anchored floating control`).not.toMatch(/absolute end-3 bottom-3/);
    expect(src, `${file} still imports the retired button`).not.toMatch(/HERO_NEXT_BUTTON/);
  });

  it.each(PAGES)('%s shares the hero height rather than pinning its own', async (file) => {
    const fs = await import('fs');
    const src = fs.readFileSync(file, 'utf8');
    // Anchored to the slide container's padding: the tab bar's
    // `min-h-[48px]` is the Apple HIG tap-target floor and unrelated.
    expect(src, `${file} hardcodes its own hero height`).not.toMatch(/p-4 md:p-5 min-h-\[/);
    expect(src).toMatch(/HERO_SLIDE_MIN_H/);
  });
});

describe('the retired constant stays retired', () => {
  it('is no longer exported', async () => {
    const mod = await import('@/lib/heroChrome');
    expect('HERO_NEXT_BUTTON' in mod).toBe(false);
  });
});
