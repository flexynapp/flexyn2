// The "Tell us about yourself" step asks three things and required two. Sex
// could be left untouched and Continue still went through — and because an
// unset value silently takes the conservative middle in `_demographicScale`
// (starting loads) and BMR, nobody ever saw a consequence. They just got a
// plan calibrated on a guess.
//
// The rule itself is `canLeaveAboutStep` in onboardingProfile.js, unit-tested
// there. These are the wiring checks: that the step actually calls it, that
// the dead Continue says which answer is missing, and that the option which
// makes requiring an answer fair renders the words it claims to.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync('src/pages/Onboarding.jsx', 'utf8');
const I18N = readFileSync('src/lib/i18n-onboarding.js', 'utf8');

function aboutStep() {
  const start = SOURCE.indexOf('function AgeStep(');
  const end = SOURCE.indexOf('function HeightStep(', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe('about step — sex is required', () => {
  it('gates Continue on the shared rule, not an inline condition', () => {
    const step = aboutStep();
    expect(step).toContain('canLeaveAboutStep({ username, usernameError, gender })');
    expect(step).toContain('disabled={!canNext}');
    // The old gate, which had no sex condition, must not come back.
    expect(step).not.toMatch(/canNext\s*=\s*username\.trim\(\)\.length/);
  });

  it('imports the rule rather than redefining the threshold locally', () => {
    // Continue and the username availability check read one constant. They
    // drifted to 3 and 2 once, and a two-character name went unchecked until
    // the final save came back 23505.
    expect(SOURCE).toContain("MIN_USERNAME_LENGTH, canLeaveAboutStep } from '@/lib/data/onboardingProfile'");
    expect(SOURCE).not.toMatch(/^const MIN_USERNAME_LENGTH\s*=/m);
  });

  it('tells the user which answer is missing', () => {
    // A dead Continue with no reason is the defect the username states already
    // fixed; a third blocker needs its own line for the same reason.
    const step = aboutStep();
    expect(step).toContain('onboarding.about.ctaNoSex');
    expect(step).toContain('onboarding.about.ctaNoUsername');
    expect(step).toContain('onboarding.about.ctaBadUsername');
    expect(I18N).toContain("'onboarding.about.ctaNoSex'");
  });

  it('renders "Prefer not to say", which is what makes requiring it fair', () => {
    // The labels were looked up as `onboarding.about.sex.${id}` with the real
    // copy as the FALLBACK — and that key set existed, so `sex.other`
    // ('Other') won and the button never showed the intended words. A
    // fallback only fires when the key is missing.
    const step = aboutStep();
    expect(step).toContain('onboarding.about.sexSkip');
    expect(step).not.toMatch(/tFallback\(`onboarding\.about\.sex\.\$\{o\.id\}`/);
    expect(I18N).toContain("'onboarding.about.sexSkip': 'Prefer not to say'");
    expect(I18N).not.toContain("'onboarding.about.sex.other'");
    expect(I18N).not.toContain("'onboarding.about.sex.male'");
    expect(I18N).not.toContain("'onboarding.about.sex.female'");
  });

  it('offers exactly the three options the rule accepts', () => {
    const step = aboutStep();
    const ids = [...step.matchAll(/\{ id: '(female|male|other)',/g)].map(m => m[1]);
    expect(ids).toEqual(['female', 'male', 'other']);
  });
});
