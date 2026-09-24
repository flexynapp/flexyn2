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
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let LANGUAGE = 'en';

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' } }),
}));
// `tFallback(key, 'English {n}', { n })` is the three-argument form, and the
// usual stub — `(_k, e) => e` — silently drops the third. That returns the
// pre-interpolated fallback, so a string carrying a placeholder passes whether
// or not the call site forwards its vars, and the hole only appears once
// somebody switches language. CLAUDE.md documents this exact blind spot. This
// stub interpolates, so a dropped var fails here instead of in Spanish.
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: LANGUAGE,
    t: (k) => k,
    tFallback: (_k, e, vars) =>
      String(e).replace(/\{(\w+)\}/g, (m, name) => (vars && name in vars ? vars[name] : m)),
  }),
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

// A day key, built the way the COMPONENT builds it.
//
// This file used to say `new Date().toISOString().slice(0, 10)`, and that is a
// different day from the one the component is showing for the last hours of
// every day. `toISOString()` is UTC; the component keys days with date-fns
// `format(d, 'yyyy-MM-dd')`, which is LOCAL. Anywhere west of Greenwich the two
// disagree once local time passes midnight-minus-the-offset — 20:00 EDT, 19:00
// EST — so every plan these tests placed on "today" landed on TOMORROW, the
// open day rendered empty, and five tests failed.
//
// It presents as flakiness and is not: it failed every evening and passed every
// morning, on identical code. Anything comparing against what this component
// renders has to use local time, because that is what the component uses.
const isoDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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

// The grocery CTA's four tests lived here and went with the feature — it
// could only ever draw from a saved recipe, and production held one recipe
// with one ingredient across 63 profiles. What replaced them is the open day,
// which is what the surface now actually puts on screen.
describe('the open day — what the 89.7pt cell could never show', () => {
  const TODAY = isoDay(new Date());

  it("sums the day's calories rather than dropping them", async () => {
    PLANS = [
      plan(TODAY, 'lunch',  photoSnapshot('Grilled chicken with quinoa')),
      plan(TODAY, 'dinner', photoSnapshot('Mac and cheese with peas')),
    ];
    await mountLoaded();
    // Two 520-kcal snapshots. The grid rendered neither number — and the
    // total is grouped, because a bare "1040" is what the device pass caught.
    expect(document.body.textContent).toMatch(/1,040/);
  });

  it('REGRESSION: a slot holding TWO meals renders both', async () => {
    // The grid keyed cells `${date}-${mealType}` with last-write-wins, so the
    // first of these was written, counted, and invisible. That is the
    // 2026-08-11 defect — 6 of 8 production rows were unreachable this way.
    PLANS = [
      { ...plan(TODAY, 'dinner', photoSnapshot('Mac and cheese with peas')), id: 'd1' },
      { ...plan(TODAY, 'dinner', photoSnapshot('Steak and red potato')),     id: 'd2' },
    ];
    await mountLoaded();
    const text = document.body.textContent;
    expect(text).toMatch(/Mac and cheese with peas/);
    expect(text).toMatch(/Steak and red potato/);
  });

  it('a full name is rendered, not truncated to fit a column', async () => {
    // 52 characters — the real length of a production row's name.
    const long = 'Grilled panini sandwich with french fries and ketchup';
    PLANS = [plan(TODAY, 'snack', photoSnapshot(long))];
    await mountLoaded();
    expect(screen.getByText(long)).toBeTruthy();
  });

  it('a day with no macros behind it shows no calorie total', async () => {
    // A recipe-backed plan carries `recipe_id` and no snapshot, so there is
    // nothing to add up. Rendering "0" at someone who planned a meal is the
    // app calling them lazy — the rule CLAUDE.md states for empty sections.
    PLANS = [{ ...plan(TODAY, 'lunch', null), recipe_id: 'r1' }];
    await mountLoaded();
    expect(document.body.textContent).not.toMatch(/\b0 cal\b/);
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

describe('the slot cap — a refusal that offers a way through', () => {
  const TODAY = isoDay(new Date());
  const fullDinner = () => ([
    { ...plan(TODAY, 'dinner', photoSnapshot('Mac and cheese with peas')),  id: 'd1' },
    { ...plan(TODAY, 'dinner', photoSnapshot('Grilled panini sandwich')),   id: 'd2' },
    { ...plan(TODAY, 'dinner', photoSnapshot('Steak and red potato')),      id: 'd3' },
  ]);

  it('a full slot offers no Add — it says which rule was hit', async () => {
    PLANS = fullDinner();
    await mountLoaded();
    expect(document.body.textContent).toMatch(/Dinner is full, 3 of 3/);
  });

  it('tapping it opens the sheet, with both ways forward', async () => {
    PLANS = fullDinner();
    await mountLoaded();
    fireEvent.click(screen.getByRole('button', { name: /Dinner is full/i }));

    // Names the rule and the reason, rather than only refusing.
    expect(await screen.findByText(/3 meals is the most one slot holds/i)).toBeTruthy();
    // Way out 1: replace one — every meal in the slot is offered.
    expect(screen.getByText(/Replace one of them/i)).toBeTruthy();
    // Twice on screen now: once in the day, once offered for replacement.
    expect(screen.getAllByText('Steak and red potato')).toHaveLength(2);
    // Way out 2: the diary, which genuinely has no cap.
    expect(screen.getByText(/Log it to today's diary instead/i)).toBeTruthy();
  });

  it("does not offer today's diary for a day that is not today", async () => {
    // The cap is on the PLAN, not on what someone may eat — but there is no
    // "today's diary" to divert a future Thursday's dinner into.
    // Must be in the VISIBLE week — the grid loads Mon–Sun, so "today + 3"
    // can fall outside it and render no chip at all. Monday, unless today is
    // Monday, in which case Tuesday.
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    if (isoDay(monday) === TODAY) monday.setDate(monday.getDate() + 1);
    const future = isoDay(monday);
    PLANS = fullDinner().map((p, i) => ({ ...p, plan_date: future, id: `f${i}` }));
    await mountLoaded();
    // Open that day first, then the sheet.
    const dayNum = String(Number(future.slice(8, 10)));
    // Match the WHOLE trailing number. `endsWith('1')` also matches a chip
    // ending in 11, 21 or 31, and on a Monday the 31st (today) is the chip
    // found first, so the test opened today and failed on Aug 31.
    fireEvent.click(screen.getAllByRole('button').find(b => b.textContent.match(/\d+$/)?.[0] === dayNum));
    fireEvent.click(await screen.findByRole('button', { name: /Dinner is full/i }));

    expect(screen.getByText(/Replace one of them/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Log it to today's diary/i);
  });
});
