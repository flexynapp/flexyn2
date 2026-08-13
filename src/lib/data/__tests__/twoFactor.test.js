// Tests for src/lib/data/twoFactor.js — wrappers around
// supabase.auth.mfa.{listFactors,enroll,challenge,verify,unenroll}.
// Mocks supabase.auth.mfa to verify call shapes + normalized envelopes.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mfa = {
  listFactors: vi.fn(),
  enroll:      vi.fn(),
  challenge:   vi.fn(),
  verify:      vi.fn(),
  unenroll:    vi.fn(),
};
vi.mock('@/api/supabaseClient', () => ({
  supabase: { auth: { mfa } },
}));

const { listFactors, enrollTotp, verifyEnrollment, unenroll } = await import('../twoFactor');

beforeEach(() => {
  Object.values(mfa).forEach(fn => fn.mockReset());
});

describe('listFactors', () => {
  it('returns ok + totp/all on success', async () => {
    mfa.listFactors.mockResolvedValue({ data: { totp: [{ id: 'f1' }], all: [{ id: 'f1' }] }, error: null });
    const res = await listFactors();
    expect(res.ok).toBe(true);
    expect(res.totp).toEqual([{ id: 'f1' }]);
    expect(res.all).toEqual([{ id: 'f1' }]);
  });

  it('returns ok:false on error', async () => {
    mfa.listFactors.mockResolvedValue({ data: null, error: { message: 'bad' } });
    const res = await listFactors();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('rpc_error');
  });

  it('returns ok:false on throw', async () => {
    mfa.listFactors.mockRejectedValue(new Error('network down'));
    const res = await listFactors();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('network');
  });
});

describe('enrollTotp', () => {
  it('returns the QR + secret + factor id on success', async () => {
    mfa.enroll.mockResolvedValue({
      data: { id: 'f1', totp: { qr_code: 'data:image/png;base64,xxx', secret: 'ABCDEF', uri: 'otpauth://' } },
      error: null,
    });
    const res = await enrollTotp('My App');
    expect(res.ok).toBe(true);
    expect(res.factorId).toBe('f1');
    expect(res.qr).toMatch(/^data:image/);
    expect(res.secret).toBe('ABCDEF');
    expect(mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'My App' });
  });

  it('returns ok:false on enroll error', async () => {
    mfa.enroll.mockResolvedValue({ data: null, error: { message: 'mfa not allowed' } });
    const res = await enrollTotp();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('rpc_error');
  });

  // GoTrue's real refusal for an anonymous session, captured verbatim from
  // the live project on 2026-08-12. Guests are 34 of 63 accounts and the
  // panel has no is_anonymous gate, so this is the branch most users who
  // tap Enable will actually hit -- it must not surface as raw server text.
  it('names the anonymous refusal so the UI can explain it', async () => {
    mfa.enroll.mockResolvedValue({
      data: null,
      error: { message: 'Anonymous user not allowed to perform these actions' },
    });
    const res = await enrollTotp();
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('anonymous');
    expect(res.message).toMatch(/anonymous user not allowed/i);
  });
});

describe('verifyEnrollment', () => {
  it('rejects when factorId or code is missing', async () => {
    expect((await verifyEnrollment({ factorId: '', code: '123456' })).ok).toBe(false);
    expect((await verifyEnrollment({ factorId: 'f1', code: '' })).ok).toBe(false);
  });

  it('challenges + verifies and returns ok on success', async () => {
    mfa.challenge.mockResolvedValue({ data: { id: 'c1' }, error: null });
    mfa.verify.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const res = await verifyEnrollment({ factorId: 'f1', code: '123456' });
    expect(mfa.challenge).toHaveBeenCalledWith({ factorId: 'f1' });
    expect(mfa.verify).toHaveBeenCalledWith({ factorId: 'f1', challengeId: 'c1', code: '123456' });
    expect(res.ok).toBe(true);
  });

  it('returns invalid_code when verify says the code is wrong', async () => {
    mfa.challenge.mockResolvedValue({ data: { id: 'c1' }, error: null });
    mfa.verify.mockResolvedValue({ data: null, error: { message: 'Invalid code' } });
    const res = await verifyEnrollment({ factorId: 'f1', code: '000000' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('invalid_code');
  });

  it('returns rpc_error when challenge fails', async () => {
    mfa.challenge.mockResolvedValue({ data: null, error: { message: 'challenge failed' } });
    const res = await verifyEnrollment({ factorId: 'f1', code: '123456' });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('rpc_error');
  });
});

describe('unenroll', () => {
  it('returns ok:false on missing factor id', async () => {
    expect((await unenroll(null)).ok).toBe(false);
  });

  it('calls supabase.auth.mfa.unenroll with the factor id', async () => {
    mfa.unenroll.mockResolvedValue({ data: null, error: null });
    const res = await unenroll('f1');
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f1' });
    expect(res.ok).toBe(true);
  });

  it('returns ok:false on error', async () => {
    mfa.unenroll.mockResolvedValue({ data: null, error: { message: 'no' } });
    expect((await unenroll('f1')).ok).toBe(false);
  });
});
