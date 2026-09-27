// Planted, not placed. A figure that stands on the ground in a skin's
// backdrop (a headstone, a fence post, a tree) must be buried in that ground
// at every point of its base, and anything that should float clear of it (a
// fence rail) must clear it everywhere along its span.
//
// The Halloween graveyard broke this before the rule existed: every figure
// carried a hand-typed bottom y while the ground was a curve, so the tilted
// headstone hovered over the hill and the fence stood on air at one end.
// Nothing in the code looked wrong. It only looked wrong on a phone.
//
// The rule is enforced on data, not pixels. A skin with grounded figures
// exports them from a module in its folder:
//
//   groundY(x)  height of the ground surface at x (SVG y, down is larger)
//   PLANTED     [{ kind, x0, x1, base, transform? }]  base spans x0..x1
//   RAILS       [{ x0, x1, thickness, topAt(x) }]      optional
//
// and this file finds every such module and checks it. Animating a figure
// later means animating these numbers, and the rule still holds per frame.

import { describe, it, expect } from 'vitest';
import * as graveyard from '../skins/halloween/graveyard';

const modules = Object.entries(import.meta.glob('../skins/*/*.js', { eager: true }))
  .filter(([, m]) => typeof m.groundY === 'function' && Array.isArray(m.PLANTED));

// A figure's base must be at least this far under the surface everywhere.
// One viewBox unit is under a pixel on a phone, so less than this reads as
// touching, and touching at a curve's edge reads as floating.
const BURIED = 1;
// A rail must clear the ground by at least this much.
const CLEARANCE = 2;

function rotate([x, y], deg, cx, cy) {
  const a = (deg * Math.PI) / 180;
  return [cx + (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a), cy + (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a)];
}

// The base edge as drawn, after any rotate() transform.
function baseEdge(f) {
  let a = [f.x0, f.base];
  let b = [f.x1, f.base];
  const m = f.transform?.match(/rotate\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)/);
  if (m) {
    const [deg, cx, cy] = m.slice(1).map(Number);
    a = rotate(a, deg, cx, cy);
    b = rotate(b, deg, cx, cy);
  } else if (f.transform) {
    throw new Error(`${f.kind} at ${f.x0}: only rotate(deg cx cy) is understood, got ${f.transform}`);
  }
  return [a, b];
}

/** Every point where a figure's base is not buried, or a rail touches the ground. */
function misalignments({ groundY, PLANTED, RAILS = [] }) {
  const out = [];
  for (const f of PLANTED) {
    const [[ax, ay], [bx, by]] = baseEdge(f);
    for (let i = 0; i <= 40; i += 1) {
      const t = i / 40;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const depth = y - groundY(x);
      if (depth < BURIED) out.push(`${f.kind} at x=${f.x0}: base is ${(-depth).toFixed(1)} above the ground at x=${x.toFixed(1)}`);
    }
  }
  for (const r of RAILS) {
    for (let x = r.x0; x <= r.x1; x += 0.5) {
      const gap = groundY(x) - (r.topAt(x) + r.thickness);
      if (gap < CLEARANCE) out.push(`rail ${r.x0}..${r.x1}: only ${gap.toFixed(1)} above the ground at x=${x}`);
    }
  }
  return [...new Set(out)];
}

describe('skin figures are planted, not placed', () => {
  it('finds the grounded skins', () => {
    expect(modules.map(([f]) => f)).toContain('../skins/halloween/graveyard.js');
  });

  for (const [file, mod] of modules) {
    describe(file, () => {
      it('buries every figure and clears every rail', () => {
        expect(misalignments(mod)).toEqual([]);
      });

      it('has something to check', () => {
        expect(mod.PLANTED.length).toBeGreaterThan(0);
        for (const f of mod.PLANTED) {
          expect(f.x1, `${f.kind} at ${f.x0}`).toBeGreaterThan(f.x0);
          expect(Number.isFinite(f.base)).toBe(true);
        }
      });

      it('draws the ground from the same numbers it measures', () => {
        if (!mod.GROUND_PATH) return;
        const ends = [...mod.GROUND_PATH.matchAll(/Q-?[\d.]+ -?[\d.]+ (-?[\d.]+) (-?[\d.]+)/g)].map((m) => m.slice(1).map(Number));
        expect(ends.length).toBeGreaterThan(0);
        for (const [x, y] of ends) expect(mod.groundY(x)).toBeCloseTo(y, 1);
      });
    });
  }
});

describe('the rule catches what it exists to catch', () => {
  const { groundY, PLANTED, RAILS } = graveyard;

  it('flags the old hand-placed headstone that floated over the hill', () => {
    // The pre-fix literal: base 122, tilted -6, where the ground sits near 125.
    const floating = { kind: 'headstone', x0: 150, x1: 176, base: 122, transform: 'rotate(-6 163 122)' };
    expect(misalignments({ groundY, PLANTED: [floating] }).length).toBeGreaterThan(0);
  });

  it('flags the old flat fence standing on air', () => {
    const floating = { kind: 'picket', x0: 206, x1: 211, base: 121 };
    expect(misalignments({ groundY, PLANTED: [floating] }).length).toBeGreaterThan(0);
  });

  it('flags a tilt that lifts one corner out of the ground', () => {
    // Buried just enough while upright, then tilted without sinking further:
    // the raised corner comes out. Proves the check reads the rotation.
    const f = PLANTED.find((p) => p.transform);
    const r = (f.x1 - f.x0) / 2;
    const base = Math.max(...[0, 0.25, 0.5, 0.75, 1].map((t) => groundY(f.x0 + t * 2 * r))) + BURIED + 0.2;
    const upright = { ...f, base, transform: undefined };
    expect(misalignments({ groundY, PLANTED: [upright] })).toEqual([]);
    const tilted = { ...upright, transform: `rotate(-6 ${f.x0 + r} ${base})` };
    expect(misalignments({ groundY, PLANTED: [tilted] }).length).toBeGreaterThan(0);
  });

  it('flags a rail that dips into the ground', () => {
    const sunk = { ...RAILS[1], topAt: (x) => RAILS[1].topAt(x) + 6 };
    expect(misalignments({ groundY, PLANTED: [], RAILS: [sunk] }).length).toBeGreaterThan(0);
  });
});
