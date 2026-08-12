// Ranking and de-duplication for "Search" in the Log Meal panel.
//
// The ordering IS the feature: a search that returns the right foods in the
// wrong order is one nobody uses. These run against the real production
// shapes — the two food_items rows Kegan contributed by scanning, the one
// saved recipe, and the diary, 118 of whose 126 rows are water.

import { describe, it, expect } from 'vitest';
import { rankFoodMatches, recentFoods, matchRank, FOOD_SOURCE } from '@/lib/foodSearch';

// ── Fixtures, from production ────────────────────────────────────────────

/** food_items — both rows are real, both created by scanning a barcode. */
const SCANS = [
  { id: 'fi-1', name: 'White Claw Surge (Pineapple)', brand: null, barcode: '634985801507',
    serving_label: '1 serving', calories: 160, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 30,
    nutrition: { calories: 160, sugar: 2, sodium: 30 }, created_at: '2026-07-16T19:41:22Z' },
  { id: 'fi-2', name: 'Wafer Cookie (Lemon)', brand: null, barcode: '842826002642',
    serving_label: '1 serving', calories: 160, protein: 2, carbs: 20, fat: 8, fiber: 0.3, sodium: 50,
    nutrition: { calories: 160, protein: 2, carbs: 20, fat: 8, fiber: 0.3, sugar: 12, sodium: 50 },
    created_at: '2026-07-17T03:06:06Z' },
];

const RECIPES = [
  { id: 'rc-1', name: 'Chicken and rice bowl', servings: 4,
    totals: { calories: 2000, protein: 160, carbs: 200, fat: 40, fiber: 12, sodium: 1600 },
    updated_at: '2026-08-01T12:00:00Z' },
];

/** nutrition_logs — real meals plus the water that dominates the table. */
const LOGS = [
  { id: 'l-1', food_name: 'Water',    meal_type: null, calories: 0, created_at: '2026-08-11T10:00:00Z' },
  { id: 'l-2', food_name: 'Water|30', meal_type: null, calories: 0, created_at: '2026-08-11T11:00:00Z' },
  { id: 'l-3', food_name: 'Wafer Cookie (Lemon)', meal_type: 'dinner', calories: 160,
    protein: 2, carbs: 20, fat: 8, fiber: 0.3, sodium: 50, created_at: '2026-07-17T03:06:19Z' },
  { id: 'l-4', food_name: 'Farro and roasted vegetable bowl', meal_type: 'dinner', calories: 470,
    protein: 15, carbs: 85, fat: 8, fiber: 10, sodium: 150,
    ai_meta: { sugar_g: 4 }, created_at: '2026-08-11T22:21:59Z' },
  { id: 'l-5', food_name: 'Grilled chicken breast', meal_type: 'lunch', calories: 280,
    protein: 52, carbs: 1, fat: 6, created_at: '2026-08-09T12:00:00Z' },
  { id: 'l-6', food_name: 'Grilled chicken breast', meal_type: 'lunch', calories: 280,
    protein: 52, carbs: 1, fat: 6, created_at: '2026-08-10T12:00:00Z' },
];

const ALL = { logs: LOGS, foodItems: SCANS, recipes: RECIPES };
const names = (rows) => rows.map(r => r.name);

// ── matchRank ────────────────────────────────────────────────────────────

