import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { REGIONS, regionFor, regionColor, rollUpToRegions } from '@/lib/muscleRegions';
import { muscleKey } from '@/lib/exerciseTranslations';

describe('regionFor', () => {
  const EXPECTED = {
    chest: 'push', shoulders: 'push', triceps: 'push',
    back: 'pull', lats: 'pull', traps: 'pull', biceps: 'pull', forearms: 'pull',
    legs: 'legs', quads: 'legs', hamstrings: 'legs', glutes: 'legs', calves: 'legs',
    core: 'other', abs: 'other', obliques: 'other', fullBody: 'other', cardio: 'other',
  };

  it('maps every muscle muscleKey() can produce', () => {
    // The guard that matters: muscleKey's map is the vocabulary the whole
    // app writes into workout_logs, so a muscle it knows and this file
    // does not would silently land in the neutral bucket and read as
    // "core & other" on the chart. Enumerate the source rather than a
    // copy of it.
    const src = fs.readFileSync('src/lib/exerciseTranslations.js', 'utf8');
    const block = src.slice(src.indexOf('export function muscleKey'));
    const known = [...block.slice(0, block.indexOf('};')).matchAll(/'([A-Za-z ]+)':\s*'(\w+)'/g)]
      .map((m) => m[2]);

    expect(known.length).toBeGreaterThan(15);
    const unmapped = known.filter((k) => !Object.keys(EXPECTED).includes(k));
    expect(unmapped, `muscleKey knows these but muscleRegions does not: ${unmapped}`).toEqual([]);
    for (const [key, region] of Object.entries(EXPECTED)) {
      expect(regionFor(key), `${key} should be ${region}`).toBe(region);
    }
  });

  it('is case-insensitive via muscleKey, so Chest and chest agree', () => {
    // The raw column carries whatever the exercise row was written with,
    // and 'Chest' vs 'chest' landing in different buckets is exactly the
    // bug that once rendered two pills for one muscle.
    expect(regionFor(muscleKey('Chest'))).toBe('push');
    expect(regionFor(muscleKey('chest'))).toBe('push');
  });

  it('falls an unknown muscle to the neutral remainder rather than throwing', () => {
    expect(regionFor('adductors')).toBe('other');
    expect(regionFor(undefined)).toBe('other');
  });
});

describe('regionColor', () => {
  it('returns a themed CSS var, never a raw hex', () => {
    // A raw hex would ignore the theme. These variables hold HSL triplets,
    // so the hsl() wrapper is what makes them a colour at all — the
    // widget's tooltip shipped without it and had no background.
    for (const r of REGIONS) expect(regionColor(r)).toBe(`hsl(var(--region-${r}))`);
  });

  it('gives every region a DISTINCT slot — never cycles', () => {
    const slots = new Set(REGIONS.map(regionColor));
    expect(slots.size).toBe(REGIONS.length);
  });

  it('sends an unknown region to the neutral slot', () => {
    expect(regionColor('nonsense')).toBe('hsl(var(--region-other))');
  });
});

describe('rollUpToRegions', () => {
  it('sums muscles into their region', () => {
    expect(rollUpToRegions({ chest: 3, triceps: 2, back: 4 })).toEqual([
      { region: 'push', value: 5 },
      { region: 'pull', value: 4 },
    ]);
  });

  it('returns regions in FIXED slot order, not by size', () => {
    // Colour follows the entity, never its rank: a bigger pull week must
    // not repaint push. Order is the palette's CVD-safety mechanism.
    const out = rollUpToRegions({ calves: 99, chest: 1, abs: 5, back: 40 });
    expect(out.map((d) => d.region)).toEqual(['push', 'pull', 'legs', 'other']);
  });

  it('drops empty regions but never drops data', () => {
    const out = rollUpToRegions({ chest: 2 });
    expect(out).toEqual([{ region: 'push', value: 2 }]);

    // The bug this replaces: `.slice(0, 6)` on insertion order silently
    // discarded groups 7+, and because it sliced by order rather than
    // size it could drop a bigger group than the ones it kept. Regions
    // are bounded at four, so the total is always conserved.
    const many = { chest: 1, shoulders: 1, triceps: 1, back: 1, lats: 1, traps: 1,
                   biceps: 1, forearms: 1, legs: 1, quads: 1, calves: 1, abs: 1 };
    const total = rollUpToRegions(many).reduce((n, d) => n + d.value, 0);
    expect(total).toBe(Object.keys(many).length);
  });

  it('ignores zero, negative and non-numeric counts', () => {
    expect(rollUpToRegions({ chest: 0, back: -3, legs: 'x', abs: 2 }))
      .toEqual([{ region: 'other', value: 2 }]);
    expect(rollUpToRegions({})).toEqual([]);
    expect(rollUpToRegions()).toEqual([]);
  });
});

describe('the palette is defined for both themes', () => {
  // The validated hexes live in index.css as HSL triplets. This asserts
  // they EXIST in both blocks — a region with no dark value would fall
  // back to nothing and paint the wedge transparent.
  const css = fs.readFileSync('src/index.css', 'utf8');
  const dark = css.slice(css.indexOf('.dark {'));
  const light = css.slice(0, css.indexOf('.dark {'));

  it.each(REGIONS)('--region-%s is declared in light and dark', (r) => {
    expect(light).toContain(`--region-${r}:`);
    expect(dark).toContain(`--region-${r}:`);
  });

  it('declares three hues and exactly one neutral', () => {
    // The neutral is what marks a remainder rather than an identity, and
    // it is the reason only three regions carry a hue. If a fourth hue
    // ever appears here, the all-pairs measurement in muscleRegions.js
    // says it will not be distinguishable — re-run the validator first.
    const sat = (mode, r) => Number(
      mode.match(new RegExp(`--region-${r}:\\s*[\\d.]+\\s+([\\d.]+)%`))[1],
    );
    for (const mode of [light, dark]) {
      expect(sat(mode, 'other')).toBeLessThan(15);
      for (const r of ['push', 'pull', 'legs']) expect(sat(mode, r)).toBeGreaterThan(50);
    }
  });
});
