// An ORPHAN KEY is a `tFallback('some.key', 'English')` call site whose
// key is not in src/locales/en.json.
//
// It is the one i18n defect that every other guard in this repo is blind
// to, and the reason is worth stating because it is not obvious: an
// orphan renders PERFECTLY. tFallback falls through to its second
// argument, so an English reader sees exactly the right words, forever.
//
//   • i18n:audit compares each locale against en.json — a key that is
//     missing from en.json is missing from the comparison too.
//   • _coverage.json counts translated keys per locale — an orphan is not
//     a key anywhere, so it moves neither `translated` nor `englishEcho`.
//   • i18n-hardcoded.mjs hunts string literals in JSX — an orphan is
//     already wrapped in tFallback, so it reads as done.
//   • getTranslation's DEV warning fires only when English HAS the key
//     and the active locale does not.
//
// So the string is untranslatable and nothing says so. No translator and
// no TMS reading the catalogs can discover that it exists. Measured
// 2026-08-16 while doing the Crew Wars i18n pass: 764 of them against a
// 3,895-key catalog — roughly one in six of the strings that LOOK
// translated were never on the table at all.
//
// The pass cleared src/components/crews outright. The remainder are
// listed in src/locales/_orphans.json, and this file is the ratchet: the
// list may shrink and may not grow. Both directions are enforced, because
// a baseline nobody prunes becomes a lie — a key that has since been
// added to en.json must be deleted from the list, or the count stops
// meaning anything.
//
//   npm run i18n:orphans            what is outstanding
//   npm run i18n:orphans -- --write re-baseline after fixing some
import { describe, it, expect } from 'vitest';
import { findOrphans, readBaseline } from '../../../scripts/i18n-orphans.mjs';

const found    = findOrphans();
const foundSet = new Set(found.map((f) => f.key));
const baseline = readBaseline();
const baseSet  = new Set(baseline.keys);

describe('orphan translation keys', () => {
  it('does not add a tFallback key that has no en.json entry', () => {
    const added = [...foundSet].filter((k) => !baseSet.has(k)).sort();
    const where = (k) => found.filter((f) => f.key === k).map((f) => f.file).join(', ');
    expect(
      added,
      added.length
        ? 'These tFallback keys are not in src/locales/en.json, so the string renders in ' +
          'English in every language and no translator will ever see it. Add each key to ' +
          'en.json AND to every released locale (see src/locales/_meta.json):\n' +
          added.map((k) => `  ${k}  —  ${where(k)}`).join('\n')
        : '',
    ).toEqual([]);
  });

  it('has no stale entries — a fixed key must leave the baseline', () => {
    const stale = [...baseSet].filter((k) => !foundSet.has(k)).sort();
    expect(
      stale,
      stale.length
        ? 'These keys are baselined as orphans but now exist in en.json (or their call site ' +
          'is gone). That is progress — record it by running `npm run i18n:orphans -- --write`:\n' +
          stale.map((k) => `  ${k}`).join('\n')
        : '',
    ).toEqual([]);
  });

  it('keeps src/components/crews clear, which the Crew Wars pass emptied', () => {
    // The one directory that is fully done. A regression here is a new
    // crew string shipped without a catalog entry, which is exactly how
    // the other 626 accumulated.
    const crews = found.filter((f) => f.file.startsWith('src/components/crews/'));
    expect(
      crews.map((f) => `${f.key} (${f.file})`),
      'A new Crew string was added without an en.json entry.',
    ).toEqual([]);
  });
});
