// Rewrites hardcoded user-visible strings into tFallback(key, 'English') calls
// and adds the keys to src/locales/en.json.
//
//   node scripts/i18n-extract.mjs --kind toast          one category
//   node scripts/i18n-extract.mjs --kind aria --dry     show, change nothing
//   node scripts/i18n-extract.mjs --file src/x/Y.jsx    one file
//
// tFallback, never bare t(). The second argument keeps the English at the call
// site, so nothing on screen changes and the ~20 suites that mock tFallback as
// (_k, english) => english keep passing. A bare t() would render a key path in
// those suites — measured, not assumed; see `--blocked` in i18n-hardcoded.mjs.
//
// SCOPE IS THE WHOLE PROBLEM. A rewrite is only correct if tFallback actually
// resolves where it lands, and these files hold several components each: the
// outer one often has useLanguage() while the inner one that owns the string
// does not, and some destructure only `language` or only `t`. Guessing produced
// a runtime crash the first time (CardioPlanned), so this walks to the
// enclosing component and edits its destructure, skipping anything it cannot
// place with certainty. ESLint no-undef is the backstop, not the plan.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const arg = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const DRY = args.includes('--dry');
const kindFilter = arg('--kind');
const fileFilter = arg('--file');
const LIMIT = Number(arg('--limit') || 0);

const findings = JSON.parse(
  execFileSync('node', ['scripts/i18n-hardcoded.mjs', '--json'], { encoding: 'utf8', maxBuffer: 64e6 }),
).filter((f) => (!kindFilter || f.kind === kindFilter) && (!fileFilter || f.file === fileFilter));

const EN_PATH = 'src/locales/en.json';
const en = JSON.parse(fs.readFileSync(EN_PATH, 'utf8'));
const valueToKey = new Map();
for (const [k, v] of Object.entries(en)) if (!valueToKey.has(String(v))) valueToKey.set(String(v), k);

/** Component file -> key namespace. Button.jsx -> `button`, MyGym.jsx -> `myGym`. */
function namespaceFor(file) {
  const base = path.basename(file).replace(/\.[jt]sx?$/, '');
  return base.charAt(0).toLowerCase() + base.slice(1);
}

/**
 * 'Image must be 50 MB or smaller' -> 'imageMustBe50Mb'
 *
 * Trailing function words are dropped, because truncating at a fixed word
 * count lands on them constantly and the result reads like a typo:
 * 'Give this plan a title' became `giveThisPlanA`. Key names are the first
 * thing a translator sees, so they should end on a word that carries meaning.
 */
const TRAILING_NOISE = new Set(['a', 'an', 'the', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'at', 'is', 'be', 'your', 'this', 'that', 'it', 'with', 'as']);
function slug(text) {
  const words = text.replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5);
  while (words.length > 1 && TRAILING_NOISE.has(words[words.length - 1].toLowerCase())) words.pop();
  if (!words.length) return 'label';
  const s = words[0].toLowerCase()
    + words.slice(1).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  return s.slice(0, 34) || 'label';
}

/**
 * The component enclosing `line`, and whether tFallback resolves there.
 * Returns null when the position cannot be attributed to a component.
 */
