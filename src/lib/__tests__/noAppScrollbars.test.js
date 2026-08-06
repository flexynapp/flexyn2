// The app paints no scrollbars. Scrolling is a swipe on iOS and Android and a
// wheel or trackpad on desktop; the only bar we want anywhere is the
// browser's own document scrollbar, which the base rule leaves alone.
//
// This is a stylesheet rule, so the guard is a stylesheet check: it fails if
// a component starts styling ::-webkit-scrollbar again, which is how the two
// market dialogs came to draw their own thin bars inside modals.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const SOURCE = walk('src').filter(f => /\.(jsx?|css)$/.test(f));

describe('no app-drawn scrollbars', () => {
  it('hides scrollbars everywhere except the document', () => {
    const css = readFileSync('src/index.css', 'utf8');
    expect(css).toContain('*:not(html):not(body)::-webkit-scrollbar');
    expect(css).toMatch(/\*:not\(html\):not\(body\)\s*\{[^}]*scrollbar-width:\s*none/);
  });

  it('leaves html and body to the browser', () => {
    const css = readFileSync('src/index.css', 'utf8');
    // A bare `*::-webkit-scrollbar` would take the document scrollbar with it,
    // and once the stylesheet owns scrollbar rendering there is no value that
    // hands it back.
    expect(css).not.toMatch(/(^|[\s,])\*::-webkit-scrollbar/);

    // Nor may the document itself be told to hide its bar.
    const rootSelectors = new Set(['html', 'body', 'html, body', 'body, html', '*', ':root']);
    const hidesOnRoot = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector, body]) =>
      /scrollbar-width:\s*none/.test(body) && rootSelectors.has(selector.trim()));
    expect(hidesOnRoot).toEqual([]);
  });

  it('has no component drawing a scrollbar of its own', () => {
    const offenders = SOURCE.filter((file) => {
      if (file.endsWith('index.css')) return false;         // the rule itself
      if (file.endsWith('noAppScrollbars.test.js')) return false;  // this guard
      const src = readFileSync(file, 'utf8');
      // Width/colour/thumb styling means something is being painted. Hiding
      // (`display:none`, `scrollbar-width: none`) is not.
      return /scrollbar-thumb|scrollbar-track|scrollbarColor|scrollbarWidth:\s*'thin'|\[&::-webkit-scrollbar\]:w-/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
