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

  it.each(['1', '2', '3', 'neutral'])('--cat-%s has its own step per mode', (n) => {
    // Dark is SELECTED, not a flip — each mode carries its own value.
    // --cat-1 in particular is NOT --primary in dark: the brand orange
    // measures L 0.701 there, above the 0.67 ceiling, so it fails the
    // lightness band outright and is re-stepped to 45%.
    expect(light).toMatch(new RegExp(`--cat-${n}:\\s*\\d`));
    expect(dark).toMatch(new RegExp(`--cat-${n}:\\s*\\d`));
  });

  it('is ONE palette — chart and region slots share the same values', () => {
    // Two ramps invented independently is how the old one drifted: the
    // chart ramp failed the chroma floor in both modes and had --chart-1
    // bit-for-bit identical to --primary, while nothing checked either.
    // Both sets now reference --cat-*, so they cannot diverge.
    for (const mode of [light, dark]) {
      for (const n of [1, 2, 3]) {
        expect(mode).toMatch(new RegExp(`--chart-${n}:\\s*var\\(--cat-${n}\\)`));
      }
      for (const [region, cat] of [['pull', 1], ['push', 2], ['legs', 3]]) {
        expect(mode).toMatch(new RegExp(`--region-${region}:\\s*var\\(--cat-${cat}\\)`));
      }
      expect(mode).toMatch(/--region-other:\s*var\(--cat-neutral\)/);
    }
  });

  it('has NO fourth or fifth categorical slot', () => {
    // Three is the measured ceiling (see --cat-* in index.css). Slots 4
    // and 5 existed, did not discriminate, and were what let a widget
    // cycle colours onto colliding wedges. Their absence is the fix, so
    // it is the thing worth pinning — a declaration is an invitation.
    expect(css).not.toMatch(/^\s*--chart-4:/m);
    expect(css).not.toMatch(/^\s*--chart-5:/m);

    const tw = fs.readFileSync('tailwind.config.js', 'utf8');
    const chartBlock = tw.slice(tw.indexOf('chart: {'), tw.indexOf('}', tw.indexOf('chart: {')));
    expect(chartBlock).toContain("'3'");
    expect(chartBlock).not.toContain("'4'");
    expect(chartBlock).not.toContain("'5'");
  });

  it('nothing in the app still reaches for a removed slot', () => {
    // A stale `text-chart-4` emits no CSS at all now — Tailwind's scanner
    // finds no such class — so the element silently renders unstyled
    // rather than failing. That is invisible in review, hence a test.
    const hits = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        // Skip __tests__ — this very file names the removed slots in a
        // regex, so scanning itself is a guaranteed self-hit.
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); continue; }
        if (!/\.jsx?$/.test(e.name)) continue;
        const src = fs.readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        if (/chart-[45]/.test(src)) hits.push(p);
      }
    })('src');
    expect(hits, `these still use a removed chart slot: ${hits.join(', ')}`).toEqual([]);
  });

  it('declares three hues and exactly one neutral', () => {
    // The neutral is what marks a remainder rather than an identity, and
    // it is the reason only three regions carry a hue. If a fourth hue
    // ever appears here, the all-pairs measurement in muscleRegions.js
    // says it will not be distinguishable — re-run the validator first.
    const sat = (mode, n) => Number(
      mode.match(new RegExp(`--cat-${n}:\\s*[\\d.]+\\s+([\\d.]+)%`))[1],
    );
    for (const mode of [light, dark]) {
      expect(sat(mode, 'neutral')).toBeLessThan(15);
      for (const n of [1, 2, 3]) expect(sat(mode, n)).toBeGreaterThan(50);
    }
  });
});
