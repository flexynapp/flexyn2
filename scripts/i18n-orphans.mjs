// scripts/i18n-orphans.mjs
//
// Finds ORPHAN KEYS: `tFallback('some.key', 'English')` call sites whose
// key does not exist in src/locales/en.json.
//
// WHY THIS IS ITS OWN GUARD. An orphan key is invisible to every check
// this repo already had, and it renders perfectly in English:
//
//   • `npm run i18n:audit` compares each locale AGAINST en.json, so a key
//     that is missing from en.json is missing from the comparison too.
//   • `_coverage.json` counts translated keys per locale — an orphan is
//     not a key, so it moves nothing.
//   • `i18n-hardcoded.mjs` looks for string literals in JSX. An orphan is
//     already wrapped in tFallback, so it passes.
//   • The DEV missing-translation warning in getTranslation only fires
//     when English HAS the key and the locale does not.
//
// So the string renders via tFallback's second argument, looks correct in
// English forever, and can never be translated — no translator, and no
// TMS ingesting the catalogs, will ever see that it exists. Measured
// 2026-08-16: 764 of them, against a 3,895-key catalog.
//
// The Crew Wars pass cleared src/components/crews entirely. The rest are
// baselined in src/locales/_orphans.json so the class cannot GROW while
// it is being worked off. Adding a new tFallback key without a catalog
// entry fails the suite; fixing one and leaving it on the list fails too,
// so the baseline cannot rot into a lie.
//
//   node scripts/i18n-orphans.mjs           report
//   node scripts/i18n-orphans.mjs --write   rewrite the baseline

import fs from 'node:fs';
import path from 'node:path';

const SRC      = 'src';
const EN       = 'src/locales/en.json';
const BASELINE = 'src/locales/_orphans.json';

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== '__tests__' && e.name !== 'locales') sourceFiles(p, out);
    } else if (/\.(jsx?|tsx?)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Every tFallback call whose key is a plain string literal.
 *
 * Template-literal keys (`crew.tab.${key}`) are skipped deliberately —
 * the key is computed, so there is nothing static to look up. Those are
 * covered by reading the component, not by this scan.
 */
export function findOrphans(root = SRC, enPath = EN) {
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const found = [];

  // `tFallback(` AND the `tf(`/`tF(` aliases. Modules that take the
  // translator as an argument name it `tf` by convention (see
  // src/lib/translatorArg.js), and scanning only the long name missed two
  // real orphans in the celebration helpers while reporting a clean zero.
  // The alias needs a left boundary or it matches inside `setF(`, `getf(`
  // and every other identifier ending in those two letters.
  const CALLS = /(?<![A-Za-z0-9_$.])(tFallback|tF|tf)\(/g;
  for (const file of sourceFiles(root)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const call of [...src.matchAll(CALLS)]) {
      const i = call.index;
      let j = i + call[0].length;
      let depth = 1, quote = null, arg = '';
      while (j < src.length && depth > 0) {
        const c = src[j];
        if (quote) {
          if (c === '\\') { arg += c + src[j + 1]; j += 2; continue; }
          if (c === quote) quote = null;
          arg += c; j++; continue;
        }
        if (c === '"' || c === "'" || c === '`') { quote = c; arg += c; j++; continue; }
        if ('([{'.includes(c)) depth++;
        if (')]}'.includes(c)) { depth--; if (depth === 0) break; }
        if (c === ',' && depth === 1) break;
        arg += c; j++;
      }
      const raw = arg.trim();
      if (!/^['"]/.test(raw)) continue;          // computed key — skip
      const key = raw.slice(1, -1);
      if (key.includes('${')) continue;
      if (key in en) continue;

      found.push({ key, file: file.replace(/\\/g, '/') });
    }
  }
  return found;
}

export function readBaseline(p = BASELINE) {
  if (!fs.existsSync(p)) return { keys: [] };
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = findOrphans();
  const keys  = [...new Set(found.map((f) => f.key))].sort();

  if (process.argv.includes('--write')) {
    const byPrefix = {};
    for (const k of keys) {
      const p = k.split('.')[0];
      byPrefix[p] = (byPrefix[p] || 0) + 1;
    }
    fs.writeFileSync(BASELINE, JSON.stringify({
      $comment:
        'Baselined ORPHAN KEYS: tFallback() call sites whose key is not in en.json, so the string ' +
        'renders in English forever and no translator can ever see it. This list may SHRINK, never ' +
        'grow — see scripts/i18n-orphans.mjs and src/lib/__tests__/i18nOrphanKeys.test.js. Fix one ' +
        'by adding the key to en.json (and to every released locale) and deleting it from here.',
      $measured: '2026-08-16, after the Crew Wars pass cleared src/components/crews',
      $byPrefix: Object.fromEntries(Object.entries(byPrefix).sort((a, b) => b[1] - a[1])),
      keys,
    }, null, 2) + '\n');
    console.log(`wrote ${BASELINE} — ${keys.length} orphan keys`);
  } else {
    const base = new Set(readBaseline().keys);
    const added = keys.filter((k) => !base.has(k));
    const fixed = [...base].filter((k) => !keys.includes(k));
    console.log(`orphan keys: ${keys.length} (baseline ${base.size})`);
    if (added.length) console.log(`\nNEW — these will fail the suite:\n  ${added.join('\n  ')}`);
    if (fixed.length) console.log(`\nFIXED — delete these from the baseline:\n  ${fixed.join('\n  ')}`);
  }
}
