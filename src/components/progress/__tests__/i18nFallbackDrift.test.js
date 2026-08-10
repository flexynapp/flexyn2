/**
 * A defined key WINS over its call-site fallback, and that makes copy edits
 * fail silently.
 *
 * `tFallback('a.b', 'English')` returns the fallback only when `a.b` exists
 * NOWHERE. The moment a part file defines it, the part file's value is what
 * ships — so editing the English at the call site changes nothing, produces
 * a clean-looking diff, and passes review. That is not hypothetical: this
 * test shipped with four such edits already broken, and the two segmented-
 * control labels among them had been showing "Active Achievements" and
 * "Completed Achievements" long after someone shortened them to "In
 * progress" and "Earned".
 *
 * It also runs the other way. Adding a part-file entry for a key that was
 * already being called rewrites the screen unless the new value matches the
 * fallback character for character — which is how four of the keys added
 * alongside this test very nearly shipped text their call sites had never
 * used ('No badges yet' had been typed as 'No achievements yet').
 *
 * Scoped to `src/components/progress` because that is the tree this was
 * audited across. Widening it is welcome; expect the list below to grow
 * first, then shrink.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const DIR = 'src/components/progress';
const AGGREGATE = 'src/lib/i18n-langs/en.js';

/** Turn a JS string literal's body into the string JS would produce. */
const unescape = (s) => s.replace(/\\(n|t|r|\\|'|")/g, (_, c) => (
  { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' }[c]
));

const en = Object.fromEntries(
  [...fs.readFileSync(AGGREGATE, 'utf8').matchAll(/^\s*"([^"]+)":\s*("(?:\\.|[^"])*")/gm)]
    .map(([, k, v]) => [k, JSON.parse(v)]),
);

/** [file, key, fallback] for every tFallback call with a literal fallback. */
function callSites() {
  const out = [];
  for (const f of fs.readdirSync(DIR).filter((x) => /\.jsx?$/.test(x))) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8');
    for (const m of src.matchAll(/tFallback\(\s*['"]([\w.]+)['"]\s*,\s*(['"])((?:\\.|(?!\2).)*)\2/g)) {
      out.push([f, m[1], unescape(m[3])]);
    }
  }
  return out;
}

// Drift this test is willing to tolerate, with a reason attached.
//
// EMPTY, and it should stay that way. The four entries it shipped with are
// fixed: `progress.activeAchievements` and `.completedAchievements` now say
// "In progress" and "Earned", and `photos.takePhoto` / `.tryAgain` are in
// sentence case — in every case the call site's English, which is what
// someone meant the user to read.
//
// Worth recording how that was fixed, because the obvious move is wrong.
// Changing the English does NOT oblige clearing the translations. The 14
// non-English values for the achievements pair still render the previous,
// longer phrasing, and were kept: they describe exactly what the segment
// holds, so a Spanish reader is correctly served. Deleting them would have
// forced English on 14 languages to make a register consistent, which is a
// worse screen for those users today. See the note in i18n-part4.js.
//
// Add an entry only with that kind of reasoning written down. Shrink this
// list; never grow it casually.
const KNOWN_DRIFT = new Set([]);

describe('a part file cannot silently rewrite what a Progress screen says', () => {
  const sites = callSites();

  it('found the call sites at all', () => {
    // Guards the regex: a scan that matches nothing passes every assertion
    // below and proves exactly nothing.
    expect(sites.length).toBeGreaterThan(100);
  });

  it('every defined key matches the English its call site passes', () => {
    const drift = sites
      .filter(([, k]) => k in en && !KNOWN_DRIFT.has(k))
      .filter(([, k, fb]) => en[k] !== fb)
      .map(([f, k, fb]) => `${f} ${k}\n    call site: ${JSON.stringify(fb)}\n    part file: ${JSON.stringify(en[k])}`);
    expect(drift, `\n${drift.join('\n')}\n`).toEqual([]);
  });

  it('has no stale entries — every known drift is still drifting', () => {
    // A fixed entry left here would exempt a future regression on the same
    // key. Same rule as AWAITING_TRANSLATION in i18nCoverage.
    for (const key of KNOWN_DRIFT) {
      const site = sites.find(([, k]) => k === key);
      expect(site, `${key} is no longer called in ${DIR} — drop it`).toBeTruthy();
      expect(en[key], `${key} is no longer defined — drop it`).toBeDefined();
      expect(en[key], `${key} no longer drifts — drop it from KNOWN_DRIFT`).not.toBe(site[2]);
    }
  });
});

describe('every key a Progress surface calls is defined somewhere', () => {
  it('has no keys that exist only as an inline fallback', () => {
    // These render correct English, so nothing looks wrong — but the key is
    // invisible to `i18n-audit.mjs` and to anyone doing a translation pass,
    // so it can never BE translated. Twelve were found in this tree.
    const undefined_ = [...new Set(callSites().map(([, k]) => k))].filter((k) => !(k in en)).sort();
    expect(undefined_, `defined nowhere: ${undefined_.join(', ')}`).toEqual([]);
  });
});
