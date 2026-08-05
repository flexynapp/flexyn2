// src/lib/__tests__/tooltipRegistry.test.js
//
// The registry's header gives two steps for adding a one-shot hint: append a
// constant, then mount <OneShotTooltip id={TOOLTIP.YOUR_ID} …/>. Step 1
// happened five times and step 2 once.
//
// The result was three real, shipped gestures with nothing teaching them —
// pasting "225 x 8" into a weight field, what the PR proximity bar means, and
// double-tap-to-react on a DM — plus a fourth entry describing a gesture that
// did not exist at all.
//
// Nothing caught it because an unmounted tooltip is invisible by construction.
// There is no error, no warning, and the feature still works for anyone who
// already knows the gesture. The only observable is a hint that never appears,
// which is indistinguishable from a hint the user dismissed months ago.
//
// So: every registered ID must have a mount site. This asserts the pairing,
// which is the thing that actually broke.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TOOLTIP } from '@/lib/tooltipRegistry';

const SRC = resolve(process.cwd(), 'src');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (!['node_modules', '__tests__'].includes(entry)) walk(p, out);
    } else if (/\.jsx?$/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

// Every file except the registry itself and the tooltip component.
const sources = walk(SRC).filter(
  (f) => !f.endsWith('lib/tooltipRegistry.js') && !f.endsWith('components/OneShotTooltip.jsx'),
);

const corpus = sources.map((f) => ({ file: f, src: readFileSync(f, 'utf8') }));

describe('tooltip registry — every registered hint is actually mounted', () => {
  it('registers at least one tooltip (guards against an empty-registry pass)', () => {
    expect(Object.keys(TOOLTIP).length).toBeGreaterThan(0);
  });

  for (const [constName, id] of Object.entries(TOOLTIP)) {
    it(`TOOLTIP.${constName} ("${id}") has a mount site`, () => {
      // Matched by CONSTANT NAME rather than string value: every call site
      // uses `id={TOOLTIP.X}`, and searching for the raw slug would miss all
      // of them while matching this registry's own comments.
      const mounts = corpus.filter(({ src }) =>
        new RegExp(`TOOLTIP\\.${constName}\\b`).test(src) && /OneShotTooltip/.test(src),
      );
      expect(
        mounts.map((m) => m.file.slice(m.file.indexOf('/src/') + 1)),
        `TOOLTIP.${constName} is registered but never mounted.\n` +
          `Either mount <OneShotTooltip id={TOOLTIP.${constName}} anchorRef={…}>…\n` +
          `in the component that owns the gesture, or delete the entry — a\n` +
          `registered-but-unmounted hint teaches nobody and nothing warns.`,
      ).not.toHaveLength(0);
    });
  }

  it('no mount references an id that is not registered', () => {
    const registered = new Set(Object.keys(TOOLTIP));
    const unknown = [];
    for (const { file, src } of corpus) {
      for (const m of src.matchAll(/TOOLTIP\.([A-Z0-9_]+)/g)) {
        if (!registered.has(m[1])) {
          unknown.push(`${file.slice(file.indexOf('/src/') + 1)} → TOOLTIP.${m[1]}`);
        }
      }
    }
    // A stale reference is `undefined` at runtime, and OneShotTooltip's
    // `if (!id) return` swallows it — so this fails silently too.
    expect(unknown).toEqual([]);
  });
});
