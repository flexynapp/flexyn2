// Unit tests for quests.js — specifically claimQuest, which is the
// thin client over the claim_quest_atomic RPC (migration 068).
//
// The race we closed: previously claimQuest did
//   read user.flex_coins → update with `coins + reward` → mark claimed
// which silently lost coin grants when a concurrent flex_coins update
// (marketplace credit, streak milestone, another quest claim) landed
// between the read and the write. The RPC does delta-arithmetic +
// CAS-style update of the claimed_at column inside one transaction.
//
// We also exercise input-shape validation and the missing-RPC failure
// mode, both of which the client surfaces as "claim didn't take" rather
// than throwing — quest claiming runs from the quests modal and a
// thrown error would have shown the user a generic error toast for
// what's actually a recoverable state.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const _state = {
  // Map of questRowId -> { claimed: bool, reward: number }
  rows: {},
  coins: 0,
  rpcError: null,
};

function simulateRpc(p_quest_row_id) {
  if (_state.rpcError) return { data: null, error: _state.rpcError };
  const row = _state.rows[p_quest_row_id];
  if (!row) {
    // RPC contract: missing row → success=false rather than error,
    // because RLS may have hidden it from this user.
    return {
      data: { success: false, already_claimed: false, coins_awarded: 0, new_balance: _state.coins },
      error: null,
    };
  }
  if (row.claimed) {
    return {
      data: { success: false, already_claimed: true, coins_awarded: 0, new_balance: _state.coins },
      error: null,
    };
  }
  row.claimed = true;
  _state.coins += row.reward;
  return {
    data: { success: true, already_claimed: false, coins_awarded: row.reward, new_balance: _state.coins },
    error: null,
  };
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: async (fnName, args) => {
      if (fnName === 'claim_quest_atomic') {
        return simulateRpc(args?.p_quest_row_id);
      }
      return { data: null, error: { code: '42883', message: `unknown RPC: ${fnName}` } };
    },
    // Defensive — the test only exercises claimQuest, but the rest of
    // quests.js still imports `supabase.from` at module-load.
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    }),
  },
}));

const { claimQuest } = await import('../quests');

const user = { id: 'uid', email: 'u@e.com' };

beforeEach(() => {
  _state.rows = {};
  _state.coins = 100;   // pretend wallet
  _state.rpcError = null;
});

describe('claimQuest — happy path', () => {
  it('credits the reward and returns the new balance', async () => {
    _state.rows['q1'] = { claimed: false, reward: 30 };
    const got = await claimQuest(user, 'q1');
    expect(got.success).toBe(true);
    expect(got.coinsAwarded).toBe(30);
    expect(got.newCoinBalance).toBe(130);
  });

  it('does NOT double-credit on a second claim', async () => {
    _state.rows['q1'] = { claimed: false, reward: 30 };
    await claimQuest(user, 'q1');
    const second = await claimQuest(user, 'q1');
    expect(second.success).toBe(false);
    expect(second.coinsAwarded).toBe(0);
    // Balance reflects the prior single credit, not 2 × 30
    expect(second.newCoinBalance).toBe(130);
  });

  it('composes with other coin grants — server-side delta math is honored', async () => {
    // Simulate a marketplace credit landing between read and write
    // (in the old impl, this would have been overwritten).
    _state.rows['q1'] = { claimed: false, reward: 30 };
    _state.rows['q2'] = { claimed: false, reward: 20 };
    await claimQuest(user, 'q1');
    _state.coins += 200; // external grant lands here
    const got = await claimQuest(user, 'q2');
    expect(got.coinsAwarded).toBe(20);
    expect(got.newCoinBalance).toBe(100 + 30 + 200 + 20);
  });
});

describe('claimQuest — input validation', () => {
  it('returns failure for missing user', async () => {
    const got = await claimQuest(null, 'q1');
    expect(got).toEqual({ success: false, newCoinBalance: null, coinsAwarded: 0 });
  });

  it('returns failure for missing user.id', async () => {
    const got = await claimQuest({ email: 'u@e.com' }, 'q1');
    expect(got.success).toBe(false);
  });

  it('returns failure for missing questRowId', async () => {
    const got = await claimQuest(user, null);
    expect(got.success).toBe(false);
  });
});

describe('claimQuest — failure modes', () => {
  it('returns failure (does NOT throw) when the RPC errors', async () => {
    _state.rows['q1'] = { claimed: false, reward: 30 };
    _state.rpcError = { code: '40001', message: 'serialization failure' };
    const got = await claimQuest(user, 'q1');
    expect(got.success).toBe(false);
    expect(got.coinsAwarded).toBe(0);
    expect(got.newCoinBalance).toBeNull();
  });

  it('returns failure when the RPC is missing (pre-068 host)', async () => {
    _state.rpcError = { code: '42883', message: 'function does not exist' };
    const got = await claimQuest(user, 'q1');
    expect(got.success).toBe(false);
  });

  it('returns failure (not throw) when the row is hidden by RLS / not found', async () => {
    // No row inserted into _state.rows.
    const got = await claimQuest(user, 'q-missing');
    expect(got.success).toBe(false);
    expect(got.coinsAwarded).toBe(0);
  });
});
