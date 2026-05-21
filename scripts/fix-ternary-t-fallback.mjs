#!/usr/bin/env node
// scripts/fix-ternary-t-fallback.mjs
//
// Second sweep tool — replaces the verbose-but-working idiom
//   t('key') === 'key' ? 'fallback' : t('key')
// with the canonical
//   tFallback('key', 'fallback')
// form. The verbose idiom isn't a runtime bug (the conditional resolves
// to the right value), but it calls t() twice, duplicates the key
// literal, and clutters JSX. tFallback was added precisely so that
// callers stop hand-rolling this.
//
// Companion to fix-broken-t-fallback.mjs (which handled the genuinely
// broken `t('key') || 'fallback'` form — broken because t() returns the
// key string on miss, which is truthy, so the fallback never fires).
//
// Idempotent + safe to re-run. Only touches files containing the
// pattern; preserves whitespace / surrounding code elsewhere.

import { readFileSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || 'src');

// Captures:
//   1 = the key (e.g. 'hub.empty.cta.share')
//   2 = the fallback string contents (inside the quotes, including
//       any escaped chars — we preserve verbatim)
//   3 = the quote style of the fallback (' or ")
//
// Permissive on whitespace, including newlines between the ?: parts.
// Strict on quote style for the key (single quotes only — that's the
// codebase convention for translation keys). The fallback can be
// single OR double quoted to handle `"Your squad hasn't posted yet"`
// where the contraction forces a quote switch.
const BROKEN_RE = new RegExp(
  String.raw`t\(\s*'([^']+)'\s*\)\s*===\s*'\1'\s*\?\s*(['"])((?:(?!\2)[^\\]|\\.)*)\2\s*:\s*t\(\s*'\1'\s*\)`,
  'g'
);

let filesScanned   = 0;
let filesChanged   = 0;
let replacements   = 0;
let needsTFallback = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      await walk(p);
      continue;
    }
    if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
    if (/\.test\.[jt]sx?$/.test(entry.name))  continue;
    processFile(p);
  }
}

function processFile(filepath) {
  filesScanned += 1;
  const src = readFileSync(filepath, 'utf8');
  if (!BROKEN_RE.test(src)) return;
  BROKEN_RE.lastIndex = 0;

  let localReplacements = 0;
  const next = src.replace(BROKEN_RE, (_full, key, origQuote, fallback) => {
    localReplacements += 1;
    // The regex captured the raw source bytes of the fallback,
    // including any backslash escapes that were valid under the
    // ORIGINAL quote style (origQuote). Two strategies:
    //   • If we keep the same quote style → emit fallback verbatim.
    //   • If we switch quote styles → unescape the old quote and add
    //     escapes for the new one. Otherwise the leftover \' inside a
    //     double-quoted string becomes \\' (a parse error).
    //
    // We default to single quotes (codebase convention) unless the
    // fallback contains an unescaped single quote AND no unescaped
    // double quote — then switch to double quotes to avoid escaping.
    const hasUnescaped = (str, ch) => {
      for (let i = 0; i < str.length; i++) {
        if (str[i] === '\\') { i++; continue; }
        if (str[i] === ch) return true;
      }
      return false;
    };
    const fbQuote = (hasUnescaped(fallback, "'") && !hasUnescaped(fallback, '"')) ? '"' : "'";
    let body = fallback;
    if (fbQuote !== origQuote) {
      // Unescape old quote, escape new quote.
      body = body.replace(new RegExp(`\\\\${origQuote}`, 'g'), origQuote);
      if (body.includes(fbQuote)) {
        body = body.replace(new RegExp(fbQuote, 'g'), `\\${fbQuote}`);
      }
    }
    return `tFallback('${key}', ${fbQuote}${body}${fbQuote})`;
  });
  if (localReplacements === 0) return;

  let finalSrc = next;
  const hasUseLanguageImport = /from\s+['"]@\/lib\/LanguageContext['"]/.test(finalSrc);
  if (!hasUseLanguageImport) {
    needsTFallback.push({ file: filepath, reason: 'no useLanguage import' });
    return;
  }
  const destructureRe = /const\s*\{\s*([^}]+)\}\s*=\s*useLanguage\s*\(\s*\)\s*;?/;
  const m = destructureRe.exec(finalSrc);
  if (!m) {
    needsTFallback.push({ file: filepath, reason: 'useLanguage() not destructured at top-level' });
    return;
  }
  const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
  if (!names.includes('tFallback')) {
    const tIdx = names.indexOf('t');
    if (tIdx >= 0) names.splice(tIdx + 1, 0, 'tFallback');
    else           names.push('tFallback');
    finalSrc = finalSrc.replace(destructureRe, `const { ${names.join(', ')} } = useLanguage();`);
  }

  writeFileSync(filepath, finalSrc);
  filesChanged += 1;
  replacements += localReplacements;
  console.log(`✓ ${filepath}  (${localReplacements} replacement${localReplacements > 1 ? 's' : ''})`);
}

await walk(ROOT);

console.log('');
console.log(`Scanned    : ${filesScanned} files`);
console.log(`Changed    : ${filesChanged} files`);
console.log(`Replacements: ${replacements}`);
if (needsTFallback.length) {
  console.log('');
  console.log('⚠️  Manual review needed:');
  for (const { file, reason } of needsTFallback) {
    console.log(`   ${file}  — ${reason}`);
  }
}
