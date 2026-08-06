// The sharpen step asks three things with what used to be four different
// control idioms — big chips, small chips, two number boxes and a text
// toggle — stacked around a bordered card nested inside a bordered section.
// Sixteen tap targets for three answers.
//
// The consolidation: the event answer IS the distance, so the separate
// 1 mi / 5K / 10K row is gone and the time is asked at the picked distance,
// inline, only once an event exists. "I'll set it later" went with it —
// leaving the fields empty already is later, and the hint below says so.
//
// These are source-level assertions rather than a mount, because what's
// being protected is the ABSENCE of controls; a render test can only see
// what's there.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync('src/pages/Onboarding.jsx', 'utf8');

function sharpenStep() {
  const start = SOURCE.indexOf('function SharpenStep(');
  const end = SOURCE.indexOf('STEP 3: EXPERIENCE');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

/** Ids out of an array-of-objects literal like CARDIO_EVENTS. */
function idsFromLiteral(name) {
  const block = SOURCE.slice(SOURCE.indexOf(`const ${name} = [`));
  const body = block.slice(0, block.indexOf('];'));
  return [...body.matchAll(/id: '([^']+)'/g)].map(m => m[1]);
}

describe('sharpen step', () => {
  it('asks the time at the distance the event already named', () => {
    const events = idsFromLiteral('CARDIO_EVENTS');
    expect(events.length).toBeGreaterThan(0);

    const map = SOURCE.slice(SOURCE.indexOf('const TIME_DISTANCE_FOR_EVENT = {'));
    const body = map.slice(0, map.indexOf('};'));
    const mapped = [...body.matchAll(/'?([\w]+)'?:\s*'([^']+)'/g)]
      .reduce((acc, [, k, v]) => ({ ...acc, [k]: v }), {});

    // Every event resolves to a distance...
    for (const id of events) {
      expect(Object.keys(mapped), `event ${id}`).toContain(id);
    }
    // ...and only to one the rest of the app understands. The value is
    // rendered straight into the cardio goal's note by
    // ensureOnboardingCardioGoal, and the old picker only ever offered these.
    const vocabulary = idsFromLiteral('TIME_DISTANCES');
    for (const [event, distance] of Object.entries(mapped)) {
      expect(vocabulary, `${event} → ${distance}`).toContain(distance);
    }
  });

  it('no longer re-asks the distance with its own row of chips', () => {
    expect(sharpenStep()).not.toContain('TIME_DISTANCES.map');
  });

  it('has no "set it later" toggle', () => {
    // Empty fields are already "later"; the toggle was a second control
    // saying what the hint underneath says in words.
    expect(SOURCE).not.toContain('cardioDefer');
    expect(SOURCE).not.toContain('sharpen.setLater');
  });

  it('does not nest a card inside the section', () => {
    // `rounded-2xl border ... bg-card` around the time question put a surface
    // inside a surface, which is most of what made the step feel boxed in.
    // The "nothing to ask" card is a different thing — it IS the content.
    const cardioSection = sharpenStep();
    const start = cardioSection.indexOf('{wantsCardio &&');
    const end = cardioSection.indexOf('{wantsStrength &&');
    expect(cardioSection.slice(start, end)).not.toMatch(/rounded-2xl border/);
  });

  it('keeps one chip size', () => {
    // A `small` variant put two chip sizes 40px apart on the same screen.
    const chip = SOURCE.slice(SOURCE.indexOf('function Chip('), SOURCE.indexOf('function SectionLabel('));
    expect(chip).not.toContain('small');
  });

  it('still captures all three inputs', () => {
    const body = sharpenStep();
    for (const field of ['cardioEvent', 'cardioCurrent', 'strengthFocus']) {
      expect(body, field).toContain(field);
    }
  });
});
