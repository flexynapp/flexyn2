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
});
