// Tests for src/lib/data/referrals.js — URL capture + RPC wrappers.
//
// The URL-capture helpers (capturePendingReferralCode /
// consumePendingReferralCode / peekPendingReferralCode) are pure
// localStorage + window.history manipulation, so they're testable
// in jsdom without mocking Supabase.
//
// The RPC wrappers (getMyReferralCode / claimReferral /
// getMyReferralStats) mock supabase.rpc to verify the envelope
// shapes, error swallowing, and 42883 / 42P01 graceful-degrade
// paths.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { rpc: (...args) => rpc(...args) },
}));

let referrals;
beforeEach(async () => {
  vi.resetModules();
  rpc.mockReset();
  localStorage.clear();
  // Reset URL state — jsdom keeps the location across tests
  window.history.replaceState({}, '', '/');
  referrals = await import('../referrals');
});

describe('capturePendingReferralCode', () => {
  it('reads ?ref=… from the URL into localStorage', () => {
    window.history.replaceState({}, '', '/?ref=ABC234');
    referrals.capturePendingReferralCode();
    expect(localStorage.getItem('flexyn.pendingReferralCode')).toBe('ABC234');
  });

  it('cleans the ?ref param from the URL after capture', () => {
    window.history.replaceState({}, '', '/dashboard?ref=ABC234&other=x');
    referrals.capturePendingReferralCode();
    expect(window.location.search).toBe('?other=x');
  });

  it('uppercases lowercase codes for canonical storage', () => {
    window.history.replaceState({}, '', '/?ref=abc234');
    referrals.capturePendingReferralCode();
    expect(localStorage.getItem('flexyn.pendingReferralCode')).toBe('ABC234');
  });

  it('rejects codes outside the alphabet (no I, O, 0, 1)', () => {
    window.history.replaceState({}, '', '/?ref=AB0CDE');
    referrals.capturePendingReferralCode();
    expect(localStorage.getItem('flexyn.pendingReferralCode')).toBe(null);
  });

  it('rejects codes of the wrong length', () => {
    window.history.replaceState({}, '', '/?ref=ABCD');
    referrals.capturePendingReferralCode();
    expect(localStorage.getItem('flexyn.pendingReferralCode')).toBe(null);
  });

  it('is a no-op when there is no ?ref param', () => {
    window.history.replaceState({}, '', '/dashboard');
    referrals.capturePendingReferralCode();
    expect(localStorage.getItem('flexyn.pendingReferralCode')).toBe(null);
  });
});

describe('consumePendingReferralCode', () => {
  it('reads and clears the stashed code', () => {
    localStorage.setItem('flexyn.pendingReferralCode', 'ABC234');
    const code = referrals.consumePendingReferralCode();
    expect(code).toBe('ABC234');
    expect(localStorage.getItem('flexyn.pendingReferralCode')).toBe(null);
  });

  it('returns null when nothing is stashed', () => {
    expect(referrals.consumePendingReferralCode()).toBe(null);
  });
});

describe('peekPendingReferralCode', () => {
  it('returns the stashed code without consuming it', () => {
    localStorage.setItem('flexyn.pendingReferralCode', 'XYZ234');
    expect(referrals.peekPendingReferralCode()).toBe('XYZ234');
    expect(localStorage.getItem('flexyn.pendingReferralCode')).toBe('XYZ234');
  });
});

describe('getMyReferralCode', () => {
  it('returns the code on a successful RPC call', async () => {
    rpc.mockResolvedValue({ data: 'ABC234', error: null });
    const code = await referrals.getMyReferralCode();
    expect(code).toBe('ABC234');
    expect(rpc).toHaveBeenCalledWith('get_my_referral_code');
  });

  it('returns null when the RPC is missing (42883)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function not found' } });
    expect(await referrals.getMyReferralCode()).toBe(null);
  });

  it('returns null when the RPC errors generically', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '50000', message: 'oops' } });
    expect(await referrals.getMyReferralCode()).toBe(null);
  });

  it('returns null when the RPC throws', async () => {
    rpc.mockRejectedValueOnce(new Error('network'));
    expect(await referrals.getMyReferralCode()).toBe(null);
  });
});

describe('claimReferral', () => {
  it('rejects empty/missing codes without an RPC call', async () => {
    const res = await referrals.claimReferral('');
    expect(res).toEqual({ ok: false, reason: 'invalid_code' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes the code through to the RPC', async () => {
    rpc.mockResolvedValue({ data: { ok: true, reward_coins: 200 }, error: null });
    const res = await referrals.claimReferral('ABC234');
    expect(res.ok).toBe(true);
    expect(res.reward_coins).toBe(200);
    expect(rpc).toHaveBeenCalledWith('claim_referral', { p_code: 'ABC234' });
  });

  it('returns null on pre-089 hosts (42883)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect(await referrals.claimReferral('ABC234')).toBe(null);
  });

  it('returns {ok:false} on other RPC errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '50000', message: 'db error' } });
    const res = await referrals.claimReferral('ABC234');
    expect(res?.ok).toBe(false);
    expect(res?.reason).toBe('rpc_error');
  });
});

describe('getMyReferralStats', () => {
  it('returns the stats payload', async () => {
    rpc.mockResolvedValue({
      data: { code: 'ABC234', total_referrals: 3, total_coins_earned: 600 },
      error: null,
    });
    const stats = await referrals.getMyReferralStats();
    expect(stats?.code).toBe('ABC234');
    expect(stats?.total_referrals).toBe(3);
  });

  it('gracefully returns null when the RPC is missing', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42P01' } });
    expect(await referrals.getMyReferralStats()).toBe(null);
  });
});
