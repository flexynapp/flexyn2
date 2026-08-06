// The coach's step ids and the flow's step list have to be the same set.
//
// They drifted once already: the `body_baseline` step was deleted from
// onboarding and its coach guide stayed behind — a full intro, prompts, an
// explanation of waist and body-fat measurements, and a skip answer, for a
// screen that no longer exists. Unreachable, so nothing broke, but the coach
// was carrying a confident description of the app as it used to be. That is
// the shape of every "the AI is making things up" report in a rule-based
// coach: not invention, but text that outlived what it described.
//
// The drift runs both ways, so this checks both:
//   · a guide for a step that doesn't exist is dead text waiting to reappear
//     if the id is ever reused
//   · a step with no guide silently hides the coach button, because
//     StepHeader only renders it when hasCoachFor() is true

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OB, hasCoachFor } from '../onboardingCoach';

const ONBOARDING = readFileSync('src/pages/Onboarding.jsx', 'utf8');

/** The flow's own step order, read from the source of truth. */
function flowSteps() {
  const line = ONBOARDING.match(/^const STEPS = \[(.*)\];$/m);
  expect(line, 'STEPS array not found — did it get renamed?').toBeTruthy();
  return [...line[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

describe('coach step coverage', () => {
  it('knows every step the flow has, and no others', () => {
    expect([...Object.values(OB)].sort()).toEqual([...flowSteps()].sort());
  });

  it('has no guide for a step that was removed', () => {
    // The specific one that drifted. Kept by name so a re-added
    // `body_baseline` guide has to be a deliberate act.
    expect(hasCoachFor('body_baseline')).toBe(false);
  });

  it('offers the coach on the steps that ask something', () => {
    // Not every step earns one — `loading` and `reveal` have nothing to ask
    // about — but every step the user answers on does.
    for (const step of ['goal', 'sharpen', 'experience', 'age', 'height', 'weight', 'days', 'assessment']) {
      expect(hasCoachFor(step), step).toBe(true);
    }
  });
});