describe('matchRank — the tiers that decide the order', () => {
  it('ranks exact above prefix above word-prefix above anywhere', () => {
    expect(matchRank('chicken', 'chicken')).toBe(0);
    expect(matchRank('chicken breast', 'chicken')).toBe(1);
    expect(matchRank('grilled chicken breast', 'chicken')).toBe(2);
    expect(matchRank('unchickened sauce', 'chicken')).toBe(3);
  });

  // The example in foodSearch.js's own head comment, which the module did not
  // deliver until 2026-08-12: `'chicken-fried steak sauce'.startsWith('chicken')`
  // is true, so a `startsWith` tier put the SAUCE level with *Chicken breast*
  // and above *Grilled lemon chicken*. Rendered in the browser against all
  // three sources before the fix, the sauce came second of four.
  it('puts a mid-word compound BELOW a whole-word match — the doc comment’s example', () => {
    expect(matchRank('chicken breast', 'chicken')).toBe(1);
    expect(matchRank('grilled lemon chicken', 'chicken')).toBe(2);
    expect(matchRank('chicken-fried steak sauce', 'chicken')).toBe(3);
    // …and therefore, in that order:
    const order = ['Chicken-fried steak sauce', 'Grilled lemon chicken', 'Chicken breast']
      .sort((a, b) => matchRank(a, 'chicken') - matchRank(b, 'chicken'));
    expect(order).toEqual(['Chicken breast', 'Grilled lemon chicken', 'Chicken-fried steak sauce']);
  });

  it('treats punctuation as a word boundary but a hyphen as a joiner', () => {
    // "(Pineapple)" is the word pineapple in brackets — somebody searching
    // for it means to find it, so brackets must not demote the match the way
    // a hyphen does.
    expect(matchRank('White Claw Surge (Pineapple)', 'pineapple')).toBe(2);
    expect(matchRank('2% milk', '2')).toBe(1);
    expect(matchRank('low-fat milk', 'fat')).toBe(3);
    expect(matchRank('milk, low fat', 'fat')).toBe(2);
  });

  it('takes the BEST occurrence, not the first', () => {
    // Mid-word at index 0, whole word at index 14. The whole word wins.
    expect(matchRank('chicken-fried chicken soup', 'chicken')).toBe(2);
  });

  it('returns null when there is no match at all', () => {
    expect(matchRank('farro bowl', 'chicken')).toBeNull();
    expect(matchRank('', 'chicken')).toBeNull();
  });

  it('treats an empty query as matching everything at rank 0', () => {
    // This is what makes the idle "recent" list the same code path.
    expect(matchRank('anything', '')).toBe(0);
  });

  it('is case-insensitive and survives regex metacharacters in the query', () => {
    expect(matchRank('White Claw Surge (Pineapple)', 'white claw')).toBe(1);
    // A user typing a bracket must not blow up the word-boundary RegExp.
    expect(() => matchRank('White Claw Surge (Pineapple)', '(pine')).not.toThrow();
    expect(matchRank('Cost $5 bar', '$5')).not.toBeNull();
  });
});

// ── the sources ──────────────────────────────────────────────────────────

describe('rankFoodMatches — sources', () => {
  it('finds a food from the scanner history', () => {
    const r = rankFoodMatches({ ...ALL, query: 'white claw' });
    expect(names(r)).toContain('White Claw Surge (Pineapple)');
    expect(r[0].source).toBe(FOOD_SOURCE.SCAN);
    expect(r[0].barcode).toBe('634985801507');
  });

  it('finds a saved recipe and divides its totals by servings', () => {
    const r = rankFoodMatches({ ...ALL, query: 'chicken and rice' });
    const hit = r.find(x => x.source === FOOD_SOURCE.RECIPE);
    expect(hit).toBeTruthy();
    // 2000 kcal over 4 servings is 500 for the one you log, not 2000.
    expect(hit.calories).toBe(500);
    expect(hit.protein_g).toBe(40);
    expect(hit.servingLabel).toBe('1 of 4 servings');
  });

  it('finds a food from the diary and recovers sugar from ai_meta', () => {
    const r = rankFoodMatches({ ...ALL, query: 'farro' });
    expect(r[0].name).toBe('Farro and roasted vegetable bowl');
    expect(r[0].source).toBe(FOOD_SOURCE.RECENT);
    expect(r[0].sugar_g).toBe(4);
  });

  it('NEVER returns water, which is 118 of the 126 rows in production', () => {
    for (const q of ['wa', 'water', '']) {
      const r = rankFoodMatches({ ...ALL, query: q }, { limit: 100 });
      expect(r.every(x => !/^Water(\||$)/.test(x.name))).toBe(true);
    }
  });
});

// ── de-duplication ───────────────────────────────────────────────────────

