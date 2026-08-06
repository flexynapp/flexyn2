// The assessment step was four bordered cards, each holding a question above
// two full-width buttons: 688px of content in a 594px box. It overflowed by
// 146px — the worst of any step — so the fourth question was always sliced.
//
// The answer is binary. A binary answer doesn't need a card and two big
// buttons, it needs a statement and a two-segment control, which is what
// each question is now: one row, in the same rhythm as the goal cards.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync('src/pages/Onboarding.jsx', 'utf8');

function assessmentStep() {
  const start = SOURCE.indexOf('function AssessmentStep(');
  const end = SOURCE.indexOf('STEP 4: ABOUT YOU', start) > -1
    ? SOURCE.indexOf('STEP 4: ABOUT YOU', start)
    : SOURCE.indexOf('function AgeStep(', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

function questionsBlock() {
  const start = SOURCE.indexOf('const ASSESSMENT_QUESTIONS = [');
  return SOURCE.slice(start, SOURCE.indexOf('];', start));
}

describe('assessment step', () => {
  it('states the feat instead of asking it', () => {
    // The heading already asks. Every card repeating "Can you…" cost a line
    // the step could not afford, and the shorter statement is what lets the
    // answer sit on the same row.
    expect(questionsBlock()).not.toMatch(/Can you/);
  });

  it('keeps all four checks', () => {
    for (const id of ['bench_bw', 'squat_bw15', 'pullups_10', 'mile_under10']) {
      expect(questionsBlock(), id).toContain(id);
    }
  });

  it('does not stack the answers under the question', () => {
    // `grid grid-cols-2` under each question is what made a question three
    // rows tall.
    expect(assessmentStep()).not.toMatch(/grid grid-cols-2/);
  });

  it('keeps the answer buttons at a real touch target', () => {
    // Eight of these render in one viewport; they were 34px before.
    const step = assessmentStep();
    const buttons = [...step.matchAll(/className="min-h-11[^"]*rounded-full/g)];
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('spends colour on the border and the label only', () => {
    // Same budget as the goal cards — an answered row tints its border, the
    // chosen chip tints its border and text, and nothing gets a fill.
    const step = assessmentStep();
    expect(step).toContain('borderColor: answer ? answer.hue');
    expect(step).not.toMatch(/background:\s*selected \? `\$\{a\.hue\}/);
  });

  it('folds the coach note into the sub rather than a second line', () => {
    expect(SOURCE).not.toContain('assessment.coachNote');
  });
});
