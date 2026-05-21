#!/usr/bin/env node
// scripts/fix-broken-t-fallback.mjs
//
// Sweep tool — replaces the broken `t('key') || 'fallback'` idiom
// with the correct `tFallback('key', 'fallback')` form across the
// codebase. This pattern was rendering the literal dotted key path
// to users on any locale where the key was missing (because t(k)
// returns the key string itself on miss, which is truthy, so the
// `|| 'fallback'` branch never fires).
//
// Idempotent + safe to re-run. Only touches files that contain the
// exact broken pattern; preserves all other code unchanged.

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || 'src');

// Matches: t('some.key.path') || 'fallback string'
//          OR (t('some.key') || 'fallback')
// Captures key + fallback so we can rebuild as tFallback('key', 'fallback').
// Permissive on whitespace; strict on quote style (single quotes only —
// the codebase uses single quotes consistently for these literals).
const BROKEN_RE = /t\(\s*'([^']+)'\s*\)\s*\|\|\s*'([^']*)'/g;

let filesScanned   = 0;
let filesChanged   = 0;
let replacements   = 0;
let needsTFallback = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip test directories — they intentionally exercise edge cases
      // including the original-string form.
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
  // Reset lastIndex after the .test() consumed it.
  BROKEN_RE.lastIndex = 0;

  let localReplacements = 0;
  const next = src.replace(BROKEN_RE, (_full, key, fallback) => {
    localReplacements += 1;
    return `tFallback('${key}', '${fallback}')`;
  });
  if (localReplacements === 0) return;

  // Ensure tFallback is in scope. Two cases:
  //   1. File already destructures useLanguage — add tFallback to the
  //      destructure list if not present.
  //   2. File imports useLanguage but doesn't destructure (rare). We
  //      flag those for manual review rather than guessing.
  let finalSrc = next;
  const hasUseLanguageImport = /from\s+['"]@\/lib\/LanguageContext['"]/.test(finalSrc);
  if (!hasUseLanguageImport) {
    needsTFallback.push({ file: filepath, reason: 'no useLanguage import' });
    return;
  }
  // Look for an existing destructure like `const { t } = useLanguage();`
  // (with optional other names). If tFallback is already there, no
  // change needed.
  const destructureRe = /const\s*\{\s*([^}]+)\}\s*=\s*useLanguage\s*\(\s*\)\s*;?/;
  const m = destructureRe.exec(finalSrc);
  if (!m) {
    needsTFallback.push({ file: filepath, reason: 'useLanguage() not destructured at top-level' });
    return;
  }
  const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
  if (!names.includes('tFallback')) {
    // Insert tFallback right after t in the destructure list.
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
