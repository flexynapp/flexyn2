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

// Mirrors the per-level reward schedule defined inline in migration 263
// (which superseded 070 + 074). Kept in lockstep manually — the SQL has the
// canonical version. If you change one, change both; this mirror is the
// only thing that catches them disagreeing.
//
// The SQL loops `FOR v_lvl IN GREATEST(v_prev_through + 1, 2) .. p_new_level`.
// Level 1 is intentionally skipped: every user starts at current_level=1
// and the welcome capsule (grantWelcomeCapsule, fired on first device
// baseline) is the level-1 acknowledgment. Without that floor, a fresh
// user hitting level 2 received 2 standards from this RPC, double the
// intended single level-up grant.
//
// Migration 263 rebalanced the rates. 070 paid a standard capsule on EVERY
// level, which was tuned for the old curve where levels were expensive. On
// the rebalanced curve (migration 261) a single 700 XP workout crosses five
// levels, so per-level grants turned into a firehose — month one paid ~8,950
// coins of capsule value into a shop whose priciest item is 1,000.
//
// Now: 25 coins every level, a standard every 3rd, a premium + 100 coins
// every 10th, an elite every 25th.
function computeOwed(fromLevel, toLevel) {
  let standard = 0, premium = 0, elite = 0, coins = 0;
  for (let l = Math.max(fromLevel + 1, 2); l <= toLevel; l++) {
    coins += 25;
    if (l % 3 === 0) {
      standard += 1;
    }
    if (l % 10 === 0) {
      premium += 1;
      coins += 100;
    }
    if (l % 25 === 0) {
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

  it('grants coins only at level 2 — capsules start at level 3', async () => {
    // Level 1 grant lives elsewhere (the welcome capsule). The
    // grant_level_up_rewards floor at level 2 prevents this RPC from
    // doubling that grant on the first level-up.
    // Under migration 263 capsules land every 3rd level, so level 2 is
    // coins only. The first capsule from this RPC arrives at level 3.
    const got = await grantForLevelUp('uid', 'u@e.com', 2);
    expect(got.already_granted).toBe(false);
    expect(got.standard).toBe(0);
    expect(got.premium).toBe(0);
    expect(got.elite).toBe(0);
    expect(got.coins).toBe(25);
    expect(got.new_balance).toBe(25);
  });

  it('grants one standard by level 5 (levels 2..5)', async () => {
    const got = await grantForLevelUp('uid', 'u@e.com', 5);
    expect(got.already_granted).toBe(false);
    expect(got.standard).toBe(1);   // level 3 only
    expect(got.premium).toBe(0);    // premiums are every 10th now
    expect(got.elite).toBe(0);
    expect(got.coins).toBe(4 * 25); // levels 2,3,4,5
  });

  it('grants the first premium at level 10 (covers levels 2..10)', async () => {
    const got = await grantForLevelUp('uid', 'u@e.com', 10);
    expect(got.standard).toBe(3);   // levels 3, 6, 9
    expect(got.premium).toBe(1);    // level 10
    expect(got.elite).toBe(0);      // elites are every 25th now
    expect(got.coins).toBe(9 * 25 + 100);
  });

  it('grants the first elite at level 25', async () => {
    // Elites moved from every 10th to every 25th, so they land at
    // 25/50/75/100 — four in a lifetime rather than ten in six months.
    const got = await grantForLevelUp('uid', 'u@e.com', 25);
    expect(got.elite).toBe(1);
    expect(got.premium).toBe(2);    // 10, 20
    expect(got.standard).toBe(8);   // 3,6,9,12,15,18,21,24
  });

  it('grants nothing when invoked at level 1 (welcome capsule covers it)', async () => {
    // A fresh user who somehow lands here with newLevel=1 should get
    // zero rewards from this RPC — level 1 is owned by the welcome
    // capsule path. This guards against future code that calls
    // grantForLevelUp(currentLevel) without level-up gating.
    const got = await grantForLevelUp('uid', 'u@e.com', 1);
    expect(got.standard).toBe(0);
    expect(got.premium).toBe(0);
    expect(got.elite).toBe(0);
    expect(got.coins).toBe(0);
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
    expect(got.standard).toBe(1); // level 6
    expect(got.premium).toBe(0);
    expect(got.elite).toBe(0);
    expect(got.coins).toBe(2 * 25);
  });

  it('handles a multi-tier jump in one earn (rare race compensator)', async () => {
    // User somehow jumps 0 → 11 in one earn (e.g. backlog of XP that
    // crossed multiple level lines). The RPC pays out every intervening
    // level (except 1) — the bug we closed was the old client only
    // paying one level.
    const got = await grantForLevelUp('uid', 'u@e.com', 11);
    expect(got.standard).toBe(3);   // levels 3, 6, 9
    expect(got.premium).toBe(1);    // level 10
    expect(got.elite).toBe(0);      // first elite is level 25
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
