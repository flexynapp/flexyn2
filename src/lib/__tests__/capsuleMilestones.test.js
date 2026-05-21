// Unit tests for the achievement-milestone capsule grant logic.
//
// As of migration 071, grantForAchievementMilestone is a thin client
// over the atomic SECURITY DEFINER `grant_achievement_milestones` RPC.
// All the schedule + idempotency logic lives in SQL now; this test
// mocks the RPC and verifies the client correctly relays the result.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock state — emulates the server-side milestone counter ─────────────
const _state = {
  awarded: 0,           // milestone_capsules_awarded on the server
  rpcError: null,       // optional error to return from the RPC
};

// Schedule must match the inline VALUES in 071_atomic_achievement_milestones.
// Kept in sync manually — single source of truth lives in the migration.
const SCHEDULE = [
  { idx: 1, threshold: 5,   type: 'standard' },
  { idx: 2, threshold: 10,  type: 'standard' },
  { idx: 3, threshold: 25,  type: 'premium'  },
  { idx: 4, threshold: 50,  type: 'premium'  },
  { idx: 5, threshold: 100, type: 'elite'    },
];

function simulateRpc(p_unlocked_count) {
  if (_state.rpcError) return { data: null, error: _state.rpcError };
  const owed = SCHEDULE.filter(
    m => m.threshold <= p_unlocked_count && m.idx > _state.awarded
  );
  if (owed.length === 0) {
    return {
      data: { granted_count: 0, granted: [], awarded_total: _state.awarded },
      error: null,
    };
  }
  _state.awarded += owed.length;
  return {
    data: {
      granted_count: owed.length,
      granted: owed.map(o => ({ threshold: o.threshold, type: o.type })),
      awarded_total: _state.awarded,
    },
    error: null,
  };
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: async (fnName, args) => {
      if (fnName === 'grant_achievement_milestones') {
        return simulateRpc(args?.p_unlocked_count);
      }
      return { data: null, error: { code: '42883', message: `unknown RPC: ${fnName}` } };
    },
    // Legacy direct table access still mocked for any other path the
    // module under test might exercise. The new flow doesn't touch it.
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  },
}));

// Now we can import the module under test.
const { grantForAchievementMilestone, ACHIEVEMENT_MILESTONES } = await import('../data/capsules');

beforeEach(() => {
  _state.awarded = 0;
  _state.rpcError = null;
});

describe('ACHIEVEMENT_MILESTONES schedule', () => {
  it('has thresholds in strictly ascending order', () => {
    for (let i = 1; i < ACHIEVEMENT_MILESTONES.length; i++) {
      expect(ACHIEVEMENT_MILESTONES[i].threshold)
        .toBeGreaterThan(ACHIEVEMENT_MILESTONES[i - 1].threshold);
    }
  });

  it('every entry is one of the three capsule types', () => {
    for (const m of ACHIEVEMENT_MILESTONES) {
      expect(['standard', 'premium', 'elite']).toContain(m.type);
    }
  });

  it('capsule tier escalates with threshold', () => {
    const rank = { standard: 1, premium: 2, elite: 3 };
    for (let i = 1; i < ACHIEVEMENT_MILESTONES.length; i++) {
      expect(rank[ACHIEVEMENT_MILESTONES[i].type])
        .toBeGreaterThanOrEqual(rank[ACHIEVEMENT_MILESTONES[i - 1].type]);
    }
  });

  it('stays in lockstep with the SQL VALUES inlined in migration 071', () => {
    // If you change one, change the other — they share no source.
    expect(ACHIEVEMENT_MILESTONES).toHaveLength(SCHEDULE.length);
    SCHEDULE.forEach((s, i) => {
      expect(ACHIEVEMENT_MILESTONES[i]).toMatchObject({
        threshold: s.threshold,
        type:      s.type,
      });
    });
  });
});

describe('grantForAchievementMilestone — first-time grants', () => {
  it('grants nothing below the first threshold', async () => {
    const got = await grantForAchievementMilestone('uid', 'u@e.com', 4);
    expect(got).toEqual([]);
    expect(_state.awarded).toBe(0);
  });

  it('grants one standard at exactly 5 achievements', async () => {
    const got = await grantForAchievementMilestone('uid', 'u@e.com', 5);
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe('standard');
    expect(_state.awarded).toBe(1);
  });

  it('grants both standards if user jumps from 0 → 10 directly', async () => {
    const got = await grantForAchievementMilestone('uid', 'u@e.com', 10);
    expect(got.map(m => m.type)).toEqual(['standard', 'standard']);
    expect(_state.awarded).toBe(2);
  });

  it('grants all five if user lands at 100+', async () => {
    const got = await grantForAchievementMilestone('uid', 'u@e.com', 150);
    expect(got).toHaveLength(5);
    expect(got.map(m => m.type)).toEqual(['standard', 'standard', 'premium', 'premium', 'elite']);
    expect(_state.awarded).toBe(5);
  });
});

describe('grantForAchievementMilestone — idempotency', () => {
  it('does NOT re-grant on second call with same count', async () => {
    await grantForAchievementMilestone('uid', 'u@e.com', 25);
    expect(_state.awarded).toBe(3); // standard, standard, premium

    const second = await grantForAchievementMilestone('uid', 'u@e.com', 25);
    expect(second).toEqual([]);
    expect(_state.awarded).toBe(3); // unchanged
  });

  it('grants only the new milestones when count grows past additional thresholds', async () => {
    await grantForAchievementMilestone('uid', 'u@e.com', 10);
    expect(_state.awarded).toBe(2);

    const got = await grantForAchievementMilestone('uid', 'u@e.com', 50);
    expect(got.map(m => m.type)).toEqual(['premium', 'premium']);
    expect(_state.awarded).toBe(4);
  });

  it('handles a user who is already at max — no double-grant', async () => {
    _state.awarded = 5; // user already received everything
    const got = await grantForAchievementMilestone('uid', 'u@e.com', 200);
    expect(got).toEqual([]);
  });
});

describe('grantForAchievementMilestone — input validation', () => {
  it('returns empty for missing userId', async () => {
    const got = await grantForAchievementMilestone(null, 'u@e.com', 50);
    expect(got).toEqual([]);
  });

  it('returns empty for missing email', async () => {
    const got = await grantForAchievementMilestone('uid', null, 50);
    expect(got).toEqual([]);
  });

  it('returns empty for non-numeric count', async () => {
    const got = await grantForAchievementMilestone('uid', 'u@e.com', NaN);
    expect(got).toEqual([]);
  });
});

describe('grantForAchievementMilestone — failure safety', () => {
  it('returns empty when the RPC errors — atomic SQL rollback handles state', async () => {
    _state.rpcError = { code: '40001', message: 'serialization failure' };
    const got = await grantForAchievementMilestone('uid', 'u@e.com', 25);
    expect(got).toEqual([]);
    // _state.awarded is unchanged — the simulateRpc never advanced it
    // because we short-circuited on the error. This mirrors the SQL
    // transaction rolling back if any step inside the RPC fails.
    expect(_state.awarded).toBe(0);
  });

  it('returns empty when the RPC is missing (pre-071 host) — fails closed', async () => {
    _state.rpcError = { code: '42883', message: 'function does not exist' };
    const got = await grantForAchievementMilestone('uid', 'u@e.com', 25);
    expect(got).toEqual([]);
    expect(_state.awarded).toBe(0);
  });
});
