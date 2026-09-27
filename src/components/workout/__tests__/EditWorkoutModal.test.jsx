// EditWorkoutModal: three defects from the 2026-09-27 audit.
//  1. A saved log's sets carry no _key, so the first edit re-keyed every
//     row and the input being typed in remounted after one digit.
//  2. A failed save left the modal stuck on "Saving…" with no message.
//  3. onClick={handleSave} passed the click event as forceSkipChecks, so
//     the realistic-weight checks never ran on an edit.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (k, en) => en,
    language: 'en',
  }),
}));
vi.mock('@/lib/WeightUnitContext', () => ({
  useWeightUnit: () => ({ weightUnit: 'lbs' }),
}));
vi.mock('@/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() },
}));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

import EditWorkoutModal from '../EditWorkoutModal';
import { toast } from '@/lib/toast';

const LOG = {
  id: 'log-1',
  date: '2026-09-20',
  exercises: [{ name: 'Barbell Curl', sets: [{ weight: 50, reps: 8 }, { weight: 50, reps: 8 }] }],
};

const renderModal = (props = {}) => render(
  <EditWorkoutModal
    log={LOG}
    userProfile={{}}
    logs={[]}
    cardioLogs={[]}
    open
    onClose={vi.fn()}
    onSave={vi.fn().mockResolvedValue(undefined)}
    onDelete={vi.fn().mockResolvedValue(undefined)}
    {...props}
  />
);

const repsInputs = () => screen.getAllByPlaceholderText('common.reps');

describe('EditWorkoutModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the same reps input mounted across keystrokes', () => {
    renderModal();
    const first = repsInputs()[0];
    fireEvent.change(first, { target: { value: '1' } });
    // Same DOM node after the first edit: no remount, so focus survives.
    expect(repsInputs()[0]).toBe(first);
    fireEvent.change(first, { target: { value: '12' } });
    expect(repsInputs()[0]).toBe(first);
    expect(first.value).toBe('12');
  });

  it('shows an error and re-enables Save when the save fails', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('offline'));
    const onClose = vi.fn();
    renderModal({ onSave, onClose });
    const save = screen.getByRole('button', { name: 'Save changes' });
    fireEvent.click(save);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save changes' })).not.toBeDisabled();
  });

  it('runs the realistic-weight check when Save is clicked', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderModal({
      onSave,
      log: { ...LOG, exercises: [{ name: 'Barbell Curl', sets: [{ weight: 5000, reps: 8 }] }] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Go back and fix');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('never writes the client-only set keys', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderModal({ onSave });
    fireEvent.change(repsInputs()[0], { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const sets = onSave.mock.calls[0][1].exercises[0].sets;
    expect(sets[0]).toEqual({ weight: 50, reps: 10 });
    expect(sets.every(s => !('_key' in s))).toBe(true);
  });
});
