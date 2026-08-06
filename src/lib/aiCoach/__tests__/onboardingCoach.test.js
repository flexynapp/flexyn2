import { describe, it, expect } from 'vitest';
import {
  OB, NUT, NUTRITION_STEP_IDS,
  inferGoals, inferLevel, inferActivity, inferNutritionGoal,
  suggestTargetDate, answerOnboarding, introFor, promptsFor, hasCoachFor,
} from '../onboardingCoach';

describe('inferGoals', () => {
  it('reads a plain description', () => {
    expect(inferGoals('I want to lose some belly fat')).toContain('lose');
    expect(inferGoals('trying to get stronger')).toContain('strength');
    expect(inferGoals('I want to run a faster mile')).toContain('speed');
  });

  it('returns every goal a multi-goal message points at', () => {
    const got = inferGoals('I want to lose fat and build muscle');
    expect(got).toEqual(expect.arrayContaining(['lose', 'muscle']));
  });

  it('is empty when nothing matches', () => {
    expect(inferGoals('what are these options')).toEqual([]);
    expect(inferGoals('')).toEqual([]);
    expect(inferGoals(null)).toEqual([]);
  });
});

describe('inferLevel', () => {
  it('reads the four levels', () => {
    expect(inferLevel("I've never lifted before")).toBe('newbie');
    expect(inferLevel('been training consistently for a year')).toBe('consistent');
    expect(inferLevel('5 years in, lifts are plateauing')).toBe('advanced');
  });

  // The ordering rule that matters: a message carrying BOTH a long history
  // and a break has to resolve to `returning`. Starting someone at their
  // pre-break numbers is how people get hurt in week one.
  it('prefers returning over advanced when the message has both', () => {
    expect(inferLevel('I lifted for three years but took a long break')).toBe('returning');
    expect(inferLevel('coming back after 5 years of training')).toBe('returning');
  });

  // Found by driving the real onboarding flow, not by the suite: the
  // original pattern matched "took time off" but not "took 2 years off",
  // so a four-year lifter two years out of the gym was answered Advanced.
  // These are the phrasings people actually type.
  it('reads every common way of saying "I stopped for a while"', () => {
    for (const said of [
      'I lifted seriously for about 4 years but took 2 years off',
      'trained hard for 6 years, took a year off',
      'was lifting 3 years then stopped training',
      "I've been out of the gym for 18 months",
      'took an 8 month hiatus after 5 years of lifting',
      'been away from the gym a while',
    ]) {
      expect(inferLevel(said), said).toBe('returning');
    }
  });

  it('returns null when it cannot tell', () => {
    expect(inferLevel('which one should I pick')).toBeNull();
    expect(inferLevel('')).toBeNull();
  });
});

describe('inferActivity', () => {
  it('reads a description of the day', () => {
    expect(inferActivity('I sit at a desk all day')).toBe('sedentary');
    expect(inferActivity("I'm a nurse on my feet all day")).toBe('very');
    expect(inferActivity('I train 3-5 times a week')).toBe('moderate');
    expect(inferActivity('construction worker')).toBe('extra');
  });

  it('returns null when it cannot tell', () => {
    expect(inferActivity('what does this mean')).toBeNull();
  });
});

describe('inferNutritionGoal', () => {
  it('maps to lose / gain / maintain', () => {
    expect(inferNutritionGoal('I want to drop 20 pounds')).toBe('lose');
    expect(inferNutritionGoal('bulking season')).toBe('gain');
    expect(inferNutritionGoal('just maintain where I am')).toBe('maintain');
  });
});

describe('suggestTargetDate', () => {
  const today = new Date(2026, 0, 1); // fixed so the assertion is stable

  it('caps loss at 1% of bodyweight per week', () => {
    const s = suggestTargetDate({ currentLbs: 200, targetLbs: 180, today });
    expect(s.perWeek).toBe(2);       // 1% of 200 = 2, and 2 is also the absolute cap
    expect(s.weeks).toBe(10);
  });

  it('applies the absolute 2 lb ceiling to heavier users', () => {
    // 1% of 300 is 3 lb/week, which the absolute cap has to override.
    const s = suggestTargetDate({ currentLbs: 300, targetLbs: 280, today });
    expect(s.perWeek).toBe(2);
    expect(s.weeks).toBe(10);
  });

  it('scales the rate down for lighter users', () => {
    const s = suggestTargetDate({ currentLbs: 130, targetLbs: 120, today });
    expect(s.perWeek).toBe(1.3);
    expect(s.weeks).toBe(8);
  });

  it('uses the slower rate for gaining', () => {
    const s = suggestTargetDate({ currentLbs: 150, targetLbs: 160, today });
    expect(s.perWeek).toBe(0.5);
    expect(s.weeks).toBe(20);
  });

  it('returns a date that many weeks out', () => {
    const s = suggestTargetDate({ currentLbs: 200, targetLbs: 180, today });
    expect(s.date.getTime()).toBe(new Date(2026, 0, 1 + 70).getTime());
  });

  it('is null on missing, unusable or already-met input', () => {
    expect(suggestTargetDate({ currentLbs: null, targetLbs: 180 })).toBeNull();
    expect(suggestTargetDate({ currentLbs: 200, targetLbs: 'abc' })).toBeNull();
    expect(suggestTargetDate({ currentLbs: 200, targetLbs: 200 })).toBeNull();
  });
});

