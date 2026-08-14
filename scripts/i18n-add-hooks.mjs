// Adds `const { tFallback } = useLanguage();` to components that hold hardcoded
// strings but have no useLanguage() of their own.
//
//   node scripts/i18n-add-hooks.mjs --dry
//   node scripts/i18n-add-hooks.mjs
//
// Deliberately SEPARATE from i18n-extract.mjs, and run before it. Inserting a
// line shifts every finding below it in the same file, so a script that both
// inserts and rewrites has to track its own drift. Splitting the passes means
// the extractor re-runs the scanner afterwards and reads line numbers that are
// already correct — the bug cannot exist rather than being handled.
//
// The risk here is not line numbers though. It is calling a hook somewhere React
// will not accept one. A capitalised function that returns JSX is not
// necessarily a component: it may be a render helper invoked as renderRow(),
// where a hook is a rules-of-hooks violation that no test would catch and that
// breaks only on the render where the call count changes. So a function has to
// earn the hook on three counts, and anything that cannot is reported, not
// guessed at.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DRY = process.argv.includes('--dry');
const SRC = 'src';

const findings = JSON.parse(
  execFileSync('node', ['scripts/i18n-hardcoded.mjs', '--json'], { encoding: 'utf8', maxBuffer: 64e6 }),
);

// Whole-tree text, for the "is it ever rendered as <Name />" test.
const allText = (function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, acc); continue; }
    if (/\.jsx?$/.test(e.name)) acc.push(fs.readFileSync(p, 'utf8'));
  }
  return acc;
})(SRC).join('\n');

const TOP = /^(?:export\s+)?(?:default\s+)?function\s+([A-Z]\w*)\s*\(|^const\s+([A-Z]\w*)\s*=/;

/** Components (file + name) that own at least one finding and lack useLanguage. */
const need = new Map();
for (const f of findings) {
  const lines = fs.readFileSync(f.file, 'utf8').split('\n');
  for (let i = f.line - 1; i >= 0; i--) {
    const m = TOP.exec(lines[i]);
    if (!m) continue;
    const name = m[1] || m[2];
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) if (TOP.test(lines[j])) { end = j; break; }
    if (f.line > end) break;
    const body = lines.slice(i, end).join('\n');
    // `tFallback` already in scope counts, however it got there. MyGym has
    // `function CommunityProgress({ progress, tFallback })` — passed down as a
    // prop, no hook in sight — and inserting one there redeclares the
    // identifier and fails to parse.
    const already = /useLanguage\(\)/.test(body) || /\btFallback\b/.test(body);
    if (!already) {
      const k = `${f.file}::${name}`;
      if (!need.has(k)) need.set(k, { file: f.file, name, declLine: i, endLine: end });
      need.get(k).count = (need.get(k).count || 0) + 1;
    }
    break;
  }
}

const skipped = [];
const byFile = new Map();
for (const c of need.values()) {
  const lines = fs.readFileSync(c.file, 'utf8').split('\n');
  const body = lines.slice(c.declLine, c.endLine).join('\n');

  // 1. Returns JSX at all.
  if (!/<[A-Za-z][\w.]*[\s/>]/.test(body)) { skipped.push([c, 'no JSX in body']); continue; }

  // 2. Actually rendered as an element somewhere, or exported as the module's
  //    default. A render helper called as renderRow() satisfies neither, and
  //    that is exactly the case a hook must not be added to.
  const rendered = new RegExp(`<${c.name}[\\s/>]`).test(allText);
  const isDefault = new RegExp(`export\\s+default\\s+(function\\s+)?${c.name}\\b`).test(body)
    || new RegExp(`export\\s+default\\s+${c.name}\\s*;`).test(lines.join('\n'));
  if (!rendered && !isDefault) { skipped.push([c, 'never rendered as <Element> and not a default export']); continue; }

  // 3. Has a block body to insert into. `const X = () => (` returns implicitly;
  //    adding a statement means rewriting the arrow, which is a different edit.
  //    Find where the body opens, allowing a signature spread over lines.
  let open = -1, depth = 0;
  for (let i = c.declLine; i < Math.min(c.declLine + 12, lines.length); i++) {
    for (const ch of lines[i]) {
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    if (depth === 0 && /\{\s*$/.test(lines[i])) { open = i; break; }
    if (depth === 0 && /=>\s*\(\s*$/.test(lines[i])) break;   // implicit return
  }
  if (open < 0) { skipped.push([c, 'no block body to insert into (implicit-return arrow?)']); continue; }

  if (!byFile.has(c.file)) byFile.set(c.file, []);
  byFile.get(c.file).push({ ...c, insertAfter: open });
}

let inserted = 0;
for (const [file, comps] of byFile) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  // Bottom-up, so each insertion cannot move the next one's target.
  comps.sort((a, b) => b.insertAfter - a.insertAfter);
  for (const c of comps) {
    const indent = (lines[c.insertAfter + 1] || '').match(/^\s*/)?.[0] || '  ';
    lines.splice(c.insertAfter + 1, 0, `${indent}const { tFallback } = useLanguage();`);
    inserted++;
  }
  let text = lines.join('\n');
  if (!/import\s*\{[^}]*\buseLanguage\b[^}]*\}\s*from\s*['"]@\/lib\/LanguageContext['"]/.test(text)) {
    const ls = text.split('\n');
    // End of the last import STATEMENT, which is not the same as the last line
    // beginning with `import`. A multi-line `import {\n  a,\n} from 'x';` has
    // its opening line match, so inserting after it lands INSIDE the braces and
    // the file stops parsing. Walk to the line that actually closes it.
    let last = -1;
    for (let i = 0; i < ls.length; i++) {
      if (!/^import\s/.test(ls[i])) continue;
      let j = i;
      while (j < ls.length && !/from\s*['"][^'"]+['"]\s*;?\s*$|^import\s+['"][^'"]+['"]\s*;?\s*$/.test(ls[j])) j++;
      last = Math.min(j, ls.length - 1);
      i = last;
    }
    ls.splice(last + 1, 0, "import { useLanguage } from '@/lib/LanguageContext';");
    text = ls.join('\n');
  }
  if (!DRY) fs.writeFileSync(file, text);
}

console.log(`${DRY ? 'would add' : 'added'} the hook to ${inserted} component(s) across ${byFile.size} file(s)`);
const why = {};
for (const [, r] of skipped) why[r] = (why[r] || 0) + 1;
if (skipped.length) {
  console.log(`skipped ${skipped.length}:`, why);
  for (const [c, r] of skipped.slice(0, 12)) console.log(`   ${c.file} :: ${c.name} — ${r}`);
}
