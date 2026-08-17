/**
 * LogWeightModal — the ONLY client-side writer of a `body_metrics` row.
 *
 * It had no test file until this one, which is the gap the Projected-Goal
 * audit (docs/progress-insights-goal-audit.md) closed its write-up naming:
 * everything downstream of this modal was covered, and the write itself was
 * not. Body-measurement logging was removed from the Body tab per product
 * direction, so every row the projection reads comes from here or from
 * onboarding's one-shot weight seed.
 *
 * The two properties worth pinning:
 *
 *   • **The dual write and its ORDER.** A save touches `user_profiles`
 *     (the global weight XP and leaderboards read) and `body_metrics` (the
 *     history the chart reads). The profile mirror goes FIRST on purpose —
 *     it is an idempotent UPDATE, while the row INSERT has no unique
 *     constraint behind it, so a failure after the INSERT would let a retry
 *     create a second row for the same date. Reversing these is a silent
 *     duplicate-row bug, which is why the order is asserted and not just
 *     the fact that both ran.
 *
 *   • **All three weight units, not two.** `VALID` in WeightUnitContext is
 *     `['lbs', 'kg', 'stone']` and every unit-aware branch in this file has
 *     to cover the third. The native `max` and the placeholder branched on
 *     kg alone and dropped `stone` into the lbs arm — the bug these tests
 *     were written against.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Order of the two writes is the thing under test, so both land in one log.
const calls = [];
const updateMe = vi.fn(() => { calls.push('updateMe'); return Promise.resolve({}); });
const createMetric = vi.fn((payload) => { calls.push('create'); return Promise.resolve(payload); });

vi.mock('@/api/db', () => ({
  db: {
    auth: { updateMe: (...a) => updateMe(...a) },
    entities: { BodyMetric: { create: (...a) => createMetric(...a) } },
  },
}));

const successToast = vi.fn();
const errorToast = vi.fn();
vi.mock('@/lib/toast', () => ({
  toast: { success: (...a) => successToast(...a), error: (...a) => errorToast(...a) },
}));

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { email: 'a@b.c', id: 'u-1' } }) }));

// The house stub: the fallback IS the English string. None of the copy
// asserted here carries a placeholder, so this is the right shape.
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, en, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), en) : en,
  }),
}));

let unit = 'lbs';
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: unit }) }));
vi.mock('@/components/UnitPill', () => ({ default: () => null }));

const recordAction = vi.fn(() => Promise.resolve());
vi.mock('@/lib/data/quests', () => ({ recordAction: (...a) => recordAction(...a) }));

vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

import LogWeightModal from '@/components/dashboard/LogWeightModal';

const show = (props = {}) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <LogWeightModal open onOpenChange={() => {}} profile={{ weight_lbs: 180 }} {...props} />
  </QueryClientProvider>,
);

const weightBox = () => screen.getByRole('spinbutton');
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Log weight' }));

beforeEach(() => {
  unit = 'lbs';
  calls.length = 0;
  [updateMe, createMetric, successToast, errorToast, recordAction].forEach(m => m.mockClear());
});
afterEach(cleanup);

describe('the dual write', () => {
  it('mirrors the profile BEFORE inserting the history row', async () => {
    show();
    fireEvent.change(weightBox(), { target: { value: '182' } });
    save();

    await waitFor(() => expect(createMetric).toHaveBeenCalled());
    // Not just "both ran" — the order is the compensation strategy. A
    // reversal lets a failed profile write leave a committed row behind,
    // and the retry duplicates it.
    expect(calls).toEqual(['updateMe', 'create']);
    expect(updateMe).toHaveBeenCalledWith({ weight_lbs: 182 });
    expect(createMetric).toHaveBeenCalledWith(
      expect.objectContaining({ weight_lbs: 182 }),
    );
  });

  it('writes no history row when the profile mirror fails', async () => {
    updateMe.mockImplementationOnce(() => Promise.reject(new Error('network')));
    show();
    fireEvent.change(weightBox(), { target: { value: '182' } });
    save();

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('Could not save. Try again.'));
    // The point of the ordering: nothing was committed, so a retry cannot
    // produce two rows for one date.
    expect(createMetric).not.toHaveBeenCalled();
  });

  it('stamps the row with a date key, not a localised date string', async () => {
    show();
    fireEvent.change(weightBox(), { target: { value: '182' } });
    save();

    await waitFor(() => expect(createMetric).toHaveBeenCalled());
    // `date` is a key the DB and every reader parse with parseLocalDate.
    // A locale-formatted value here would be unparseable rather than merely
    // ugly, which is why this column keeps date-fns `format` per CLAUDE.md.
    expect(createMetric.mock.calls[0][0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('units — all three of them', () => {
  it('converts kg to the stored lbs', async () => {
    unit = 'kg';
    show({ profile: {} });
    fireEvent.change(weightBox(), { target: { value: '80' } });
    save();

    await waitFor(() => expect(updateMe).toHaveBeenCalled());
    expect(updateMe.mock.calls[0][0].weight_lbs).toBeCloseTo(176.37, 1);
  });

  it('converts stone to the stored lbs', async () => {
    unit = 'stone';
    show({ profile: {} });
    fireEvent.change(weightBox(), { target: { value: '12' } });
    save();

    await waitFor(() => expect(updateMe).toHaveBeenCalled());
    expect(updateMe.mock.calls[0][0].weight_lbs).toBe(168);
  });

  it('bounds the native input to the guard, in the displayed unit', () => {
    // 700 lb is the JS ceiling. The native `max` has to be the SAME weight,
    // converted — not the same number. It branched on kg alone, so stone
    // inherited the lbs arm's 700 (= 9,800 lb) and the browser accepted
    // values the app then rejected as "looks off".
    unit = 'lbs';   show({ profile: {} });
    expect(weightBox()).toHaveAttribute('max', '700');
    cleanup();

    unit = 'kg';    show({ profile: {} });
    expect(weightBox()).toHaveAttribute('max', '317');
    cleanup();

    unit = 'stone'; show({ profile: {} });
    expect(weightBox()).toHaveAttribute('max', '50');
  });

  it('offers a placeholder in the unit on screen', () => {
    // 154 lb in each unit. The stone arm used to read "154.0", i.e. a
    // suggestion of 2,156 lb to anyone weighing themselves in stone.
    unit = 'lbs';   show({ profile: {} });
    expect(weightBox()).toHaveAttribute('placeholder', '154.0');
    cleanup();

    unit = 'kg';    show({ profile: {} });
    expect(weightBox()).toHaveAttribute('placeholder', '69.9');
    cleanup();

    unit = 'stone'; show({ profile: {} });
    expect(weightBox()).toHaveAttribute('placeholder', '11.0');
  });

  it('prefills from the profile in the displayed unit', () => {
    unit = 'stone';
    show({ profile: { weight_lbs: 168 } });
    expect(weightBox()).toHaveValue(12);
  });
});

describe('the range guard', () => {
  it('rejects a weight under the floor without writing anything', async () => {
    show({ profile: {} });
    fireEvent.change(weightBox(), { target: { value: '60' } });
    save();

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('That value looks off, double-check it.'));
    expect(updateMe).not.toHaveBeenCalled();
    expect(createMetric).not.toHaveBeenCalled();
  });

  it('stops an over-ceiling stone entry at the native bound, before the JS guard', async () => {
    // 60 stone is 840 lb — over the ceiling — while the bare number 60 is
    // comfortably inside it, which is why the bound has to be converted.
    //
    // Note WHERE this is caught. With `max` fixed to 50, the form is
    // constraint-invalid and the submit never fires, so no toast appears
    // and nothing is written — the "native validation before submitting"
    // the input's comment promises. Before the fix `max` was 700, the form
    // submitted, and the JS guard caught it one step later with a "looks
    // off" toast. Asserting on the toast would therefore have passed
    // against the BUG and failed against the fix; assert on the write.
    unit = 'stone';
    show({ profile: {} });
    fireEvent.change(weightBox(), { target: { value: '60' } });
    save();

    await new Promise(r => setTimeout(r, 50));
    expect(updateMe).not.toHaveBeenCalled();
    expect(createMetric).not.toHaveBeenCalled();
  });

  it('applies the guard in lbs for a value the native bound lets through', async () => {
    // 4 stone (56 lb) is under the 70 lb floor but inside the 0–50 stone
    // native range, so this is the path where the JS guard is the only
    // thing standing between a converted value and the database.
    unit = 'stone';
    show({ profile: {} });
    fireEvent.change(weightBox(), { target: { value: '4' } });
    save();

    await waitFor(() => expect(errorToast).toHaveBeenCalledWith('That value looks off, double-check it.'));
    expect(updateMe).not.toHaveBeenCalled();
  });

  it('accepts a weight at the boundary', async () => {
    show({ profile: {} });
    fireEvent.change(weightBox(), { target: { value: '700' } });
    save();

    await waitFor(() => expect(createMetric).toHaveBeenCalled());
    expect(errorToast).not.toHaveBeenCalled();
  });
});

describe('after a successful save', () => {
  it('credits the daily quest and confirms to the user', async () => {
    show();
    fireEvent.change(weightBox(), { target: { value: '182' } });
    save();

    await waitFor(() => expect(successToast).toHaveBeenCalledWith('Weight saved'));
    expect(recordAction).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'a@b.c' }), 'body_metric_logged', 1,
    );
  });
});
