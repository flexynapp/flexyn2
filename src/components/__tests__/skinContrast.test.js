// Every skin must keep text readable. Two ways a skin can break that, and
// this checks both for every registered skin, in light and dark:
//
//   1. Its own token overrides. Text colours against the surfaces they sit
//      on (background, card, secondary, muted) must clear WCAG AA 4.5:1.
//   2. Its Backdrop. Text sits on the bare background between cards, where
//      the backdrop shows through. The skin declares the strongest ink any
//      backdrop figure may use (`ink` in src/lib/skins.js); text must still
//      clear 4.5:1 over the background mixed with that ink.
//
// It also enforces the one hard rule on what a skin may repaint: never
// --primary or a state hue, because each of those carries a meaning.
//
// Values are read from the CSS files themselves, so a skin cannot pass by
// declaring one number here and shipping another.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SKINS } from '@/lib/skins';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function block(css, selector) {
  const i = css.indexOf(`${selector} {`);
  if (i < 0) return {};
  let depth = 0;
  let j = css.indexOf('{', i);
  const start = j;
  for (; j < css.length; j += 1) {
    if (css[j] === '{') depth += 1;
    if (css[j] === '}') { depth -= 1; if (depth === 0) break; }
  }
  const body = css.slice(start + 1, j);
  const vars = {};
  for (const m of body.matchAll(/--([\w-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/g)) {
    vars[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return vars;
}

function hslToRgb([h, s, l]) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);

const base = read('src/index.css');
const BASE = { light: block(base, ':root'), dark: { ...block(base, ':root'), ...block(base, '.dark') } };

const TEXT_ON = {
  background: ['foreground', 'muted-foreground'],
  card: ['card-foreground', 'muted-foreground'],
  secondary: ['secondary-foreground', 'muted-foreground'],
  muted: ['muted-foreground'],
};
const FORBIDDEN = ['primary', 'success', 'info', 'destructive'];

for (const skin of SKINS) {
  const cssPath = `src/components/skins/${skin.id}/${skin.id}.css`;
  const css = read(cssPath);
  const light = { ...BASE.light, ...block(css, `html[data-skin="${skin.id}"]`) };
  const dark = { ...BASE.dark, ...block(css, `html[data-skin="${skin.id}"]`), ...block(css, `html.dark[data-skin="${skin.id}"]`) };

  describe(`skin "${skin.id}" keeps text readable`, () => {
    it('never repaints --primary or a state hue', () => {
      for (const name of FORBIDDEN) {
        expect(css, `${cssPath} redefines --${name}`).not.toMatch(new RegExp(`--${name}\\s*:`));
      }
    });

    it('declares its backdrop ink', () => {
      expect(skin.ink?.foreground).toBeGreaterThan(0);
      expect(skin.ink?.primary).toBeGreaterThan(0);
    });

    for (const [mode, t] of [['light', light], ['dark', dark]]) {
      it(`${mode}: text clears 4.5:1 on every surface`, () => {
        for (const [surface, texts] of Object.entries(TEXT_ON)) {
          for (const text of texts) {
            const c = contrast(hslToRgb(t[text]), hslToRgb(t[surface]));
            expect(c, `${mode} --${text} on --${surface} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      });

      it(`${mode}: text clears 4.5:1 over the backdrop at its declared ink`, () => {
        const bg = hslToRgb(t.background);
        const grounds = {
          foregroundInk: mix(bg, hslToRgb(t.foreground), skin.ink.foreground),
          primaryInk: mix(bg, hslToRgb(t.primary), skin.ink.primary),
        };
        for (const [name, ground] of Object.entries(grounds)) {
          for (const text of TEXT_ON.background) {
            const c = contrast(hslToRgb(t[text]), ground);
            expect(c, `${mode} --${text} over ${name} = ${c.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      });
    }
  });
}
