import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// .font-hero sets the onboarding lines in Sofia Sans Extra Condensed, a
// family of its own on Google Fonts. If it drops out of the index.html
// request nothing throws: the computed font-family still names it and every
// hero line silently falls back to Arial Narrow or plain sans. Only the
// source can say the face is being asked for, and at the weight .font-hero
// sets. .font-display, the in-app title, is sentence case on purpose.
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

  const rule = (css, cls) => {
    const found = css.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`, 'g')) || [];
    expect(found, `exactly one .${cls} rule`).toHaveLength(1);
    return found[0];
  };

  it('keeps in-app titles in the text face and sentence case', () => {
    const block = rule(read('src/index.css'), 'font-display');
    expect(block).toMatch(/font-family:\s*var\(--font-heading\)/);
    expect(block).not.toMatch(/text-transform/);
  });

  it('keeps the condensed capitals for the hero style only', () => {
    const block = rule(read('src/index.css'), 'font-hero');
    expect(block).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(block).toMatch(/text-transform:\s*uppercase/);
    expect(block).toMatch(/font-weight:\s*800/);
  });

  it('uses the hero style on onboarding and sign in, nowhere else', () => {
    const allowed = new Set(['src/pages/Onboarding.jsx', 'src/pages/SignInToContinue.jsx']);
    const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(rel);
      return /\.jsx?$/.test(e.name) ? [rel] : [];
    });
    const users = walk('src').filter((f) => /\bfont-hero\b/.test(read(f)));
    expect(users.filter((f) => !allowed.has(f))).toEqual([]);
    for (const f of allowed) expect(users).toContain(f);
  });
});
