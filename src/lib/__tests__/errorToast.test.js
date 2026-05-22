// Tests for src/lib/errorToast.js — the sonner-backed error toast
// helper with an optional Retry action.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const errSpy = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args) => errSpy(...args),
  },
}));

describe('errorToast', () => {
  beforeEach(() => {
    errSpy.mockClear();
  });

  it('fires toast.error with title and no action when no retry', async () => {
    const { errorToast } = await import('../errorToast');
    errorToast({ title: 'Something broke', description: 'try later' });
    expect(errSpy).toHaveBeenCalledTimes(1);
    const [title, opts] = errSpy.mock.calls[0];
    expect(title).toBe('Something broke');
    expect(opts.description).toBe('try later');
    expect(opts.action).toBeUndefined();
  });

  it('omits description when not provided', async () => {
    const { errorToast } = await import('../errorToast');
    errorToast({ title: 'Hi' });
    const [, opts] = errSpy.mock.calls[0];
    expect(opts.description).toBeUndefined();
  });

  it('attaches a Retry action when retry is provided', async () => {
    const { errorToast } = await import('../errorToast');
    const retry = vi.fn();
    errorToast({ title: 'Failed to save', retry });
    const [, opts] = errSpy.mock.calls[0];
    expect(opts.action).toBeTruthy();
    expect(opts.action.label).toBe('Retry');
    opts.action.onClick();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('honours a custom retry label', async () => {
    const { errorToast } = await import('../errorToast');
    errorToast({ title: 'oops', retry: () => {}, retryLabel: 'Try again' });
    const [, opts] = errSpy.mock.calls[0];
    expect(opts.action.label).toBe('Try again');
  });

  it('does not throw when the retry callback itself throws', async () => {
    const { errorToast } = await import('../errorToast');
    errorToast({ title: 'fail', retry: () => { throw new Error('boom'); } });
    const [, opts] = errSpy.mock.calls[0];
    expect(() => opts.action.onClick()).not.toThrow();
  });
});
