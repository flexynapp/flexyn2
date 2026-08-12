// BarcodeNotFoundModal — the only way to add a food to the shared catalogue.
//
// What this file exists to stop coming back: **copy that promises something
// the code no longer does.** Until 2026-08-12 the sheet read "we'll save it
// for everyone" over a button reading "Save for Everyone", while the code
// underneath filed a row in `food_item_requests` for a human to review — the
// behaviour migration 343 introduced, with the two toasts updated and thirty
// hardcoded English literals left behind. The toast said "Sent for review"
// and the button said the opposite, on the same tap.
//
// The assertions below are deliberately about WORDS. A test that only checked
// `requestFoodItem` was called would have passed throughout the period the
// button was lying.
//
// This sheet has never run in production: `food_item_requests` is 0 rows, and
// it needs a real barcode miss on a real scan to open. That is a statement
// about usage, not about correctness — everything here is unconditionally
// true on every render.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ t: (k) => k, tFallback: (_k, english) => english }),
}));
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', email: 'mine@flexyn.test' } }),
}));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));
vi.mock('@/hooks/useKeyboardInset', () => ({ useKeyboardInset: () => 0 }));

const requestFoodItem = vi.fn();
vi.mock('@/lib/data/foodItemRequests', () => ({
  requestFoodItem: (...args) => requestFoodItem(...args),
}));

const toastCalls = [];
vi.mock('@/lib/toast', () => ({
  toast: {
    success: (m) => toastCalls.push(['success', m]),
    error: (m) => toastCalls.push(['error', m]),
  },
}));

import BarcodeNotFoundModal from '../BarcodeNotFoundModal';

const show = (props = {}) =>
  render(
    <BarcodeNotFoundModal barcode="099482412345" onCancel={() => {}} onSubmit={() => {}} {...props} />,
  );

beforeEach(() => {
  requestFoodItem.mockReset();
  requestFoodItem.mockResolvedValue({ ok: true, alreadyQueued: false });
  toastCalls.length = 0;
});

describe('BarcodeNotFoundModal — the sheet says what the code does', () => {
  it('asks for a review and never promises to publish', () => {
    show();
    expect(screen.getByText('Send for review')).toBeTruthy();
    expect(screen.getByText(/send it for review/i)).toBeTruthy();
    // The two claims the old copy made, both now absent. Neither was true.
    expect(document.body.textContent).not.toMatch(/save it for everyone/i);
    expect(document.body.textContent).not.toMatch(/Save for Everyone/);
  });

  it('tells the user their own diary is not blocked on the review', () => {
    show();
    // This half matters as much as the first: without it, "sent for review"
    // reads as a refusal to log the food they are standing in front of.
    expect(screen.getByText(/log it for yourself right away/i)).toBeTruthy();
  });

  it('says a blank field is unknown rather than zero', () => {
    show();
    // The form writes `parseFloat('')` → null on purpose. Until the
    // foodLookup fix the read path turned that back into a hard 0 for every
    // scanner; this line is the half of the contract the user can see.
    expect(screen.getByText(/kept as unknown, not as zero/i)).toBeTruthy();
  });

  it('renders no hardcoded English label — every nutrient goes through a key', () => {
    show();
    // The eight macro fields resolve through `nutrition.macros.*`, which
    // already ships in 15 languages. If someone re-hardcodes one, the literal
    // shows up here instead of the key.
    for (const key of ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol']) {
      expect(screen.getByText(new RegExp(`^nutrition\\.macros\\.${key}`))).toBeTruthy();
    }
    expect(document.body.textContent).not.toContain('Carbohydrates');
    expect(document.body.textContent).not.toContain('Total Fat');
  });

  it('reaches the vitamin fields through keys too', async () => {
    show();
    await userEvent.click(screen.getByText('Vitamins & minerals'));
    await waitFor(() => expect(screen.getByText('nutrition.minerals.calcium')).toBeTruthy());
    for (const key of ['nutrition.minerals.iron', 'nutrition.vitamins.a', 'nutrition.vitamins.b12']) {
      expect(screen.getByText(key)).toBeTruthy();
    }
    expect(document.body.textContent).not.toContain('Vitamin B12');
  });
});

describe('BarcodeNotFoundModal — what it files', () => {
  it('files a request carrying the barcode, the name and the caller', async () => {
    const onSubmit = vi.fn();
    show({ onSubmit });

    await userEvent.type(screen.getByPlaceholderText(/Organic Almond Butter/), 'Test Butter');
    const calorieInput = screen.getByText(/^nutrition\.macros\.calories/)
      .closest('div').querySelector('input');
    await userEvent.type(calorieInput, '210');
    await userEvent.click(screen.getByText('Send for review'));

    await waitFor(() => expect(requestFoodItem).toHaveBeenCalledTimes(1));
    const [payload] = requestFoodItem.mock.calls[0];
    expect(payload.barcode).toBe('099482412345');
    expect(payload.name).toBe('Test Butter');
    expect(payload.nutrition.calories).toBe(210);
    // Blanks are null, NOT 0 — this is the write half of the read fix.
    expect(payload.nutrition.protein).toBeNull();
    expect(payload.nutrition.fiber).toBeNull();
    // `requester_user_id = auth.uid()` is the INSERT policy, so the user must
    // be passed through or RLS rejects the write.
    expect(payload.user.id).toBe('u-1');

    // And the product handed back is loggable immediately.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].nutrition.calories).toBe(210);
  });

  it('confirms the review rather than a save', async () => {
    show();
    await userEvent.type(screen.getByPlaceholderText(/Organic Almond Butter/), 'Test Butter');
    const calorieInput = screen.getByText(/^nutrition\.macros\.calories/)
      .closest('div').querySelector('input');
    await userEvent.type(calorieInput, '210');
    await userEvent.click(screen.getByText('Send for review'));

    await waitFor(() => expect(toastCalls.length).toBeGreaterThan(0));
    const [level, message] = toastCalls[toastCalls.length - 1];
    expect(level).toBe('success');
    expect(message).toMatch(/Sent for review/i);
    expect(message).not.toMatch(/saved for everyone/i);
  });

  it('treats an already-queued barcode as a success, not an error', async () => {
    requestFoodItem.mockResolvedValue({ ok: true, alreadyQueued: true });
    show();
    await userEvent.type(screen.getByPlaceholderText(/Organic Almond Butter/), 'Test Butter');
    const calorieInput = screen.getByText(/^nutrition\.macros\.calories/)
      .closest('div').querySelector('input');
    await userEvent.type(calorieInput, '210');
    await userEvent.click(screen.getByText('Send for review'));

    await waitFor(() => expect(toastCalls.length).toBeGreaterThan(0));
    expect(toastCalls[toastCalls.length - 1][0]).toBe('success');
    expect(toastCalls[toastCalls.length - 1][1]).toMatch(/already asked/i);
  });

  it('refuses a nameless or calorie-less submission with a translated message', async () => {
    show();
    await userEvent.click(screen.getByText('Send for review'));
    await waitFor(() => expect(toastCalls[0]).toEqual(['error', 'Enter the food name.']));
    expect(requestFoodItem).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText(/Organic Almond Butter/), 'Test Butter');
    await userEvent.click(screen.getByText('Send for review'));
    await waitFor(() =>
      expect(toastCalls[toastCalls.length - 1]).toEqual(['error', 'Calories are required.']));
    expect(requestFoodItem).not.toHaveBeenCalled();
  });
});
