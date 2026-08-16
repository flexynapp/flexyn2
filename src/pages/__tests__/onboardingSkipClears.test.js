// Every OPTIONAL step's "skip" must CLEAR what it collected, not just
// advance. Wired to a bare `next`, a skip button keeps the answers the user
// just declined to give — and every one of these feeds something real:
// `assessment` sets the starter plan's volume, `injury_history` is inserted
// into `injury_logs` AND removes muscle groups from the plan, `home_gym`
// creates a community gym and a membership.
//
// The injury step shipped with `onSkip={next}` and was reproduced end to end:
// log Chest + Legs, tap "Skip, no injuries", and both rows were still handed
// to the injury_logs insert. Audit 18 #4 found the identical bug on the
// body-baseline step; the fix reached `assessment` and `home_gym` and missed
// this one, which is exactly the shape a source-level guard catches and a
// green unit suite does not.
//
// Asserted against the source rather than by rendering because nothing in the
// repo renders Onboarding.jsx — see the audit notes. What matters is the
// wiring at the call site, and that is visible here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC = readFileSync(path.resolve(__dirname, '../Onboarding.jsx'), 'utf8');

/** Pull the JSX block that renders one step, by its `stepName === '<id>'` guard. */
function stepBlock(id) {
  const start = SRC.indexOf(`stepName === '${id}'`);
  expect(start, `no render block for step '${id}'`).toBeGreaterThan(-1);
  return SRC.slice(start, start + 1400);
}

describe('optional steps clear their answers when skipped', () => {
  const CASES = [
    { step: 'assessment',     field: 'assessment',          empty: '{}' },
    { step: 'injury_history', field: 'onboardingInjuries',  empty: '[]' },
    { step: 'home_gym',       field: 'homeGym',             empty: 'null' },
  ];

  for (const { step, field, empty } of CASES) {
    it(`${step}: onSkip resets ${field} to ${empty}`, () => {
      const block = stepBlock(step);
      const onSkip = block.match(/onSkip=\{([^]*?)\}\n/);
      expect(onSkip, `${step} passes no onSkip`).toBeTruthy();

      const handler = onSkip[1];
      // The bug shape: onSkip is just `next`, so skipping keeps the answers.
      expect(handler.trim(), `${step}'s skip is a bare next() — it advances without clearing`)
        .not.toBe('next');
      expect(handler).toContain(field);
      expect(handler).toContain(empty);
    });
  }

  it('every step that renders a skip control passes a real onSkip', () => {
    // A step whose component takes `onSkip` but is rendered without one falls
    // back to `onSkip || onNext` internally, which is the same silent bug.
    for (const { step } of CASES) {
      expect(stepBlock(step)).toMatch(/onSkip=\{/);
    }
  });
});

describe('the reveal summary does not strand an article', () => {
  // "for a {level} lifter" rendered "for a advanced lifter" — two of the four
  // levels start with a vowel, and the article is baked into the template
  // where no translator can agree it with anything.
  it('has no bare article immediately before an interpolated slot', () => {
    // Comments are stripped first: the fix's own comment quotes the old
    // broken string, and a match that spans lines would flag it.
    const code = SRC.replace(/^\s*\/\/.*$/gm, '');
    const templates = code.match(/'[^'\n]*\{level\}[^'\n]*'/g) || [];
    expect(templates.length).toBeGreaterThan(0);
    for (const t of templates) {
      expect(t, `article stranded before {level} in: ${t}`).not.toMatch(/\b(a|an)\s+\{level\}/i);
    }
  });
});
