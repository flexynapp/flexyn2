import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SKINS } from '@/lib/skins';

const halloween = SKINS.find((s) => s.id === 'halloween');
let ctx = null;
vi.mock('@/lib/ThemeContext', () => ({ useTheme: () => ctx }));

import SkinSlot from '../skins/SkinSlot';
import { SKIN_PARTS, SKIN_SLOTS } from '../skins/parts';

describe('skin slots', () => {
  it('render nothing unless a skin is in season AND on', () => {
    for (const c of [null, { skin: null, skinOn: true }, { skin: halloween, skinOn: false }]) {
      ctx = c;
      const { container, unmount } = render(<><SkinSlot name="Backdrop" /><SkinSlot name="NavEdge" /></>);
      expect(container.innerHTML).toBe('');
      unmount();
    }
  });

  it('every registered skin has a data entry and only known slots', () => {
    for (const [id, parts] of Object.entries(SKIN_PARTS)) {
      expect(SKINS.some((s) => s.id === id)).toBe(true);
      for (const k of Object.keys(parts)) expect(SKIN_SLOTS).toContain(k);
    }
  });
});

describe('Halloween parts', () => {
  const on = () => { ctx = { skin: halloween, skinOn: true }; };

  it('backdrop sits behind the page and never takes taps', () => {
    on();
    render(<SkinSlot name="Backdrop" />);
    const el = screen.getByTestId('halloween-backdrop');
    expect(el.className).toContain('-z-10');
    expect(el.className).toContain('pointer-events-none');
  });

  it('the pumpkin patch fills the nav edge', () => {
    on();
    render(<SkinSlot name="NavEdge" />);
    const el = screen.getByTestId('pumpkin-patch');
    expect(el.className).toContain('pointer-events-none');
    expect(el.querySelectorAll('svg').length).toBeGreaterThan(10);
  });

  it('jack o lanterns are clipped to the sky, so they never stack on the ground ink', () => {
    on();
    render(<SkinSlot name="Backdrop" />);
    const lanterns = screen.getByTestId('halloween-lanterns');
    const id = lanterns.getAttribute('clip-path').match(/url\(#(.+)\)/)[1];
    expect(document.getElementById(id)).not.toBeNull();
    expect(lanterns.querySelectorAll('path[fill-rule="evenodd"]').length).toBe(2);
  });

  it('flyover movers use a physical inset, since the lane itself mirrors in RTL', () => {
    // .hw-motion is scaleX(-1) under [dir=rtl]. A start-0 inside it flips a
    // second time: measured, the witch began 110px on screen and flew off
    // the left edge in two seconds instead of crossing from the right.
    on();
    render(<SkinSlot name="Backdrop" />);
    const movers = screen.getByTestId('halloween-backdrop').querySelectorAll('.hw-motion .hw-fly');
    expect(movers.length).toBeGreaterThan(0);
    for (const m of movers) {
      expect(m.getAttribute('class')).toMatch(/\bleft-0\b/);
      expect(m.getAttribute('class')).not.toMatch(/\bstart-0\b/);
    }
  });
});
