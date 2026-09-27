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
// The third alternative used to be `.*[/\\.]{1}.*`, meant to skip paths and
// dotted identifiers. It matched any string CONTAINING a dot — which is the
// shape of every real sentence, so the scanner was structurally blind to
// prose. Measured before this change: across the toast/placeholder/aria
// detectors it reported 9 strings app-wide and skipped 274. "Could not delete
// note" was reported; "Could not delete note." was not.
//
// A path or dotted identifier is now recognised by shape rather than by
// containing a dot: whole-string, no whitespace, and every separator sits
// BETWEEN word characters. `user.name`, `src/lib/foo.js` and `v1.2.3` still
// match; `Deleted.`, `Story's up.` and `Are you sure? This cannot be undone.`
// no longer do, because a trailing dot has no word character after it and
// prose has spaces.
const LOOKS_LIKE_CODE = /^(?:[a-z0-9_$-]+|[A-Z_]+|[\w$-]+(?:[./\\][\w$-]+)+|#[0-9a-f]{3,8}|\d+(?:px|rem|em|%|ms|s)?)$/;
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

/**
 * Every quoted literal inside a balanced toast(...) call.
 *
 * Yields match-SHAPED arrays so the scan loop can treat regex and function
 * detectors identically: [literalWithQuotes, undefined, literalText] with an
 * `index` pointing at the literal, which is what the loop's existing
 * tFallback look-behind needs to keep skipping already-localised copy.
 *
 * Quote-aware, so a paren inside a message does not end the call early.
 */
function* toastLiterals(src) {
  const open = /(?<![-.\w])toast(?:\.(?:success|error|info|warning|message))?\s*\(/g;
  let m;
  while ((m = open.exec(src))) {
    const start = m.index + m[0].length - 1;   // sits on the '('
    let i = start, depth = 0, quote = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) break; }
    }
    // Mask template literals before looking for quoted ones. A backtick
    // string carries apostrophes ("Couldn't start 2FA: ${...}") and code
    // inside ${}, and scanning it for '...' slices garbage fragments out of
    // the middle of a sentence. Masking with spaces rather than deleting
    // keeps every offset, so `index` still points at the real literal.
    // Template literals themselves stay undetected, exactly as before —
    // this detector is quote-anchored by design.
    let call = src.slice(start, i + 1);
    let masked = '';
    for (let j = 0, tq = false; j < call.length; j++) {
      const ch = call[j];
      if (ch === '\\') { masked += tq ? '  ' : call.slice(j, j + 2); j++; continue; }
      if (ch === '`') { tq = !tq; masked += ' '; continue; }
      masked += tq ? ' ' : ch;
    }
    call = masked;
    const lit = /(['"])((?:\\.|(?!\1).)*)\1/g;
    // A literal inside the call is not necessarily COPY. The bundle dialog
    // picks its message with `raw.includes('listing is')`, matching a Postgres
    // error — a predicate, never rendered. Skip literals that are being
    // compared rather than shown, or the scanner asks for a translation of a
    // database string and whoever obliges breaks the branch.
    const PREDICATE = /(?:\.(?:includes|startsWith|endsWith|indexOf|match|test|split|replace|replaceAll)\(|[=!]==?\s*|\bcase\s+)$/;
    let L;
    while ((L = lit.exec(call))) {
      if (PREDICATE.test(call.slice(Math.max(0, L.index - 40), L.index))) continue;
      const shaped = [L[0], undefined, L[2]];
      shaped.index = start + L.index;
      yield shaped;
    }
    open.lastIndex = i + 1;
  }
}

/** Adapter so a plain regex detector iterates the same way. */
function* regexMatches(re, src) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(src))) yield m;
}

