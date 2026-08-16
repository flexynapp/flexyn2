#!/usr/bin/env node
//
// i18n audit — what is and isn't translated, across all 15 languages.
//
//   node scripts/i18n-audit.mjs            summary
//   node scripts/i18n-audit.mjs --partial  keys translated in SOME languages
//                                          but missing in others (the bugs)
//   node scripts/i18n-audit.mjs --lang ja  one language's missing keys
//
// Reads the catalogs in src/locales/, which ARE the source of truth and what
// the app actually loads. There is no build step to run first — the old
// part-file layout needed one, because a key's English half and its
// translations could live in different files and only the splitter merged
// them. One flat catalog per language retires that.
//
// ── Related: src/lib/i18n-check.js ───────────────────────────────────
// A DEV-only runtime checker already exists and covers the same two
// passes (missing keys, English-identical values). This script is the
// CLI/CI counterpart — it needs no browser and can gate a build. Where
// they overlap they should agree, so the cognate exclusions below are
// kept in sync with that file's ALLOW_IDENTICAL set. If you add an
// intentional same-in-every-language key, add it in BOTH places.
//
// ── How to read the output ───────────────────────────────────────────
//
// A key missing in a language is NOT a crash. getTranslation() falls back
// `language → en → the raw key`, so a gap renders ENGLISH inside an
// otherwise-translated screen. Only a key missing from `en` too would show
// a raw key path to a user, and section A exists to prove that count stays
// at zero.
//
// The number that matters is PARTIAL gaps. A key missing from all 14
// non-English languages is usually a deliberate English-only feature (see
// CLAUDE.md's out-of-scope list). A key present in 10 languages and absent
// in 4 is an oversight, and it shows up as one English line in the middle
// of a translated screen.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const LANGS = ['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','tr','pl','nl'];
const OTHERS = LANGS.filter(l => l !== 'en');
const DIR = 'src/locales';

const args = process.argv.slice(2);
const wantPartial = args.includes('--partial');
const wantUntranslatable = args.includes('--untranslatable');
const langArg = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null;

function loadEntries(lang) {
  return JSON.parse(fs.readFileSync(path.join(DIR, `${lang}.json`), 'utf8'));
}

function loadKeys(lang) {
  const file = path.join(DIR, `${lang}.json`);
  if (!fs.existsSync(file)) {
    console.error(`missing catalog: ${file}`);
    process.exit(1);
  }
  return new Set(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))));
}

const keys = Object.fromEntries(LANGS.map(l => [l, loadKeys(l)]));
const en = keys.en;