function enclosing(lines, line) {
  const TOP = /^(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)\s*\(|^const\s+([A-Z]\w*)\s*=\s*(?:React\.)?(?:memo\()?\s*(?:\()?/;
  for (let i = line - 1; i >= 0; i--) {
    const m = TOP.exec(lines[i]);
    if (!m) continue;
    const name = m[1] || m[2];
    // Body = from the declaration to the next top-level declaration after it.
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) if (TOP.test(lines[j])) { end = j; break; }
    if (line > end) return null;                       // between components
    const body = lines.slice(i, end).join('\n');
    const useLang = /const\s*\{([^}]*)\}\s*=\s*useLanguage\(\)/.exec(body);
    return { name, declLine: i, endLine: end, useLangMatch: useLang, bodyStart: i };
  }
  return null;
}

const edits = new Map();   // file -> { lines }
const added = {};
const skipped = [];
let n = 0;

// DESCENDING by line, per file. Every rewrite happens in place on one line, so
// nothing shifts — but the moment a pass inserts or removes a line, every
// finding below it in the same file is off by one and lands in the wrong place.
// Editing bottom-up makes that impossible rather than unlikely.
const ordered = [...findings].sort((a, b) => (a.file === b.file ? b.line - a.line : a.file.localeCompare(b.file)));

for (const f of ordered) {
  if (LIMIT && n >= LIMIT) break;
  if (!edits.has(f.file)) edits.set(f.file, { lines: fs.readFileSync(f.file, 'utf8').split('\n') });
  const st = edits.get(f.file);
  const idx = f.line - 1;
  const src = st.lines[idx];
  if (src === undefined) { skipped.push([f, 'line moved']); continue; }

  // Reuse an existing key when the exact English already has one. Avoids a
  // second key for a string a translator has already handled.
  let key = valueToKey.get(f.text);
  if (!key) {
    const ns = namespaceFor(f.file);
    let base = `${ns}.${slug(f.text)}`;
    let k = base, i = 2;
    while (en[k] !== undefined && en[k] !== f.text) k = `${base}${i++}`;
    key = k;
  }

  const lit = f.text;
  const call = `tFallback(${JSON.stringify(key)}, ${JSON.stringify(lit)})`;
  let next = null;

  if (f.kind === 'toast' || f.kind === 'alert') {
    for (const q of ['"', "'"]) {
      const needle = `${q}${lit}${q}`;
      if (src.includes(needle)) { next = src.replace(needle, call); break; }
    }
  } else if (['aria', 'title', 'placeholder', 'alt'].includes(f.kind)) {
    const attr = { aria: 'aria-label', title: 'title', placeholder: 'placeholder', alt: 'alt' }[f.kind];
    for (const q of ['"', "'"]) {
      const needle = `${attr}=${q}${lit}${q}`;
      if (src.includes(needle)) { next = src.replace(needle, `${attr}={${call}}`); break; }
    }
  } else if (f.kind === 'jsxText') {
    // Three shapes, all of which leave the rendered output byte-identical
    // because only the text run is swapped for an expression yielding the same
    // string. JSX strips whitespace containing a newline around both a text
    // node and an expression alike, and keeps same-line spacing around both, so
    // the surrounding characters decide the spacing and none of them move.
    //
    //   >Text<                     one line, inside its element
    //   \n  Text\n                 alone on its line, between tags
    //   <Icon /> Text              beside an inline tag, same line
    //
    // Deliberately NOT handled, because these change meaning rather than form:
    // a sentence continuing into an element (`Your level: <span>{level}</span>`
    // is one message whose word order differs by language, so it wants one key
    // with a placeholder), text spanning lines, and a literal appearing twice
    // on one line. Those are edited by hand.
    const trimmed = src.trim();
    const indent = src.slice(0, src.length - src.trimStart().length);
    if (src.includes(`>${lit}<`)) {
      next = src.replace(`>${lit}<`, `>{${call}}<`);
    } else if (trimmed === lit) {
      next = `${indent}{${call}}`;
    } else if (src.split(lit).length === 2) {
      const at = src.indexOf(lit);
      const before = src.slice(0, at);
      const after = src.slice(at + lit.length);
      const beforeOk = before.trimEnd().endsWith('>');
      const afterOk = after.trim() === '' || after.trimStart().startsWith('<');
      const splitSentence = after.includes('{') && after.includes('<');
      if (beforeOk && afterOk && !splitSentence && !/<(text|tspan)\b/.test(src)) {
        next = `${before}{${call}}${after}`;
      }
    }
  }

  if (!next || next === src) { skipped.push([f, 'no unambiguous match on its line']); continue; }

  const enc = enclosing(st.lines, f.line);
  if (!enc) { skipped.push([f, 'not inside a component']); continue; }
  if (enc.useLangMatch) {
    const names = enc.useLangMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (!names.includes('tFallback')) {
      const declIdx = st.lines.findIndex((l, i) => i >= enc.bodyStart && l.includes(enc.useLangMatch[0]));
      if (declIdx < 0) { skipped.push([f, 'useLanguage line not found']); continue; }
      st.lines[declIdx] = st.lines[declIdx].replace(
        enc.useLangMatch[0], `const { ${[...names, 'tFallback'].join(', ')} } = useLanguage()`,
      );
    }
  } else {
    // The component has no useLanguage() at all. Adding the hook means
    // inserting a line, which shifts every finding below it — and choosing
    // where to put it means knowing this really is a component and not a
    // helper that merely starts with a capital. Left for a deliberate pass:
    // reported here rather than guessed at.
    skipped.push([f, 'component has no useLanguage() — needs the hook added by hand']);
    continue;
  }

  st.lines[idx] = next;
  if (en[key] === undefined) { en[key] = lit; added[key] = f.file; }
  n++;
}

// Make sure every touched file imports useLanguage.
for (const [file, st] of edits) {
  const text = st.lines.join('\n');
  if (!/useLanguage/.test(text)) continue;
  if (/import\s*\{[^}]*useLanguage[^}]*\}\s*from\s*['"]@\/lib\/LanguageContext['"]/.test(text)) continue;
  // End of the last import STATEMENT. A multi-line `import {\n …\n} from 'x';`
  // opens with a line matching /^import/, so inserting after that line lands
  // INSIDE the braces and the file stops parsing. Same trap as in
  // i18n-add-hooks.mjs, which had it fixed while this copy did not.
  let lastImport = -1;
  for (let i = 0; i < st.lines.length; i++) {
    if (!/^import\s/.test(st.lines[i])) continue;
    let j = i;
    while (j < st.lines.length
      && !/from\s*['"][^'"]+['"]\s*;?\s*$|^import\s+['"][^'"]+['"]\s*;?\s*$/.test(st.lines[j])) j++;
    lastImport = Math.min(j, st.lines.length - 1);
    i = lastImport;
  }
  if (lastImport >= 0) st.lines.splice(lastImport + 1, 0, "import { useLanguage } from '@/lib/LanguageContext';");
}

if (DRY) {
  console.log(`${n} extraction(s) would be made across ${edits.size} file(s); ${skipped.length} skipped.`);
} else {
  for (const [file, st] of edits) fs.writeFileSync(file, st.lines.join('\n'));
  fs.writeFileSync(EN_PATH, JSON.stringify(Object.fromEntries(Object.entries(en).sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n');
  console.log(`${n} extraction(s) across ${edits.size} file(s); ${Object.keys(added).length} new key(s).`);
}
const why = {};
for (const [, r] of skipped) why[r] = (why[r] || 0) + 1;
if (skipped.length) console.log('skipped:', why);
