// Unit tests for the achievement-milestone capsule grant logic.
//
// We test the milestone SCHEDULE itself (pure data) plus the idempotent
// grant behavior by mocking the supabase client. The integration paths
// (db.js _invokeXp + leaderboardStats backfill) are tested separately
// via the full app — what matters here is that the math is right and
// repeated calls don't double-grant.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase BEFORE importing the module so the import picks up the mock.
const _state = {
  awarded: 0,           // milestone_capsules_awarded
  insertedCapsules: [], // list of capsule_type values inserted
  insertError: null,    // optional error to throw on next insert
  updateError: null,    // optional error to throw on update
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'user_profiles') {
              return { data: { milestone_capsules_awarded: _state.awarded }, error: null };
            }
            return { data: null, error: null };
          },
        }),
      }),
      insert: async (row) => {
        if (_state.insertError) return { error: _state.insertError };
        if (table === 'user_capsules') {
          _state.insertedCapsules.push(row.capsule_type);
        }
        return { error: null };
      },
      update: (patch) => ({
        eq: async () => {
          if (_state.updateError) return { error: _state.updateError };
          if (table === 'user_profiles' && Number.isFinite(patch.milestone_capsules_awarded)) {
            _state.awarded = patch.milestone_capsules_awarded;
          }
          return { error: null };
        },
      }),
    }),
  },
}));

// Now we can import the module under test.
const { grantForAchievementMilestone, ACHIEVEMENT_MILESTONES } = await import('../data/capsules');

beforeEach(() => {
  _state.awarded = 0;
  _state.insertedCapsules = [];
  _state.insertError = null;
  _state.updateError = null;
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
});

describe('grantForAchievementMilestone — first-time grants', () => {
  it('grants nothing below the first threshold', async () => {
    const got = await grantForAchievementMilestone('uid', 'u@e.com', 4);
    expect(got).toEqual([]);
    expect(_state.insertedCapsules).toEqual([]);
    expect(_state.awarded).toBe(0);
  });

  it('grants one standard at exactly 5 achievements', async () => {
    const got = await grantForAchievementMilestone('uid', 'u@e.com', 5);
    expect(got).toHaveLength(1);
    expect(got[0].type).toBe('standard');
    expect(_state.insertedCapsules).toEqual(['standard']);
    expect(_state.awarded).toBe(1);
  });

  it('grants both standards if user jumps from 0 → 10 directly', async () => {
    const got = await grantForAchievementMilestone('uid', 'u@e.com', 10);
    expect(got.map(m => m.type)).toEqual(['standard', 'standard']);
    expect(_state.insertedCapsules).toEqual(['standard', 'standard']);
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
    expect(_state.insertedCapsules).toHaveLength(3); // unchanged
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
    expect(_state.insertedCapsules).toEqual([]);
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
  it('does NOT bump the counter if no insert succeeded', async () => {
    _state.insertError = new Error('rls denied');
    const got = await grantForAchievementMilestone('uid', 'u@e.com', 25);
    expect(got).toEqual([]);
    expect(_state.awarded).toBe(0); // counter not bumped — next call can retry
  });

  it('only bumps the counter by the number actually inserted on partial failure', async () => {
    // Allow first insert, fail subsequent ones.
    let calls = 0;
    _state.insertError = null;
    const origMockState = _state;
    // Override insert behavior just for this test
    const supabaseModule = await import('@/api/supabaseClient');
    const origFrom = supabaseModule.supabase.from;
    supabaseModule.supabase.from = (table) => {
      const base = origFrom.call(supabaseModule.supabase, table);
      if (table === 'user_capsules') {
        return {
          ...base,
          insert: async (row) => {
            calls += 1;
            if (calls === 1) {
              origMockState.insertedCapsules.push(row.capsule_type);
              return { error: null };
            }
            return { error: new Error('flaky network') };
          },
        };
      }
      return base;
    };

    const got = await grantForAchievementMilestone('uid', 'u@e.com', 25);
    expect(got).toHaveLength(1);
    expect(_state.awarded).toBe(1);

    // Restore
    supabaseModule.supabase.from = origFrom;
  });
});
