// The experience step's rep meter played its open animation on MOUNT, so
// walking onto the step with a level already chosen showed the card growing
// from height 0 as an EMPTY shell while its text arrived in two later beats
// inside it. Measured off a screen recording of the real device: bars at
// 1.17s, the "New" label at 1.41s, the description at 1.64s. Three arrivals
// for one card, which is what read as choppy against every other step.
//
// Probed at mount with the step rendered at value="newbie":
//
//   BEFORE   card  42px @ opacity 0.00   text opacity 0.00   description clipped
//   AFTER    card 214px @ opacity 1.00   text opacity 1.00   description visible
//
// `initial={false}` on both AnimatePresence wrappers is the whole fix.
// AnimatePresence only suppresses children present at its OWN first render, so
// picking a level while standing on the step still animates the card open —
// which is right: it should animate as a response to a choice, not as a
// greeting. Animating `height: 0 → auto` is also the one property here that
// can't be composited (it relayouts the four option cards below on every
// frame), so not running it on arrival is worth it twice.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync('src/pages/Onboarding.jsx', 'utf8');

function experienceStep() {
  const start = SOURCE.indexOf('function ExperienceStep(');
  const end = SOURCE.indexOf('function AssessmentStep(', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe('experience step — arrives in one piece', () => {
  it('does not animate the meter open on arrival', () => {
    const step = experienceStep();
    const presences = [...step.matchAll(/<AnimatePresence[^>]*>/g)].map(m => m[0]);
    // Two of them: the card itself, and the label/description inside it.
    expect(presences.length).toBe(2);
    for (const p of presences) expect(p).toContain('initial={false}');
  });

  it('keeps the text inside the card, not on its own timeline', () => {
    // The inner AnimatePresence is what carries the label and description. If
    // it animates on mount, the card arrives and THEN fills — which is the
    // exact defect, one level down from the card's own entrance.
    const step = experienceStep();
    const inner = step.slice(step.indexOf('<AnimatePresence mode="wait"'));
    expect(inner).toContain('initial={false}');
  });

  it('still animates the card open when a level is picked', () => {
    // The enter/exit animation has to survive: expanding on a pick is real
    // feedback for the choice. Only the mount case is suppressed.
    const step = experienceStep();
    expect(step).toContain("initial={{ opacity: 0, y: 8, height: 0 }}");
    expect(step).toContain("animate={{ opacity: 1, y: 0, height: 'auto' }}");
    expect(step).toContain("exit={{ opacity: 0, y: -8, height: 0 }}");
  });

  it('leaves no measurement exports behind in the page', () => {
    // A probe export for this fix reached main once, swept in by a parallel
    // session that stages the whole tree. Nothing outside this file imports
    // either name, so both belong to the harness, not the app.
    expect(SOURCE).not.toContain('__STEPS__');
    expect(SOURCE).not.toContain('export const OnboardingCoachContext');
    expect(SOURCE).not.toContain('export function RevealStep');
  });
});
