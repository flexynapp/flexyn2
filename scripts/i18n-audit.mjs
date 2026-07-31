#!/usr/bin/env node
//
// i18n audit — what is and isn't translated, across all 15 languages.
//
//   node scripts/i18n-audit.mjs            summary
//   node scripts/i18n-audit.mjs --partial  keys translated in SOME languages
//                                          but missing in others (the bugs)
//   node scripts/i18n-audit.mjs --lang ja  one language's missing keys
//
// Reads the BUILT aggregates in src/lib/i18n-langs/, which is what the app
// actually loads — run `node scripts/split-i18n.mjs` first if part files
// changed. Reading the part files directly would miss the merge step.
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

const LANGS = ['en','es','fr','de','pt','it','ja','ko','zh','ar','hi','ru','tr','pl','nl'];
const OTHERS = LANGS.filter(l => l !== 'en');
const DIR = 'src/lib/i18n-langs';

const args = process.argv.slice(2);
const wantPartial = args.includes('--partial');
const langArg = args.includes('--lang') ? args[args.indexOf('--lang') + 1] : null;

function loadKeys(lang) {
  const file = path.join(DIR, `${lang}.js`);
  if (!fs.existsSync(file)) {
    console.error(`missing aggregate: ${file} — run scripts/split-i18n.mjs`);
    process.exit(1);
  }
  return new Set([...fs.readFileSync(file, 'utf8').matchAll(/"([^"]+)":/g)].map(m => m[1]));
}

const keys = Object.fromEntries(LANGS.map(l => [l, loadKeys(l)]));
const en = keys.en;

// ── A. keys used in code that resolve to nothing at all ──────────────
// A bare t('x') where 'x' isn't in `en` renders the literal string 'x' to
// the user. tFallback('x', 'English') is always safe, so it's excluded.
const usedBare = new Map();
const safeFallback = new Set();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/__tests__|node_modules|i18n-langs/.test(e.name)) walk(p);
      continue;
    }
    if (!/\.jsx?$/.test(e.name) || /^i18n-/.test(e.name)) continue;
    const src = fs.readFileSync(p, 'utf8')
      // strip comments so documentation examples aren't read as call sites
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of src.matchAll(/\btFallback\(\s*['"]([\w.]+)['"]\s*,/g)) safeFallback.add(m[1]);
    for (const m of src.matchAll(/\bt\(\s*['"]([\w.]+)['"]\s*\)(?!\s*(?:\|\||\?\?))/g)) {
      if (!usedBare.has(m[1])) usedBare.set(m[1], new Set());
      usedBare.get(m[1]).add(p.replace(/^src\//, ''));
    }
  }
})('src');

const unresolvable = [...usedBare.keys()]
  .filter(k => !en.has(k) && !safeFallback.has(k)).sort();

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

console.log('=== A. unresolvable keys (would render a raw key path to a user) ===');
console.log(`    ${unresolvable.length}`);
for (const k of unresolvable) console.log(`      ${k}  <- ${[...usedBare.get(k)].join(', ')}`);

console.log('\n=== B. coverage ===');
console.log(`    en: ${en.size} keys (baseline)`);
for (const l of OTHERS) {
  const miss = en.size - [...en].filter(k => keys[l].has(k)).length;
  const pct = ((1 - miss / en.size) * 100).toFixed(1);
  console.log(`    ${l}: ${String(keys[l].size).padStart(5)}   missing ${String(miss).padStart(4)}   ${pct}%`);
}

console.log('\n=== C. gap shape ===');
console.log(`    ${gaps.size} keys have a gap somewhere`);
console.log(`      ${englishOnly.length} missing in ALL 14  — English-only features, usually deliberate`);
console.log(`      ${partial.length} partial            — run with --partial; these are the real bugs`);

process.exitCode = unresolvable.length > 0 ? 1 : 0;
