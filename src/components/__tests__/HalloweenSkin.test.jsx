import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import { SKINS } from '@/lib/skins';

const halloween = SKINS.find((s) => s.id === 'halloween');
let ctx = null;
vi.mock('@/lib/ThemeContext', () => ({ useTheme: () => ctx }));

import SkinSlot from '../skins/SkinSlot';
import { SKIN_PARTS, SKIN_SLOTS } from '../skins/parts';
import { PLANTED } from '../skins/halloween/graveyard';

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

  it('every lit shape fills a hole cut for it, so glow never stacks on other ink', () => {
    for (const f of PLANTED.filter((p) => p.lantern)) expect(f.d.endsWith(f.face)).toBe(true);
    const crow = PLANTED.find((p) => p.kind === 'scarecrow');
    expect(crow.eyes).toHaveLength(2);
    for (const e of crow.eyes) expect(crow.head).toContain(`M${e.x} ${e.y}h${e.w}v${e.h}h${-e.w}Z`);
    on();
    render(<SkinSlot name="Backdrop" />);
    const glow = screen.getByTestId('halloween-glow');
    expect(glow.style.opacity).toBe(String(halloween.ink.glow));
    const lids = [...screen.getByTestId('halloween-backdrop').querySelectorAll('rect.hw-lid')];
    const eyes = [...glow.querySelectorAll('rect.hw-eye')];
    expect(lids).toHaveLength(2);
    const box = (r) => ['x', 'y', 'width', 'height'].map((a) => r.getAttribute(a)).join();
    expect(lids.map(box)).toEqual(eyes.map(box));
  });

  it('eyelid and eye close on one clock, so together they always fill the hole once', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../skins/halloween/halloween.css'), 'utf8');
    const stops = (name) => {
      const body = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))[1];
      const out = {};
      for (const [, pcts, v] of body.matchAll(/([\d%,\s]+)\{\s*transform:\s*scaleY\(([\d.]+)\)/g)) {
        for (const p of pcts.split(',').map((x) => x.trim()).filter(Boolean)) out[p] = Number(v);
      }
      return out;
    };
    const lid = stops('hw-lid');
    const eye = stops('hw-eye');
    expect(Object.keys(lid).sort()).toEqual(Object.keys(eye).sort());
    for (const k of Object.keys(lid)) expect(lid[k] + eye[k]).toBe(1);
    const rule = (cls) => css.match(new RegExp(`\\.${cls} \\{([^}]*)\\}`))[1];
    const clock = (cls) => rule(cls).match(/animation: hw-\w+ ([\d.]+s) linear infinite/)[1];
    expect(clock('hw-lid')).toBe(clock('hw-eye'));
  });

  it('the scarecrow blinks at uneven moments, not on a beat', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../skins/halloween/halloween.css'), 'utf8');
    const body = css.match(/@keyframes hw-lid \{([\s\S]*?)\n\}/)[1];
    const shut = body.match(/([\d%,\s]+)\{\s*transform:\s*scaleY\(1\)/)[1].split(',').map((p) => parseFloat(p));
    expect(shut.length).toBeGreaterThanOrEqual(3);
    const gaps = shut.slice(1).map((p, i) => p - shut[i]).concat(100 - shut.at(-1) + shut[0]);
    expect(new Set(gaps).size).toBe(gaps.length);
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
