import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the store behind the feedback pill so we can observe what the policy
// wrapper forwards. (sonner was replaced by FeedbackPill on 2026-09-27; the
// wrapper's contract is unchanged.)
vi.mock('@/lib/feedbackStore', () => ({ show: vi.fn(), dismiss: vi.fn() }));

import { show } from '@/lib/feedbackStore';
import { toast } from '../toast';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toast policy wrapper', () => {
  it('forwards errors to the pill (failures never go silent)', () => {
    toast.error('Something broke', { description: 'x' });
    expect(show).toHaveBeenCalledWith('error', 'Something broke', { description: 'x' });
  });

  // Reversed on 2026-08-04. Success is the confirmation class: under the
  // old policy 271 of 283 non-error call sites carried no `action` and so
  // rendered nothing, which made a successful save pixel-identical to a
  // dead button. If the "subtle press/completion cues" ever ship and
  // success goes back behind keepIfAction, flip this test with it.
  it('forwards success toasts even without an action', () => {
    toast.success('Saved!');
    expect(show).toHaveBeenCalledWith('success', 'Saved!');
  });

  it('forwards a success toast that carries an action', () => {
    const action = { label: 'Undo', onClick: () => {} };
    toast.success('Saved!', { action });
    expect(show).toHaveBeenCalledWith('success', 'Saved!', { action });
  });

  // Reversed on 2026-08-05, for the same reason success was reversed the day
  // before — and this is the half that first pass missed. A paren-balanced
  // scan of every remaining call site found 28 of 28 info/message/warning
  // calls carrying no `action`, so the gate was not filtering this class, it
  // was deleting it. Among the deleted: SetRow's "Capped at 315 lb" (the app
  // silently overwriting a weight the user typed), the cardio tracker's
  // "Auto-paused" mid-run, and Onboarding's "Some profile details could not
  // be saved".
  //
  // If these go back behind keepIfAction, flip this test with them — and
  // re-run the audit in toastPolicy.test.js first.
  it('forwards info / message / warning even without an action', () => {
    toast.info('fyi');
    toast.message('hey');
    toast.warning('careful');
    expect(show).toHaveBeenCalledWith('info', 'fyi');
    expect(show).toHaveBeenCalledWith('message', 'hey');
    expect(show).toHaveBeenCalledWith('warning', 'careful');
  });

  it('silences a plain toast() call', () => {
    toast('just a note');
    expect(show).not.toHaveBeenCalled();
  });

  it('keeps a plain toast() that carries an action (Undo / Retry)', () => {
    const action = { label: 'Undo', onClick: () => {} };
    toast('Deleted', { action });
    expect(show).toHaveBeenCalledWith('default', 'Deleted', { action });
  });

  it('keeps a method toast that carries an action', () => {
    const action = { label: 'Retry', onClick: () => {} };
    toast.message('Upload failed', { action });
    expect(show).toHaveBeenCalledWith('message', 'Upload failed', { action });
  });
});
