// Regenerates src/locales/_coverage.json — the committed per-locale baseline
// the no-regression guard measures against.
//
// Run it when a change intentionally moves the numbers:
//   npm run i18n:baseline
//
// Two counts per locale, both absolute, neither a ratio:
//
//   translated  keys the locale defines. Must never go DOWN — that is a
//               locale losing copy it already had, which is always a bug.
//
//   englishEcho keys the locale defines with the byte-identical English
//               value. Must never go UP — that is English pasted in as a
//               placeholder and counted as progress. Cognates ("Cardio" in
//               Spanish) live in i18n-check.js's allow-lists and are the
//               reason this is a ratchet rather than an assertion of zero.
//
// Why counts and not a percentage: a ratio falls whenever `en` grows, so
// extracting a hardcoded English string INTO a key — strictly an improvement,
// since it makes the string translatable and visible to every audit — read as
// a regression. The old floor worked around that with a 431-line list of
// exempt prefixes, each needing a justification comment and a later deletion.
// Counting the numerator alone makes the whole apparatus unnecessary:
// adding English copy cannot move `translated` at all.
//
// Two APP-WIDE counts sit alongside the per-locale pair, and they exist
// because the pair above cannot see the two largest sources of English on a
// translated screen — both are outside en.json, so they are outside the
// numerator AND the denominator of every per-locale number here:
//
//   untranslatable  keys referenced in source but absent from en.json. The
//                   call site's English default is the only value that can
//                   ever resolve, in all 15 languages, forever. No locale
//                   file can carry the key, so no translator ever sees it.
//
//   hardcoded       strings that never reached a catalog at all.
//
// Both must never RISE. Adding a key to en.json moves a string from
// `untranslatable` into the translatable pool, which is the fix; shipping a
// new tFallback for a key nobody added is what this stops. Spanish read
// 99.4% while the dashboard rendered "Your daily chest is ready" in English
// because nothing counted these.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DIR = 'src/locales';
const LANGS = ['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','tr','pl','nl'];
const OTHERS = LANGS.filter((l) => l !== 'en');

const load = (l) => JSON.parse(fs.readFileSync(path.join(DIR, `${l}.json`), 'utf8'));
const en = load('en');
const hasLetters = (v) => /\p{L}/u.test(String(v));

// Parsed from source, not imported: i18n-check.js pulls in ./i18n, which
// dynamic-imports every locale aggregate. Same parse the guard uses.
const CHECK_SRC = fs.readFileSync(path.join('src/lib', 'i18n-check.js'), 'utf8');
const GLOBAL_IDENTICAL = (() => {
  const m = CHECK_SRC.match(/const ALLOW_IDENTICAL = new Set\(\[([\s\S]*?)\]\);/);
  return new Set(m ? [...m[1].matchAll(/'([\w.]+)'/g)].map((x) => x[1]) : []);
})();
const cognates = (l) => {
  const m = CHECK_SRC.match(
    new RegExp(`^ {2}${l}: new Set\\(\\[([\\s\\S]*?)\\]\\),`, 'm'),
  );
  const own = m ? [...m[1].matchAll(/'([\w.]+)'/g)].map((x) => x[1]) : [];
  return new Set([...GLOBAL_IDENTICAL, ...own]);
};

const locales = {};
for (const l of OTHERS) {
  const d = load(l);
  const keys = Object.keys(d);
  locales[l] = {
    translated: keys.length,
    // Cognates excluded, matching src/lib/__tests__/i18nCoverage.test.js.
    // A generator and its guard measuring different things is how a
    // baseline silently grants slack: the guard would compare a
    // cognate-adjusted count against a raw ceiling and pass on anything.
    englishEcho: keys.filter(
      (k) => en[k] != null && d[k] === en[k] && hasLetters(en[k]) && !cognates(l).has(k),
    ).length,
  };
}

// Referenced with an English default, absent from en.json. Same scan as
// scripts/i18n-audit.mjs section A2 and the guard in i18nCoverage.test.js.
function scanUntranslatable() {
  const fallback = new Set();
  const bare = new Set();
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!/__tests__|node_modules|locales/.test(e.name)) walk(p);
        continue;
      }
      if (!/\.jsx?$/.test(e.name) || /^i18n-/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // tF / tf aliases included — see the note in scripts/i18n-audit.mjs.
      for (const m of src.matchAll(/\b(?:tFallback|tF|tf)\(\s*['"`]([\w.]+)['"`]\s*,/g)) fallback.add(m[1]);
      // Keys held as <name>Key data properties — see the note in
      // scripts/i18n-audit.mjs. The call site passes a variable, so a
      // scan anchored on the call cannot see these at all.
      for (const m of src.matchAll(/\w*Key:\s*'([\w.]+)'/g)) if (m[1].includes('.')) fallback.add(m[1]);
      for (const m of src.matchAll(/\bt\(\s*['"`]([\w.]+)['"`]\s*\)(?!\s*(?:\|\||\?\?))/g)) bare.add(m[1]);
    }
  })('src');
  return [...new Set([...fallback, ...bare])].filter((k) => !(k in en) && fallback.has(k)).length;
}

const untranslatable = scanUntranslatable();
const hardcoded = new Set(
  JSON.parse(execFileSync('node', ['scripts/i18n-hardcoded.mjs', '--json'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  })).map((f) => `${f.file}:${f.line}:${f.text}`),
).size;

const out = {
  $comment:
    'Committed per-locale baseline for the i18n no-regression guard. ' +
    '`translated` must never decrease; `englishEcho` must never increase. ' +
    '`untranslatable` and `hardcoded` are app-wide and must never increase. ' +
    'Regenerate deliberately with `npm run i18n:baseline` and say why in the commit.',
  sourceKeys: Object.keys(en).length,
  // The honest denominator: every user-visible string, not just the ones a
  // catalog happens to contain. Quote coverage against THIS, never against
  // sourceKeys alone.
  untranslatable,
  hardcoded,
  userVisibleStrings: Object.keys(en).length + untranslatable + hardcoded,
  locales,
};
fs.writeFileSync(path.join(DIR, '_coverage.json'), JSON.stringify(out, null, 2) + '\n');

console.log(`source (en): ${out.sourceKeys} keys`);
console.log(`untranslatable: ${untranslatable}   hardcoded: ${hardcoded}`);
console.log(`user-visible total: ${out.userVisibleStrings}\n`);
console.log('locale  translated  englishEcho');
for (const [l, v] of Object.entries(locales)) {
  console.log(`  ${l}   ${String(v.translated).padStart(8)}  ${String(v.englishEcho).padStart(10)}`);
}
console.log('\nwrote src/locales/_coverage.json');
