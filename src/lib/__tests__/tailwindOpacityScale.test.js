/**
 * A colour-opacity class must sit on Tailwind's scale, or it renders nothing.
 *
 * Tailwind's `opacity` scale runs in steps of five. `bg-primary/18` is not
 * on it, and an off-scale slash value produces NO CSS RULE — it does not
 * warn, it does not fall back, it just silently doesn't exist. The element
 * renders with no background and looks merely plain, which is why 67 of
 * these survived across 25 files: every one of them looks like working
 * code, and the only place the truth shows is the built stylesheet.
 *
 * The worst of them was on the Workout page's grid, where every card's
 * icon tile was `bg-primary/18 border border-primary/28` — so nine
 * navigation tiles had no icon tint and no icon border from the day they
 * shipped. It was found by copying those classes into the cardio tiles
 * and then grepping dist for them, not by looking at the screen.
 *
 * This scans SOURCE rather than the built CSS deliberately: it names the
 * file and line to fix, runs in milliseconds, and needs no build step.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Tailwind v3's default opacity scale. tailwind.config.js does not extend
// it — if that ever changes, this constant has to change with it, and the
// test below will start passing things it should not.
const SCALE = new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65,
  70, 75, 80, 85, 90, 95, 100]);

// Colour utilities that take an opacity modifier. `shadow-` is excluded:
// `shadow-lg/25` is valid but rare here, and including it adds no coverage.
const UTIL = '(?:bg|text|border|ring|from|to|via|fill|stroke|divide|outline|placeholder|accent|caret|decoration)';

// The `(?<![\w-])` prefix is load-bearing and was added after a first pass
// reported five false positives:
//
//   slide-in-from-start-1/2   tailwindcss-animate's translate FRACTION,
//   slide-out-to-start-1/2    where 1/2 means 50% and has nothing to do
//                             with colour. Only the leading `-` tells them
//                             apart from a `from-`/`to-` gradient stop.
//
// The trailing (?![\w/]) stops `text-rank-1/2/3` — a token that appears in
// prose — from matching as `text-rank-1/2`.
const PATTERN = new RegExp(`(?<![\\w-])(${UTIL}-[a-z]+(?:-[a-z0-9]+)*)/(\\d+)(?![\\w/])`, 'g');

// A line of prose describing a class is not a class. The `text-rank-1/2/3`
// hit above lived in a comment, which is the same trap CLAUDE.md warns
// about under "before treating a grep hit as debt, read the comments".
const COMMENT = /^\s*(\/\/|\*|\/\*)/;

const ROOT = path.resolve(__dirname, '../..');   // src/

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'i18n-langs') continue;   // generated
    // Test files are skipped, and this one is why: the fixtures below
    // contain `bg-primary/18` deliberately, so scanning tests makes the
    // guard fail on its own evidence. Nothing in __tests__ ships as UI.
    if (entry.name === '__tests__') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(jsx?|tsx?)$/.test(entry.name)) out.push(p);
  }
  return out;
}

function findOffScale() {
  const hits = [];
  for (const file of walk(ROOT)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (COMMENT.test(line)) return;
      for (const m of line.matchAll(PATTERN)) {
        const n = Number(m[2]);
        if (!SCALE.has(n)) {
          hits.push(`${path.relative(ROOT, file)}:${i + 1}  ${m[1]}/${n}`);
        }
      }
    });
  }
  return hits;
}

describe('Tailwind colour-opacity classes render something', () => {
  it('has no off-scale opacity anywhere in src/', () => {
    const hits = findOffScale();
    expect(
      hits,
      'These emit NO CSS at all — Tailwind\'s opacity scale runs in steps of 5.\n' +
      'Snap each to the nearest step (18 → 20, 12 → 10, 8 → 10, 3 → 5), or use\n' +
      'bracket syntax like bg-primary/[0.18] if the exact value genuinely matters:\n  ' +
      hits.join('\n  '),
    ).toEqual([]);
  });

  // Guards the guard. If the pattern stops matching, the test above passes
  // for the wrong reason — silently, and forever.
  it('still detects an off-scale value when one is present', () => {
    const line = '<div className="bg-primary/18 border border-primary/28" />';
    const found = [...line.matchAll(PATTERN)].map(m => `${m[1]}/${m[2]}`);
    expect(found).toEqual(['bg-primary/18', 'border-primary/28']);
    expect(found.every(f => !SCALE.has(Number(f.split('/')[1])))).toBe(true);
  });

  it('does not flag on-scale values', () => {
    const line = '<div className="bg-primary/20 border-primary/30 text-white/5" />';
    const offScale = [...line.matchAll(PATTERN)].filter(m => !SCALE.has(Number(m[2])));
    expect(offScale).toEqual([]);
  });

  it('does not flag tailwindcss-animate translate fractions', () => {
    // The five false positives from the first pass. `1/2` here is 50% of a
    // translate, not 1% opacity.
    const line = 'data-[state=open]:slide-in-from-start-1/2 data-[state=closed]:slide-out-to-start-1/2';
    expect([...line.matchAll(PATTERN)]).toEqual([]);
  });

  it('does not flag layout fractions', () => {
    const line = '<div className="w-1/2 top-1/2 left-1/3 basis-2/3" />';
    expect([...line.matchAll(PATTERN)]).toEqual([]);
  });
});
