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

  it('separates "Other" from "Prefer not to say"', () => {
    // They are different answers: "Other" states something about the user's
    // sex, declining does not. Offering only one of them makes someone who
    // simply doesn't want to answer pick a category that describes them —
    // which matters much more now the question can't be skipped.
    const step = aboutStep();
    expect(step).toContain('onboarding.about.sexOther');
    expect(step).toContain('onboarding.about.sexSkip');
    expect(I18N).toContain("'onboarding.about.sexOther': 'Other'");
    expect(I18N).toContain("'onboarding.about.sexSkip': 'Prefer not to say'");
  });

  it('does not look the labels up through a key that shadows them', () => {
    // The labels were looked up as `onboarding.about.sex.${id}` with the real
    // copy as the FALLBACK — and that key set existed, so `sex.other`
    // ('Other') won and the third button never showed the intended words. A
    // fallback only fires when the key is missing.
    const step = aboutStep();
    expect(step).not.toMatch(/tFallback\(`onboarding\.about\.sex\.\$\{o\.id\}`/);
    for (const dead of ['sex.other', 'sex.male', 'sex.female']) {
      expect(I18N).not.toContain(`'onboarding.about.${dead}'`);
    }
  });

  it('offers exactly the four options, declining last', () => {
    const step = aboutStep();
    const ids = [...step.matchAll(/\{ id: '(female|male|other|prefer_not_to_say)',/g)].map(m => m[1]);
    expect(ids).toEqual(['female', 'male', 'other', 'prefer_not_to_say']);
    // Four in a single row would put "Prefer not to say" on three lines at
    // 375px; 2x2 gives every label a full-width column.
    expect(step).toContain('grid grid-cols-2 gap-2');
  });

  it('leaves every downstream consumer on its neutral branch', () => {
    // The new value must behave exactly like 'other' everywhere, and does,
    // because each consumer names 'male'/'female' and lets the rest fall
    // through. Asserted here so a future `=== 'other'` special case has to
    // decide consciously what declining means rather than silently excluding
    // it. (realisticLimits and workoutFatigue branch on 'female' alone.)
    const gen = readFileSync('src/lib/aiCoach/workoutGenerator.js', 'utf8');
    const nut = readFileSync('src/lib/nutritionDefaults.js', 'utf8');
    for (const src of [gen, nut]) expect(src).not.toContain("=== 'other'");
    expect(gen).toContain("if (g === 'male')");
    expect(gen).toContain("else if (g === 'female')");
  });
});
