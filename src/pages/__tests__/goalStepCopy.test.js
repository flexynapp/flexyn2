// The goal step used to answer a pick with chips describing what the app was
// about to configure, and three of them named the anti-cheat systems by the
// signal each one watches: "Anti-cheat: bar speed", "Anti-cheat: rest timer",
// "Form-check anti-cheat". That handed every brand-new account both the
// existence of the checks and their inputs, on the second screen of signup,
// before anyone had logged a set — universal knowledge of a system that only
// works while it is not universally known.
//
// The chips are gone and the step now shows nothing in their place. This
// guards the copy, not the layout: whatever fills that space later must not
// put the checks back on the screen.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync('src/pages/Onboarding.jsx', 'utf8');

/** The GoalStep component body, sliced out of the page. */
function goalStep() {
  const start = SOURCE.indexOf('function GoalStep(');
  const end = SOURCE.indexOf('STEP 2b: SHARPEN YOUR PLAN');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe('goal step copy', () => {
  it('never mentions the anti-cheat systems', () => {
    expect(goalStep().toLowerCase()).not.toContain('anti-cheat');
  });

  it('does not name what those checks watch either', () => {
    // Naming the signal is the same disclosure as naming the system.
    const body = goalStep().toLowerCase();
    for (const signal of ['bar speed', 'rest timer', 'form-check', 'form check']) {
      expect(body, signal).not.toContain(signal);
    }
  });

  it('still offers every goal', () => {
    // A cheap canary: the step is the first thing a new account does, and the
    // slice above silently passes if GoalStep is renamed out from under it.
    for (const id of ['strength', 'muscle', 'lose', 'speed', 'endurance', 'mobility']) {
      expect(SOURCE).toContain(`id: '${id}'`);
    }
  });
});
