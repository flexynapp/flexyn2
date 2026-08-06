// What the goal step reads out of a sentence, and — more importantly — what
// it refuses to read.
//
// This is the "the AI coach is hallucinating" report. There is no model in
// `onboardingCoach.js`; the coach was pattern-matching single words that mean
// something else in ordinary English, then stating the result as fact and
// offering a button that would act on it:
//
//   "I don't want to lose weight"      → "That reads as **Lose fat**"
//   "I don't want to bulk up"          → "That reads as **Add muscle**"
//   "I'm heavy right now"              → "That reads as **Build strength**"
//   "how much longer does this take?"  → "That reads as **Run further**"
//   "my schedule is tight"             → "That reads as **Move better**"
//   "I only have half an hour a day"   → "That reads as **Run further**"
//   "I want to cut down on my gym time"→ "That reads as **Lose fat**"
//
// Eight of eleven realistic sentences, three of them asserting the opposite of
// what the user had just said. That reads as invention even though nothing was
// invented.

import { describe, it, expect } from 'vitest';
import { inferGoals, answerOnboarding } from '../onboardingCoach';

const infer = (msg) => inferGoals(msg);
const answer = (message) => answerOnboarding({ stepId: 'goal', draft: {}, message });

describe('inferGoals — negation', () => {
  it('does not select a goal the user just ruled out', () => {
    expect(infer("I don't want to lose weight")).toEqual([]);
    expect(infer("I don't want to bulk up")).toEqual([]);
    expect(infer('not looking to get bigger')).toEqual([]);
    expect(infer('no interest in getting bigger')).toEqual([]);
  });

  it('offers no apply button for a negated sentence', () => {
    // The button is the dangerous half: bad advice is recoverable, a
    // one-tap selection of the opposite goal is what lands in the profile.
    expect(answer("I don't want to bulk up").apply).toBeUndefined();
  });

  it('keeps a goal named in a different clause', () => {
    // The negation window is deliberately short so it cannot leak across a
    // comma. This sentence rules out one goal and names another.
    expect(infer("I don't want to lose weight, I want to get stronger")).toEqual(['strength']);
  });
});

describe('inferGoals — words that mean something else', () => {
  it('reads "heavy" as bodyweight, not as a barbell', () => {
    expect(infer("I'm heavy right now and want to fix that")).toEqual([]);
    expect(infer('I want to lift heavy')).toEqual(['strength']);
    expect(infer('heavy squats')).toEqual(['strength']);
  });

  it('does not treat a duration as a distance', () => {
    expect(infer('how much longer does this take?')).toEqual([]);
    expect(infer('I only have half an hour a day')).toEqual([]);
    expect(infer('training for a half marathon')).toEqual(['endurance']);
  });

  it('does not treat a busy schedule as a mobility goal', () => {
    expect(infer('my schedule is tight')).toEqual([]);
    expect(infer('my hips are tight')).toEqual(['mobility']);
  });

  it('does not treat "cut down" as a cut', () => {
    expect(infer('I want to cut down on my gym time')).toEqual([]);
    expect(infer("I'm cutting")).toEqual(['lose']);
    expect(infer('want to cut fat')).toEqual(['lose']);
  });

  it('does not treat "at my own pace" as speed work', () => {
    expect(infer('I just want to go at my own pace')).toEqual([]);
    expect(infer('I want a faster mile')).toEqual(['speed']);
  });
});

describe('inferGoals — the phrasings that should still work', () => {
  it('reads plain descriptions', () => {
    expect(infer('I want to get stronger')).toEqual(['strength']);
    expect(infer('put on some size')).toEqual(['muscle']);
    expect(infer('just tone up a bit')).toEqual(['lose']);
    expect(infer('build stamina')).toEqual(['endurance']);
    expect(infer('I feel stiff all the time')).toEqual(['mobility']);
  });

  it('reads more than one goal from one sentence', () => {
    // Order follows GOAL_PATTERNS, not the sentence.
    expect(infer('lose some belly fat and get stronger')).toEqual(['lose', 'strength']);
  });

  it('still offers to apply what it genuinely read', () => {
    const res = answer('I want to get stronger and put on size');
    expect(res.apply).toMatchObject({ field: 'goal', value: ['muscle', 'strength'] });
    expect(res.reply).toMatch(/that reads as/i);
  });

  it('falls back to the list rather than guessing', () => {
    const res = answer('I have no idea, what do you suggest?');
    expect(res.apply).toBeUndefined();
    expect(res.reply).toMatch(/pick by the outcome/i);
  });
});
