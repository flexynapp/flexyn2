// FoodSearchSheet — the surface behind "Search" in the Log Meal panel.
//
// This file did not exist. `src/components/nutrition/__tests__/` held four
// files and none of them was the search sheet, so the only component in the
// food database with a text input had no render coverage at all — the ranking
// module underneath it was well tested, the sheet that renders it was not.
//
// Two things this proves that `foodSearch.test.js` cannot:
//
//   • **which table each of the three sources reads.** The stub is keyed by
//     table name, so a source silently pointed at the wrong table fails here.
//     It also pins the `created_by` scoping, which is the whole answer to
//     "does Search search a shared food database?" — it does not, on purpose.
//   • **what the sheet puts on screen for a zero.** jsdom paints nothing, but
//     it does render text, and "0 cal" beside three foods with real numbers
//     was a real defect: `safeEntry` maps every blank numeric field to 0 on
//     save, and production carries such a row (`food_name: 'ck'`).
//
// Fixtures are production shapes: the two `food_items` rows one user
// contributed by scanning, and a diary in which most rows are water.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, english, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), english) : english,
  }),
}));
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'mine@flexyn.test' } }),
}));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));
vi.mock('@/hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

// ── the two data layers, stubbed at the supabase level ────────────────────
//
// A chainable thenable per table, resolving at ANY depth: `listMineForSearch`
// bottoms out at `.limit()`, `nutritionRecipes.listMine` at `.order()`. The
// call log is what lets the assertions below name the table AND the filter.
const CALLS = [];
let TABLES = {};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      const node = {};
      const payload = () => ({ data: TABLES[table] ?? [], error: null });
      for (const m of ['select', 'eq', 'order', 'limit', 'neq']) {
        node[m] = (...args) => { CALLS.push([table, m, ...args]); return node; };
      }
      node.then = (res, rej) => Promise.resolve(payload()).then(res, rej);
      node.catch = (rej) => Promise.resolve(payload()).catch(rej);
      node.finally = (f) => Promise.resolve(payload()).finally(f);
      return node;
    },
  },
}));
vi.mock('@/api/db', () => ({
  db: {
    entities: {
      NutritionLog: {
        filter: (...args) => {
          CALLS.push(['nutrition_logs', 'filter', ...args]);
          return Promise.resolve(TABLES.nutrition_logs ?? []);
        },
      },
    },
  },
}));

import FoodSearchSheet from '../FoodSearchSheet';

// ── Fixtures ──────────────────────────────────────────────────────────────

/** Both real `food_items` rows. One user, both from a barcode scan. */
const SCANS = [
  { id: 'fi-1', name: 'White Claw Surge (Pineapple)', brand: null, barcode: '634985801507',
    serving_label: '1 serving', calories: 160, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 30,
    nutrition: { calories: 160, protein: null, sugar: 2, sodium: 30 },
    created_by: 'mine@flexyn.test', created_at: '2026-07-17T03:06:06Z' },
  { id: 'fi-2', name: 'Wafer Cookie (Lemon)', brand: null, barcode: '842826002642',
    serving_label: '1 serving', calories: 160, protein: 2, carbs: 20, fat: 8, fiber: 0.3, sodium: 50,
    nutrition: { calories: 160, protein: 2, carbs: 20, fat: 8, fiber: 0.3, sugar: 12, sodium: 50 },
    created_by: 'mine@flexyn.test', created_at: '2026-07-16T19:41:22Z' },
];

const RECIPES = [
  { id: 'rc-1', name: 'Chicken rice bowl', servings: 2,
    totals: { calories: 1180, protein_g: 92, carbs_g: 120, fat_g: 26 },
    updated_at: '2026-08-06T10:00:00Z' },
];

/** The diary. Water dominates it in production, and `ck` is a real row. */
const LOGS = [
  { id: 'l-1', food_name: 'Water',    meal_type: null, calories: 0, created_at: '2026-08-11T10:00:00Z' },
  { id: 'l-2', food_name: 'Water|30', meal_type: null, calories: 0, created_at: '2026-08-11T11:00:00Z' },
  { id: 'l-3', food_name: 'Chicken breast', meal_type: 'lunch', calories: 165, protein: 31, created_at: '2026-08-10T12:00:00Z' },
  { id: 'l-4', food_name: 'Chicken breast', meal_type: 'lunch', calories: 165, protein: 31, created_at: '2026-08-09T12:00:00Z' },
  { id: 'l-5', food_name: 'Grilled lemon chicken', meal_type: 'dinner', calories: 310, created_at: '2026-08-08T19:00:00Z' },
  { id: 'l-6', food_name: 'Chicken-fried steak sauce', meal_type: 'dinner', calories: 90, created_at: '2026-08-07T19:00:00Z' },
  { id: 'l-7', food_name: 'ck', meal_type: 'breakfast', calories: 0, created_at: '2026-08-06T08:00:00Z' },
];

const mount = (props = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FoodSearchSheet open onClose={() => {}} onPick={() => {}} {...props} />
    </QueryClientProvider>,
  );
};

// The sheet renders through a portal-free fixed overlay, but the results only
// exist once all three queries settle — asserting before that reads the
// loading spinner and proves nothing.
const settled = () => screen.findByText('Wafer Cookie (Lemon)');

