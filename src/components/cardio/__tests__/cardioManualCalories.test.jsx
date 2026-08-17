/**
 * CardioManualForm — what lands in `cardio_logs.calories`.
 *
 * THE DEFECT THESE WERE WRITTEN AGAINST (docs/progress-stats-audit.md).
 * The calories field is optional and its estimator sat behind a
 * "Estimate" button nobody has to press. On save the value went through
 * `Number(calories) || 0`, so leaving the field alone stored a hard **0**
 * — not NULL, not absent, but a positive claim that the session burned
 * nothing. Both live trackers (Indoor / Outside) already call
 * `estimateCalories` and store the result unasked, so the manual form was
 * the single entry path in the app that wrote a zero.
 *
 * It is not cosmetic: `generate_weekly_review_for` sums this column into
 * the week's cardio kcal, and 2 of the 5 rows in production carry the
 * zero — both manual entries with real distance and duration behind them.
 *
 * The first test reproduces one of those rows EXACTLY: Kegan's
 * 2026-08-09 treadmill session, 900 s over 3218.688 m (2.00 mi), which
 * stored `calories = 0` against a MET-derived 224.
 *
 * The 0-vs-blank distinction is the load-bearing part of the fix and is
 * pinned by two separate tests — a TYPED zero is still a zero, because
 * that is a number the user chose, and only an untouched field estimates.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const createLog = vi.fn((payload) => Promise.resolve({ ...payload, id: 'c-1' }));
const updateLog = vi.fn((_id, payload) => Promise.resolve(payload));

vi.mock('@/api/db', () => ({
  db: {
    auth: { me: () => Promise.resolve({}), updateMe: () => Promise.resolve({}) },
    functions: { invoke: () => Promise.resolve({}) },
    entities: {
      CardioLog: {
        create: (...a) => createLog(...a),
        update: (...a) => updateLog(...a),
        filter: () => Promise.resolve([]),
      },
      WorkoutLog: { filter: () => Promise.resolve([]) },
    },
  },
}));

vi.mock('@/api/supabaseClient', () => ({
  supabase: { rpc: () => Promise.resolve({ error: null }), from: () => ({ insert: () => Promise.resolve({}) }) },
}));

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

// The house stub: the fallback IS the English string. Nothing asserted
// here carries a placeholder, so this shape is correct.
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, en, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), en) : en,
  }),
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { email: 'a@b.c', id: 'u-1' } }),
}));

// Miles, so the 2.00 typed into the box round-trips to exactly the
// 3218.688 m the production row carries.
vi.mock('@/lib/DistanceUnitContext', () => ({
  useDistanceUnit: () => ({ distanceUnit: 'mi' }),
}));

vi.mock('@/lib/data/quests', () => ({ recordActions: () => Promise.resolve(), recordAction: () => Promise.resolve() }));
vi.mock('@/lib/data/leagues', () => ({ addWeeklyXp: () => Promise.resolve() }));
vi.mock('@/lib/data/workoutStreak', () => ({ bumpWorkoutStreak: () => Promise.resolve({}) }));
vi.mock('@/lib/data/soloChallenges', () => ({ recordWorkoutProgress: () => Promise.resolve() }));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));

import CardioManualForm from '@/components/cardio/CardioManualForm';

// The production row, as template defaults: 15 minutes, 2.00 miles,
// treadmill. metersTo('mi', 3218.688) is exactly 2.00, and toMeters
// takes it straight back, so no rounding enters the assertion.
const PROD_ROW = { duration_seconds: 900, distance_meters: 3218.688 };

const show = (props = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <CardioManualForm
      mode="running"
      env="treadmill"
      onCancel={() => {}}
      onSaved={() => {}}
      userProfile={{}}
      templateDefaults={PROD_ROW}
      {...props}
    />
  </QueryClientProvider>,
);

const save = () => fireEvent.click(screen.getByRole('button', { name: /cardio\.save/ }));
// Scoped to its own label — the incline field also carries placeholder "0",
// so a bare getByPlaceholderText matches two inputs.
const caloriesBox = () =>
  screen.getByText('cardio.field.calories').parentElement.querySelector('input');

const savedPayload = async () => {
  await waitFor(() => expect(createLog).toHaveBeenCalled());
  return createLog.mock.calls[0][0];
};

beforeEach(() => { createLog.mockClear(); updateLog.mockClear(); });
afterEach(cleanup);

describe('cardio_logs.calories — the manual entry path', () => {
  // 12.87 km/h over 0.25 h → MET 12.8; 70 kg is userWeightKg's fallback
  // for a profile with no weight. 12.8 × 70 × 0.25 = 224.
  it('estimates when the field is left blank, instead of storing 0', async () => {
    show();
    save();
    const payload = await savedPayload();
    expect(payload.calories).toBe(224);
  });

  it('the estimate it stores is the same one the Estimate button produces', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /cardio\.field\.estimate/ }));
    // The button writes its result into the field; saving must not change it.
    expect(caloriesBox()).toHaveValue(224);
    save();
    expect((await savedPayload()).calories).toBe(224);
  });

  it('honours a typed value rather than overriding it with the estimate', async () => {
    show();
    fireEvent.change(caloriesBox(), { target: { value: '310' } });
    save();
    expect((await savedPayload()).calories).toBe(310);
  });

  // The carve-out that makes the fix safe: a typed 0 is a number the user
  // chose. Only an UNTOUCHED field estimates, so this must not become 224.
  it('a typed 0 stays 0', async () => {
    show();
    fireEvent.change(caloriesBox(), { target: { value: '0' } });
    save();
    expect((await savedPayload()).calories).toBe(0);
  });

  // getMaxRealisticCalories(900, {}) is round(18 × 70 × 0.25) = 315, so
  // the ceiling still binds on the estimated path as well as the typed one.
  it('the realistic-maximum cap still applies to an estimated value', async () => {
    show({ userProfile: { weight_lbs: 1 } });
    save();
    const payload = await savedPayload();
    // Cap is derived from userProfile (1 lb → 0.4536 kg → 2 cal); the
    // estimate is derived from the auth user (no weight → 70 kg → 224).
    // The cap must win.
    expect(payload.calories).toBe(2);
  });
});
