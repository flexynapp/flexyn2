/**
 * The list of body regions a user can declare an injury on exists TWICE —
 * `MUSCLE_GROUPS` in InjuryForm.jsx and `OB_MUSCLES` in Onboarding.jsx — and
 * nothing links them. A region present in one and not the other is the worst
 * of the three states: the app asks about injuries during onboarding, so a
 * user who cannot declare one THERE has already been handed a plan by the
 * time the fuller list appears.
 *
 * This is the fourth duplicated muscle vocabulary found in this codebase in a
 * day (the picker's ALL_MUSCLE_GROUPS is triplicated, plus a dead fourth copy
 * in Workout.jsx). Rather than refactor a duplication these lists did not
 * create, pin the invariant that actually matters: they agree.
 *
 * Read from source rather than imported because neither is exported, and
 * exporting them purely for a test would be the tail wagging the dog — see
 * mountedRefStrictMode.test.js for the same approach.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

/** Pull a single-line array literal's string entries out of a source file. */
function arrayLiteral(source, constName) {
  const m = source.match(new RegExp(`const ${constName} = \\[([^\\]]*)\\]`));
  if (!m) throw new Error(`${constName} not found — was it renamed or reformatted?`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const INJURY_FORM = arrayLiteral(read('src/components/workout/InjuryForm.jsx'), 'MUSCLE_GROUPS');
const ONBOARDING = arrayLiteral(read('src/pages/Onboarding.jsx'), 'OB_MUSCLES');

describe('the injurable regions are one vocabulary, stored in two places', () => {
  it('finds both lists', () => {
    expect(INJURY_FORM.length).toBeGreaterThan(0);
    expect(ONBOARDING.length).toBeGreaterThan(0);
  });

  it('agrees on every region, in the same order', () => {
    // Order matters as well as membership: these render as chip rows and the
    // two screens should not present the body in different sequences.
    expect(ONBOARDING).toEqual(INJURY_FORM);
  });

  it('includes Forearms, which the library can program', () => {
    // The regression this exists for: grip work was retagged off 'Back' onto
    // 'Forearms', which was not a declarable region — so those exercises went
    // from being excluded by a back injury (wrongly, but protectively) to
    // being excludable by nothing at all. A group the library can program and
    // nobody can flag is the hole.
    expect(INJURY_FORM).toContain('Forearms');
    expect(ONBOARDING).toContain('Forearms');
  });
});
