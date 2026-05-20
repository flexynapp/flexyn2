import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @sentry/react before importing the module under test
const setLevel  = vi.fn();
const setTag    = vi.fn();
const setUser   = vi.fn();
const setExtras = vi.fn();
const setExtra  = vi.fn();
const captureException = vi.fn();
const withScope = vi.fn((cb) => cb({ setLevel, setTag, setUser, setExtras, setExtra }));

vi.mock('@sentry/react', () => ({
  withScope: (cb) => withScope(cb),
  captureException: (...args) => captureException(...args),
}));

import { reportError } from '../reportError';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('reportError', () => {
  it('logs to console.error always', () => {
    const err = new Error('boom');
    reportError(err, { feature: 'test.sample' });
    expect(console.error).toHaveBeenCalled();
    const args = console.error.mock.calls[console.error.mock.calls.length - 1];
    expect(args[0]).toContain('[reportError]');
    expect(args[0]).toContain('test.sample');
    expect(args[1]).toBe(err);
  });

  it('tags Sentry scope with feature + user + level', () => {
    reportError(new Error('boom'), {
      feature: 'workout.save',
      userEmail: 'a@b.com',
      level: 'warning',
    });
    expect(setLevel).toHaveBeenCalledWith('warning');
    expect(setTag).toHaveBeenCalledWith('feature', 'workout.save');
    expect(setUser).toHaveBeenCalledWith({ email: 'a@b.com' });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('passes remaining context fields as Sentry extras', () => {
    reportError(new Error('boom'), {
      feature: 'workout.save',
      userEmail: 'a@b.com',
      workoutId: 'abc-123',
      regimenName: 'Push Day',
    });
    expect(setExtras).toHaveBeenCalledWith({
      workoutId: 'abc-123',
      regimenName: 'Push Day',
    });
  });

  it('defaults severity to "error" when level is not specified', () => {
    reportError(new Error('boom'), { feature: 'x' });
    expect(setLevel).toHaveBeenCalledWith('error');
  });

  it('extracts Postgres / PostgREST fields into a "postgrest" extra', () => {
    const pgErr = {
      code: '23505',
      message: 'duplicate key value',
      details: 'Key (username)=(foo) already exists.',
      hint: 'Try a different username.',
    };
    reportError(pgErr, { feature: 'onboarding.save' });
    const pgExtraCall = setExtra.mock.calls.find(([k]) => k === 'postgrest');
    expect(pgExtraCall).toBeDefined();
    expect(pgExtraCall[1]).toMatchObject({
      code: '23505',
      details: 'Key (username)=(foo) already exists.',
      hint: 'Try a different username.',
    });
  });

  it('does not set the "postgrest" extra when no Postgres fields exist', () => {
    reportError(new Error('plain js error'), { feature: 'x' });
    const pgExtraCall = setExtra.mock.calls.find(([k]) => k === 'postgrest');
    expect(pgExtraCall).toBeUndefined();
  });

  it('does not throw when Sentry capture itself throws', () => {
    captureException.mockImplementationOnce(() => { throw new Error('sentry-down'); });
    // Should not propagate the Sentry error to the caller
    expect(() => reportError(new Error('boom'), { feature: 'x' })).not.toThrow();
  });

  it('handles a non-Error thrown value safely', () => {
    expect(() => reportError('a string', { feature: 'x' })).not.toThrow();
    expect(captureException).toHaveBeenCalledWith('a string');
  });
});
