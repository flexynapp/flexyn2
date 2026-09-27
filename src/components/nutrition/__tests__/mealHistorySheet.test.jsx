// The History sheet, rendered against production-shaped rows.
//
// This file exists because of a bug that shipped. The redesign made the per-day
// macro chips unconditional (they had been behind `hidden sm:flex`, i.e. dead on
// every phone) and read them off `entry.protein_g`. That column does not exist —
// migration 006 declares the `_g` aliases and has never been applied, so
// `select('*')` returns bare `protein` / `carbs` / `fat`. Every chip rendered
// "0g" for every user, and 35 lib-level tests plus a green suite said nothing,
// because the defect lived at the layer none of them touched.
//
// So: production shapes, and assertions on what a person would SEE.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Resolves against the real English catalog rather than returning the key.
// These tests assert on copy the user sees — the water-only case below is named
// for the sentence it expects — and an identity mock renders the key path
// instead, so the assertion would hold only while the string stayed hardcoded
// and break on the change that extracted it correctly.
vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'kegan@example.com', id: 'u1' } }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
const filter = vi.fn();
vi.mock('@/lib/data/nutrition', () => ({ remove: vi.fn(), listRecent: (...a) => filter(...a) }));

import MealHistoryModal from '../MealHistoryModal';

const pad = (v) => String(v).padStart(2, '0');
const dayKey = (n) => {
  const d = new Date(); d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const stamp = (n, h, m) => {
  const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0);
  return d.toISOString();
};

// Bare `protein` / `carbs` / `fat`, no `_g` alias, no `water_oz` key at all —
// exactly what PostgREST hands back. Values are real production rows.
const PANINI = {
  id: 'm1', date: dayKey(0), created_at: stamp(0, 16, 18), meal_type: 'snack',
  food_name: 'Grilled panini sandwich with french fries and ketchup',
  calories: 870, protein: 33, carbs: 104, fat: 36, fiber: 7, sodium: 1200,
};
const MAC = {
  id: 'm2', date: dayKey(1), created_at: stamp(1, 18, 58), meal_type: 'dinner',
  food_name: 'Mac and Cheese with Peas rice with green peas',
  calories: 330, protein: 9, carbs: 69, fat: 2, fiber: 4, sodium: 480,
};
const FARRO = {
  id: 'm3', date: dayKey(1), created_at: stamp(1, 18, 21), meal_type: 'dinner',
  food_name: 'Farro and roasted vegetable bowl',
  calories: 470, protein: 15, carbs: 85, fat: 8, fiber: 10, sodium: 150,
};
/** 92 of production's 129 rows look exactly like this. */
const water = (n, i) => ({ id: `w${n}${i}`, date: dayKey(n), created_at: stamp(n, 9 + i, 0), food_name: 'Water', calories: 0 });

const PROFILE = { weight_lbs: 185, height_inches: 71, gender: 'male' };

async function show(rows) {
  filter.mockResolvedValue(rows);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MealHistoryModal open onClose={() => {}} userProfile={PROFILE} />
    </QueryClientProvider>,
  );
  await screen.findByText('History');
  return qc;
}

/** The day header block for a given heading, so assertions stay scoped. Async
 *  because the sheet renders its skeleton first — reading synchronously after
 *  the title appears finds the loading state, not the list. */
const dayBlock = async (heading) => (await screen.findByText(heading)).closest('div').parentElement;

beforeEach(() => { filter.mockReset(); });

describe('macro chips read the columns the table actually has', () => {
  it('shows the real macros, not zeros', async () => {
    await show([PANINI]);
    const block = await dayBlock('Today');
    // THE REGRESSION. Reading entry.protein_g gave "P 0g · C 0g · F 0g".
    expect(within(block).getByText('P 33g')).toBeTruthy();
    expect(within(block).getByText('C 104g')).toBeTruthy();
    expect(within(block).getByText('F 36g')).toBeTruthy();
  });

  it('totals a multi-meal day across the bare columns', async () => {
    await show([MAC, FARRO]);
    const block = await dayBlock('Yesterday');
    expect(within(block).getByText('P 24g')).toBeTruthy();   // 9 + 15
    expect(within(block).getByText('C 154g')).toBeTruthy();  // 69 + 85
    expect(within(block).getByText('F 10g')).toBeTruthy();   // 2 + 8
    expect(within(block).getByText('800 cal')).toBeTruthy(); // 330 + 470
  });

  it('would still read a _g alias if migration 006 ever lands', async () => {
    await show([{ ...PANINI, protein_g: 41, protein: 33 }]);
    expect(await screen.findByText('P 41g')).toBeTruthy();
  });

  it('puts the macros on the row as well as the day header', async () => {
    await show([MAC]);
    expect(await screen.findByText(/9P · 69C · 2F/)).toBeTruthy();
  });
});

