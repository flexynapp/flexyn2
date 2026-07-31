// App-wide i18n coverage guards.
//
// These lock the invariants that produce visible damage, and deliberately
// do NOT assert 100% coverage — the app ships some features English-only
// on purpose (see CLAUDE.md's out-of-scope list), so a "no gaps" test
// would just get skipped past.
//
// The failure modes, worst first:
//
//   1. A key resolving to NOTHING. getTranslation falls back
//      `language → en → the raw key`, so a key absent from `en` too
//      renders its own path — "challenge.duration" on a button. This must
//      stay at zero.
//   2. A PARTIAL gap: translated in ten languages, missing in four. Shows
//      as one English line inside an otherwise-translated screen. Tracked
//      with a ratchet so it can shrink but not silently grow.
//
// `node scripts/i18n-audit.mjs` reports the same data in detail;
// `--partial` lists exactly which keys and languages.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const LANGS = ['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','tr','pl','nl'];
const OTHERS = LANGS.filter(l => l !== 'en');
const DIR = 'src/lib/i18n-langs';

const keys = Object.fromEntries(LANGS.map(l => [
  l,
  new Set([...fs.readFileSync(path.join(DIR, `${l}.js`), 'utf8').matchAll(/"([^"]+)":/g)].map(m => m[1])),
]));
const en = keys.en;

/** Every bare `t('key')` in the app, with comments stripped. */
function collectCallSites() {
  const bare = new Map();
  const safe = new Set();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!/__tests__|node_modules|i18n-langs/.test(e.name)) walk(p);
        continue;
      }
      if (!/\.jsx?$/.test(e.name) || /^i18n-/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const m of src.matchAll(/\btFallback\(\s*['"]([\w.]+)['"]\s*,/g)) safe.add(m[1]);
      for (const m of src.matchAll(/\bt\(\s*['"]([\w.]+)['"]\s*\)(?!\s*(?:\|\||\?\?))/g)) {
        if (!bare.has(m[1])) bare.set(m[1], new Set());
        bare.get(m[1]).add(p.replace(/^src\//, ''));
      }
    }
  })('src');
  return { bare, safe };
}

describe('no key can render as a raw key path', () => {
  it('every bare t() call resolves to something', () => {
    const { bare, safe } = collectCallSites();
    const unresolvable = [...bare.keys()]
      .filter(k => !en.has(k) && !safe.has(k))
      .map(k => `${k} (${[...bare.get(k)].join(', ')})`)
      .sort();
    // A bare t('x') with no English definition puts the literal string
    // 'x' on screen. Either add it to a part file or switch the call to
    // tFallback('x', 'English').
    expect(unresolvable).toEqual([]);
  });
});

describe('every language file is loadable and non-trivial', () => {
  it.each(LANGS)('%s has a populated aggregate', (lang) => {
    expect(keys[lang].size).toBeGreaterThan(1000);
  });

  it('no language has keys English lacks', () => {
    // The reverse direction: a key only in `es` is dead weight nothing
    // can reach, since every call site is written against the English set.
    for (const l of OTHERS) {
      const orphans = [...keys[l]].filter(k => !en.has(k));
      expect(orphans, `${l} has keys absent from en: ${orphans.slice(0, 5).join(', ')}`).toEqual([]);
    }
  });
});

describe('partial-gap ratchet', () => {
  // Keys translated in SOME languages but not others. Unlike an
  // English-only feature (missing everywhere, usually deliberate), these
  // are oversights. The ceiling only ever moves down — lower it when you
  // close gaps so the improvement is locked in.
  //
  // 55 after clearing eleven namespaces. The enKeys-aliasing root cause
  // is now gone entirely and guarded by the test below, so what remains
  // here is ordinary partial coverage rather than that class of bug.
  const CEILING = 55;

  it(`has no more than ${CEILING} partial gaps`, () => {
    const partial = [...en].filter(k => {
      const missing = OTHERS.filter(l => !keys[l].has(k)).length;
      return missing > 0 && missing < OTHERS.length;
    });
    expect(
      partial.length,
      `partial gaps went up. Run: node scripts/i18n-audit.mjs --partial`
    ).toBeLessThanOrEqual(CEILING);
  });

  it('coverage does not regress below 80% in any language', () => {
    for (const l of OTHERS) {
      const covered = [...en].filter(k => keys[l].has(k)).length;
      const pct = covered / en.size;
      expect(pct, `${l} coverage fell to ${(pct * 100).toFixed(1)}%`).toBeGreaterThan(0.80);
    }
  });
});

describe('no language may be aliased to the English object', () => {
  // THE bug of this whole cleanup, found eight times across nine files.
  // A part file that does `it: enKeys, ko: enKeys, …` reports 100% key
  // coverage to any presence-based audit while rendering pure English to
  // those users. notifications, formcoach, gauntlet, marketplace,
  // discovery, league, generator, coach and share all shipped this way.
  //
  // The shortcut is understandable — it makes a namespace "complete"
  // instantly — but it is indistinguishable from finished work unless
  // you compare VALUES, which is why it survived so long. This test
  // makes the shortcut fail loudly instead.
  //
  // If you genuinely want a language to fall back to English, delete the
  // key from that language entirely. getTranslation already resolves
  // `language -> en -> key`, so omission gives you the English fallback
  // AND stays visible to the audit as a real gap.
  it('no i18n part file maps a non-English locale to enKeys', () => {
    const dir = 'src/lib';
    const offenders = [];
    for (const f of fs.readdirSync(dir).filter(x => /^i18n-.*\.js$/.test(x))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const hits = src.match(/\b(es|fr|de|pt|it|ja|ko|zh|ar|hi|ru|tr|pl|nl)\s*:\s*enKeys\b/g);
      if (hits) offenders.push(`${f} (${hits.length}: ${hits.join(', ')})`);
    }
    expect(
      offenders,
      'A locale aliased to enKeys looks translated but renders English. ' +
      'Either translate it, or omit the keys so the fallback is visible.'
    ).toEqual([]);
  });
});

describe('the i18n-check allow-lists stay honest', () => {
  // src/lib/i18n-check.js suppresses "untranslated" warnings for two
  // reasons: universal codes/units, and per-language cognates. Both are
  // load-bearing — a checker that cries wolf gets ignored, and it was
  // emitting 366 warnings before these were populated.
  //
  // But an allow-list is also the easiest place to hide a real gap, so
  // these two tests bound it in both directions.
  const src = fs.readFileSync(path.join('src/lib', 'i18n-check.js'), 'utf8');
  const NON_LATIN = ['ja', 'ko', 'zh', 'ar', 'hi', 'ru'];

  const perLang = {};
  for (const m of src.matchAll(/^ {2}(es|fr|de|pt|it|tr|pl|nl|ja|ko|zh|ar|hi|ru): new Set\(\[([\s\S]*?)\]\),/gm)) {
    perLang[m[1]] = [...m[2].matchAll(/'([\w.]+)'/g)].map(x => x[1]);
  }

  it('never allow-lists a cognate for a non-Latin-script language', () => {
    // A Japanese, Korean, Chinese, Arabic, Hindi or Russian value that
    // equals the English one cannot be a coincidence — different script.
    // It is always an untranslated string, so it must always warn.
    const bad = NON_LATIN.filter(l => perLang[l]?.length);
    expect(
      bad,
      `cognate allow-list must not cover non-Latin scripts: ${bad.join(', ')}`
    ).toEqual([]);
  });

  it('has no stale entries — every allow-listed cognate is still identical', () => {
    // If a key gets translated later, its allow-list entry becomes dead
    // weight that would silently suppress a future regression.
    const stale = [];
    for (const [lang, keys] of Object.entries(perLang)) {
      const dict = Object.fromEntries(
        [...fs.readFileSync(path.join(DIR, `${lang}.js`), 'utf8')
          .matchAll(/"((?:[^"\\]|\\.)+)":\s*"((?:[^"\\]|\\.)*)"/g)].map(m => [m[1], m[2]])
      );
      const enDict = Object.fromEntries(
        [...fs.readFileSync(path.join(DIR, 'en.js'), 'utf8')
          .matchAll(/"((?:[^"\\]|\\.)+)":\s*"((?:[^"\\]|\\.)*)"/g)].map(m => [m[1], m[2]])
      );
      for (const k of keys) {
        if (dict[k] !== undefined && enDict[k] !== undefined && dict[k] !== enDict[k]) {
          stale.push(`${lang}:${k}`);
        }
      }
    }
    expect(stale, `remove these from ALLOW_IDENTICAL_BY_LANG: ${stale.join(', ')}`).toEqual([]);
  });
});