describe('rankFoodMatches — de-duplication', () => {
  it('collapses the same food arriving from two different sources', () => {
    // "Wafer Cookie (Lemon)" is both a scanned food_item AND a diary row.
    const r = rankFoodMatches({ ...ALL, query: 'wafer' });
    expect(names(r).filter(n => n === 'Wafer Cookie (Lemon)')).toHaveLength(1);
  });

  it('keeps the scanned record’s detail when merging, not the diary’s', () => {
    const r = rankFoodMatches({ ...ALL, query: 'wafer' });
    const hit = r[0];
    // The scan carries a barcode and a real serving label; the diary row does not.
    expect(hit.source).toBe(FOOD_SOURCE.SCAN);
    expect(hit.barcode).toBe('842826002642');
    // ...but the diary's usage count survives the merge.
    expect(hit.timesLogged).toBe(1);
  });

  it('sums usage across duplicate diary rows', () => {
    const r = rankFoodMatches({ ...ALL, query: 'grilled chicken' });
    expect(r).toHaveLength(1);
    expect(r[0].timesLogged).toBe(2);      // logged on the 9th and the 10th
  });
});

// ── ordering ─────────────────────────────────────────────────────────────

describe('rankFoodMatches — ordering', () => {
  it('puts the better textual match first regardless of how often it was eaten', () => {
    const logs = [
      // eaten five times, but only a mid-string match
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `x${i}`, food_name: 'Creamy chicken pasta', calories: 600,
        created_at: `2026-08-0${i + 1}T12:00:00Z`,
      })),
      { id: 'y', food_name: 'Chicken', calories: 200, created_at: '2026-01-01T12:00:00Z' },
    ];
    const r = rankFoodMatches({ logs, query: 'chicken' });
    expect(r[0].name).toBe('Chicken');            // exact beats popular
    expect(r[1].name).toBe('Creamy chicken pasta');
  });

  it('breaks a rank tie by how often the food was logged', () => {
    const logs = [
      { id: 'a', food_name: 'Chicken soup',  calories: 120, created_at: '2026-08-01T12:00:00Z' },
      { id: 'b', food_name: 'Chicken salad', calories: 300, created_at: '2026-08-02T12:00:00Z' },
      { id: 'c', food_name: 'Chicken salad', calories: 300, created_at: '2026-08-03T12:00:00Z' },
    ];
    const r = rankFoodMatches({ logs, query: 'chicken s' });
    expect(names(r)).toEqual(['Chicken salad', 'Chicken soup']);
  });

  it('honours the limit', () => {
    expect(rankFoodMatches({ ...ALL, query: '' }, { limit: 2 })).toHaveLength(2);
  });
});

// ── the idle list ────────────────────────────────────────────────────────

describe('recentFoods — what the sheet shows before a keystroke', () => {
  it('returns the user’s foods most-logged first, water excluded', () => {
    const r = recentFoods(ALL, { limit: 10 });
    expect(r.length).toBeGreaterThan(0);
    expect(names(r)).not.toContain('Water');
    // Grilled chicken breast is the only food logged twice.
    expect(r[0].name).toBe('Grilled chicken breast');
  });

  it('includes every source, not just the diary', () => {
    const sources = new Set(recentFoods(ALL, { limit: 20 }).map(r => r.source));
    expect(sources).toContain(FOOD_SOURCE.SCAN);
    expect(sources).toContain(FOOD_SOURCE.RECIPE);
    expect(sources).toContain(FOOD_SOURCE.RECENT);
  });

  it('returns an empty list rather than throwing when the user has nothing', () => {
    expect(recentFoods({})).toEqual([]);
    expect(rankFoodMatches({ query: 'anything' })).toEqual([]);
    expect(rankFoodMatches()).toEqual([]);
  });

  it('survives malformed rows without throwing', () => {
    const junk = { logs: [{}, { food_name: null }, null], foodItems: [{}], recipes: [{ servings: 0 }] };
    expect(() => recentFoods(junk)).not.toThrow();
  });
});
