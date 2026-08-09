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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  TOOLTIP, countSeenTooltips, resetAllSeenTooltips, markTooltipSeen, hasSeenTooltip,
} from '@/lib/tooltipRegistry';

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

// ── The reset path ────────────────────────────────────────────────────────
//
// The hints are once-per-device forever, which is the right default and a
// dead end the moment you want one back — on a new phone, showing someone
// the app, or checking a hint still points where it should.
// `resetAllSeenTooltips` existed for exactly that from the start and had
// ZERO callers until Settings → Help got a row, so nothing had ever
// exercised it. These cover what that row depends on: an honest count (it
// decides whether the row is even tappable) and a wipe that reports what it
// actually did.

describe('tooltip registry — bringing the hints back', () => {
  const ID_A = Object.values(TOOLTIP)[0];
  const ID_B = Object.values(TOOLTIP)[1];

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('counts nothing on a device that has seen nothing', () => {
    expect(countSeenTooltips()).toBe(0);
    expect(resetAllSeenTooltips()).toBe(0);
  });

  it('counts only seen hints, and clears every one', () => {
    markTooltipSeen(ID_A);
    markTooltipSeen(ID_B);
    expect(countSeenTooltips()).toBe(2);
    expect(hasSeenTooltip(ID_A)).toBe(true);

    expect(resetAllSeenTooltips()).toBe(2);
    expect(countSeenTooltips()).toBe(0);
    expect(hasSeenTooltip(ID_A)).toBe(false);
    expect(hasSeenTooltip(ID_B)).toBe(false);
  });

  it('leaves every other localStorage key alone', () => {
    // The wipe is prefix-scoped. It shares localStorage with the rest of the
    // app's per-device state (flexyn.restDay.*, flexyn.onboardingState.*,
    // the sign-out preserve set), and a broad clear here would quietly log
    // someone out of their own preferences.
    localStorage.setItem('flexyn.restDay.abc.2026-08-09', '1');
    localStorage.setItem('unrelated', 'keep me');
    markTooltipSeen(ID_A);

    expect(resetAllSeenTooltips()).toBe(1);
    expect(localStorage.getItem('flexyn.restDay.abc.2026-08-09')).toBe('1');
    expect(localStorage.getItem('unrelated')).toBe('keep me');
  });
});
