// The released-locale list, and the rule that keeps it honest.
//
// Cutting the picker from fifteen languages to one broke no test at all. That
// is the gap this file closes: the decision about which locales a user can
// choose had nothing holding it in place, in either direction. Someone could
// re-add a half-finished language, or drop a finished one, and 4,960 tests
// would stay green.
//
// The rule is that a locale is offered when it is FINISHED, not when it is
// started. Every locale shelved on 2026-08-13 sat near 49% of the English
// catalog, and a screen half in Arabic reads as a broken app where an absent
// language reads as a decision.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ALL_LANGUAGES, SUPPORTED_LANGUAGES } from '../i18n';

const DIR = 'src/locales';
const meta = JSON.parse(fs.readFileSync(path.join(DIR, '_meta.json'), 'utf8'));
const catalog = (l) => JSON.parse(fs.readFileSync(path.join(DIR, `${l}.json`), 'utf8'));
const en = catalog('en');

// How complete a locale must be to be offered. Not 100%: `_meta.json` holds
// keys deliberately left English (prose a machine translation would worsen),
// so a genuinely finished locale still sits a little under.
const COMPLETE = 0.95;

describe('the released locales', () => {
  it('match what src/locales/_meta.json records', () => {
    // Two places state the decision — the code the app runs, and the file a
    // translator reads. They must not drift.
    expect(SUPPORTED_LANGUAGES.map((l) => l.code).sort())
      .toEqual([...meta.released.locales].sort());
  });

  it('account for every catalog: released + shelved covers all of them', () => {
    const accounted = [...meta.released.locales, ...meta.released.shelved.locales].sort();
    expect(accounted).toEqual(ALL_LANGUAGES.map((l) => l.code).sort());
  });

  it('are a subset of the languages that have a catalog', () => {
    const all = new Set(ALL_LANGUAGES.map((l) => l.code));
    for (const l of SUPPORTED_LANGUAGES) {
      expect(all.has(l.code), `${l.code} is offered but has no catalog`).toBe(true);
    }
  });

  it('always include English, which is the fallback everything else resolves to', () => {
    expect(SUPPORTED_LANGUAGES.map((l) => l.code)).toContain('en');
  });

  it.each(SUPPORTED_LANGUAGES.map((l) => l.code))(
    '%s is complete enough to offer',
    (code) => {
      // The rule the shelving exists to enforce. Offering a locale at half
      // coverage is the exact defect that was removed; this fails before it
      // can come back.
      const d = catalog(code);
      const pct = Object.keys(en).filter((k) => d[k] != null).length / Object.keys(en).length;
      expect(
        pct,
        `${code} is ${(pct * 100).toFixed(1)}% translated — below the ${COMPLETE * 100}% bar to ` +
        'be offered. Finish it (npm run i18n:audit shows the gap) rather than lowering this.',
      ).toBeGreaterThanOrEqual(COMPLETE);
    },
  );

  it('keeps every shelved catalog on disk, so re-offering one costs no recovery', () => {
    for (const code of meta.released.shelved.locales) {
      const p = path.join(DIR, `${code}.json`);
      expect(fs.existsSync(p), `${code} is shelved but its catalog was deleted`).toBe(true);
      // Non-trivial, too — an empty file would technically exist.
      expect(Object.keys(catalog(code)).length).toBeGreaterThan(500);
    }
  });
});