beforeEach(() => {
  CALLS.length = 0;
  TABLES = { food_items: SCANS, nutrition_recipes: RECIPES, nutrition_logs: LOGS };
});

describe('FoodSearchSheet — the three sources it reads', () => {
  it('reads food_items scoped to the caller, plus recipes and the diary', async () => {
    mount();
    await settled();

    const tables = CALLS.map(c => c[0]);
    expect(tables).toContain('food_items');
    expect(tables).toContain('nutrition_recipes');
    expect(tables).toContain('nutrition_logs');

    // THE ANSWER TO "does this search a shared food database?" — it does not.
    // `created_by = <the caller>` is deliberate (see foodItems.js), and this
    // assertion is what stops the filter being dropped by accident rather
    // than by decision.
    expect(CALLS).toEqual(expect.arrayContaining([
      ['food_items', 'eq', 'created_by', 'mine@flexyn.test'],
    ]));
    // Nothing asks the database for `is_verified`, because nothing is meant to.
    expect(CALLS.some(c => JSON.stringify(c).includes('is_verified'))).toBe(false);
  });

  it('renders one row per food across all three sources, with its badge', async () => {
    mount();
    await settled();
    expect(screen.getByText('Chicken rice bowl')).toBeTruthy();       // recipe
    expect(screen.getByText('White Claw Surge (Pineapple)')).toBeTruthy(); // scan
    expect(screen.getByText('Chicken breast')).toBeTruthy();          // diary
    expect(screen.getAllByText(/Recipe/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Scanned/).length).toBeGreaterThan(0);
  });

  it('never offers water, which is 118 of the 126 diary rows', async () => {
    mount();
    await settled();
    expect(screen.queryByText('Water')).toBeNull();
    expect(screen.queryByText('Water|30')).toBeNull();
  });
});

describe('FoodSearchSheet — what a query puts on screen', () => {
  it('orders a query the way foodSearch.js documents', async () => {
    mount();
    await settled();
    await userEvent.type(screen.getByPlaceholderText('Search your foods'), 'chicken');

    await waitFor(() => expect(screen.getByText('Chicken breast')).toBeTruthy());
    const rendered = screen.getAllByRole('button')
      .map(b => b.textContent)
      .filter(txt => /chicken/i.test(txt));

    const idx = (name) => rendered.findIndex(t => t.startsWith(name));
    expect(idx('Chicken breast')).toBeGreaterThanOrEqual(0);
    // Whole-word beats mid-word: the sauce goes last, not second.
    expect(idx('Grilled lemon chicken')).toBeLessThan(idx('Chicken-fried steak sauce'));
    expect(idx('Chicken breast')).toBeLessThan(idx('Grilled lemon chicken'));
  });

  it('says nothing matched without claiming the user has no foods', async () => {
    mount();
    await settled();
    await userEvent.type(screen.getByPlaceholderText('Search your foods'), 'zzzz');
    await waitFor(() => expect(screen.getByText('Nothing matches that yet')).toBeTruthy());
    expect(screen.queryByText('No foods yet')).toBeNull();
  });

  it('says the account has no foods when it genuinely has none', async () => {
    TABLES = { food_items: [], nutrition_recipes: [], nutrition_logs: [] };
    mount();
    expect(await screen.findByText('No foods yet')).toBeTruthy();
    expect(screen.queryByText('Nothing matches that yet')).toBeNull();
  });

  it('shows no calorie figure for a food stored with zero calories', async () => {
    mount();
    await settled();
    // `ck` is a real production row: a one-character name and sixteen
    // untouched inputs, saved as a breakfast with a hard 0. It appears in the
    // list — it is a food the user logged — but it does not claim "0 cal".
    const row = screen.getByText('ck').closest('button');
    expect(row).toBeTruthy();
    // `not.toMatch(/\bcal\b/)` is VACUOUS here and was the first version of
    // this assertion: the figure and the unit render adjacent as "0cal", and
    // there is no word boundary between a digit and a letter, so it passed
    // against the bug. Caught by reverting the fix and re-running. Assert on
    // the substring.
    expect(row.textContent).not.toContain('cal');
    expect(row.textContent).not.toContain('0');
    // …while a food with real calories still shows them.
    expect(screen.getByText('Chicken breast').closest('button').textContent).toContain('165');
    expect(screen.getByText('Chicken breast').closest('button').textContent).toContain('cal');
  });
});

describe('FoodSearchSheet — picking a food', () => {
  it('hands the entry to onPick and closes, rather than logging it', async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    mount({ onPick, onClose });
    await settled();

    await userEvent.click(screen.getByText('Wafer Cookie (Lemon)').closest('button'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    const [entry] = onPick.mock.calls[0];
    expect(entry.name).toBe('Wafer Cookie (Lemon)');
    expect(entry.calories).toBe(160);
    expect(entry.barcode).toBe('842826002642');
  });

  it('renders nothing at all when closed', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <FoodSearchSheet open={false} onClose={() => {}} onPick={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.queryByPlaceholderText('Search your foods')).toBeNull();
    expect(CALLS).toHaveLength(0);   // and reads nothing
  });
});
