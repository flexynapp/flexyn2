// src/lib/__tests__/listMotion.test.js
//
// Guards the shape in src/lib/listMotion.js and the two things a future edit
// is most likely to undo without noticing, because neither throws and neither
// shows up in a screenshot of a settled page — they only show while the grid
// is mid-transition.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { LIST_PRESENCE, listItemMotion } from '@/lib/listMotion';

/** Every .jsx under src/, tests excluded. */
function jsxFiles(dir = resolve(process.cwd(), 'src'), out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== '__tests__') jsxFiles(p, out);
    } else if (name.endsWith('.jsx')) out.push(p);
  }
  return out;
}

/** Body of each `<AnimatePresence …>` block, with its opening attributes. */
function presenceBlocks(s) {
  const found = [];
  for (const m of s.matchAll(/<AnimatePresence([^>]*)>/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (depth && i < s.length) {
      const open = s.indexOf('<AnimatePresence', i);
      const close = s.indexOf('</AnimatePresence>', i);
      if (close === -1) break;
      if (open !== -1 && open < close) { depth++; i = open + 16; }
      else { depth--; i = close + 18; }
    }
    found.push({ attrs: m[1], body: s.slice(m.index + m[0].length, i), at: m.index });
  }
  return found;
}

const src = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

// Comments in this codebase quote the patterns they warn against — the feed
// explains at length why the row is no longer a `motion.div layout`. Match
// against code only, or the guard fires on its own documentation.
const code = (p) => src(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')     // /* … */ and JSX {/* … */} bodies
  .replace(/^\s*\/\/.*$/gm, '');        // // …

describe('LIST_PRESENCE', () => {
  it('uses popLayout so exiting cards leave the flow immediately', () => {
    // sync (the default) keeps them in flow, which makes every survivor
    // animate to a position that is wrong until the exits unmount, then
    // animate again. That double move is the choppiness.
    expect(LIST_PRESENCE.mode).toBe('popLayout');
  });

  it('does not animate the first paint', () => {
    expect(LIST_PRESENCE.initial).toBe(false);
  });
});

describe('listItemMotion', () => {
  it('animates position only — these tiles never change size', () => {
    expect(listItemMotion().layout).toBe('position');
  });

  it('does not animate scale on exit', () => {
    // A scale exit forces size-delta work on an element that is leaving
    // anyway, and under popLayout it scales an absolutely-positioned box.
    expect(listItemMotion().exit).not.toHaveProperty('scale');
  });

  it('carries an explicit transition rather than the default layout spring', () => {
    const t = listItemMotion().transition;
    expect(t).toBeTruthy();
    expect(t.duration).toBeGreaterThan(0);
    expect(t.duration).toBeLessThanOrEqual(0.25);
  });

  it('expresses dimming as an animation target, not a class', () => {
    // framer writes opacity inline and inline beats a class, so an
    // `opacity-50` className on a motion element silently does nothing —
    // which is why the marketplace SOLD stamp rendered at full brightness.
    expect(listItemMotion({ dim: true }).animate.opacity).toBe(0.5);
    expect(listItemMotion().animate.opacity).toBe(1);
  });
});

describe('the marketplace grid keeps the shape', () => {
  const feed = code('src/components/market/MarketplaceFeed.jsx');
  const card = code('src/components/market/ListingCard.jsx');

  it('does not put a CSS opacity transition on a card framer animates', () => {
    // Every inline opacity write restarts the CSS transition, so the render
    // lags the animation and the fade smears.
    expect(card).not.toMatch(/transition-opacity/);
  });

  it('leaves the listings row a plain element, not a layout projection node', () => {
    expect(feed).not.toMatch(/<motion\.div\s+layout/);
  });

  it('positions the rows that host popLayout exits', () => {
    // popLayout measures offsetTop/offsetLeft, which need a positioned
    // ancestor or exiting cards jump.
    expect(feed).toMatch(/LISTING_ROW\s*=[^;]*\brelative\b/s);
    expect(feed).toMatch(/grid grid-cols-2 sm:grid-cols-3 gap-3 relative/);
  });

  it('hands ListingCard a memoized props object', () => {
    // memo() on the card is worthless if the parent mints a new props object
    // every render.
    expect(feed).toMatch(/const cardProps = useMemo\(/);
    expect(card).toMatch(/export default memo\(ListingCard\)/);
  });

  it('keeps the previous sort on screen while the next one loads', () => {
    expect(feed).toMatch(/placeholderData: keepPreviousData/);
  });
});

// The two rules from listMotion.js, enforced across the app. A sweep found 12
// candidate collections and only 4 wanted popLayout; both of these mistakes
// are silent — nothing throws, and a screenshot of a settled page looks fine.
describe('popLayout is only used where it is correct', () => {
  const files = jsxFiles();

  it('finds files to check', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('is never used on a list whose exit collapses height', () => {
    // `exit={{ opacity: 0, height: 0 }}` is a deliberate in-flow collapse —
    // the row shrinks and its neighbours slide up to meet it. popLayout takes
    // the row out of flow, so there is nothing left to collapse and the
    // neighbours snap instead.
    const offenders = [];
    for (const f of files) {
      for (const b of presenceBlocks(readFileSync(f, 'utf8'))) {
        if (!b.attrs.includes('popLayout')) continue;
        if (/exit=\{\{[^}]*\bheight\b/.test(b.body)) {
          offenders.push(f.replace(process.cwd() + '/', ''));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('is never used inside a space-y container', () => {
    // space-y puts margin-top on each child after the first. popLayout pins
    // an exiting child at `top: <its offsetTop>` and does not zero margins,
    // and offsetTop already counts that margin — so it lands twice and the
    // item drops one space step as it leaves. flex/grid `gap` belongs to the
    // parent and cannot double-count.
    const offenders = [];
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      for (const b of presenceBlocks(s)) {
        if (!b.attrs.includes('popLayout')) continue;
        // The nearest className above the presence tag is its container.
        const before = s.slice(Math.max(0, b.at - 600), b.at);
        const classNames = [...before.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)];
        const nearest = classNames.at(-1);
        const cls = nearest ? (nearest[1] ?? nearest[2]) : '';
        if (/\bspace-y-\d/.test(cls)) {
          offenders.push(`${f.replace(process.cwd() + '/', '')} → ${cls.trim().slice(0, 60)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
