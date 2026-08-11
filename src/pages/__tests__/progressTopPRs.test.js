// The Recent list's PR selection, pinned against the shape that exposed it.
//
// Production held exactly one workout for the account that found this: a
// single Push-Up set at 0 lbs x 5 reps. The Recent list ran
// `.filter(pr => pr.weight > 0)`, so it showed no personal bests at all —
// while the Personal Bests sheet one tap below listed it as "5 reps". Two
// answers to the same question on one screen.
//
// The selection logic is reproduced here rather than imported because it
// lives inside a useMemo in the page component. That is a real limitation:
// this asserts the RULE, and a change to Progress.jsx that diverges from it
// would not fail here. The guard against that is the shared wording — both
// this and the component sort loaded-first-then-reps — plus the render
// tests on PersonalBestsSheet, which do import the real thing.

import { describe, it, expect } from 'vitest';

function topPRs(logs) {
  const map = {};
  logs.forEach(log => {
    (log.exercises || []).forEach(ex => {
      if (!ex.name) return;
      if (!map[ex.name]) map[ex.name] = { name: ex.name, weight: 0, reps: 0 };
      (ex.sets || []).forEach(s => {
        if ((s.weight || 0) > map[ex.name].weight) map[ex.name].weight = s.weight;
        if ((s.reps || 0) > map[ex.name].reps) map[ex.name].reps = s.reps;
      });
    });
  });
  return Object.values(map)
    .filter(pr => pr.weight > 0 || pr.reps > 0)
    .sort((a, b) => {
      const aLoaded = a.weight > 0, bLoaded = b.weight > 0;
      if (aLoaded !== bLoaded) return aLoaded ? -1 : 1;
      if (aLoaded) return b.weight - a.weight || a.name.localeCompare(b.name);
      return b.reps - a.reps || a.name.localeCompare(b.name);
    })
    .slice(0, 5);
}

describe('Recent list PR selection', () => {
  it('keeps a bodyweight best — the exact row that had none', () => {
    const real = [{ date: '2026-08-07', exercises: [{ name: 'Push-Up', sets: [{ weight: 0, reps: 5 }] }] }];
    expect(topPRs(real)).toEqual([{ name: 'Push-Up', weight: 0, reps: 5 }]);
  });

  it('drops an exercise with neither load nor reps', () => {
    // A logged-but-empty set is not an achievement.
    const empty = [{ date: '2026-08-07', exercises: [{ name: 'Plank', sets: [{ weight: 0, reps: 0 }] }] }];
    expect(topPRs(empty)).toEqual([]);
  });

  it('ranks loaded lifts above bodyweight regardless of rep count', () => {
    const mixed = [{ date: '2026-08-07', exercises: [
      { name: 'Push-Up', sets: [{ weight: 0, reps: 60 }] },
      { name: 'Bench Press', sets: [{ weight: 95, reps: 5 }] },
    ] }];
    // 60 push-ups do not outrank a 95 lb bench just by having a bigger number.
    expect(topPRs(mixed).map(p => p.name)).toEqual(['Bench Press', 'Push-Up']);
  });

  it('orders bodyweight by reps rather than by the alphabet', () => {
    const bw = [{ date: '2026-08-07', exercises: [
      { name: 'Chin Up', sets: [{ weight: 0, reps: 8 }] },
      { name: 'Push-Up', sets: [{ weight: 0, reps: 40 }] },
      { name: 'Dip', sets: [{ weight: 0, reps: 20 }] },
    ] }];
    expect(topPRs(bw).map(p => p.name)).toEqual(['Push-Up', 'Dip', 'Chin Up']);
  });

  it('still caps at five', () => {
    const many = [{ date: '2026-08-07', exercises: Array.from({ length: 9 }, (_, i) => ({
      name: `Lift ${i}`, sets: [{ weight: 100 + i, reps: 5 }],
    })) }];
    expect(topPRs(many)).toHaveLength(5);
  });
});
