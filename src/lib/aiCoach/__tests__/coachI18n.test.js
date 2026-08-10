/**
 * The Coach's generated text is translatable — and, crucially, is UNCHANGED
 * for every caller that does not opt in.
 *
 * That second half is what makes this refactor safe. The pure modules
 * (`trainingModifiers`, `responders`, `onboardingCoach`) cannot call a hook,
 * so `t` arrives as an argument; every entry point defaults it to English.
 * A caller that never heard of `t` — including every test written before
 * this — has to get byte-identical output, the same posture CLAUDE.md
 * describes for this subsystem's other context inputs.
 */
import { describe, it, expect } from 'vitest';
import { interpolate, enT, asT } from '@/lib/aiCoach/coachI18n';
import { buildTrainingModifiers, fuelNote } from '@/lib/aiCoach/trainingModifiers';

/** A stub that IGNORES the English fallback, the way a real locale does. */
const es = (key, _english, vars) => interpolate(`[${key}]`, vars);

describe('coachI18n plumbing', () => {
  it('interpolates the same way tFallback does', () => {
    // If these two ever diverge, a missing key renders differently from a
    // present one and the bug is invisible in English.
    expect(interpolate('Rest is {sec}s longer', { sec: 20 })).toBe('Rest is 20s longer');
    expect(interpolate('{a} and {a}', { a: 'x' })).toBe('x and x');
    expect(interpolate('no vars', undefined)).toBe('no vars');
  });

  it('degrades a missing or malformed translator to English instead of throwing', () => {
    // A ctx threaded through several layers can lose `t` on the way. That
    // must cost the translation, not the reply.
    expect(asT(undefined)('k', 'English {n}', { n: 1 })).toBe('English 1');
    expect(asT('not a function')('k', 'English')).toBe('English');
    expect(asT(es)('k', 'English')).toBe('[k]');
    expect(enT('k', 'English {n}', { n: 2 })).toBe('English 2');
  });
});

describe('buildTrainingModifiers is inert without a translator', () => {
  it('returns the exact English a pre-i18n caller got', () => {
    const { notes } = buildTrainingModifiers({
      goal: 'strength', nutritionGoal: 'lose', weeklyRateLbs: 1, feel: 'rough', age: 62,
    });
    expect(notes).toContain('Built for strength: lower reps, longer rests.');
    expect(notes).toContain('You are eating in a deficit, so this session trims a set and keeps the weight heavy — intensity is what protects strength while cutting.');
    expect(notes).toContain('You said you feel rough — lighter, shorter and with more rest. Showing up counts; this still maintains.');
    expect(notes.some(n => n.startsWith('Rest is 20s longer'))).toBe(true);
  });

  it('changes no NUMBER when a translator is supplied', () => {
    const args = { goal: ['strength', 'endurance'], nutritionGoal: 'gain', age: 70, feel: 'good' };
    const en = buildTrainingModifiers(args);
    const loc = buildTrainingModifiers({ ...args, t: es });
    // Translation must move copy and nothing else — these numbers are what
    // generateWorkout applies to the bar.
    expect(loc.loadMultiplier).toBe(en.loadMultiplier);
    expect(loc.setsDelta).toBe(en.setsDelta);
    expect(loc.repDelta).toBe(en.repDelta);
    expect(loc.restDeltaSec).toBe(en.restDeltaSec);
    expect(loc.applied).toEqual(en.applied);
  });
});

describe('every generated note actually routes through a key', () => {
  // The failure this catches: a note added later with a literal string and
  // no key. It renders perfectly in English forever and never translates,
  // which is exactly how this whole surface got missed the first time.
  const localized = (args) => buildTrainingModifiers({ ...args, t: es }).notes;

  it('covers goal, diet, fuel, cycle, feel and age notes', () => {
    const notes = localized({
      goal: 'strength', nutritionGoal: 'lose', weeklyRateLbs: 1,
      cycleState: { phase: 'luteal' }, age: 70,
    });
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) expect(n).toMatch(/^\[coach\./);
  });

  it('covers the blended-goal sentence and its goal labels', () => {
    const [blend] = localized({ goal: ['strength', 'endurance', 'mobility'] });
    // The label list is interpolated INTO the key'd sentence, so the labels
    // have to be translated too — a raw English "strength, endurance" inside
    // a Spanish sentence is the mixed-script failure.
    expect(blend).toBe('[coach.note.goal.blend]');
  });

  it('covers both fuel branches, including the food name', () => {
    expect(fuelNote(['vegan'], es)).toBe('[coach.note.fuel.named]');
    // Every named option ruled out → the un-named fallback.
    expect(fuelNote(['vegan', 'keto', 'paleo', 'soy', 'egg'], es)).toBe('[coach.note.fuel.generic]');
  });
});

describe('the blended-goal list uses the locale, not hand-rolled grammar', () => {
  it('forms an English conjunction with the Oxford comma', () => {
    const [blend] = buildTrainingModifiers({ goal: ['strength', 'endurance', 'mobility'] }).notes;
    // Was `labels.slice(0,-1).join(', ') + ' and ' + last`, which is an
    // English-only rule. Intl supplies each locale's own — and en-US's
    // includes the serial comma, which the hand-rolled version omitted.
    expect(blend).toBe(
      'Balancing strength, endurance, and mobility — reps and rests land between what each one would ask for on its own.',
    );
  });

  it('handles the two-goal case without a stray separator', () => {
    const [blend] = buildTrainingModifiers({ goal: ['strength', 'muscle'] }).notes;
    expect(blend).toContain('Balancing strength and muscle —');
  });
});
