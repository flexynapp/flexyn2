// Tests for the goal / diet / cycle / feel modifier layer.
//
// The behaviour that matters most here is restraint: cycle phase must only
// ever be a small nudge, a reported symptom must beat a predicted phase, and
// no combination of context may produce an unreasonable prescription.

import { describe, it, expect } from 'vitest';
import {
  buildTrainingModifiers,
  normalizeGoal,
  normalizeDiet,
  fuelNote,
  profileAge,
  FEEL,
} from '../trainingModifiers';
import { _demographicScale } from '../workoutGenerator';

describe('fuelNote — allergies and dietary restrictions', () => {
  it('names a concrete food when nothing is restricted', () => {
    expect(fuelNote([])).toMatch(/yogurt/i);
  });

  it('never names dairy for a dairy allergy', () => {
    const n = fuelNote(['dairy_free']);
    expect(n).not.toMatch(/yogurt|whey|milk|cheese/i);
  });

  it('never names animal products for a vegan', () => {
    const n = fuelNote(['vegan']);
    expect(n).not.toMatch(/yogurt|chicken|egg|salmon|beef/i);
  });

  it('respects multiple stacked allergies', () => {
    const n = fuelNote(['dairy_free', 'egg', 'soy', 'fish']);
    expect(n).not.toMatch(/yogurt|egg|tofu|salmon/i);
  });

  it('falls back to unnamed macros rather than guessing when everything clashes', () => {
    const n = fuelNote([
      'vegan', 'keto', 'paleo', 'soy', 'nut_free',
      'gluten_free', 'dairy_free', 'egg', 'fish', 'shellfish',
    ]);
    expect(n).toMatch(/protein source and a carb source/i);
  });

  it('is reached through buildTrainingModifiers when the user is cutting', () => {
    const m = buildTrainingModifiers({ nutritionGoal: 'lose', restrictions: ['dairy_free'] });
    const joined = m.notes.join(' ');
    expect(joined).toMatch(/refuel/i);
    expect(joined).not.toMatch(/yogurt/i);
  });

  it('does not push food advice on a maintenance day', () => {
    const m = buildTrainingModifiers({ nutritionGoal: 'maintain' });
    expect(m.notes.join(' ')).not.toMatch(/refuel/i);
  });
});

describe('profileAge', () => {
  it('prefers birthday over a stale stored age', () => {
    const yr = new Date().getFullYear();
    expect(profileAge({ birthday: `${yr - 30}-01-01`, age: 22 })).toBe(30);
  });
  it('falls back to the age column', () => {
    expect(profileAge({ age: 44 })).toBe(44);
  });
  it('returns null rather than guessing when there is nothing usable', () => {
    expect(profileAge({})).toBeNull();
    expect(profileAge({ birthday: 'not-a-date' })).toBeNull();
    expect(profileAge({ age: 0 })).toBeNull();
  });
});

describe('_demographicScale — onboarding-based starting weights', () => {
  it('leaves male norms as the 1.0 baseline', () => {
    const s = _demographicScale({ gender: 'male', age: 30 });
    expect(s.upper).toBeCloseTo(1, 3);
    expect(s.lower).toBeCloseTo(1, 3);
  });

  it('scales women down, and less so in the lower body', () => {
    const s = _demographicScale({ gender: 'female', age: 30 });
    expect(s.upper).toBeLessThan(0.7);
    expect(s.lower).toBeGreaterThan(s.upper); // leg gap is much smaller
    expect(s.lower).toBeLessThan(1);
  });

  it('takes a conservative middle value when sex is unset or other', () => {
    const unset = _demographicScale({ age: 30 });
    const male  = _demographicScale({ gender: 'male', age: 30 });
    const fem   = _demographicScale({ gender: 'female', age: 30 });
    expect(unset.upper).toBeLessThan(male.upper);
    expect(unset.upper).toBeGreaterThan(fem.upper);
  });

  it('holds flat to 40 then tapers with age', () => {
    const young = _demographicScale({ gender: 'male', age: 25 });
    const forty = _demographicScale({ gender: 'male', age: 40 });
    const sixty = _demographicScale({ gender: 'male', age: 60 });
    const older = _demographicScale({ gender: 'male', age: 75 });
    expect(forty.upper).toBeCloseTo(young.upper, 3);
    expect(sixty.upper).toBeLessThan(forty.upper);
    expect(older.upper).toBeLessThan(sixty.upper);
    expect(older.upper).toBeGreaterThan(0.4); // never collapses to nothing
  });

  it('nudges on activity level', () => {
    const sed = _demographicScale({ gender: 'male', age: 30, activityLevel: 'sedentary' });
    const act = _demographicScale({ gender: 'male', age: 30, activityLevel: 'extra' });
    expect(sed.upper).toBeLessThan(1);
    expect(act.upper).toBeGreaterThan(1);
  });

  it('is safe with a completely empty profile', () => {
    const s = _demographicScale({});
    expect(Number.isFinite(s.upper)).toBe(true);
    expect(Number.isFinite(s.lower)).toBe(true);
    expect(s.upper).toBeGreaterThan(0);
  });
});