describe('water is not a meal', () => {
  it('keeps water rows out of the meal list', async () => {
    await show([PANINI, water(0, 0), water(0, 1), water(0, 2)]);
    await screen.findByText('Today');
    // The leak: `water_oz > 0` could never be true, so every bare "Water" row
    // rendered as a 0-cal meal.
    expect(screen.queryByText('Water')).toBeNull();
    expect(screen.getByText(/3 glasses/)).toBeTruthy();
  });

  it('a water-only day says "No meals logged", never "0 cal"', async () => {
    await show([PANINI, water(2, 0), water(2, 1), water(2, 2), water(2, 3)]);
    expect(await screen.findByText('No meals logged')).toBeTruthy();
    expect(screen.queryByText('0 cal')).toBeNull();
    expect(screen.getByText(/4 glasses/)).toBeTruthy();
  });
});

describe('the row says what the meal was', () => {
  it('leads the meta line with meal_type', async () => {
    await show([MAC]);
    // meal_type is set on every meal the app writes and was displayed nowhere.
    expect(await screen.findByText(/^Dinner · /)).toBeTruthy();
  });

  it('renders the log time from created_at', async () => {
    await show([MAC]);
    expect(await screen.findByText(/6:58 PM/)).toBeTruthy();
  });
});

describe('the detail sheet', () => {
  const openFirstMeal = async () => {
    const row = await screen.findByText(MAC.food_name);
    row.closest('[role="button"]').click();
  };

  it('hands the stored macros to re-log, and writes nothing itself', async () => {
    const onLogAgain = vi.fn();
    filter.mockResolvedValue([MAC]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MealHistoryModal open onClose={() => {}} userProfile={PROFILE} onLogAgain={onLogAgain} />
      </QueryClientProvider>,
    );
    await openFirstMeal();
    (await screen.findByText('Log this again')).click();
    expect(onLogAgain).toHaveBeenCalledTimes(1);
    // Result-shaped, with the bare columns already mapped onto the _g keys the
    // write path expects — the sheet computes the payload, Nutrition writes it.
    expect(onLogAgain.mock.calls[0][0]).toMatchObject({
      food_name: MAC.food_name, calories: 330, protein_g: 9, carbs_g: 69, fat_g: 2,
    });
  });

  it('offers no re-log control when the page did not pass one', async () => {
    await show([MAC]);
    await openFirstMeal();
    await screen.findByText(MAC.food_name);
    expect(screen.queryByText('Log this again')).toBeNull();
  });

  it('hides a nutrient that could never be non-zero rather than showing 0', async () => {
    // `sugar` has no column and no ai_meta on a manual entry, so a Sugar tile
    // would be a permanent, confident zero.
    await show([MAC]);
    await openFirstMeal();
    expect(await screen.findByText('Fiber')).toBeTruthy();   // 4 — real
    expect(screen.getByText('Sodium')).toBeTruthy();         // 480 — real
    expect(screen.queryByText('Sugar')).toBeNull();
  });
});

describe('empty state', () => {
  it('offers the log actions when there is nothing at all', async () => {
    filter.mockResolvedValue([]);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MealHistoryModal open onClose={() => {}} userProfile={PROFILE}
          onLogPhoto={() => {}} onLogManual={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('No meals logged yet')).toBeTruthy();
    expect(screen.getByText('Log with a photo')).toBeTruthy();
  });

  it('treats a day of nothing but water as empty history, not as a logged day', async () => {
    await show([water(0, 0), water(0, 1)]);
    // No meal has ever been logged, so the sheet is empty even though rows exist.
    expect(await screen.findByText('No meals logged yet')).toBeTruthy();
  });
});
