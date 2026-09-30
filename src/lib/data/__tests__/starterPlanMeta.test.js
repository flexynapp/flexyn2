// What the onboarding loader and reveal SAY about the starter plan, against
// what the plan builder actually builds. The 2026-09-30 audit found three
// places where they disagreed: the level and length came from the raw pick
// while the builder promoted the level from the lift check, the recent run
// time was asked for and reached nothing, and lift picks from a dropped
// strength goal still led a fat loss plan.
import { describe, it, expect } from 'vitest';
import {
  buildStarterRegimen, starterPlanLevel, starterPlanWeeks, fiveKSecondsFrom,
} from '../starterRegimen';

const ACES = { pushups_20: 'yes', squat_bw15: 'yes', pullups_10: 'yes', mile_under10: 'yes' };

describe('starterPlanLevel', () => {
  it('is the pick when the lift check is skipped', () => {
    expect(starterPlanLevel({ goals: ['strength'], level: 'newbie', assessment: {} })).toBe('newbie');
  });

  it('matches the level the builder writes into the plan', () => {
    for (const goals of [['strength'], ['lose'], ['speed'], ['endurance', 'strength']]) {
      for (const assessment of [{}, ACES, { pushups_20: 'yes', plank_60s: 'yes' }]) {
        const input = { goals, level: 'newbie', daysCount: 3, assessment };
        const built = buildStarterRegimen(input).description.split(' · ')[0];
        expect(starterPlanLevel(input), `${goals} ${JSON.stringify(assessment)}`).toBe(built);
      }
    }
  });
});

describe('starterPlanWeeks', () => {
  it.each([
    ['newbie', 8], ['returning', 8], ['consistent', 12], ['advanced', 12],
  ])('%s runs %i weeks', (level, weeks) => {
    expect(starterPlanWeeks(level)).toBe(weeks);
  });
});

describe('fiveKSecondsFrom', () => {
  it('passes a 5K time straight through', () => {
    expect(fiveKSecondsFrom({ distance: '5k', timeSec: 1500 })).toBe(1500);
  });

  it('converts a 10K and a mile with Riegel', () => {
    // 50:00 for 10K is about 24:00 for 5K; an 8:00 mile about 26:37.
    expect(fiveKSecondsFrom({ distance: '10k', timeSec: 3000 })).toBeGreaterThan(1420);
    expect(fiveKSecondsFrom({ distance: '10k', timeSec: 3000 })).toBeLessThan(1450);
    expect(fiveKSecondsFrom({ distance: '1mi', timeSec: 480 })).toBeGreaterThan(1580);
    expect(fiveKSecondsFrom({ distance: '1mi', timeSec: 480 })).toBeLessThan(1610);
  });

  it('is null for nothing, zero or an unknown distance', () => {
    expect(fiveKSecondsFrom(null)).toBeNull();
    expect(fiveKSecondsFrom({ distance: '5k', timeSec: 0 })).toBeNull();
    expect(fiveKSecondsFrom({ distance: 'marathon', timeSec: 12000 })).toBeNull();
  });

  it('changes the runner plan it feeds', () => {
    const base = { goals: ['speed'], level: 'consistent', daysCount: 3, cardioEvent: '5k' };
    const untargeted = buildStarterRegimen(base);
    const targeted = buildStarterRegimen({ ...base, current5kSec: fiveKSecondsFrom({ distance: '5k', timeSec: 1500 }) });
    expect(targeted).not.toEqual(untargeted);
  });
});

describe('lift picks only lead a strength or muscle plan', () => {
  const picks = ['Bench Press'];
  it('leads a strength plan', () => {
    const plan = buildStarterRegimen({ goals: ['strength'], level: 'newbie', daysCount: 3, strengthFocus: picks });
    expect(plan.exercises[0].name).toBe('Bench Press');
  });

  it('is ignored once the strength goal is gone', () => {
    const withPicks = buildStarterRegimen({ goals: ['lose'], level: 'newbie', daysCount: 3, strengthFocus: picks });
    const without = buildStarterRegimen({ goals: ['lose'], level: 'newbie', daysCount: 3 });
    expect(withPicks).toEqual(without);
  });
});

describe('pull-up regression for a "Not yet"', () => {
  const base = { goals: ['strength'], level: 'newbie', daysCount: 3 };
  const names = (r) => r.exercises.map(e => e.name);

  it('keeps Pull-Up when the question was not answered', () => {
    expect(names(buildStarterRegimen(base))).toContain('Pull-Up');
  });

  it('swaps to a pulldown in a gym and an assisted pull-up with minimal kit', () => {
    const gym = names(buildStarterRegimen({ ...base, assessment: { pullups_10: 'not_yet' } }));
    expect(gym).not.toContain('Pull-Up');
    expect(gym).toContain('Machine Lat Pulldown');
    const minimal = names(buildStarterRegimen({ ...base, equipment: 'minimal', assessment: { pullups_10: 'not_yet' } }));
    expect(minimal).not.toContain('Pull-Up');
    expect(minimal).toContain('Assisted Pull-Up');
  });

  it('keeps a pull-up the user picked by name', () => {
    const r = buildStarterRegimen({ ...base, assessment: { pullups_10: 'not_yet' }, strengthFocus: ['Pull-Up'] });
    expect(names(r)).toContain('Pull-Up');
  });
});
