// src/lib/__tests__/i18nRawKeys.test.js
//
// Guards the one promise the i18n layer makes: a user never sees a raw key
// path. It was being broken in five places when this was written, and the
// reason is worth stating because it is not obvious from reading a call site.
//
// `getTranslation` ends with `return enVal ?? key` — on a total miss it hands
// back THE KEY STRING. That string is non-empty, so it is truthy. Therefore:
//
//     t('nutrition.toast.waterCap') || "That's plenty of water for today"
//
// never reaches its fallback. The `||` sees `"nutrition.toast.waterCap"`,
// decides the lookup worked, and the user gets a toast reading
// `nutrition.toast.waterCap`. CLAUDE.md documented this exact pattern as the
// house idiom, which is how five of them accumulated.
//
// `tFallback(key, 'English')` is the correct call: it compares the result
// against the key and substitutes on an exact match.
//
// Two checks below, in order of how much they catch:
//
//   1. No `t('key') || 'fallback'` anywhere. This is the important one — it
//      fails on the PATTERN, so it catches a new instance the day it lands,
//      whether or not the key happens to exist in en today.
//   2. No literal `t('key')` naming a key absent from the built en aggregate.
//      Catches the case where someone drops the `||` entirely.
//
// Scope note: only files that pull `t` from `useLanguage()` are scanned.
// `crewTreasury.js` takes `tFallback` as a PARAMETER and aliases it to a
// local `t` — `describeLedgerReason(reason, tFallback)` — so its internal
// `t('treasury.warWon', 'War won')` calls are correct and must not be
// flagged. An earlier draft of this audit reported all eight of them as
// bugs; they aren't, and the useLanguage() filter is what keeps them out.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Resolve from cwd rather than import.meta.url: vitest rewrites the module
// URL, so `new URL('../../', import.meta.url).pathname` resolved to a bare
// "/src" and the walk blew up with ENOENT before a single check ran.
const SRC = resolve(process.cwd(), 'src');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'i18n-langs' && entry !== '__tests__') walk(p, out);
    } else if (/\.jsx?$/.test(entry) && !/^i18n-/.test(entry)) {
      out.push(p);
    }
  }
  return out;
}

// Files where `t` is genuinely the context translator.
const contextTFiles = walk(SRC).filter((f) => {
  const src = readFileSync(f, 'utf8');
  return /useLanguage\(\)/.test(src) && /\bt\b\s*[,}]/.test(src);
});

const enKeys = (() => {
  const raw = readFileSync(join(SRC, 'lib/i18n-langs/en.js'), 'utf8');
  return new Set([...raw.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]));
})();

const rel = (f) => f.slice(f.indexOf('/src/') + 1);

// Comments describing a past bug quote the very pattern we're banning —
// DailyQuestsCard has `// the prior t('...').replace('{coins}', …) left the`.
// Scanning raw source flags that as a live offender, which would make the
// only fix "stop explaining the bug in a comment". Strip them first.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');
}

describe('i18n — no raw key can reach the user', () => {
  it('has a populated English aggregate to check against', () => {
    // If this ever reads 0 the two checks below would silently pass forever.
    expect(enKeys.size).toBeGreaterThan(1000);
  });

  it("never uses t('key') || 'fallback' — the || can never fire", () => {
    const offenders = [];
    for (const f of contextTFiles) {
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(
        /(?<![A-Za-z0-9_.$])t\(\s*['"]([^'"]+)['"]\s*\)\s*\|\|/g,
      )) {
        offenders.push(`${rel(f)} → t('${m[1]}') || …`);
      }
    }
    expect(
      offenders,
      `Use tFallback('key', 'English') instead — t() returns the key itself on a\n` +
        `miss, and a non-empty string is truthy, so || never reaches the fallback:\n` +
        offenders.map((o) => `  ${o}`).join('\n'),
    ).toEqual([]);
  });

  it('never calls t() with a literal key that is missing from en', () => {
    const offenders = [];
    for (const f of contextTFiles) {
      const src = stripComments(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/(?<![A-Za-z0-9_.$])t\(\s*['"]([^'"]+)['"]/g)) {
        const key = m[1];
        // Dotted only: a bare word is some other one-letter-named function.
        if (!key.includes('.')) continue;
        if (!enKeys.has(key)) offenders.push(`${rel(f)} → t('${key}')`);
      }
    }
    expect(
      offenders,
      `en is the last fallback before the raw key, so a key missing from en\n` +
        `renders as its own path in ALL 15 languages. Add it to a part file, or\n` +
        `switch the call to tFallback('key', 'English'):\n` +
        offenders.map((o) => `  ${o}`).join('\n'),
    ).toEqual([]);
  });
});
