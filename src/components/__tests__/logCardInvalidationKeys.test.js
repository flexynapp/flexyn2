// src/components/__tests__/logCardInvalidationKeys.test.js
//
// A source-level guard for one defect class: a daily-log card invalidating a
// query key that is LONGER than the key its readers subscribe to.
//
// React Query prefix-matches downwards only. invalidateQueries(['k', uid])
// matches ['k', uid] and ['k', uid, date]; invalidateQueries(['k', uid, date])
// matches neither ['k', uid] nor anything reading it.
//
// MoodLogCard shipped with the 3-element form. The result was invisible in the
// card itself — it refetched its own state fine — and wrong everywhere else:
// useReadiness subscribes to ['moodLogToday', uid], never heard about the
// write, and kept substituting a neutral estimate for mood/soreness, which is
// 25% of the Readiness score. The sheet showed "Mood / soreness — not logged"
// with the emoji visibly selected one card above it.
//
// Asserted at the source rather than by rendering: the failure is a string
// mismatch between two files, and a render test would need the real cards, the
// real hook and a shared QueryClient to reproduce what one regex states
// directly.
//
// Because it scans SOURCE, moving a write to a new file makes this fail even
// when the behaviour is unchanged — which is what happened when the mood write
// moved into logMoodAction.js. That is the guard working: it is asserting where
// the invalidation is, and the answer changed. Point it at the new file; never
// relax the assertion.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(resolve(SRC, rel), 'utf8');

// Where a daily log is WRITTEN, and the readers that must hear about it.
//
// Mood is `lib/data/logMoodAction.js`, not MoodLogCard: three surfaces log a
// mood now (the card, the journal day screen, the dashboard journal widget)
// and they share one action, because two of them were doing only some of the
// five things a logged mood owes. This guard follows the invalidation to
// wherever it lives — if it moves again, move this entry with it rather than
// deleting the case.
const WRITERS = [
  'lib/data/logMoodAction.js',
  'components/dashboard/SleepLogCard.jsx',
  'components/dashboard/StepsLogCard.jsx',
];
const READERS = [
  'hooks/useReadiness.js',
  'components/dashboard/TodayLogCard.jsx',
];

const KEY_RE = /\[\s*'((?:mood|sleep|step)LogToday)'([^\]]*)\]/g;

/** Every *LogToday key literal in a file, as { name, length }. */
function keysIn(source) {
  const out = [];
  for (const m of source.matchAll(KEY_RE)) {
    const rest = m[2].split(',').map(s => s.trim()).filter(Boolean);
    out.push({ name: m[1], length: 1 + rest.length, raw: m[0] });
  }
  return out;
}

function invalidationsIn(source) {
  // Only the keys passed to invalidateQueries, not the ones passed to useQuery.
  return [...source.matchAll(/invalidateQueries\(\s*\{\s*queryKey:\s*(\[[^\]]*\])/g)]
    .flatMap(m => keysIn(m[1]));
}

describe('daily-log cards invalidate a key their readers can hear', () => {
  const readerKeys = READERS.flatMap(f => keysIn(read(f)));

  it('has readers subscribing to the 2-element prefix', () => {
    // Guards the test itself: if the readers change shape, the contract below
    // is measuring nothing.
    expect(readerKeys.length).toBeGreaterThan(0);
    for (const k of readerKeys) expect(k.length).toBe(2);
  });

  for (const file of WRITERS) {
    it(`${file.split('/').pop()} invalidates a prefix of its readers' keys`, () => {
      const invalidations = invalidationsIn(read(file));
      expect(invalidations.length).toBeGreaterThan(0);

      for (const inv of invalidations) {
        const readers = readerKeys.filter(r => r.name === inv.name);
        if (readers.length === 0) continue; // nothing outside the card reads it
        for (const r of readers) {
          expect(
            inv.length,
            `${file} invalidates ${inv.raw} (${inv.length} elements) but a reader `
            + `subscribes with ${r.length}. React Query prefix-matches downwards `
            + `only, so this write never reaches that reader — invalidate the `
            + `${r.length}-element prefix instead.`,
          ).toBeLessThanOrEqual(r.length);
        }
      }
    });
  }

  it('mood specifically invalidates the readiness-visible prefix', () => {
    // The regression that prompted this file, stated plainly.
    const inv = invalidationsIn(read('lib/data/logMoodAction.js'))
      .filter(k => k.name === 'moodLogToday');
    expect(inv.length).toBeGreaterThan(0);
    for (const k of inv) expect(k.length).toBe(2);
  });
});
