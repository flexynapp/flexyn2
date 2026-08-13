// src/components/__tests__/headerSafeArea.test.js
//
// The mobile header is NOT 56px tall. Header.jsx is `fixed top-0` with
// `paddingTop: env(safe-area-inset-top)` wrapped around an h-14 row, so its
// real height is `56px + env(safe-area-inset-top)` — 115px on a Dynamic
// Island iPhone and 56px on a desktop where the inset is 0.
//
// So anything that positions itself against the header has to carry the
// inset. A bare `top-14` / `pt-[56px]` is correct on every machine a
// developer looks at and wrong on every phone the app ships to, by exactly
// the inset. That asymmetry is why this bug class survives review, and it
// has now landed twice:
//
//   • Layout's <main> padded a flat 56px, so the top ~59px of EVERY page sat
//     under the header. It surfaced as the Dashboard's stories rail being
//     clipped — the rail is `items-end`, so note bubbles and "+ Add" pills
//     grow upward into exactly that band, and they were invisible until an
//     overscroll bounce dragged them out.
//   • MarketFilterBar stuck at `top-14`, i.e. 59px underneath the header,
//     which its own comment describes as the bug it was added to fix.
//
// The correct form is always `calc(56px + env(safe-area-inset-top))` (or
// `3.5rem`). `lg:` variants are exempt — the header is `lg:hidden` and the
// inset is 0 on a desktop.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Header-height offsets written as a bare constant, with no inset alongside.
// `lg:`-prefixed ones are stripped before matching.
const BARE_OFFSET = /(?<!lg:)\b(?:pt|top)-(?:14|\[56px\]|\[3\.5rem\])(?![\w[])/;

const ALLOWED = new Map([
  // Nothing today. Add a file here only with the reason its offset is
  // genuinely unrelated to the mobile header.
]);

/** Strip comments so the prose describing this bug doesn't trip the rule. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/^(__tests__|locales|test)$/.test(entry.name)) sourceFiles(p, out);
    } else if (/\.jsx$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

describe('offsets against the mobile header carry the safe-area inset', () => {
  it('has no bare 56px header offset', () => {
    const offenders = [];

    for (const file of sourceFiles(SRC)) {
      const rel = path.relative(path.resolve(SRC, '..'), file);
      if (ALLOWED.has(rel)) continue;

      const code = stripComments(fs.readFileSync(file, 'utf8'));
      // Match line by line so the report names something findable.
      code.split('\n').forEach((line, i) => {
        if (BARE_OFFSET.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }

    expect(
      offenders,
      'These offset against the mobile header using a bare 56px, which is '
      + 'short by env(safe-area-inset-top) on every notched phone. Use '
      + 'calc(56px + env(safe-area-inset-top)) — e.g. '
      + 'pt-[calc(56px+env(safe-area-inset-top))].',
    ).toEqual([]);
  });

  it("Layout's <main> reserves the header's real height", () => {
    const layout = fs.readFileSync(path.join(SRC, 'components/Layout.jsx'), 'utf8');
    const main = layout.match(/<main className="([^"]+)"/)?.[1] ?? '';

    expect(main, 'Layout.jsx <main> className').toContain(
      'pt-[calc(56px+env(safe-area-inset-top))]',
    );
    // The bottom inset was already right; keep it that way.
    expect(main).toContain('env(safe-area-inset-bottom)');
  });
});
