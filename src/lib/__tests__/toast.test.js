import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the real sonner so we can observe what the policy wrapper forwards.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    message: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { toast as sonnerToast } from 'sonner';
import { toast } from '../toast';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('toast policy wrapper', () => {
  it('forwards errors to sonner (failures never go silent)', () => {
    toast.error('Something broke', { description: 'x' });
    expect(sonnerToast.error).toHaveBeenCalledWith('Something broke', { description: 'x' });
  });

  it('silences success toasts', () => {
    toast.success('Saved!');
    expect(sonnerToast.success).not.toHaveBeenCalled();
  });

  it('silences info / message / warning toasts', () => {
    toast.info('fyi');
    toast.message('hey');
    toast.warning('careful');
    expect(sonnerToast.info).not.toHaveBeenCalled();
    expect(sonnerToast.message).not.toHaveBeenCalled();
    expect(sonnerToast.warning).not.toHaveBeenCalled();
  });

  it('silences a plain toast() call', () => {
    toast('just a note');
    expect(sonnerToast).not.toHaveBeenCalled();
  });

  it('keeps a plain toast() that carries an action (Undo / Retry)', () => {
    const action = { label: 'Undo', onClick: () => {} };
    toast('Deleted', { action });
    expect(sonnerToast).toHaveBeenCalledWith('Deleted', { action });
  });

  it('keeps a method toast that carries an action', () => {
    const action = { label: 'Retry', onClick: () => {} };
    toast.message('Upload failed', { action });
    expect(sonnerToast.message).toHaveBeenCalledWith('Upload failed', { action });
  });
});