// Each detector: [kind, regex with the literal in group 1, description]
const DETECTORS = [
  // NOT a regex — see toastLiterals(). A pattern anchored on a quote after the
  // paren cannot see either of the two shapes this detector kept missing:
  // a bare `toast('Name your crew first!')` (the variant used to be required)
  // and a literal behind a ternary, `toast.success(next ? 'On.' : 'Off.')`.
  // Both were invisible here AND, for the bare form, invisible to the user,
  // because src/lib/toast.js action-gates it. Eleven ternary strings were
  // rendering untranslated English while this reported them as absent.
  // Found 2026-08-30.
  ['toast',       toastLiterals, 2, 'toast text'],
  ['alert',       /\b(?:alert|confirm)\(\s*(['"])((?:\\.|(?!\1).)*)\1/g, 2, 'alert/confirm text'],
  ['placeholder', /\bplaceholder=(["'])((?:\\.|(?!\1).)*)\1/g, 2, 'input placeholder'],
  ['aria',        /\baria-label=(["'])((?:\\.|(?!\1).)*)\1/g, 2, 'aria-label'],
  ['title',       /\btitle=(["'])((?:\\.|(?!\1).)*)\1/g, 2, 'title attribute'],
  ['alt',         /\balt=(["'])((?:\\.|(?!\1).)*)\1/g, 2, 'image alt text'],
  // HTML entities are admitted as whole tokens (`&amp;`, `&nbsp;`, `&#8212;`)
  // rather than by adding `&` to the character class. The distinction is
  // load-bearing: a bare `&` would make `{A && B}` and `x => X && Y < Z` match
  // as copy, which is how a widened scanner earns itself a mute. Before this,
  // `<p>Trade gear &amp; regimens</p>` (src/pages/Hub.jsx) was invisible — the
  // class had no `&`, so the match died at the entity and the node was skipped
  // entirely. Being un-keyed it was invisible to the orphan scanner too, so it
  // survived a sweep that took orphans to zero.
  ['jsxText',     />\s*([A-Z](?:[A-Za-z0-9'’,!?.:%-]|&[a-zA-Z]+;|&#\d+;)*(?:\s+(?:[A-Za-z0-9'’,!?.:%-]|&[a-zA-Z]+;|&#\d+;)+){0,14})\s*</g, 1, 'JSX text node'],
  // Text ALONE on its line, bounded by a JSX expression on either side:
  //   {loading ? <Spinner /> : <Glyph />}
  //   Continue with Google
  //   </Button>
  // `jsxText` above needs `>` before and `<` after, so a node that follows a
  // `{…}` child or precedes one (`List Item` then `{count > 0 && …}`) was
  // invisible — fifteen buttons and labels shipped English in es/fr that way,
  // found by hand in two audits (2026-09-27). Anchored to whole lines, and the
  // neighbouring lines must end/begin with JSX punctuation, so ordinary JS
  // (`} else {`) cannot match. Lowercase is admitted here, unlike `jsxText`,
  // because these are whole lines: "or", "not collected", "on Flexyn".
  ['jsxLine',     /[>}][ \t]*\n[ \t]*([A-Za-z](?:[A-Za-z0-9'’,!?.:%-]|&[a-zA-Z]+;|&#\d+;)*(?:[ \t]+(?:[A-Za-z0-9'’,!?.:%&-]|&[a-zA-Z]+;|&#\d+;)+){0,30})[ \t]*(?=\n[ \t]*[<{])/g, 1, 'JSX text on its own line'],
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
    // The lookbehind is not cosmetic. `accept="image/*"` contains `/*`, so a
    // bare pattern opened a block comment inside a string literal and blanked
    // everything up to the next `*/` — real code, and every literal in it.
    // Twelve files carry that attribute, including HubComposer, StoriesRow and
    // CrewChat, which are exactly the files with the most un-keyed copy. A real
    // comment opener is never preceded by a word character or a quote.
    .replace(/(?<![A-Za-z0-9_"'])\/\*[\s\S]*?\*\//g, blank)
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

// ── Reachable through a DERIVED key ──────────────────────────────────
//
// A slug -> { label } map in a data module is not automatically debt. The
// house pattern is a key built at the render site from the entry's own key:
//
//   const k = `quest.${def.id}.label`;  const v = t(k);
//   implementTypeLabel(slug, tf)  ->  tf(`equipment.implement.${slug}`, en)
//
// so once the catalog carries that key, the English in the data module is a
// fallback nobody sees. Counting it would report the fix as debt — and this
// is not a small correction: it covers questCatalog's 36, Onboarding's 33 and
// equipmentCatalog's 53.
//
// Every template literal shaped like a key path becomes a (prefix, suffix)
// pair; a finding is covered when `prefix + itsOwnKey + suffix` is real in
// en.json. The namespace has to match, which is what makes this precise
// rather than a suffix coincidence.
// KNOWN LIMIT, and it over-reports rather than under-reports, which is the
// right direction to be wrong in. A prefix passed as a PROP is invisible:
//
//   <Pillset options={EQUIPMENT_OPTIONS} keyPrefix="generator.equipment." />
//   function Pillset({ keyPrefix }) { … tFallback(`${keyPrefix}${opt.id}`, …) }
//
// The only template literal here is `${keyPrefix}${opt.id}`, whose static
// prefix is the empty string, so no usable pattern is recorded and the eleven
// option labels in workoutGenerator.js stay on the list even though they are
// translated and resolving. Do not "fix" this by matching empty prefixes —
// that would match everything. If the count matters more than the
// indirection, give the options explicit keys instead of a shared prefix.
const EN_KEYS = (() => {
  try { return JSON.parse(fs.readFileSync('src/locales/en.json', 'utf8')); }
  catch { return null; }
})();

// PER FILE, and that is the whole precision of it. A pattern found anywhere
// in the app is not evidence that THIS data gets looked up: MacroRingWidget
// renders `{m.label}` with no lookup whatsoever, and an app-wide pool
// "covered" it because some other component happens to build
// `nutrition.macro.${key}`. A finding is only reachable if the lookup lives
// in its own file, or in a file that IMPORTS it — which is the real shape for
// a data module (DailyQuestsCard imports questCatalog and builds the key).
const DERIVED_BY_FILE = new Map();
const IMPORTERS = new Map();        // module path -> files that import it
const IMPORTED_BY_FILE = new Map(); // file -> module paths it imports
if (EN_KEYS) {
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.test(e.name)) walk(p); continue; }
      if (!/\.jsx?$/.test(e.name)) continue;
      const body = fs.readFileSync(p, 'utf8');
      // `@/lib/questCatalog` -> src/lib/questCatalog
      // Both import forms. Layout imports './TabQuickActionMenu' relatively,
      // and an @/-only regex missed it — so the ten quick-action labels stayed
      // on the list after the lookup was wired.
      for (const im of body.matchAll(/from\s+['"](@\/[\w/.-]+|\.{1,2}\/[\w/.-]+)['"]/g)) {
        const spec = im[1];
        const target = (spec.startsWith('@/')
          ? 'src/' + spec.slice(2)
          : path.join(path.dirname(p), spec)).replace(/\.jsx?$/, '');
        if (!IMPORTERS.has(target)) IMPORTERS.set(target, new Set());
        IMPORTERS.get(target).add(p);
        if (!IMPORTED_BY_FILE.has(p)) IMPORTED_BY_FILE.set(p, new Set());
        IMPORTED_BY_FILE.get(p).add(target);
      }
      const DERIVED = DERIVED_BY_FILE.get(p) || [];
      DERIVED_BY_FILE.set(p, DERIVED);
      for (const m of body.matchAll(/`([^`\n]*\$\{[^`\n]*)`/g)) {
        const tpl = m[1];
        if (!/^[\w.]*\$\{[^}]*\}[\w.${}]*$/.test(tpl) || !tpl.includes('.')) continue;
        const holed = tpl.replace(/\$\{[^}]*\}/g, ' ');
        const i = holed.indexOf(' ');
        DERIVED.push([holed.slice(0, i), holed.slice(i + 1).replace(/ /g, '')]);
      }
    }
  })(SRC);
}

/**
 * Candidate slugs a derived key might be built from. Three shapes, all live:
 *
 *   { id: 'log_sleep', label: '…' }        -> id
 *   { key: 'breakfast', label: '…' }       -> key
 *   leg_press: { label: '…' }              -> the object key above
 *
 * plus the slugified LABEL ITSELF, because TodaysPlanCard has no id at all —
 * it returns `{ label: 'Push Day' }` and the render site slugifies the
 * English to reach `todaysPlan.label.push_day`.
 */
function ownKeys(lines, line, text) {
  const out = [];
  for (let i = line - 1; i >= Math.max(0, line - 6); i--) {
    const m = /\b(?:id|key):\s*['"]([\w-]+)['"]/.exec(lines[i]);
    if (m) { out.push(m[1]); break; }
  }
  // THE UPWARD SCAN MUST STOP AT AN OBJECT THAT ALREADY CLOSED, and without
  // that check this rule is generous in exactly the way the other three
  // versions of it were. `lootCatalog.js` declares RARITY with an `animated: {`
  // member, closes it, and then declares ITEMS twenty lines further down. A
  // bare scan walked out of RARITY, claimed `animated` as the enclosing key of
  // every ITEMS row, and `loot.rarity.animated` IS in en.json — so 25 sticker
  // descriptions were reported as reachable through a derived key that has
  // nothing to do with them. Everything ABOVE the first `x: {` in a file was
  // reported correctly, which is what made the hole look like a quirk of one
  // catalog rather than a rule that fails after any nested object literal.
  //
  // A candidate only encloses the finding if the brace depth between them
  // never returns to zero.
  for (let i = line - 1; i >= 0; i--) {
    const m = /^\s*['"]?([A-Za-z0-9_-]+)['"]?\s*:\s*\{/.exec(lines[i]);
    if (!m) continue;
    let depth = 0;
    let encloses = true;
    for (let j = i; j < line - 1; j++) {
      const from = j === i ? lines[j].indexOf('{') : 0;
      for (let c = from; c < lines[j].length; c++) {
        if (lines[j][c] === '{') depth++;
        else if (lines[j][c] === '}') depth--;
      }
      if (depth <= 0) { encloses = false; break; }
    }
    if (encloses) out.push(m[1]);
    break;
  }
  if (text) out.push(text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, ''));
  return out;
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
      const iter = typeof re === 'function' ? re(src) : regexMatches(re, src);
      for (const m of iter) {
        const text = m[group];
        if (!isProse(text)) continue;
        // Already localized? The match sits inside a translation call.
        //
        // This knew only `t(` and `tFallback(`, and the codebase calls the
        // same thing six other ways — measured 2026-08-30: tFallback 3911,
        // T 198, t 60, tf 44, tF 15, tr 12, tCount 8, plural 5. Every alias
        // but two was reported as untranslated copy the moment a detector
        // could see it, which is how widening the toast reader turned up
        // `tr('trophies.toast.view', 'View')` as a finding.
        const before = src.slice(Math.max(0, m.index - 120), m.index);
        const TFN = '(?:tFallback|tCount|plural|tf|tF|tr|t|T)';
        if (new RegExp(`\\b${TFN}\\(\\s*$|\\b${TFN}\\([^)]*$`).test(before)) continue;
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
          // Reachable through a derived key — see DERIVED above.
          if (EN_KEYS) {
            const lines = src.split('\n');
            const slugs = ownKeys(lines, lineOf(m.index), text);
            // This file's own lookups, plus those of every file that imports
            // it — the data-module case. Nothing wider.
            // Own file, plus its IMPORTERS (a parent that reads the data) and
            // its IMPORTS (a child the data is handed down to — Layout owns
            // TAB_ACTIONS and TabQuickActionMenu does the lookup). Both
            // directions of one edge; still the import graph, not the app.
            const pats = [...(DERIVED_BY_FILE.get(p) || [])];
            for (const importer of IMPORTERS.get(p.replace(/\.jsx?$/, '')) || [])
              pats.push(...(DERIVED_BY_FILE.get(importer) || []));
            for (const imported of IMPORTED_BY_FILE.get(p) || [])
              for (const cand of [imported + '.js', imported + '.jsx', imported])
                pats.push(...(DERIVED_BY_FILE.get(cand) || []));
            if (slugs.some((slug) => pats.some(([pre, suf]) => (pre + slug + suf) in EN_KEYS))) continue;
          }
        }
        // Report the line of the TEXT, not of the match start. A JSX text node
        // matches from the `>` that opens it, which for a wrapped element sits
        // on the previous line — citing that line sends the reader to markup
        // with no prose on it.
        const rel = m[0].indexOf(text);
        const line = lineOf(m.index + (rel < 0 ? 0 : rel));
        // `jsxLine` and `jsxText` overlap on a node with `>` on one side and
        // `<` on the other; count the string once, or the ratchet moves by two
        // when one fix lands.
        if (findings.some((f) => f.file === p && f.line === line && f.text === text.trim())) continue;
        findings.push({
          kind, desc, file: p,
          line,
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
