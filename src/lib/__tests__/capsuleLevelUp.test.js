// Unit tests for grantForLevelUp — the client wrapper over the
// grant_level_up_rewards RPC introduced in migration 070.
//
// The race condition we closed was: the previous client implementation
// issued multiple independent inserts (one per tier) + a coin update
// without any idempotency check, so a level-up event firing twice
// (retried fetch, two tabs, re-mount during StrictMode dev) would
// double-grant. The RPC enforces idempotency via
// user_profiles.level_capsules_awarded_through, only paying out for
// levels strictly above that high-water mark. This test mocks the RPC
// and exercises the client glue.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Simulate the server's awarded-through counter so we can verify
// the client correctly relays first-call grants and second-call
// "already_granted" results.
const _state = {
  awardedThrough: 0,
  coins: 0,
  rpcError: null,
};

// Mirrors the per-level reward schedule defined inline in migration
// 070. Kept in lockstep manually — the SQL has the canonical version.
//
// The SQL loops `FOR v_lvl IN (v_prev_through + 1) .. p_new_level`, so
// a fresh user (level_capsules_awarded_through=0) hitting level 2 gets
// rewards for levels 1 AND 2. The "+50 coins per level" is paid for
// every iteration, multiples of 5 add a premium + bonus coins,
// multiples of 10 add an elite.
function computeOwed(fromLevel, toLevel) {
  let standard = 0, premium = 0, elite = 0, coins = 0;
  for (let l = fromLevel + 1; l <= toLevel; l++) {
    standard += 1;
    coins += 50;
    if (l % 5 === 0) {
      premium += 1;
      coins += 100;
    }
    if (l % 10 === 0) {
      elite += 1;
    }
  }
  return { standard, premium, elite, coins };
}

function simulateRpc(p_new_level) {
  if (_state.rpcError) return { data: null, error: _state.rpcError };
  if (p_new_level <= _state.awardedThrough) {
    return {
      data: {
        already_granted: true,
        awarded_through: _state.awardedThrough,
        standard: 0, premium: 0, elite: 0, coins: 0,
        new_balance: _state.coins,
      },
      error: null,
    };
  }
  const owed = computeOwed(_state.awardedThrough, p_new_level);
  _state.awardedThrough = p_new_level;
  _state.coins += owed.coins;
  return {
    data: {
      already_granted: false,
      awarded_through: p_new_level,
      standard: owed.standard,
      premium: owed.premium,
      elite:   owed.elite,
      coins:   owed.coins,
      new_balance: _state.coins,
    },
    error: null,
  };
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: async (fnName, args) => {
      if (fnName === 'grant_level_up_rewards') {
        return simulateRpc(args?.p_new_level);
      }
      return { data: null, error: { code: '42883', message: `unknown RPC: ${fnName}` } };
    },
  },
}));

const { grantForLevelUp } = await import('../data/capsules');

beforeEach(() => {
  _state.awardedThrough = 0;
  _state.coins = 0;
  _state.rpcError = null;
});

describe('grantForLevelUp — first-time grants', () => {
  it('returns null when userId is missing', async () => {
    const got = await grantForLevelUp(null, 'u@e.com', 2);
    expect(got).toBeNull();
  });

  it('returns null when newLevel is 0 / falsy', async () => {
    const got = await grantForLevelUp('uid', 'u@e.com', 0);
    expect(got).toBeNull();
  });

  it('grants two standards + 100 coins at level 2 (fresh user — levels 1+2)', async () => {
    const got = await grantForLevelUp('uid', 'u@e.com', 2);
    expect(got.already_granted).toBe(false);
    expect(got.standard).toBe(2);
    expect(got.premium).toBe(0);
    expect(got.elite).toBe(0);
    expect(got.coins).toBe(100);
    expect(got.new_balance).toBe(100);
  });

  it('grants standards + premium + bonus at level 5 (levels 1..5)', async () => {
    const got = await grantForLevelUp('uid', 'u@e.com', 5);
    expect(got.already_granted).toBe(false);
    expect(got.standard).toBe(5);   // one per level 1..5
    expect(got.premium).toBe(1);    // level 5
    expect(got.elite).toBe(0);
    expect(got.coins).toBe(5 * 50 + 100);
  });

  it('grants elite at level 10 (covers levels 1..10)', async () => {
    const got = await grantForLevelUp('uid', 'u@e.com', 10);
    expect(got.standard).toBe(10);  // levels 1..10
    expect(got.premium).toBe(2);    // 5, 10
    expect(got.elite).toBe(1);      // 10
    expect(got.coins).toBe(10 * 50 + 2 * 100);
  });
});

describe('grantForLevelUp — idempotency', () => {
  it('does NOT re-grant on second call at the same level', async () => {
    await grantForLevelUp('uid', 'u@e.com', 5);
    const second = await grantForLevelUp('uid', 'u@e.com', 5);
    expect(second.already_granted).toBe(true);
    expect(second.standard + second.premium + second.elite).toBe(0);
    expect(second.coins).toBe(0);
  });

  it('grants only the delta when level jumps past previously-paid', async () => {
    await grantForLevelUp('uid', 'u@e.com', 4); // pay 1..4
    const got = await grantForLevelUp('uid', 'u@e.com', 6); // pay 5..6
    expect(got.standard).toBe(2);
    expect(got.premium).toBe(1); // level 5
    expect(got.elite).toBe(0);
    expect(got.coins).toBe(2 * 50 + 100);
  });

  it('handles a multi-tier jump in one earn (rare race compensator)', async () => {
    // User somehow jumps 0 → 11 in one earn (e.g. backlog of XP that
    // crossed multiple level lines). The RPC pays out every intervening
    // level — the bug we closed was the old client only paying one.
    const got = await grantForLevelUp('uid', 'u@e.com', 11);
    expect(got.standard).toBe(11);
    expect(got.premium).toBe(2);    // 5, 10
    expect(got.elite).toBe(1);      // 10
  });
});

describe('grantForLevelUp — failure modes', () => {
  it('throws a tagged error when RPC is missing (pre-070 host)', async () => {
    _state.rpcError = { code: '42883', message: 'function does not exist' };
    await expect(grantForLevelUp('uid', 'u@e.com', 2)).rejects.toMatchObject({
      code: '42883',
      message: expect.stringMatching(/migration 070/i),
    });
  });

  it('throws a tagged error when the function table is missing (42P01)', async () => {
    _state.rpcError = { code: '42P01', message: 'relation does not exist' };
    await expect(grantForLevelUp('uid', 'u@e.com', 2)).rejects.toMatchObject({
      code: '42P01',
    });
  });

  it('re-throws unknown errors verbatim (lets caller capture in Sentry)', async () => {
    _state.rpcError = { code: '40001', message: 'serialization failure' };
    await expect(grantForLevelUp('uid', 'u@e.com', 2)).rejects.toMatchObject({
      code: '40001',
    });
  });
});
