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
 * That grid is also the reason the failure message below says not to snap
 * on sight. The plain square turned out to be the look kegan had reviewed
 * and approved, so the fix there was to WRITE THE PLAIN SQUARE OUT
 * (`iconTile` in Workout.jsx) and delete the dead classes. Restoring the
 * tint the source asked for would have been a design change nobody
 * requested. Finding a dead class tells you the element is not rendering
 * what it says; it does not tell you which of the two is wrong.
 *
 * This scans SOURCE rather than the built CSS deliberately: it names the
 * file and line to fix, runs in milliseconds, and needs no build step.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

// The scale is READ FROM THE CONFIG, not hardcoded, because the config is
// what decides. `theme.opacity` currently resolves to Tailwind v3's default
// 0–100 in steps of five and tailwind.config.js does not extend it — but a
// hardcoded copy would go wrong in both directions the moment it did:
// extending the scale would make this guard flag classes that now render
// (false positives, which get the guard disabled), and narrowing it would
// make the guard bless classes that stopped rendering. `createRequire` is
// used because tailwind.config.js is CommonJS and Vite will not interop a
// `module.exports` in a project source file.
//
// TAILWIND V4 CHANGES WHAT THIS TEST MEANS. v3 resolves a slash modifier
// against this scale and emits NOTHING when it misses. v4 accepts any value
// — verified on 4.3.3, where /18, /22, /28 and /33 all generate a rule. So
// on v4 nothing here is dead, and every off-scale class in this repo lights
// up at once on the upgrade commit. That is a visual diff, not a no-op:
// re-read the hits this guard reports before bumping, because each one is a
// surface that has been rendering untinted since it was written.
const require_ = createRequire(import.meta.url);
const resolveConfig = require_('tailwindcss/resolveConfig');

// tailwind.config.js is CommonJS under a `"type": "module"` package.json, so
// neither `import` nor `createRequire` will load it — Node reads the .js as
// ESM and dies on `module.exports`. Tailwind's own `loadConfig` works by
// bundling jiti, which is a lot of machinery to drag into a unit test. The
// config is a plain object literal with one `require`, so evaluating it as
// the CJS module it is takes six lines and no dependency.
function loadTailwindConfig() {
  const file = path.resolve(__dirname, '../../../tailwind.config.js');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__dirname', '__filename',
    fs.readFileSync(file, 'utf8'),
  )(mod, mod.exports, require_, path.dirname(file), file);
  return mod.exports;
}

const SCALE = new Set(
  Object.keys(resolveConfig(loadTailwindConfig()).theme.opacity).map(Number),
);

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
//
// This strips comments rather than skipping lines that START with a marker,
// which is what it did first and which is not enough: the interesting
// comments here are JSX `{/* … */}` blocks, and only their opening line
// begins with a marker. Every continuation line read as code, so explaining
// WHY a tile is plain — necessarily by naming the dead class it used to
// carry — tripped the guard on the explanation. Under the old rule the only
// way to document one of these was to misspell it.
function stripComments(src) {
  return src
    // Block comments, `{/* … */}` included. Blanked instead of removed so
    // the line numbers this test reports still point at the real line.
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    // Trailing `//`. The `[^:]` guard leaves `https://…` alone.
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const ROOT = path.resolve(__dirname, '../..');   // src/

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'locales') continue;   // i18n catalogs, not code
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
    const lines = stripComments(fs.readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
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
      'These emit NO CSS at all — an off-scale slash value produces no rule.\n' +
      'DO NOT reflexively snap them to the nearest step. Each one is a surface\n' +
      'that has been rendering UNTINTED, possibly for months, so the plain look\n' +
      'may be the one that was reviewed and approved — snapping is then a visible\n' +
      'change nobody asked for. That happened once already, on the Workout grid.\n' +
      'Decide per site, then write the decision out literally:\n' +
      '  tint  → use a step that exists (/20), or bg-primary/[18%] if exact\n' +
      '  plain → `border border-border`, and delete the dead class\n  ' +
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

  // The scale is derived, so a config that failed to resolve would silently
  // redefine "off-scale" for every assertion here. Pin the derivation too.
  it('derives its scale from tailwind.config.js', () => {
    expect(SCALE.size).toBeGreaterThan(1);
    expect([...SCALE].every(Number.isFinite)).toBe(true);
    expect(SCALE.has(20)).toBe(true);
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

  // Prose naming a dead class is the normal way to document why a surface is
  // plain, so the guard has to read past it. This fixture is the real comment
  // from the Crew Wars tile in Workout.jsx, which failed the guard before
  // stripComments learned about multi-line blocks.
  it('does not flag a class named inside a multi-line JSX comment', () => {
    const src = [
      '            {/* Crew Wars was the one tile whose border was half-alive:',
      '                `bg-primary/22` emitted nothing but `border-primary/35` did,',
      '                so it rendered an orange outline around an empty square. */}',
      '            <div className={iconTile}>',
    ].join('\n');
    const hits = [...stripComments(src).matchAll(PATTERN)]
      .filter((m) => !SCALE.has(Number(m[2])));
    expect(hits).toEqual([]);
  });

  it('still sees a real class on the same line a comment ends', () => {
    const src = '<div /* why */ className="bg-primary/18" />';
    const hits = [...stripComments(src).matchAll(PATTERN)].map((m) => m[0]);
    expect(hits).toEqual(['bg-primary/18']);
  });

  it('does not mistake a URL for a comment', () => {
    const src = 'const doc = "https://tailwindcss.com"; const c = "bg-primary/18";';
    const hits = [...stripComments(src).matchAll(PATTERN)].map((m) => m[0]);
    expect(hits).toEqual(['bg-primary/18']);
  });

  it('does not flag layout fractions', () => {
    const line = '<div className="w-1/2 top-1/2 left-1/3 basis-2/3" />';
    expect([...line.matchAll(PATTERN)]).toEqual([]);
  });
});
