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

  // Kegan, 2026-09-30: no title anywhere in the app is all caps. The hero
  // keeps its condensed face and sets its words as written.
  it('keeps the condensed face for the hero style, never in capitals', () => {
    const block = rule(read('src/index.css'), 'font-hero');
    expect(block).toMatch(/font-family:\s*var\(--font-display\)/);
    expect(block).not.toMatch(/text-transform/);
    expect(block).toMatch(/font-weight:\s*800/);
  });

  // Kegan, 2026-10-02: the market listing read as vibe coded because
  // .stamp set its set number in the condensed face, a voice no other
  // in-app screen used. The condensed face is .font-hero's alone.
  it('reaches the condensed face only through .font-hero', () => {
    const css = read('src/index.css');
    const users = [];
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (/var\(--font-display\)/.test(m[2])) users.push(m[1].trim().split('\n').pop().trim());
    }
    expect(users).toEqual(['.font-hero']);
    const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(rel);
      return /\.jsx?$/.test(e.name) ? [rel] : [];
    });
    // An inline style or a canvasFont(…, 'display') is the same leak by a
    // different door.
    expect(walk('src').filter((f) => /--font-display|canvasFont\([^)]*['"]display['"]/.test(read(f)))).toEqual([]);
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

  // Small tracked labels (eyebrows, kickers, .stamp) stay in capitals. A
  // title is anything set at xl or larger, and none of those may be.
  it('sets no title-sized text in capitals', () => {
    const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(rel);
      return /\.jsx$/.test(e.name) ? [rel] : [];
    });
    const offenders = [];
    for (const f of walk('src')) {
      for (const cls of read(f).match(/className="[^"]*"/g) || []) {
        if (/\buppercase\b/.test(cls) && /\b(?:sm:|md:)?text-(?:xl|[2-9]xl|display|title)\b/.test(cls)) offenders.push(`${f}: ${cls}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Kegan, 2026-10-02: small spaced capitals above a group ("ASKING",
  // "TODAY'S DROP") are one of the loudest tells of a generated app. A
  // label is .eyebrow (a small heading) or .kicker (a quiet label), both
  // sentence case. Capitals survive only on chips and badges (a short tag
  // on a filled or outlined shape, like LIVE or NEW) and in the arcade
  // games, whose HUD is a game look.
  it('sets no small label in spaced capitals', () => {
    const games = /HeavyBird|SweatJetpack|SnakeGame/;
    // The My Bag redesign (claude/bag-collection-redesign-7sdpyj) rewrites
    // UserBag and deletes CollectionModal, so their labels are left to it
    // rather than edited twice. Drop these two once that branch lands.
    const pending = new Set(['src/components/hub/UserBag.jsx', 'src/components/loot/CollectionModal.jsx']);
    const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(rel);
      return /\.jsx$/.test(e.name) ? [rel] : [];
    });
    const offenders = [];
    for (const f of walk('src').filter((x) => !games.test(x) && !pending.has(x))) {
      for (const m of read(f).matchAll(/(["'`])((?:(?!\1)[^\n])*?\buppercase\b(?:(?!\1)[^\n])*?)\1/g)) {
        const toks = m[2].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/);
        const small = toks.some((t) => /^text-(?:micro|caption|xs|label|\[\d+px\])$/.test(t));
        // A chip is a SHAPE: a fill, an outline or a rounded edge. Padding
        // alone is not one, which is how the Settings group headings
        // (px-1, nothing else) passed as chips while reading as labels.
        const chip = toks.some((t) => /^(?:bg-|rounded|border(?:$|-(?![bltrsexy]-|[bltrsexy]$)))/.test(t));
        if (small && !chip) offenders.push(`${f}: ${m[2].slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps both label styles in sentence case with no letter spacing', () => {
    const css = read('src/index.css');
    for (const cls of ['eyebrow', 'kicker']) {
      const block = css.match(new RegExp(`\\.${cls}\\b[^{]*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(block, `.${cls}`).not.toBe('');
      expect(block).not.toMatch(/text-transform|letter-spacing:\s*0?\.[1-9]|letter-spacing:\s*[1-9]/);
    }
  });
});
