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
  // Copy held in a DATA structure rather than written in markup:
  //   { id: 'log_sleep', label: "Log last night's sleep", … }
  //   SLIDES.push({ title: 'Personal Record', sub: `${xp} XP earned overall` })
  //
  // Every other detector above keys off a JSX position or a call, so this
  // whole class was invisible: the string is a plain object property, it
  // never touches t(), and the component that renders it just reads
  // `def.label`. The scanner reported 1 TOTAL while questCatalog.js alone
  // held 71 of these and HeroSlideshow.jsx — the dashboard carousel — 43.
  //
  // Restricted to property names that are unambiguously display copy. `name`,
  // `value`, `key` and `type` are deliberately absent: they are overwhelmingly
  // identifiers in this codebase, and a detector that cries wolf gets muted.
  ['objectProp',
    /(?:^|[,{(\s])(title|label|sub|subtitle|subLabel|desc|description|heading|headline|caption|hint|tagline|blurb|cta|body|summary|tooltip|emptyText|helpText)\s*:\s*(['"])((?:\\.|(?!\2).)*)\2/g,
    3, 'object-literal copy'],
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

// Proper nouns are not untranslated copy, and a scanner that reports them
// teaches people to ignore it. These are declaration-scoped rather than
// file-scoped on purpose: equipmentCatalog.js holds BRAND_META ("Cybex",
// "Rogue" — nominative use of a trademark, which ATTRIBUTIONS.md requires
// stay verbatim) two hundred lines above IMPLEMENT_TYPE_META ("Leg press",
// "Hack squat" — ordinary UI copy that SHOULD be translated). Skipping the
// file would hide the second along with the first.
//
// Each entry needs a reason. "It is noisy" is not one.
const PROPER_NOUNS = {
  'src/lib/equipmentCatalog.js': {
    BRAND_META: 'equipment manufacturers — trademarks, nominative use, never translated',
    SEED_MODELS: 'specific product names — same rule as BRAND_META',
  },
  'src/lib/i18n.js': {
    ALL_LANGUAGES: 'language names; nativeLabel is by definition in its own language',
    SUPPORTED_LANGUAGES: 'language names — see ALL_LANGUAGES',
  },
};

// Nearest `const NAME =` / `export const NAME =` at or above `index`. Used
// only to resolve the allow-list above, so a miss costs a false positive
// rather than a wrong exclusion.
function enclosingDecl(src, index) {
  const head = src.slice(0, index);
  const m = [...head.matchAll(/^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/gm)].pop();
  return m ? m[1] : null;
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
        // Declared proper nouns — see PROPER_NOUNS above.
        if (kind === 'objectProp') {
          const allowed = PROPER_NOUNS[p];
          if (allowed && allowed[enclosingDecl(src, m.index)]) continue;
          // A sibling `<prop>Key` means this literal is the FALLBACK for a
          // catalog lookup, not untranslated copy:
          //
          //   title: 'Workouts', titleKey: 'hero.tele.week.title',
          //
          // That is the house pattern for slide/plan objects built by
          // module-scope functions with no React context — they cannot call
          // t() themselves, so the key travels with the data and the render
          // site resolves it. Counting these would report the fix as debt.
          const prop = m[1];
          const from = src.lastIndexOf('{', m.index);
          const window = src.slice(from < 0 ? m.index : from, m.index + 400);
          if (new RegExp(`\\b${prop}Key\\s*:`).test(window)) continue;
        }
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

if (args.includes('--blocked')) {
  // Hardcoded strings a test asserts BY LITERAL TEXT AND EXPECTS TO BE PRESENT,
  // in a suite that mocks `t` as the identity function.
  //
  // Which extraction form you use decides whether this matters, and the
  // difference was measured rather than reasoned about:
  //
  //   tFallback(key, 'English')  SAFE. Every one of these suites mocks
  //                              tFallback as (_k, english) => english, so the
  //                              assertion still sees its English and passes.
  //                              This is the house form for NEW English-only
  //                              copy, which is why extraction is mostly free.
  //
  //   t(key)                     BREAKS. The identity mock returns the key, so
  //                              the element now reads 'cardio.planned.upcoming'
  //                              and a getByText for the English finds nothing.
  //                              This is the form a swap to an ALREADY
  //                              TRANSLATED key takes — there is no English
  //                              fallback to pass — so it is exactly the
  //                              highest-value extraction that trips here.
  //
  // mealHistorySheet was the real instance: 'a water-only day says "No meals
  // logged"' went red when that string became t('nutrition.noMeals').
  //
  // So this is not a bug list. It is the set of tests to update in the same
  // commit as a bare-t() swap, so that lands as a decision and not a surprise.
  // Absence assertions are excluded — see the note on `presence` below.
  const testFiles = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (/\.(test|spec)\.[jt]sx?$/.test(e.name)) testFiles.push(p);
    }
  })(SRC);

  // Comments must be stripped BEFORE either test below. A file whose comment
  // explains the identity-mock problem contains the literal `t: (k) => k`, and
  // reporting it as an offender is how this report first accused the one suite
  // that had already been fixed.
  const IDENTITY_T = /t:\s*\(?k(?:ey)?\)?\s*=>\s*k(?:ey)?\b/;
  const suites = testFiles.map((f) => {
    const src = stripNonCode(fs.readFileSync(f, 'utf8'));
    return { file: f, src, identity: IDENTITY_T.test(src) };
  });

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const seen = new Map();
  for (const f of findings) {
    if (f.text.length < 6) continue;                 // 'Save' matches everything
    if (seen.has(f.text)) continue;
    // PRESENCE assertions only. `queryByText('X')).toBeNull()` asserts the
    // string is ABSENT, and extracting it keeps it absent — reporting those
    // was this check's first and loudest false positive, and it named a test
    // that passes fine either way.
    const presence = new RegExp(
      `(?:get|find)(?:All)?By(?:Text|LabelText|PlaceholderText)\\(\\s*(['"])${esc(f.text)}\\1`
      + `|toHaveTextContent\\(\\s*(['"])${esc(f.text)}\\2`,
    );
    const blockers = suites.filter((s) => s.identity && presence.test(s.src)).map((s) => s.file);
    if (blockers.length) seen.set(f.text, { at: `${f.file}:${f.line}`, blockers: [...new Set(blockers)] });
  }

  if (!seen.size) {
    console.log('No extraction is blocked by a literal-text assertion.');
  } else {
    console.log('Hardcoded strings a test asserts by literal text, expecting it present.\n');
    console.log('Swapping one to an existing key — bare t(\'key\'), no English fallback —');
    console.log('turns that assertion red. Extracting to tFallback(key, \'English\') does not.\n');
    for (const [text, v] of [...seen].sort()) {
      console.log(`  ${JSON.stringify(text)}`);
      console.log(`      hardcoded  ${v.at}`);
      for (const b of v.blockers) console.log(`      update     ${b}`);
    }
    console.log(`\n  ${seen.size} string(s). If you swap one with bare t(), fix its test in the`);
    console.log('  same commit: point the mock at the real catalog');
    console.log('  (src/lib/__tests__/i18nMock.js) so the assertion keeps reading');
    console.log('  like the screen rather than being rewritten to match a key path.');
  }
} else if (args.includes('--json')) {
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
