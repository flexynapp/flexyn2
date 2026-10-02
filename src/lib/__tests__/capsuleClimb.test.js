import { describe, it, expect } from 'vitest';
import { climbPlan, climbRank, CLIMB_LADDER } from '../capsuleClimb';

const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const never = () => 0.99;

describe('climbPlan', () => {
  it('opens a Common on the first strike', () => {
    expect(climbPlan('common', { rng: never })).toEqual([{ kind: 'open', to: 'common' }]);
  });

  it('climbs one rung per strike and opens on the real rarity', () => {
    const plan = climbPlan('legendary', { rng: never });
    expect(plan.map(s => s.kind)).toEqual(['climb', 'climb', 'climb', 'climb', 'open']);
    expect(plan.filter(s => s.kind === 'climb').map(s => s.to)).toEqual(['uncommon', 'rare', 'epic', 'legendary']);
    expect(plan.at(-1).to).toBe('legendary');
  });

  it('never climbs past or stops short of what the server rolled', () => {
    for (const r of CLIMB_LADDER) {
      for (let k = 0; k < 50; k++) {
        const plan = climbPlan(r);
        const climbs = plan.filter(s => s.kind === 'climb');
        expect(climbs.length).toBe(climbRank(r));
        expect(plan.at(-1)).toMatchObject({ kind: 'open', to: r });
        expect(plan.filter(s => s.kind === 'open').length).toBe(1);
      }
    }
  });

  it('adds at most one hold, and none on a Legendary climb', () => {
    const withHold = climbPlan('rare', { rng: seq(0.1, 0.5, 0.99) });
    expect(withHold.filter(s => s.kind === 'hold').length).toBe(1);
    for (let k = 0; k < 50; k++) {
      expect(climbPlan('legendary').some(s => s.kind === 'hold')).toBe(false);
      expect(climbPlan('rare').filter(s => s.kind === 'hold').length).toBeLessThanOrEqual(1);
    }
  });

  it('keeps a mythic on the Legendary rung and names it on the open', () => {
    const plan = climbPlan('mythic', { rng: never });
    expect(plan.filter(s => s.kind === 'climb').length).toBe(4);
    expect(plan.at(-1).to).toBe('mythic');
  });

  it('never stages a near miss on the open', () => {
    for (const r of CLIMB_LADDER) {
      for (const v of [0, 0.5, 0.99]) {
        const open = climbPlan(r, { rng: () => v }).at(-1);
        expect(open).toEqual({ kind: 'open', to: r });
      }
    }
  });
});
