// Tests for the non-linear-increment half of Phase 5.
//
// The point: a Bowflex 552 steps 2.5 lb up to 25 and then jumps in 5s.
// An unsnapped "+2.5" suggestion names a weight the lifter physically
// cannot select on the handle. These assert the suggester never does
// that — and, just as importantly, that it stays a no-op for the
// overwhelming majority of implements whose stacks we don't know.

import { describe, it, expect } from 'vitest';
import { selectableWeights, snapToSelectable, SEED_MODELS } from '../equipmentCatalog';
import { suggestNext } from '../progressiveOverload';

const BOWFLEX_552 = { brand: 'bowflex', line: 'SelectTech', model: '552' };

describe('selectableWeights', () => {
  it('knows the verified Bowflex 552 ladder', () => {
    expect(selectableWeights(BOWFLEX_552)).toEqual(
      [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 30, 35, 40, 45, 50, 52.5]
    );
  });

  it('returns null for implements whose stack we never verified', () => {
    expect(selectableWeights({ brand: 'powerblock', line: 'Elite', model: 'EXP' })).toBeNull();
    expect(selectableWeights({ brand: 'hammer_strength', line: 'Select' })).toBeNull();
    expect(selectableWeights({})).toBeNull();
    expect(selectableWeights()).toBeNull();
  });

  it('only ships ladders that are sorted, positive and unique', () => {
    for (const m of SEED_MODELS.filter(x => x.ladder)) {
      const l = m.ladder;
      expect(new Set(l).size, `${m.brand}/${m.model} has duplicates`).toBe(l.length);
      expect([...l].sort((a, b) => a - b), `${m.brand}/${m.model} unsorted`).toEqual(l);
      expect(Math.min(...l), `${m.brand}/${m.model} non-positive`).toBeGreaterThan(0);
      if (m.maxLb) expect(Math.max(...l)).toBe(m.maxLb);
    }
  });
});

describe('snapToSelectable', () => {
  it('snaps to a real setting in the 2.5 lb zone', () => {
    expect(snapToSelectable(16, BOWFLEX_552)).toBe(15);
    expect(snapToSelectable(19, BOWFLEX_552)).toBe(20);
  });

  it('snaps across the 25 lb discontinuity — 27.5 does not exist', () => {
    expect(snapToSelectable(27.5, BOWFLEX_552)).toBe(25);
    expect(snapToSelectable(28, BOWFLEX_552)).toBe(30);
  });

  it('rounds ties DOWN — a load you can lift beats one you cannot', () => {
    // 27.5 is exactly between 25 and 30.
    expect(snapToSelectable(27.5, BOWFLEX_552)).toBe(25);
  });

  it('clamps to the ends of the stack', () => {
    expect(snapToSelectable(1, BOWFLEX_552)).toBe(5);
    expect(snapToSelectable(500, BOWFLEX_552)).toBe(52.5);
  });

  it('is an exact no-op when the ladder is unknown', () => {
    expect(snapToSelectable(27.5, { brand: 'powerblock' })).toBe(27.5);
    expect(snapToSelectable(27.5, null)).toBe(27.5);
    expect(snapToSelectable(27.5, undefined)).toBe(27.5);
    expect(snapToSelectable(27.5, {})).toBe(27.5);
  });

  it('passes non-numeric input straight through', () => {
    expect(snapToSelectable(null, BOWFLEX_552)).toBeNull();
    expect(snapToSelectable(undefined, BOWFLEX_552)).toBeUndefined();
  });
});

describe('suggestNext with an adjustable implement', () => {
  const logs = (weight) => ([{
    date: new Date().toISOString(),
    exercises: [{
      name: 'Dumbbell Curl',
      sets: [{ weight, reps: 10 }, { weight, reps: 10 }],
    }],
  }]);

  it('suggests a weight the handle can actually be set to', () => {
    // Upper-body bump is +5. From 22.5 that's 27.5 — which the 552
    // cannot do. Must snap to 25.
    const s = suggestNext('Dumbbell Curl', logs(22.5), { implement: BOWFLEX_552 });
    expect(s.weight).toBe(25);
    expect(selectableWeights(BOWFLEX_552)).toContain(s.weight);
  });

  it('still bumps when the snapped step is smaller but real', () => {
    // From 50 the nominal +5 is 55, above the stack — but 52.5 exists,
    // so this is a genuine (smaller) bump, not a hold.
    const s = suggestNext('Dumbbell Curl', logs(50), { implement: BOWFLEX_552 });
    expect(s.kind).toBe('bump');
    expect(s.weight).toBe(52.5);
    expect(s.message).toMatch(/\+2\.5/);
  });

  it('says hold at the top of the stack rather than emitting "+0"', () => {
    // 52.5 IS the ceiling — there is no next setting to snap up to.
    const s = suggestNext('Dumbbell Curl', logs(52.5), { implement: BOWFLEX_552 });
    expect(s.kind).toBe('hold');
    expect(s.weight).toBe(52.5);
    expect(s.message).not.toMatch(/\+0\b/);
    expect(s.message).toMatch(/heaviest/i);
  });

  it('reports the bump it actually applied, not the nominal one', () => {
    const s = suggestNext('Dumbbell Curl', logs(22.5), { implement: BOWFLEX_552 });
    // Nominal +5, actual +2.5 after snapping.
    expect(s.message).toMatch(/\+2\.5/);
    expect(s.message).not.toMatch(/\+5/);
  });

  it('is unchanged from legacy behavior with no implement', () => {
    const withNone = suggestNext('Dumbbell Curl', logs(22.5));
    const withNull = suggestNext('Dumbbell Curl', logs(22.5), { implement: null });
    expect(withNone.weight).toBe(27.5);
    expect(withNull.weight).toBe(27.5);
  });

  it('is unchanged for an implement with no known ladder', () => {
    const s = suggestNext('Dumbbell Curl', logs(22.5), {
      implement: { brand: 'powerblock', line: 'Elite', model: 'EXP' },
    });
    expect(s.weight).toBe(27.5);
  });

  it('snaps the regression branch too', () => {
    const stale = [{
      date: new Date(Date.now() - 30 * 864e5).toISOString(),
      exercises: [{ name: 'Dumbbell Curl', sets: [{ weight: 50, reps: 8 }] }],
    }];
    const s = suggestNext('Dumbbell Curl', stale, { implement: BOWFLEX_552 });
    expect(s.kind).toBe('regress');
    expect(selectableWeights(BOWFLEX_552)).toContain(s.weight);
  });
});
