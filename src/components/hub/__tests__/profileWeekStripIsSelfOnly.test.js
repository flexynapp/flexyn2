/**
 * Every other athlete's profile announced "Trained 0 of the last 7 days".
 *
 * `workout_logs` carries exactly one policy — `created_by =
 * current_user_email() OR user_id = auth.uid()` — so filtering it by another
 * user's email returns [] rather than an error. `buildTrainingWeek([])` still
 * returns seven days (a fixed Monday-to-Sunday calendar week is the point of
 * it), each with `trained: false`. So the banner's `week.length > 0` guard
 * was always satisfied and the strip painted seven blank squares about a
 * person the viewer had no data on. An athlete who trained all seven days was
 * shown as having trained none — the reading is not "unknown", it is wrong.
 *
 * There is no server surface exposing another user's training days, and
 * adding one is a privacy decision rather than a UI one — the same call
 * already made for `useHeroContests`. So the fix is to show nothing.
 *
 * A source scan because the invariant is about the CALL SITE. profileSurface
 * covers what the banner does with an empty week; the failure this guards is
 * someone deleting the `isSelf` ternary here, which no test of the banner can
 * see. The query gate is asserted too: leaving it ungated would keep firing a
 * 500-row read whose every result is discarded.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REL = 'src/components/hub/HubProfile.jsx';
const src = readFileSync(resolve(process.cwd(), REL), 'utf8');

describe('HubProfile hero training week', () => {
  it('passes the week only for your own profile', () => {
    const prop = src.match(/^\s*week=\{([^}]*)\}/m);
    expect(prop, 'ProfileTierBanner must still be handed a week prop').toBeTruthy();
    expect(
      prop[1],
      'week must be gated on isSelf — another athlete\'s strip is all zeros, not their week',
    ).toContain('isSelf');
  });

  it('does not read workout_logs for somebody else', () => {
    // The profileLifts query and its enabled flag, matched together so a
    // stray `enabled: !!email` elsewhere in this 2000-line file cannot
    // satisfy the assertion on the wrong query's behalf.
    const q = src.match(/queryKey: \['profileLifts'[\s\S]{0,600}?\}\);/);
    expect(q, 'the profileLifts query must still exist').toBeTruthy();
    expect(q[0]).toMatch(/enabled:\s*isSelf\s*&&/);
  });

  it('still derives the week from the logs, so the gate is the only difference', () => {
    // Guards the lazy "fix": hardcoding week={[]} would pass the first test
    // and quietly delete the feature for the profile owner too.
    expect(src).toContain('buildTrainingWeek(heroLogs');
    expect(src).toMatch(/week=\{isSelf \? trainingWeek : \[\]\}/);
  });
});