describe('answerOnboarding', () => {
  it('always produces a reply — an empty answer is worse than no button', () => {
    const steps = [...Object.values(OB), ...Object.values(NUT), 'not_a_real_step'];
    for (const stepId of steps) {
      for (const message of ['', 'which should I pick?', 'what does this mean', 'asdfgh', null]) {
        const r = answerOnboarding({ stepId, message });
        expect(typeof r.reply).toBe('string');
        expect(r.reply.length).toBeGreaterThan(0);
      }
    }
  });

  it('turns a described goal into an applicable selection', () => {
    const r = answerOnboarding({ stepId: OB.GOAL, message: 'I want to lose fat and get stronger' });
    expect(r.apply).toBeTruthy();
    expect(r.apply.field).toBe('goal');
    expect(r.apply.value).toEqual(expect.arrayContaining(['lose', 'strength']));
  });

  it('answers a definition question on the goal step without hijacking it into a selection', () => {
    const r = answerOnboarding({ stepId: OB.GOAL, message: "what's the difference between strength and muscle?" });
    expect(r.apply).toBeUndefined();
    expect(r.reply).toMatch(/reps/i);
  });

  it('turns a described history into an experience level', () => {
    const r = answerOnboarding({ stepId: OB.EXPERIENCE, message: "I trained for years but I'm coming back after a break" });
    expect(r.apply).toEqual(expect.objectContaining({ field: 'level', value: 'returning' }));
  });

  it('recommends days from the level already in the draft', () => {
    const r = answerOnboarding({
      stepId: OB.DAYS,
      draft: { level: 'advanced', goal: ['strength'] },
      message: 'how many days should I train?',
    });
    expect(r.apply.field).toBe('days');
    expect(r.apply.value).toHaveLength(5);
  });

  // The bug this pins: the indices were written Sunday-first while
  // Onboarding's WEEKDAYS is Monday-first, so the coach said "Mon, Wed, Fri"
  // and then selected Tue, Thu, Sat. A reply that disagrees with what it
  // just did is worse than no suggestion. Caught by driving the real flow.
  it('names exactly the days it selects, in a Monday-first week', () => {
    const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    for (const level of ['newbie', 'returning', 'consistent', 'advanced']) {
      const r = answerOnboarding({
        stepId: OB.DAYS, draft: { level }, message: 'how many days should I train?',
      });
      const namedInLabel = r.apply.label.replace('Select ', '').split(', ');
      const namedByIndex = r.apply.value.map(i => WEEKDAYS[i]);
      expect(namedByIndex, level).toEqual(namedInLabel);
      // …and the same names have to appear in the prose above the button.
      expect(r.reply, level).toContain(namedInLabel.join(', '));
      expect(r.apply.value.every(i => i >= 0 && i <= 6), level).toBe(true);
    }
  });

  it('suggests a reachable target date from the two weights', () => {
    const r = answerOnboarding({
      stepId: NUT.TARGET,
      draft: { currentLbs: 200, targetLbs: 180 },
      message: 'what date should I set?',
    });
    expect(r.apply.field).toBe('targetDate');
    expect(r.apply.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('answers the rate question with guidance rather than a date', () => {
    const r = answerOnboarding({
      stepId: NUT.TARGET,
      draft: { currentLbs: 200, targetLbs: 180 },
      message: 'is 2 lb a week too fast?',
    });
    expect(r.apply).toBeUndefined();
    expect(r.reply).toMatch(/1%/);
  });

  it('answers "can I skip this" on the optional steps', () => {
    // OB.BASELINE was here until the body-baseline step was deleted from the
    // flow; its guide went with it. See onboardingCoachSteps.test.js, which
    // now fails if the two lists drift apart again in either direction.
    for (const stepId of [OB.HOME_GYM, NUT.RESTRICTIONS]) {
      expect(answerOnboarding({ stepId, message: 'can I skip this?' }).reply).toMatch(/yes/i);
    }
  });

  // The injury step is the one place where "you can skip" would be the
  // wrong shape of answer — the plan programs straight through an injury
  // it doesn't know about.
  it('does not wave the user past the injury step', () => {
    const r = answerOnboarding({ stepId: OB.INJURY, message: 'can I skip this?' });
    expect(r.reply).toMatch(/real cost|worth it/i);
  });

  it('never returns an apply payload for a step that cannot act on one', () => {
    for (const stepId of [OB.AGE, OB.HEIGHT, OB.WEIGHT, OB.BASELINE, OB.REVEAL, NUT.PREVIEW]) {
      const r = answerOnboarding({ stepId, message: 'which should I pick?' });
      expect(r.apply).toBeUndefined();
    }
  });
});

describe('sheet metadata', () => {
  it('knows every step of both flows', () => {
    for (const stepId of [...Object.values(OB), ...Object.values(NUT)]) {
      expect(hasCoachFor(stepId)).toBe(true);
      expect(introFor(stepId, {})).toBeTruthy();
    }
    expect(hasCoachFor('not_a_real_step')).toBe(false);
  });

  it('maps the nutrition modal step indices in order', () => {
    expect(NUTRITION_STEP_IDS).toHaveLength(6);
    expect(NUTRITION_STEP_IDS[0]).toBe(NUT.GOAL);
    expect(NUTRITION_STEP_IDS[5]).toBe(NUT.PREVIEW);
  });

  it('shows at most three starter prompts', () => {
    for (const stepId of [...Object.values(OB), ...Object.values(NUT)]) {
      expect(promptsFor(stepId, {}).length).toBeLessThanOrEqual(3);
    }
  });
});
