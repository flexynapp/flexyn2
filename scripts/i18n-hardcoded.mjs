// Finds user-visible strings that never reach the i18n catalogs.
//
// The coverage audit (scripts/i18n-audit.mjs) measures the catalogs against
// each other: how much of `en` a language is missing. It cannot see a string
// that was never extracted in the first place — that string is 100% "covered"
// in all fifteen languages and English on every screen.
//
// Scope: STATIC UI CHROME only. User-generated content (hub posts, crew
// names, comments, exercise names a user typed) is deliberately NOT here —
// it is data, it cannot live in a catalog, and it is handled at runtime by
// src/lib/translate.js and its Translate button.
//
//   node scripts/i18n-hardcoded.mjs           summary by kind
//   node scripts/i18n-hardcoded.mjs --list    every finding, file:line
//   node scripts/i18n-hardcoded.mjs --kind toast
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'src';
const args = process.argv.slice(2);
const wantList = args.includes('--list');
const kindArg = args.includes('--kind') ? args[args.indexOf('--kind') + 1] : null;

// Directories and files that hold no user-facing chrome.
const SKIP_DIR = /^(__tests__|locales|test)$/;
const SKIP_FILE = /\.(test|spec)\.[jt]sx?$/;

// Files whose strings are developer-facing or data, not chrome.
const SKIP_PATHS = [
  'src/lib/push-sw.js',          // service worker, no UI
  'src/lib/analytics',           // event names
  'src/api/',                    // network layer; errors are mapped in UI
];

// A literal is user-visible chrome only if it reads like prose: starts with a
// capital or digit, has a space or is a real word, and is not an identifier,
// path, className, key, URL, or unit.
const LOOKS_LIKE_CODE = /^(?:[a-z0-9_$-]+|[A-Z_]+|.*[/\\.]{1}.*|#[0-9a-f]{3,8}|\d+(?:px|rem|em|%|ms|s)?)$/;
const HAS_LETTERS = /[A-Za-z]{2,}/;

function isProse(s) {
  const t = s.trim();
  if (t.length < 3 || t.length > 300) return false;
  if (!HAS_LETTERS.test(t)) return false;
  if (LOOKS_LIKE_CODE.test(t)) return false;
  if (/^\{.*\}$/.test(t)) return false;
  if (/^(https?:|data:|blob:|\/|\.\/|@\/)/.test(t)) return false;
  // Tailwind-ish class soup: many tokens, all lowercase-with-dashes/colons.
  if (/^[a-z0-9:_\- [\]()/.%]+$/.test(t) && /[-:]/.test(t) && !/\s[A-Z]/.test(t)) return false;
  return true;
}

// Each detector: [kind, regex with the literal in group 1, description]
const DETECTORS = [
  ['toast',       /\btoast\.(?:success|error|info|warning|message)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g, 2, 'toast text'],
  ['alert',       /\b(?:alert|confirm)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g, 2, 'alert/confirm text'],
  ['placeholder', /\bplaceholder=(["'])((?:\\.|(?!\1).)*)\1/g, 2, 'input placeholder'],
  ['aria',        /\baria-label=(["'])((?:\\.|(?!\1).)*)\1/g, 2, 'aria-label'],
  ['title',       /\btitle=(["'])((?:\\.|(?!\1).)*)\1/g, 2, 'title attribute'],
  ['alt',         /\balt=(["'])((?:\\.|(?!\1).)*)\1/g, 2, 'image alt text'],
  ['jsxText',     />\s*([A-Z][A-Za-z0-9'’,!?.:%-]*(?:\s+[A-Za-z0-9'’,!?.:%-]+){0,14})\s*</g, 1, 'JSX text node'],
];

// Blank out comments while preserving BYTE OFFSETS AND NEWLINES, so reported
// line numbers match the real file.
//
// `^\s*//` is the trap: with the `m` flag `\s` still matches `\n`, so a
// comment preceded by a blank line swallows that newline into the match, and
// replacing the match with spaces keeps the length while destroying the line
// break. Line numbers then drift by one per blank-line-preceded comment —
// silently, and only in the files with the most commentary. Match horizontal
// whitespace only.
function stripNonCode(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/.*$/gm, blank);
}

const findings = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(p); continue; }
    if (!/\.jsx?$/.test(e.name) || SKIP_FILE.test(e.name)) continue;
    if (SKIP_PATHS.some((s) => p.startsWith(s))) continue;

    const raw = fs.readFileSync(p, 'utf8');
    const src = stripNonCode(raw);
    const lineOf = (i) => src.slice(0, i).split('\n').length;

    for (const [kind, re, group, desc] of DETECTORS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const text = m[group];
        if (!isProse(text)) continue;
        // Already localized? The match sits inside a t(...) / tFallback(...) call.
        const before = src.slice(Math.max(0, m.index - 120), m.index);
        if (/\bt(?:Fallback)?\(\s*$|\bt(?:Fallback)?\([^)]*$/.test(before)) continue;
        // Report the line of the TEXT, not of the match start. A JSX text node
        // matches from the `>` that opens it, which for a wrapped element sits
        // on the previous line — citing that line sends the reader to markup
        // with no prose on it.
        const rel = m[0].indexOf(text);
        findings.push({
          kind, desc, file: p,
          line: lineOf(m.index + (rel < 0 ? 0 : rel)),
          text: text.trim(),
        });
      }
    }
  }
})(SRC);

const byKind = {};
for (const f of findings) (byKind[f.kind] ||= []).push(f);

if (args.includes('--json')) {
  // Untruncated, machine-readable — `--list` clips long strings for reading.
  console.log(JSON.stringify(kindArg ? (byKind[kindArg] || []) : findings, null, 1));
} else if (wantList || kindArg) {
  const show = kindArg ? (byKind[kindArg] || []) : findings;
  for (const f of show) {
    console.log(`${f.file}:${f.line}  [${f.kind}]  ${JSON.stringify(f.text).slice(0, 100)}`);
  }
  console.log(`\n${show.length} finding(s)`);
} else {
  console.log('=== hardcoded user-visible strings (never reach the catalogs) ===\n');
  for (const [kind, list] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(list.length).padStart(4)}  ${kind.padEnd(12)} ${list[0].desc}`);
  }
  console.log(`\n  ${String(findings.length).padStart(4)}  TOTAL`);
  const files = new Set(findings.map((f) => f.file));
  console.log(`        across ${files.size} files`);
  console.log('\n  --list to see them, --kind <name> to filter.');
  console.log('  UGC (hub posts, crew names) is out of scope by design — that is');
  console.log('  runtime translation via src/lib/translate.js, not catalog work.');
}
