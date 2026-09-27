// What is left of the hero chrome: the accent HeroPager colours its dots
// with. The watermark, tint and fade tests went with the Dashboard band
// (hero option D, 2026-09-27); these check the retired exports stay retired
// so a revert of one file cannot bring back half of the old band.

import { describe, it, expect } from 'vitest';
import { heroSlideAccent, ICON_BG_TO_HSL } from '@/lib/heroChrome';

describe('heroSlideAccent', () => {
  it('prefers an explicit colour, then the icon chip, then brand', () => {
    expect(heroSlideAccent({ color: 'var(--info)', iconBg: 'bg-success/20' })).toBe('var(--info)');
    expect(heroSlideAccent({ iconBg: 'bg-success/20' })).toBe('var(--success)');
    expect(heroSlideAccent({ iconBg: 'bg-unknown' })).toBe('var(--primary)');
    expect(heroSlideAccent(null)).toBe('var(--primary)');
  });

  it('maps only the four budget hues', () => {
    expect(Object.values(ICON_BG_TO_HSL).sort()).toEqual(
      ['var(--destructive)', 'var(--info)', 'var(--primary)', 'var(--success)'],
    );
  });
});

describe('the retired chrome stays retired', () => {
  it('no longer exports the band, the watermark or the old chevron', async () => {
    const mod = await import('@/lib/heroChrome');
    for (const name of ['HERO_NEXT_BUTTON', 'heroTintGradient', 'HERO_FADE_GRADIENT', 'heroWatermarkStyle', 'HERO_SLIDE_GUTTER']) {
      expect(name in mod).toBe(false);
    }
  });
});
