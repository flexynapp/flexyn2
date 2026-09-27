// Every skin must fit around the content, never on top of it. The old
// themes cut content off because their decorations were painted above the
// page. This holds the structure that makes that impossible, for every
// registered skin:
//
//   1. There is no slot above the page. Figures go in the Backdrop, which
//      sits behind content (-z-10) and never takes a tap.
//   2. Anything that sits beside content (the NavEdge row) RESERVES its
//      room: the skin declares --skin-nav-edge, Layout adds it to the page's
//      bottom padding and to --nav-h (so every "above the nav" control moves
//      up too), and the row clips to that height so it cannot outgrow it.
//   3. Backdrop figures take their strength from the skin's declared `ink`,
//      never from a literal, so skinContrast.test.js is checking the numbers
//      that actually ship.
//
// Structural checks over source, because CI has no browser. A new skin that
// breaks one of these fails here with the reason.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { SKINS } from '@/lib/skins';
import { SKIN_PARTS, SKIN_SLOTS } from '../skins/parts';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const skinDir = (id) => `src/components/skins/${id}`;
const filesIn = (rel) => fs.readdirSync(path.join(ROOT, rel)).map((f) => `${rel}/${f}`);

// The file in a skin's folder whose default export is the given part.
function sourceOf(id, component) {
  const hit = filesIn(skinDir(id))
    .filter((f) => /\.jsx?$/.test(f))
    .find((f) => new RegExp(`export default function ${component.name}\\b`).test(read(f)));
  if (!hit) throw new Error(`${id}: could not find the source of ${component.name}`);
  return read(hit);
}

describe('skins fit around content', () => {
  it('has no slot that paints above the page', () => {
    for (const slot of SKIN_SLOTS) expect(slot).not.toMatch(/overlay|foreground|top/i);
    for (const [id, parts] of Object.entries(SKIN_PARTS)) {
      for (const k of Object.keys(parts)) expect(SKIN_SLOTS, `${id} exports unknown slot ${k}`).toContain(k);
    }
  });

  it('Layout reserves the NavEdge room below content and above the nav', () => {
    expect(read('src/components/Layout.jsx')).toMatch(/<main[^>]*pb-\[calc\([^\]]*var\(--skin-nav-edge,0px\)\)\]/);
    expect(read('src/index.css')).toMatch(/--nav-h:\s*calc\([^;]*var\(--skin-nav-edge,\s*0px\)\)/);
  });

  it('never counts the NavEdge room twice', () => {
    // --nav-h already includes --skin-nav-edge. Adding it again lifts
    // whatever is anchored to the nav by that much, into the page.
    const offenders = [];
    for (const dir of ['src/components/skins', 'src/components', 'src/pages']) {
      const walk = (rel) => {
        for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
          const r = `${rel}/${e.name}`;
          if (e.isDirectory()) { if (e.name !== '__tests__') walk(r); continue; }
          if (/\.(jsx?|css)$/.test(e.name) && /var\(--nav-h\)[^\]\n]*\+\s*var\(--skin-nav-edge/.test(read(r))) offenders.push(r);
        }
      };
      walk(dir);
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  for (const skin of SKINS) {
    const parts = SKIN_PARTS[skin.id] || {};
    const css = read(`${skinDir(skin.id)}/${skin.id}.css`);

    describe(skin.id, () => {
      it('declares its ink so contrast can be checked', () => {
        expect(skin.ink?.foreground).toBeGreaterThan(0);
        expect(skin.ink?.primary).toBeGreaterThan(0);
      });

      it('puts its Backdrop behind the page, untappable', () => {
        if (!parts.Backdrop) return;
        const src = sourceOf(skin.id, parts.Backdrop);
        expect(src).toMatch(/className="[^"]*\bfixed\b[^"]*-z-10[^"]*pointer-events-none/);
        expect(src).toMatch(/aria-hidden="true"/);
      });

      it('draws Backdrop figures at its declared ink, never a literal strength', () => {
        if (!parts.Backdrop) return;
        const sources = filesIn(skinDir(skin.id))
          .filter((f) => /\.jsx$/.test(f))
          .map((f) => [f, read(f)])
          .filter(([, s]) => /Backdrop|ornament/i.test(s));
        for (const [f, s] of sources) {
          // opacity="0.3", opacity: 0.3, opacity-30, / 0.3 alpha in a colour
          const literal = s.match(/opacity\s*[=:]\s*["'{]?\s*0?\.\d|opacity-\d|\/\s*0?\.\d+\)/);
          const inBackdrop = /export default function \w*Backdrop/.test(s) || /ornaments/.test(f);
          if (inBackdrop) expect(literal, `${f} sets a literal strength: ${literal?.[0]}`).toBeNull();
        }
      });

      it('reserves room for its NavEdge and stays inside it', () => {
        if (!parts.NavEdge) return;
        const m = css.match(/--skin-nav-edge:\s*(\d+)px/);
        expect(m, `${skin.id}.css must declare --skin-nav-edge`).not.toBeNull();
        const reserved = Number(m[1]);

        const src = sourceOf(skin.id, parts.NavEdge);
        expect(src, 'NavEdge must be exactly the reserved height').toMatch(/h-\[var\(--skin-nav-edge,0px\)\]/);
        expect(src, 'NavEdge must clip what overflows').toMatch(/overflow-hidden/);
        expect(src).toMatch(/pointer-events-none/);

        // Sizes in the row, where the part exports them, must fit the room.
        const list = src.match(/export const \w+ = \[([\d,\s]+)\]/);
        if (list) {
          const sizes = list[1].split(',').map(Number).filter(Boolean);
          expect(Math.max(...sizes)).toBeLessThanOrEqual(reserved);
        }
      });

      it('a skin without a NavEdge reserves nothing', () => {
        if (parts.NavEdge) return;
        expect(css).not.toMatch(/--skin-nav-edge/);
      });
    });
  }
});
