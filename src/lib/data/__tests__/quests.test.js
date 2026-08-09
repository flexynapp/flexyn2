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
  // Map of questRowId -> { claimed: bool, reward: number, xp?, crewXp? }
  rows: {},
  coins: 0,
  rpcError: null,
  perfectDay: null,
  stats: null,
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
    data: {
      success: true, already_claimed: false,
      coins_awarded: row.reward, new_balance: _state.coins,
      // Migration 316 pays three currencies. `xp_awarded` is what
      // grant_action_xp ACTUALLY credited after the daily cap, which is why
      // the fixture lets a row declare a credited amount that differs from
      // its nominal reward — see the capped-claim test below.
      xp_awarded: row.xp ?? 0,
      crew_xp_awarded: row.crewXp ?? 0,
    },
    error: null,
  };
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: async (fnName, args) => {
      if (fnName === 'claim_quest_atomic') {
        return simulateRpc(args?.p_quest_row_id);
      }
      if (fnName === 'claim_perfect_day_bonus') {
        if (_state.rpcError) return { data: null, error: _state.rpcError };
        return { data: _state.perfectDay, error: null };
      }
      if (fnName === 'get_my_quest_stats') {
        if (_state.rpcError) return { data: null, error: _state.rpcError };
        return { data: _state.stats, error: null };
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

const { claimQuest, claimPerfectDayBonus, getQuestStats } = await import('../quests');

const user = { id: 'uid', email: 'u@e.com' };

beforeEach(() => {
  _state.rows = {};
  _state.coins = 100;   // pretend wallet
  _state.rpcError = null;
  _state.perfectDay = null;
  _state.stats = null;
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

describe('claimQuest — XP and crew XP (migration 316)', () => {
  it('reports the XP and crew XP the server credited', async () => {
    _state.rows['q1'] = { claimed: false, reward: 20, xp: 50, crewXp: 13 };
    const got = await claimQuest(user, 'q1');
    expect(got.success).toBe(true);
    expect(got.xpAwarded).toBe(50);
    expect(got.crewXpAwarded).toBe(13);
  });

  // The whole reason claim_quest_atomic returns the credited figure rather
  // than the row's xp_reward: once the 'daily_quest' cap is spent,
  // grant_action_xp credits 0 and the claim still succeeds. A client that
  // rendered the catalog number would toast "+120 XP" over a zero grant.
  it('reports zero XP for a claim the daily cap swallowed', async () => {
    _state.rows['q1'] = { claimed: false, reward: 50, xp: 0, crewXp: 0 };
    const got = await claimQuest(user, 'q1');
    expect(got.success).toBe(true);
    expect(got.coinsAwarded).toBe(50);   // coins are uncapped, still paid
    expect(got.xpAwarded).toBe(0);
  });

  // A pre-316 host answers without the new keys. The client must read those
  // as zero, not undefined — `+undefined XP` is what a missing ?? produces.
  it('defaults the new fields to 0 on a pre-316 host', async () => {
    _state.rows['q1'] = { claimed: false, reward: 20 };
    const got = await claimQuest(user, 'q1');
    expect(got.xpAwarded).toBe(0);
    expect(got.crewXpAwarded).toBe(0);
  });
});

describe('claimPerfectDayBonus', () => {
  it('returns the bonus and the new streak on success', async () => {
    _state.perfectDay = {
      success: true, coins_awarded: 30, xp_awarded: 100,
      crew_xp_awarded: 50, streak: 7,
    };
    const got = await claimPerfectDayBonus(user);
    expect(got.success).toBe(true);
    expect(got.coinsAwarded).toBe(30);
    expect(got.xpAwarded).toBe(100);
    expect(got.crewXpAwarded).toBe(50);
    expect(got.streak).toBe(7);
  });

  // The card fires this speculatively after every claim rather than proving
  // the day is finished first, so "not yet" has to be an ordinary answer.
  it('reports not_complete without throwing when quests remain', async () => {
    _state.perfectDay = { success: false, reason: 'not_complete', claimed: 2, total: 4 };
    const got = await claimPerfectDayBonus(user);
    expect(got.success).toBe(false);
    expect(got.reason).toBe('not_complete');
    expect(got.coinsAwarded).toBe(0);
  });

  it('reports already_claimed rather than paying twice', async () => {
    _state.perfectDay = { success: false, reason: 'already_claimed', streak: 7 };
    const got = await claimPerfectDayBonus(user);
    expect(got.success).toBe(false);
    expect(got.reason).toBe('already_claimed');
  });

  // A host that predates 316 has no such function. That is not an error
  // worth surfacing — the bonus simply doesn't exist on that deployment.
  it('returns a quiet failure on a pre-316 host', async () => {
    _state.rpcError = { code: 'PGRST202', message: 'function not found' };
    const got = await claimPerfectDayBonus(user);
    expect(got.success).toBe(false);
    expect(got.coinsAwarded).toBe(0);
  });

  it('returns failure for a missing user without calling the RPC', async () => {
    const got = await claimPerfectDayBonus(null);
    expect(got.success).toBe(false);
  });
});

describe('getQuestStats', () => {
  it('maps the RPC payload to camelCase', async () => {
    _state.stats = {
      current_streak: 5, longest_streak: 12, perfect_days: 30,
      quests_claimed: 91, coins_earned: 1200, xp_earned: 3400,
      crew_xp_earned: 800, bonus_claimed_today: true, is_current: true,
    };
    const got = await getQuestStats(user);
    expect(got.currentStreak).toBe(5);
    expect(got.longestStreak).toBe(12);
    expect(got.crewXpEarned).toBe(800);
    expect(got.bonusClaimedToday).toBe(true);
    expect(got.isCurrent).toBe(true);
  });

  // isCurrent is the field the sheet reads, because current_streak KEEPS its
  // value after a break until the next perfect day overwrites it. Rendering
  // it raw tells someone they're on a 12-day run four days after they lost
  // it.
  it('carries a broken streak through as isCurrent false', async () => {
    _state.stats = { current_streak: 12, longest_streak: 12, is_current: false };
    const got = await getQuestStats(user);
    expect(got.currentStreak).toBe(12);
    expect(got.isCurrent).toBe(false);
  });

  it('returns zeroes rather than null when the RPC fails', async () => {
    _state.rpcError = { code: '42883', message: 'function does not exist' };
    const got = await getQuestStats(user);
    expect(got).toEqual({
      currentStreak: 0, longestStreak: 0, perfectDays: 0, questsClaimed: 0,
      coinsEarned: 0, xpEarned: 0, crewXpEarned: 0,
      bonusClaimedToday: false, isCurrent: false,
    });
  });
});

describe('claimQuest — input validation', () => {
  it('returns failure for missing user', async () => {
    const got = await claimQuest(null, 'q1');
    expect(got).toEqual({
      success: false, newCoinBalance: null,
      coinsAwarded: 0, xpAwarded: 0, crewXpAwarded: 0,
    });
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