describe('normalizeGoal', () => {
  it('reads the array form used by fitness_goals_arr', () => {
    expect(normalizeGoal(['Build Muscle'])).toBe('muscle');
  });
  it('reads the CSV string form used by fitness_goals', () => {
    expect(normalizeGoal('lose weight, tone up')).toBe('lose');
  });
  it('recognizes strength and endurance intents', () => {
    expect(normalizeGoal(['get stronger'])).toBe('strength');
    expect(normalizeGoal('train for a 5k')).toBe('endurance');
  });
  it('falls back to general on empty or unknown input', () => {
    expect(normalizeGoal(null)).toBe('general');
    expect(normalizeGoal([])).toBe('general');
    expect(normalizeGoal(['vibes'])).toBe('general');
  });
});

describe('normalizeDiet', () => {
  it('maps explicit nutrition goals', () => {
    expect(normalizeDiet('lose')).toBe('lose');
    expect(normalizeDiet('gain')).toBe('gain');
    expect(normalizeDiet('maintain')).toBe('maintain');
  });
  it('infers direction from an intended weekly rate when no goal is set', () => {
    expect(normalizeDiet(null, -1)).toBe('lose');
    expect(normalizeDiet(null, 0.5)).toBe('gain');
    expect(normalizeDiet(null, 0)).toBe('maintain');
  });
});

describe('buildTrainingModifiers', () => {
  it('is identity with no context at all', () => {
    const m = buildTrainingModifiers({});
    expect(m.loadMultiplier).toBe(1);
    expect(m.setsDelta).toBe(0);
    expect(m.repDelta).toBe(0);
    expect(m.restDeltaSec).toBe(0);
  });

  it('does not touch load when cycle tracking is off (no cycleState)', () => {
    const m = buildTrainingModifiers({ goal: ['get stronger'], nutritionGoal: 'maintain' });
    expect(m.loadMultiplier).toBe(1);
    expect(m.applied.cycle).toBeNull();
    // ...and says nothing about a cycle the user never opted into.
    expect(m.notes.join(' ')).not.toMatch(/phase|period|ovulation/i);
  });

  it('keeps the cycle nudge small — never more than 5% off either way', () => {
    for (const phase of ['menstrual', 'follicular', 'ovulation', 'luteal']) {
      const m = buildTrainingModifiers({ cycleState: { phase } });
      expect(m.loadMultiplier).toBeGreaterThanOrEqual(0.95);
      expect(m.loadMultiplier).toBeLessThanOrEqual(1.05);
    }
  });

  it('warns about ligament laxity around ovulation instead of changing load', () => {
    const m = buildTrainingModifiers({ cycleState: { phase: 'ovulation' } });
    expect(m.loadMultiplier).toBe(1);
    expect(m.notes.join(' ')).toMatch(/ligament|warm-up/i);
  });

  it('lets a reported symptom override the predicted phase', () => {
    // Phase alone would lighten the bar 5%.
    const phaseOnly = buildTrainingModifiers({ cycleState: { phase: 'menstrual' } });
    expect(phaseOnly.loadMultiplier).toBeCloseTo(0.95, 3);

    // Saying "I feel good" in the same phase should NOT compound down.
    const feelsGood = buildTrainingModifiers({
      cycleState: { phase: 'menstrual' },
      feel: FEEL.good,
    });
    expect(feelsGood.loadMultiplier).toBeGreaterThan(1);
  });

  it('cuts volume rather than load when in a deficit', () => {
    const m = buildTrainingModifiers({ nutritionGoal: 'lose' });
    expect(m.setsDelta).toBe(-1);
    expect(m.loadMultiplier).toBe(1); // intensity is what protects strength
    expect(m.notes.join(' ')).toMatch(/deficit/i);
  });

  it('allows an extra set in a surplus', () => {
    expect(buildTrainingModifiers({ nutritionGoal: 'gain' }).setsDelta).toBe(1);
  });

  it('shapes reps and rest from the training goal', () => {
    const strength = buildTrainingModifiers({ goal: ['get stronger'] });
    const cut      = buildTrainingModifiers({ goal: ['lose weight'] });
    expect(strength.repDelta).toBeLessThan(0);
    expect(strength.restDeltaSec).toBeGreaterThan(0);
    expect(cut.repDelta).toBeGreaterThan(0);
    expect(cut.restDeltaSec).toBeLessThan(0);
  });

  it('clamps hard when every signal stacks in the same direction', () => {
    const m = buildTrainingModifiers({
      cycleState: { phase: 'luteal' },
      feel: FEEL.rough,
      goal: ['endurance'],
      nutritionGoal: 'lose',
    });
    expect(m.loadMultiplier).toBeGreaterThanOrEqual(0.8);
    expect(m.setsDelta).toBeGreaterThanOrEqual(-1);
    expect(m.restDeltaSec).toBeLessThanOrEqual(45);
    expect(m.repDelta).toBeLessThanOrEqual(6);
  });

  it('explains every adjustment it makes', () => {
    const m = buildTrainingModifiers({
      cycleState: { phase: 'menstrual' },
      goal: ['get stronger'],
      nutritionGoal: 'lose',
    });
    expect(m.notes.length).toBeGreaterThanOrEqual(3);
    expect(m.notes.every(n => typeof n === 'string' && n.length > 0)).toBe(true);
  });
});
