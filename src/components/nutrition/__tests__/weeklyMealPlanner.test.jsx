// WeeklyMealPlannerModal — the grocery CTA must not promise what the list
// cannot deliver, and dates must move with the language.
//
// This is the first test file for the largest component in the nutrition
// area (919 lines). It exists because of two things the 2026-08-11 meal-plans
// audit confirmed against production:
//
//   • The CTA counted uncompleted plans. The list is built from plans that
//     carry INGREDIENTS, and no Photo-AI or manual plan does. On the real
//     data the button read "Generate grocery list · 6 meals" and opened a
//     sheet reading "Nothing to buy yet."
//   • Every date in the grid went through date-fns `format()`, which binds no
//     locale, so "Mon"/"Aug 11" rendered in English under all 15 languages.
//
// PLANS below is production's actual shape: 14-key photo-AI snapshots with a
// log_id and NO `ingredients` key. 8 of 8 rows look like this.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let LANGUAGE = 'en';

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' } }),
}));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ language: LANGUAGE, t: (k) => k, tFallback: (_k, e) => e }),
}));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));
vi.mock('@/components/nutrition/NutritionPlansModal', () => ({
  NutritionPlansPanel: () => null,
}));
vi.mock('@/components/nutrition/PhotoMealResultModal', () => ({ default: () => null }));
vi.mock('@/lib/data/photoMealRecognition', () => ({ recognizeMealPhoto: vi.fn() }));
vi.mock('@/lib/data/nutrition', () => ({
  syncPlannerDiaryLog: vi.fn(), removePlannerDiaryLog: vi.fn(), remove: vi.fn(),
}));
vi.mock('@/lib/data/nutritionRecipes', () => ({ listMine: () => Promise.resolve([]) }));

let PLANS = [];
vi.mock('@/lib/data/mealPlans', async () => {
  const actual = await vi.importActual('@/lib/data/mealPlans');
  return { ...actual, listInRange: () => Promise.resolve(PLANS) };
});

const WeeklyMealPlannerModal = (await import('../WeeklyMealPlannerModal')).default;

/** The 14-key snapshot the photo-meal mirror writes. No `ingredients`. */
const photoSnapshot = (name) => ({
  name, calories: 520, protein_g: 18, carbs_g: 72, fat_g: 16,
  fiber_g: 9, sugar_g: 7, sodium_mg: 480,
  image_url: null, portion_estimate: '1 bowl', confidence: 'medium',
  items: [{ name: 'farro' }], source: 'photo_ai', log_id: 'log-1',
});

const plan = (date, mealType, snap) => ({
  id: `${date}-${mealType}`, plan_date: date, meal_type: mealType,
  recipe_id: null, is_completed: false, food_snapshot: snap,
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WeeklyMealPlannerModal open onClose={() => {}} userProfile={{}} />
    </QueryClientProvider>,
  );
}

/** Mount and wait until the grid has actually rendered. The CTA is outside
 *  the isLoading branch, so reading it too early reads the loading state. */
async function mountLoaded() {
  const r = mount();
  await screen.findAllByText(/Breakfast/);
  return r;
}

beforeEach(() => { PLANS = []; LANGUAGE = 'en'; });

describe('grocery CTA — honest about what it can produce', () => {
  it('no plans at all: invites the user to plan one, and is disabled', async () => {
    await mountLoaded();
    const btn = screen.getByRole('button', { name: /grocery list/i });
    expect(btn).toBeDisabled();
    expect(btn.textContent).toMatch(/Plan a meal to build a grocery list/);
    expect(document.body.textContent).not.toMatch(/Generate grocery list/);
  });

  it('THE DEFECT: real photo-AI plans no longer advertise a meal count', async () => {
    PLANS = [
      plan('2026-07-16', 'snack',  photoSnapshot('Sautéed onion and pepper')),
      plan('2026-08-11', 'dinner', photoSnapshot('Farro bowl')),
    ];
    await mountLoaded();
    const btn = screen.getByRole('button', { name: /grocery list/i });
    // Before the fix this read "Generate grocery list · 2 meals" and opened
    // a sheet saying "Nothing to buy yet."
    expect(btn.textContent).not.toMatch(/\d+\s*meal/);
    expect(btn.textContent).toMatch(/Add a recipe to build a grocery list/);
    expect(btn).toBeDisabled();
  });

  it('a plan carrying ingredients does advertise, and enables the button', async () => {
    PLANS = [
      plan('2026-08-11', 'dinner', { name: 'Stew', ingredients: [{ name: 'Carrot', grams: 80 }] }),
      plan('2026-08-11', 'snack',  photoSnapshot('Farro bowl')),
    ];
    await mountLoaded();
    const btn = screen.getByRole('button', { name: /grocery list/i });
    // One of the two contributes — the count is 1, not 2.
    expect(btn.textContent).toMatch(/Generate grocery list · 1 meal\b/);
    expect(btn).toBeEnabled();
  });

  it('a completed plan is not counted', async () => {
    PLANS = [{
      ...plan('2026-08-11', 'dinner', { name: 'Stew', ingredients: [{ name: 'Carrot', grams: 80 }] }),
      is_completed: true,
    }];
    await mountLoaded();
    const btn = screen.getByRole('button', { name: /grocery list/i });
    expect(btn).toBeDisabled();
  });
});

describe('dates move with the language', () => {
  it('renders English weekday abbreviations by default', async () => {
    await mountLoaded();
    // Every ISO weekday short name, in English.
    expect(document.body.textContent).toMatch(/Mon/);
    expect(document.body.textContent).toMatch(/Sun/);
  });

  it('REGRESSION: the grid is not hardcoded English — Spanish renders Spanish', async () => {
    LANGUAGE = 'es';
    await mountLoaded();
    const text = document.body.textContent;
    // date-fns format('EEE') returned "Mon"/"Tue" regardless of language.
    // Intl gives lun./mar./mié. — assert we got a Spanish weekday and NOT
    // the English one.
    expect(text).toMatch(/lun|mar|mié|jue|vie|sáb|dom/);
    expect(text).not.toMatch(/\bMon\b/);
  });
});
