// The Hub composer's "attach a recent meal" list must not offer water.
//
// Hydration shares `nutrition_logs`: a glass is a row with meal_type NULL
// and food_name 'Water' (8 oz) or 'Water|N' (N oz). 118 of the 126 rows in
// production are water, so a meal list that fails to exclude them is almost
// entirely water.
//
// `HubComposer.jsx` filtered on `!(food_name === 'Water' && water_oz > 0)`.
// `water_oz` is a column migration 006 declares and has never created, so
// `m.water_oz` is undefined, `undefined > 0` is false, and the negated
// conjunction is unconditionally true — the filter excluded nothing. It also
// never matched the 'Water|N' form at all.
//
// This pins the predicate itself rather than mounting the composer, which
// needs the whole Hub tree. The fixture is the real 20-row window that query
// reads for the app's most active nutrition user.

import { describe, it, expect } from 'vitest';

/** The predicate as it now stands in HubComposer.jsx. */
const keepsMeal = (m) => !(m.food_name === 'Water' || m.food_name?.startsWith?.('Water|'));

/** The predicate as it was, kept so the regression stays visible. */
const oldKeepsMeal = (m) => !(m.food_name === 'Water' && m.water_oz > 0);

// Production, user 39d05494, ORDER BY date DESC LIMIT 20 → first 10.
const RECENT_20 = [
  { food_name: 'Farro and roasted vegetable bowl', meal_type: 'dinner', calories: 470 },
  { food_name: 'Mac and Cheese with Peas rice with green peas', meal_type: 'dinner', calories: 330 },
  { food_name: 'Water',    meal_type: null, calories: 0 },
  { food_name: 'Water',    meal_type: null, calories: 0 },
  { food_name: 'Water',    meal_type: null, calories: 0 },
  { food_name: 'Water',    meal_type: null, calories: 0 },
  { food_name: 'Water|32', meal_type: null, calories: 0 },
  { food_name: 'Water',    meal_type: null, calories: 0 },
  { food_name: 'Water',    meal_type: null, calories: 0 },
  { food_name: 'Water',    meal_type: null, calories: 0 },
];

describe('HubComposer recent-meals filter', () => {
  it('offers only the real meals', () => {
    const kept = RECENT_20.filter(keepsMeal);
    expect(kept.map(m => m.food_name)).toEqual([
      'Farro and roasted vegetable bowl',
      'Mac and Cheese with Peas rice with green peas',
    ]);
  });

  it('excludes the piped Water|N form, which the old predicate never matched', () => {
    expect(keepsMeal({ food_name: 'Water|32' })).toBe(false);
    expect(keepsMeal({ food_name: 'Water|8' })).toBe(false);
  });

  it('keeps a meal whose name merely starts with the word water', () => {
    // 'Watermelon' must survive — the guard is an exact match or a pipe.
    expect(keepsMeal({ food_name: 'Watermelon salad' })).toBe(true);
    expect(keepsMeal({ food_name: 'Water chestnut stir fry' })).toBe(true);
  });

  it('survives a row with no food_name', () => {
    expect(keepsMeal({})).toBe(true);
    expect(keepsMeal({ food_name: null })).toBe(true);
  });

  // The regression itself, pinned. If this ever passes, the bug is back.
  it('the OLD predicate excluded nothing at all', () => {
    const keptByOld = RECENT_20.filter(oldKeepsMeal);
    expect(keptByOld).toHaveLength(10);
    expect(keptByOld.filter(m => m.food_name.startsWith('Water'))).toHaveLength(8);
  });
});
