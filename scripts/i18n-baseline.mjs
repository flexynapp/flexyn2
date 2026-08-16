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
import fs from 'node:fs';
import path from 'node:path';

const DIR = 'src/locales';
const LANGS = ['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','tr','pl','nl'];
const OTHERS = LANGS.filter((l) => l !== 'en');

const load = (l) => JSON.parse(fs.readFileSync(path.join(DIR, `${l}.json`), 'utf8'));
const en = load('en');
const hasLetters = (v) => /\p{L}/u.test(String(v));

// Parsed from source, not imported: i18n-check.js pulls in ./i18n, which
// dynamic-imports every locale aggregate. Same parse the guard uses.
const CHECK_SRC = fs.readFileSync(path.join('src/lib', 'i18n-check.js'), 'utf8');
const cognates = (l) => {
  const m = CHECK_SRC.match(
    new RegExp(`^ {2}${l}: new Set\\(\\[([\\s\\S]*?)\\]\\),`, 'm'),
  );
  return new Set(m ? [...m[1].matchAll(/'([\w.]+)'/g)].map((x) => x[1]) : []);
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

const out = {
  $comment:
    'Committed per-locale baseline for the i18n no-regression guard. ' +
    '`translated` must never decrease; `englishEcho` must never increase. ' +
    'Regenerate deliberately with `npm run i18n:baseline` and say why in the commit.',
  sourceKeys: Object.keys(en).length,
  locales,
};
fs.writeFileSync(path.join(DIR, '_coverage.json'), JSON.stringify(out, null, 2) + '\n');

console.log(`source (en): ${out.sourceKeys} keys\n`);
console.log('locale  translated  englishEcho');
for (const [l, v] of Object.entries(locales)) {
  console.log(`  ${l}   ${String(v.translated).padStart(8)}  ${String(v.englishEcho).padStart(10)}`);
}
console.log('\nwrote src/locales/_coverage.json');
