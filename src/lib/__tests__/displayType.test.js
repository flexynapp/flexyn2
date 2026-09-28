import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// .font-display sets page titles in Sofia Sans Extra Condensed, a family of
// its own on Google Fonts. If it drops out of the index.html request nothing
// throws: the computed font-family still names it and every title silently
// falls back to Arial Narrow or plain sans. Only the source can say the face
// is being asked for, and at the weight .font-display sets.
const root = path.resolve(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('display type', () => {
  it('loads the condensed display face at a range that covers 800', () => {
    const m = read('index.html').match(/family=Sofia\+Sans\+Extra\+Condensed:wght@(\d+)\.\.(\d+)/);
    expect(m, 'Sofia Sans Extra Condensed must be requested').not.toBeNull();
    expect(Number(m[1])).toBeLessThanOrEqual(800);
    expect(Number(m[2])).toBeGreaterThanOrEqual(800);
  });

  it('loads the text face across every weight the app uses', () => {
    const m = read('index.html').match(/family=Sofia\+Sans:wght@(\d+)\.\.(\d+)/);
    expect(m, 'Sofia Sans must be requested').not.toBeNull();
    expect(Number(m[1])).toBeLessThanOrEqual(300);
    expect(Number(m[2])).toBeGreaterThanOrEqual(900);
  });

  it('points the three type tokens at the loaded faces', () => {
    const css = read('src/index.css');
    expect(css).toMatch(/--font-display:\s*'Sofia Sans Extra Condensed'/);
    expect(css).toMatch(/--font-heading:\s*'Sofia Sans'/);
    expect(css).toMatch(/--font-body:\s*'Sofia Sans'/);
  });

  it('defines one .font-display on the display face that uppercases', () => {
    const css = read('src/index.css');
    const block = css.match(/\.font-display\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(block[1]).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(block[1]).toMatch(/text-transform:\s*uppercase/);
    expect(block[1]).toMatch(/font-weight:\s*800/);
    expect(css.match(/\.font-display\s*\{/g)).toHaveLength(1);
  });
});
