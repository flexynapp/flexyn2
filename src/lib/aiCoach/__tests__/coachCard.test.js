// The figures on a Coach card come from the user's digest, never from the
// model. These pin that: a visual with no data behind it is dropped rather
// than drawn as zero, and every number on the card is the digest's number.

import { describe, it, expect } from 'vitest';
import { resolveCoachCard, resolveVisual } from '../coachCard';

const ctx = {
  units: 'lb',
  profile: { trainingDaysPerWeek: 3 },
  training: { sessionsLast7: 1, setsByMuscleLast14: { chest: 8, back: 0, shoulders: 0, arms: 0, legs: 0, core: 0 } },
  recovery: { score100: 93, avgSleepHours: 7.4, sleepDaysLogged: 3, lastSoreness1to5: 2 },
  nutritionLast7: { daysLogged: 1, avgCaloriesPerLoggedDay: 648 },
  topLifts: [{ name: 'Bench Press', weightLb: 185, reps: 5, daysAgo: 2 }],
};

describe('resolveVisual', () => {
  it('draws each figure from the digest', () => {
    expect(resolveVisual('week_sessions', '', ctx)).toEqual({ type: 'week_sessions', done: 1, target: 3 });
    expect(resolveVisual('readiness', '', ctx)).toEqual({ type: 'readiness', score: 93 });
    expect(resolveVisual('calories', '', ctx)).toEqual({ type: 'calories', kcal: 648, days: 1 });
    expect(resolveVisual('muscle_sets', 'Legs', ctx)).toEqual({ type: 'muscle_sets', muscle: 'legs', sets: 0 });
    expect(resolveVisual('muscle_sets', 'quads', ctx)).toMatchObject({ muscle: 'legs', sets: 0 });
    expect(resolveVisual('top_lift', 'bench press', ctx)).toMatchObject({ weight: 185, reps: 5, units: 'lb' });
  });

  it('returns null when the data is not there, never a zero', () => {
    expect(resolveVisual('protein', '', ctx)).toBeNull();
    expect(resolveVisual('body_trend', '', ctx)).toBeNull();
    expect(resolveVisual('top_lift', 'Squat', ctx)).toBeNull();
    expect(resolveVisual('muscle_sets', 'forearms', ctx)).toBeNull();
    expect(resolveVisual('readiness', '', {})).toBeNull();
    expect(resolveVisual('calories', '', { nutritionLast7: { daysLogged: 0, avgCaloriesPerLoggedDay: 0 } })).toBeNull();
    expect(resolveVisual('made_up', '', ctx)).toBeNull();
  });

  it('drops a weekly target that is not a real number of days', () => {
    expect(resolveVisual('week_sessions', '', { training: { sessionsLast7: 2 } }).target).toBeNull();
  });
});

describe('resolveCoachCard', () => {
  const raw = {
    tone: 'wait',
    headline: 'Log a squat first, then add 5 to 10 lb.',
    points: [
      { text: 'No leg sets in 14 days, so there is no squat to judge', visual: 'muscle_sets', ref: 'legs' },
      { text: 'Add weight once every rep lands two sessions running', visual: 'none', ref: '' },
      { text: 'Readiness is 93, so you are fresh', visual: 'readiness', ref: '' },
      { text: 'Readiness again', visual: 'readiness', ref: '' },
      { text: 'A fifth point', visual: 'none', ref: '' },
    ],
    next: 'Log your next squat with weight and reps.',
  };

  it('keeps four points, resolves their figures and draws each kind once', () => {
    const card = resolveCoachCard(raw, ctx);
    expect(card.tone).toBe('wait');
    expect(card.points).toHaveLength(4);
    expect(card.points.map((p) => p.viz?.type ?? null)).toEqual(['muscle_sets', null, 'readiness', null]);
    expect(card.next).toMatch(/^Log your next squat/);
  });

  it('keeps the text of a point whose figure has no data', () => {
    const card = resolveCoachCard({ ...raw, points: [{ text: 'Protein looks low', visual: 'protein', ref: '' }] }, ctx);
    expect(card.points).toEqual([{ text: 'Protein looks low', viz: null }]);
  });

  it('rejects anything that is not a card, so the text reply is used', () => {
    expect(resolveCoachCard(null, ctx)).toBeNull();
    expect(resolveCoachCard('hi', ctx)).toBeNull();
    expect(resolveCoachCard({ headline: '', points: [] }, ctx)).toBeNull();
  });

  it('falls back to a neutral tone for an unknown one', () => {
    expect(resolveCoachCard({ ...raw, tone: 'yolo' }, ctx).tone).toBe('info');
  });
});
