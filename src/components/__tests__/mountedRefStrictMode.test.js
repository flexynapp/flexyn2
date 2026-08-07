// src/components/__tests__/mountedRefStrictMode.test.js
//
// A guard for one defect class: an "am I still mounted?" ref that is only ever
// set to FALSE.
//
//     const mountedRef = useRef(true);
//     useEffect(() => () => { mountedRef.current = false; }, []);
//
// That reads as correct and is broken under React 18 StrictMode, which this app
// enables in main.jsx. StrictMode runs effects setup -> cleanup -> setup on
// mount, so the cleanup fires once immediately and nothing restores the flag.
// `useRef(true)`'s initial value is spent by the first render; from then on the
// ref is false for the entire session and every branch gated on it silently
// no-ops. In dev only, which is where it was found.
//
// What it cost: MoodLogCard and SleepLogCard both did
//   const res = await upsertX(...);
//   if (!mountedRef.current) return;   // <- always true, so always returned
//   qc.invalidateQueries(...)
// The row was written every time. The invalidate that makes the card and the
// Readiness score re-read it never ran, so the value never appeared and the
// score kept using a neutral estimate. StepsLogCard has no such flag, which is
// why steps saved and the other two "didn't". LanguageContext had the same
// shape gating setLanguage() after its await, so changing language in dev
// applied neither the state nor the localStorage write.
//
// The fix is one line — assign true in the setup — and this test is here
// because the broken form is the one that looks idiomatic.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'i18n-langs' || name === '__tests__') continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.jsx?$/.test(name)) out.push(p);
  }
  return out;
}

// Any ref whose name says "mounted" and which is compared as a liveness gate.
const FLAG_RE = /\b(\w*[mM]ounted\w*)\s*=\s*useRef\(/g;

// Comments must come out before scanning. The first version of this test
// passed with the bug deliberately reintroduced, because the explanatory
// comment above the fix in MoodLogCard contains `mountedRef.current = true`
// as example code — so the "is it set true?" regex matched prose. A guard that
// reads its own documentation as evidence proves nothing.
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('mounted-flag refs survive StrictMode double-invocation', () => {
  const files = walk(SRC).filter(f => {
    const s = stripComments(readFileSync(f, 'utf8'));
    return /useRef\(/.test(s) && /[mM]ounted/.test(s);
  });

  it('finds the files that use a mounted flag', () => {
    // Guards the walk itself — if this hits zero the assertions below are
    // vacuous and the whole file is decoration.
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const rel = file.slice(SRC.length + 1);
    const source = stripComments(readFileSync(file, 'utf8'));
    const names = [...source.matchAll(FLAG_RE)].map(m => m[1]);
    if (names.length === 0) continue;

    it(`${rel} sets its mounted flag true on setup`, () => {
      for (const name of names) {
        const setsFalse = new RegExp(`${name}\\.current\\s*=\\s*false`).test(source);
        const setsTrue = new RegExp(`${name}\\.current\\s*=\\s*true`).test(source);
        const gates = new RegExp(`(!\\s*)?${name}\\.current`).test(source);
        if (!setsFalse || !gates) continue; // not used as a liveness gate

        expect(
          setsTrue,
          `${rel}: ${name}.current is set to false on cleanup but never back to true. `
          + `React 18 StrictMode runs effects setup -> cleanup -> setup, so this flag is `
          + `false from the first paint in dev and every branch gated on it no-ops for `
          + `the whole session. Assign ${name}.current = true in the effect setup:\n`
          + `  useEffect(() => {\n`
          + `    ${name}.current = true;\n`
          + `    return () => { ${name}.current = false; };\n`
          + `  }, []);`,
        ).toBe(true);
      }
    });
  }
});
