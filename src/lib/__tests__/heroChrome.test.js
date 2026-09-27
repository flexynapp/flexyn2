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

// 'nothing floats over the hero' lived here and pinned Progress and
// Nutrition to the shared carousel chrome. Both pages dropped their carousel
// for a focal goal (hero option D, 2026-09-27), so there is no hero card on
// either for a control to float over.

describe('the retired constant stays retired', () => {
  it('is no longer exported', async () => {
    const mod = await import('@/lib/heroChrome');
    expect('HERO_NEXT_BUTTON' in mod).toBe(false);
  });
});