// ── A. keys used in code that `en` does not define ───────────────────
//
// Two different failures, and this script used to see only the first.
//
//   A1 UNRESOLVABLE   bare t('x'), 'x' absent from `en`. getTranslation
//                     bottoms out at `return enVal ?? key`, so the user
//                     reads the literal key path. Loud, rare, fatal.
//
//   A2 UNTRANSLATABLE tFallback('x', 'English'), 'x' absent from `en`.
//                     This was previously counted as SAFE and excluded
//                     outright — the comment said "tFallback is always
//                     safe". Safe against a raw key path, yes. But the
//                     fallback is the ONLY value that can ever resolve:
//                     no catalog defines the key, `en` included, so
//                     every locale falls through to the English literal
//                     at the call site. It renders English in all 15
//                     languages, permanently, and no translator can
//                     reach it — the string is not in a file they get.
//
// A2 is invisible to coverage BY CONSTRUCTION. Coverage counts a locale's
// keys against `en.json`; these keys are not in `en.json`, so they are
// absent from the numerator and the denominator alike. That is how the
// Spanish dashboard could read 99.4% while rendering "Your daily chest is
// ready" — dashboard.dailyChest.title has never existed as a key.
const usedBare = new Map();
const usedFallback = new Map();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/__tests__|node_modules|locales/.test(e.name)) walk(p);
      continue;
    }
    if (!/\.jsx?$/.test(e.name) || /^i18n-/.test(e.name)) continue;
    const src = fs.readFileSync(p, 'utf8')
      // strip comments so documentation examples aren't read as call sites
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const rel = p.replace(/^src\//, '');
    // Backticks included: a template literal with no ${} is a constant key,
    // and several call sites write one. A key WITH ${} is computed and
    // cannot be checked statically — `[\w.]+` excludes those by not
    // matching `$`, `{` or `}`.
    // `tF` and `tf` are real aliases here, not hypothetical: Dashboard.jsx
    // builds its section headings as `(tF) => tF('dashboard.section.friends',
    // 'Friends this week')`. Matching only the full name missed 21 call
    // sites — including every one of the dashboard's section titles, which
    // is the "most titles are all english still" Kegan reported.
    for (const m of src.matchAll(/\b(?:tFallback|tF|tf)\(\s*['"`]([\w.]+)['"`]\s*,/g)) {
      if (!usedFallback.has(m[1])) usedFallback.set(m[1], new Set());
      usedFallback.get(m[1]).add(rel);
    }
    for (const m of src.matchAll(/\bt\(\s*['"`]([\w.]+)['"`]\s*\)(?!\s*(?:\|\||\?\?))/g)) {
      if (!usedBare.has(m[1])) usedBare.set(m[1], new Set());
      usedBare.get(m[1]).add(rel);
    }
  }
})('src');

const unresolvable = [...usedBare.keys()]
  .filter(k => !en.has(k) && !usedFallback.has(k)).sort();

// Referenced with an English default, absent from `en`. Union of both call
// forms: a key can be tFallback'd in one file and bare-t'd in another, and
// it is untranslatable either way once `en` lacks it.
const untranslatable = [...new Set([...usedFallback.keys(), ...usedBare.keys()])]
  .filter(k => !en.has(k) && usedFallback.has(k)).sort();

const untranslatableBy = (k) =>
  [...new Set([...(usedFallback.get(k) || []), ...(usedBare.get(k) || [])])];

// ── B. per-key gaps ──────────────────────────────────────────────────
const gaps = new Map();
for (const k of en) {
  const missing = OTHERS.filter(l => !keys[l].has(k));
  if (missing.length) gaps.set(k, missing);
}
const englishOnly = [...gaps.entries()].filter(([, m]) => m.length === OTHERS.length);
const partial     = [...gaps.entries()].filter(([, m]) => m.length < OTHERS.length);

// ── output ───────────────────────────────────────────────────────────
if (langArg) {
  if (!LANGS.includes(langArg)) { console.error(`unknown language: ${langArg}`); process.exit(1); }
  const missing = [...en].filter(k => !keys[langArg].has(k)).sort();
  console.log(`${langArg}: ${keys[langArg].size}/${en.size} keys, ${missing.length} missing\n`);
  for (const k of missing) console.log(`  ${k}`);
  process.exit(0);
}

if (wantUntranslatable) {
  const byFile = new Map();
  for (const k of untranslatable) {
    for (const f of untranslatableBy(k)) {
      if (!byFile.has(f)) byFile.set(f, []);
      byFile.get(f).push(k);
    }
  }
  console.log(`UNTRANSLATABLE — ${untranslatable.length} keys referenced in source but absent from en.json.`);
  console.log('Each renders its English call-site default in every one of the 15');
  console.log('languages, permanently. Adding the key to en.json is what makes it');
  console.log('translatable; until then no locale file can carry it.\n');
  for (const [f, ks] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${f} — ${ks.length}`);
    for (const k of ks.sort()) console.log(`    ${k}`);
    console.log();
  }
  process.exit(0);
}

if (wantPartial) {
  const byGroup = new Map();
  for (const [k, m] of partial) {
    const g = [...m].sort().join(',');
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(k);
  }
  console.log(`PARTIAL GAPS — ${partial.length} keys translated in some languages but not others.`);
  console.log('These are oversights rather than decisions: one English line inside a translated screen.\n');
  for (const [g, ks] of [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`missing in [${g}] — ${ks.length} keys`);
    for (const k of ks.sort()) console.log(`    ${k}`);
    console.log();
  }
  process.exit(0);
}

console.log('=== A1. unresolvable keys (would render a raw key path to a user) ===');
console.log(`    ${unresolvable.length}`);
for (const k of unresolvable) console.log(`      ${k}  <- ${[...usedBare.get(k)].join(', ')}`);

console.log('\n=== A2. UNTRANSLATABLE keys (English in every language, forever) ===');
console.log('    Referenced in source with an English default, absent from en.json.');
console.log('    No locale can translate these — the key is in no catalog, so a');
console.log('    translator never receives the string. Coverage below CANNOT see');
console.log('    them: they are outside both its numerator and its denominator.');
console.log(`    ${untranslatable.length}`);
if (untranslatable.length) {
  const byFile = new Map();
  for (const k of untranslatable) {
    for (const f of untranslatableBy(k)) byFile.set(f, (byFile.get(f) || 0) + 1);
  }
  console.log('\n    worst files:');
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`      ${String(n).padStart(4)}  ${f}`);
  }
  console.log('\n    --untranslatable to list every one with its call sites.');
}

console.log('\n=== B. coverage ===');
console.log(`    en: ${en.size} keys (baseline)`);
for (const l of OTHERS) {
  const miss = en.size - [...en].filter(k => keys[l].has(k)).length;
  const pct = ((1 - miss / en.size) * 100).toFixed(1);
  console.log(`    ${l}: ${String(keys[l].size).padStart(5)}   missing ${String(miss).padStart(4)}   ${pct}%`);
}
console.log('\n    ^ CATALOG coverage — what share of en.json a locale defines.');
console.log('      It is not what a user sees. See section E.');

// A key can be PRESENT and still untranslated — holding the English
// string verbatim. Key-presence coverage misses this entirely, which is
// how `notifications` showed 100% coverage in nine languages while
// displaying pure English (they were aliased to the English object).
const entries = Object.fromEntries(LANGS.map(l => [l, loadEntries(l)]));
const enVals = entries.en;
// Mirrors i18n-check.js: a value with no letters (numbers, tokens,
// punctuation) or the bare brand name is never a missing translation.
// Keep this aligned with ALLOW_IDENTICAL in that file.
const ALLOW_IDENTICAL = new Set(['app.name', 'levelBar.level']);
const substantive = (v, k) =>
  v && v.length > 3 && /\p{L}/u.test(v) && !/^\s*Flexyn\s*$/i.test(v) && !ALLOW_IDENTICAL.has(k);
console.log('\n=== C. present but holding the English string ===');
console.log('    (invisible to coverage above — the key exists, the translation does not)');
let englishTotal = 0;
for (const l of OTHERS) {
  const n = Object.keys(entries[l])
    .filter(k => k in enVals && entries[l][k] === enVals[k] && substantive(enVals[k], k)).length;
  englishTotal += n;
  console.log(`    ${l}: ${n}`);
}
console.log(`    total: ${englishTotal}`);
console.log('    Many remaining ones are genuine cognates — "Premium", "Cardio",');
console.log('    "Reps", French "Public", Dutch "Sets" — identical by coincidence,');
console.log('    not untranslated. Check a sample before treating this as a backlog.');

console.log('\n=== D. gap shape ===');
console.log(`    ${gaps.size} keys have a gap somewhere`);
console.log(`      ${englishOnly.length} missing in ALL 14  — English-only features, usually deliberate`);
console.log(`      ${partial.length} partial            — run with --partial; these are the real bugs`);

// ── E. what a user actually sees ─────────────────────────────────────
//
// Section B's denominator is en.json, which silently defines away the two
// biggest sources of English on a translated screen. The honest denominator
// is every user-visible string in the app:
//
//     en.json keys                     translatable, and measured by B
//   + untranslatable keys (A2)         referenced, never in a catalog
//   + hardcoded strings                never reached a catalog at all
//
// The last term comes from i18n-hardcoded.mjs rather than being recomputed
// here, so the two scripts cannot drift into disagreeing about the number.
let hardcoded = null;
try {
  const out = execFileSync('node', ['scripts/i18n-hardcoded.mjs', '--json'], {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  hardcoded = new Set(JSON.parse(out).map((f) => `${f.file}:${f.line}:${f.text}`)).size;
} catch {
  hardcoded = null;
}

const realDenominator = en.size + untranslatable.length + (hardcoded ?? 0);
console.log('\n=== E. real coverage (what a user sees) ===');
console.log(`    denominator ${realDenominator} = ${en.size} en.json`
  + ` + ${untranslatable.length} untranslatable`
  + ` + ${hardcoded == null ? '?' : hardcoded} hardcoded`);
if (hardcoded == null) console.log('    (hardcoded scan failed to run — the figure below is optimistic)');
console.log('    A locale can only ever reach the en.json term. The other two are');
console.log('    English on every screen in every language.\n');
for (const l of OTHERS) {
  const have = [...en].filter(k => keys[l].has(k)).length;
  const catalogPct = ((have / en.size) * 100).toFixed(1);
  const realPct = ((have / realDenominator) * 100).toFixed(1);
  console.log(`    ${l}:  catalog ${String(catalogPct).padStart(5)}%   real ${String(realPct).padStart(5)}%`);
}
console.log('\n    Do not quote the catalog number as coverage. It was reading 99.4%');
console.log('    for Spanish while the dashboard rendered half of its cards in');
console.log('    English, which is what this section exists to stop.');

process.exitCode = unresolvable.length > 0 ? 1 : 0;
