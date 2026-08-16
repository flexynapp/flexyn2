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
const DIR = 'src/locales';

const keys = Object.fromEntries(LANGS.map(l => [
  l,
  new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(DIR, `${l}.json`), 'utf8')))),
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
        if (!/__tests__|node_modules|locales/.test(e.name)) walk(p);
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

describe('coverage does not go backwards', () => {
  // Keys translated in SOME languages but not others — oversights, as opposed
  // to an English-only feature that is missing everywhere on purpose.
  //
  // Scoped to the RELEASED locales, which is the change that keeps it
  // meaningful. It used to measure all fourteen, on the assumption that they
  // advanced together. They do not any more: locales are shelved and finished
  // one at a time, so the moment Spanish reached 99.6% while thirteen shelved
  // catalogs sat at ~38%, nearly every key in the app became "partial" and the
  // count went from 55 to 2,369. That number described the release policy
  // rather than any defect.
  //
  // Between locales the app actually offers, a gap IS a defect — a user picks
  // Spanish and gets an English string. That is what this counts now.
  const RELEASED = JSON.parse(fs.readFileSync(path.join(DIR, '_meta.json'), 'utf8'))
    .released.locales.filter(l => l !== 'en');
  const CEILING = 55;

  it(`has no more than ${CEILING} partial gaps among released locales`, () => {
    const partial = [...en].filter(k => {
      const missing = RELEASED.filter(l => !keys[l].has(k)).length;
      return missing > 0 && missing < RELEASED.length;
    });
    expect(
      partial.length,
      `partial gaps went up. Run: node scripts/i18n-audit.mjs --partial`
    ).toBeLessThanOrEqual(CEILING);
  });

  // ── NO-REGRESSION GUARD ────────────────────────────────────────────────
  //
  // Replaces a 0.79 floor over a ratio, and the 431-line AWAITING_TRANSLATION
  // list that floor needed in order to stay meaningful.
  //
  // That list existed for a real reason, stated in its own header: the ratio
  // fell whenever `en` grew, so extracting a hardcoded English string INTO a
  // key read as a regression — penalising the one workflow that makes a
  // string translatable at all, and rewarding leaving copy hardcoded in JSX
  // where no audit can see it. Every exempt prefix was a hand-written apology
  // for that, carrying a justification comment and owing a later deletion.
  //
  // Counting the numerator alone removes the cause rather than the symptom.
  // `translated` is how many keys a locale defines; adding English copy
  // cannot move it, so extraction is free and the exemptions are unnecessary.
  // The numbers live in src/locales/_coverage.json and are regenerated with
  // `npm run i18n:baseline` — a deliberate act that shows up as a diff, which
  // is what the prefix list was reaching for.
  //
  // Two directions, because there are two ways to go backwards:
  //   translated  must not FALL — a locale losing copy it already had.
  //   englishEcho must not RISE — English pasted in as a placeholder and
  //                               counted as though it were a translation.
  const baseline = JSON.parse(fs.readFileSync(path.join(DIR, '_coverage.json'), 'utf8'));
  const dict = (l) => JSON.parse(fs.readFileSync(path.join(DIR, `${l}.json`), 'utf8'));
  const enDict = dict('en');
  const hasLetters = (v) => /\p{L}/u.test(String(v));

  // A COGNATE IS NOT A PLACEHOLDER, and this used to count them as one.
  // `echoCount` read the locale JSON flat and never consulted
  // ALLOW_IDENTICAL_BY_LANG — so "Cardio", "Level", "ml" and "{n}×" all
  // scored against German exactly as a pasted English sentence would.
  // The failure message even said "real cognates belong in
  // ALLOW_IDENTICAL_BY_LANG", which was advice that could not work:
  // adding them there changed nothing this test measured.
  //
  // The practical effect was backwards. Translating MORE of a locale
  // surfaces MORE cognates, so a push that took German 67% -> 90% made
  // this number rise and read as a regression — penalising the work it
  // exists to protect, which is the same trap the AWAITING_TRANSLATION
  // list fell into and that the block above was written to escape.
  //
  // Parsed from source rather than imported: i18n-check.js pulls in
  // ./i18n, which dynamic-imports every locale aggregate. The two tests
  // at the foot of this file already parse it the same way, and they are
  // what keeps the list honest (no non-Latin scripts, no stale entries).
  const checkSrc = fs.readFileSync(path.join('src/lib', 'i18n-check.js'), 'utf8');
  const cognates = (l) => {
    const m = checkSrc.match(
      new RegExp(`^ {2}${l}: new Set\\(\\[([\\s\\S]*?)\\]\\),`, 'm'),
    );
    return new Set(m ? [...m[1].matchAll(/'([\w.]+)'/g)].map((x) => x[1]) : []);
  };

  const echoCount = (l) => {
    const d = dict(l);
    const ok = cognates(l);
    return Object.keys(d).filter(
      (k) => enDict[k] != null && d[k] === enDict[k] && hasLetters(enDict[k])
             && !ok.has(k),
    ).length;
  };

  it('every supported locale has a baseline entry', () => {
    // A locale with no entry is unguarded — silently, and forever.
    expect(Object.keys(baseline.locales).sort()).toEqual([...OTHERS].sort());
  });

  it.each(OTHERS)('%s has not lost translated keys', (lang) => {
    const now = keys[lang].size;
    const was = baseline.locales[lang].translated;
    expect(
      now,
      `${lang} fell from ${was} to ${now} translated keys. A locale losing copy ` +
      'it already had is a bug, not a baseline change. If the drop is intended ' +
      '(dead keys deleted, say), run `npm run i18n:baseline` and say why in the commit.',
    ).toBeGreaterThanOrEqual(was);
  });

  it.each(OTHERS)('%s has not gained English placeholders', (lang) => {
    const now = echoCount(lang);
    const was = baseline.locales[lang].englishEcho;
    expect(
      now,
      `${lang} went from ${was} to ${now} keys holding the English string verbatim. ` +
      'That is a key which exists and a translation which does not — invisible to ' +
      'any coverage count, and English on screen. Cognates are already excluded ' +
      'via ALLOW_IDENTICAL_BY_LANG in i18n-check.js, so add one there ONLY if the ' +
      'value is genuinely the same word in that language — otherwise translate it.',
    ).toBeLessThanOrEqual(was);
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
      const dict = JSON.parse(fs.readFileSync(path.join(DIR, `${lang}.json`), 'utf8'));
      const enDict = JSON.parse(fs.readFileSync(path.join(DIR, 'en.json'), 'utf8'));
      for (const k of keys) {
        if (dict[k] !== undefined && enDict[k] !== undefined && dict[k] !== enDict[k]) {
          stale.push(`${lang}:${k}`);
        }
      }
    }
    expect(stale, `remove these from ALLOW_IDENTICAL_BY_LANG: ${stale.join(', ')}`).toEqual([]);
  });
});
