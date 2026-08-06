// db.auth.signInWithMagicLink sends in two phases so the UI can tell an
// existing account from a brand-new one.
//
// The single-phase version (`shouldCreateUser: true`) was silently both a
// sign-up and a sign-in, so entering the address you already have an account
// with produced the same "check your inbox" as a fresh signup — no way for
// the screen to say "you already have an account". These tests pin the phase
// sequence and, importantly, that exactly ONE email leaves on either path:
// the project's email rate limit is small enough that a probe which also
// sent would be a real regression.
//
// GoTrue's no-account answer was verified against the live project on
// 2026-08-05: 422, code 'otp_disabled', "Signups not allowed for otp".

import { describe, it, expect, vi, beforeEach } from 'vitest';

const signInWithOtp = vi.fn();

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args) => signInWithOtp(...args),
      onAuthStateChange: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
  },
}));
vi.mock('@/lib/pushCleanup', () => ({ unsubscribePushOnLogout: vi.fn() }));
vi.mock('@/lib/data/users', () => ({ selectProfiles: vi.fn() }));

const { db } = await import('../db');

/** GoTrue's "there is no account at this address". */
const noAccountError = () => ({
  name: 'AuthApiError',
  code: 'otp_disabled',
  status: 422,
  message: 'Signups not allowed for otp',
});

const phaseOptions = (call) => call[0].options;

describe('signInWithMagicLink', () => {
  beforeEach(() => signInWithOtp.mockReset());

  it('reports an existing account without a second send', async () => {
    signInWithOtp.mockResolvedValueOnce({ data: {}, error: null });

    const res = await db.auth.signInWithMagicLink('kegan@example.com', '/');

    expect(res).toEqual({ ok: true, isNewAccount: false });
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
    expect(phaseOptions(signInWithOtp.mock.calls[0]).shouldCreateUser).toBe(false);
  });

  it('creates the account when the probe says there is none', async () => {
    signInWithOtp
      .mockResolvedValueOnce({ data: {}, error: noAccountError() })
      .mockResolvedValueOnce({ data: {}, error: null });

    const res = await db.auth.signInWithMagicLink('new@example.com', '/');

    expect(res).toEqual({ ok: true, isNewAccount: true });
    expect(signInWithOtp).toHaveBeenCalledTimes(2);
    expect(phaseOptions(signInWithOtp.mock.calls[0]).shouldCreateUser).toBe(false);
    expect(phaseOptions(signInWithOtp.mock.calls[1]).shouldCreateUser).toBe(true);
  });

  it('recognises the no-account refusal by message when the code is absent', async () => {
    // Older GoTrue builds don't set `code`. Falling through to "real error"
    // there would refuse to sign anybody up at all.
    signInWithOtp
      .mockResolvedValueOnce({
        data: {},
        error: { status: 422, message: 'Signups not allowed for otp' },
      })
      .mockResolvedValueOnce({ data: {}, error: null });

    await expect(db.auth.signInWithMagicLink('new@example.com', '/'))
      .resolves.toEqual({ ok: true, isNewAccount: true });
  });

  it('surfaces a rate limit instead of treating it as a missing account', async () => {
    const rateLimited = {
      name: 'AuthApiError',
      code: 'over_email_send_rate_limit',
      status: 429,
      message: 'For security purposes, you can only request this after 51 seconds.',
    };
    signInWithOtp.mockResolvedValueOnce({ data: {}, error: rateLimited });

    await expect(db.auth.signInWithMagicLink('kegan@example.com', '/'))
      .rejects.toMatchObject({ code: 'over_email_send_rate_limit' });
    // Retrying against the limit would push the cooldown out further.
    expect(signInWithOtp).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failure from the creating phase', async () => {
    signInWithOtp
      .mockResolvedValueOnce({ data: {}, error: noAccountError() })
      .mockResolvedValueOnce({ data: {}, error: { message: 'Email signups are disabled' } });

    await expect(db.auth.signInWithMagicLink('new@example.com', '/'))
      .rejects.toMatchObject({ message: 'Email signups are disabled' });
  });

  it('normalises the address and carries the redirect into both phases', async () => {
    signInWithOtp
      .mockResolvedValueOnce({ data: {}, error: noAccountError() })
      .mockResolvedValueOnce({ data: {}, error: null });

    await db.auth.signInWithMagicLink('  Kegan@Example.COM ', '/');

    for (const call of signInWithOtp.mock.calls) {
      expect(call[0].email).toBe('kegan@example.com');
      expect(phaseOptions(call).emailRedirectTo).toBe(`${window.location.origin}/`);
    }
  });

  it('still rejects a missing address before touching the network', async () => {
    await expect(db.auth.signInWithMagicLink('')).rejects.toThrow('email required');
    expect(signInWithOtp).not.toHaveBeenCalled();
  });
});
