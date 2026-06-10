// Tests for the migration-173 streak write paths: recordLogin /
// recordWorkoutDay now advance streak columns via the SECURITY DEFINER
// advance_login_streak / advance_workout_streak RPCs (the 142/173
// privileged-column trigger rejects direct client writes of streak
// columns with 42501). The legacy direct UPDATE survives ONLY as the
// pre-173 fallback, gated on the RPC being confirmed-missing
// (42883 / 42P01).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { format, subDays } from 'date-fns';

const _state = {
  rpcCalls: [],     // { name, params }
  rpcResults: {},   // name -> { data, error }
  profile: null,    // staged user_profiles row for the safeSelect read
  lastUpdate: null, // captured .update(patch) — null means no direct write
  updateError: null,
  inserts: [],      // captured .insert rows (user_capsules)
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: async (name, params) => {
      _state.rpcCalls.push({ name, params });
      return _state.rpcResults[name] ?? { data: null, error: null };
    },
    from: (table) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: _state.profile, error: null }),
        }),
      }),
      update: (patch) => {
        _state.lastUpdate = { table, patch };
        return { eq: async () => ({ error: _state.updateError }) };
      },
      insert: async (row) => {
        _state.inserts.push({ table, row });
        return { error: null };
      },
    }),
  },
}));

const { recordLogin, coinsForStreakDay } = await import('../data/loginStreak');
const { recordWorkoutDay } = await import('../data/workoutStreak');

const user = { id: 'user-1', email: 'u@example.com' };
const today = () => format(new Date(), 'yyyy-MM-dd');
const yesterday = () => format(subDays(new Date(), 1), 'yyyy-MM-dd');

const rpcNames = () => _state.rpcCalls.map(c => c.name);

beforeEach(() => {
  _state.rpcCalls = [];
  _state.rpcResults = {};
  _state.profile = null;
  _state.lastUpdate = null;
  _state.updateError = null;
  _state.inserts = [];
});

describe('recordLogin — advance_login_streak RPC path', () => {
  beforeEach(() => {
    _state.profile = {
      login_streak: 3,
      last_login_date: yesterday(),
      longest_login_streak: 9,
      streak_freezes_available: 2,
      flex_coins: 100,
    };
  });

  it('adopts the server-authoritative streak and never direct-writes profile columns', async () => {
    // Server disagrees with the local +1 computation (e.g. another
    // device advanced part-way) — the RPC result must win.
    _state.rpcResults.advance_login_streak = {
      data: { is_new_day: true, streak: 7, longest: 9, freeze_used: false, freezes_remaining: 2 },
      error: null,
    };
    _state.rpcResults.increment_flex_coins = { data: null, error: null };

    const result = await recordLogin(user);

    expect(result.isNewDay).toBe(true);
    expect(result.streak).toBe(7);                       // server value, not local 4
    expect(result.coinsAwarded).toBe(coinsForStreakDay(7));
    expect(_state.lastUpdate).toBeNull();                // no direct user_profiles write
    const advance = _state.rpcCalls.find(c => c.name === 'advance_login_streak');
    expect(advance.params).toEqual({ p_today: today() });
  });

  it('no-ops when the server says today was already recorded', async () => {
    _state.rpcResults.advance_login_streak = {
      data: { is_new_day: false, streak: 5, longest: 9, freeze_used: false, freezes_remaining: 2 },
      error: null,
    };

    const result = await recordLogin(user);

    expect(result.isNewDay).toBe(false);
    expect(result.streak).toBe(5);
    expect(result.coinsAwarded).toBe(0);
    expect(_state.lastUpdate).toBeNull();
    expect(rpcNames()).not.toContain('increment_flex_coins');
  });

  it('falls back to the legacy direct UPDATE when the RPC is confirmed-missing (pre-173 host)', async () => {
    _state.rpcResults.advance_login_streak = {
      data: null,
      error: { code: '42883', message: 'function advance_login_streak does not exist' },
    };
    _state.rpcResults.increment_flex_coins = { data: null, error: null };

    const result = await recordLogin(user);

    expect(result.isNewDay).toBe(true);
    expect(result.streak).toBe(4);                       // local math: 3 + 1
    expect(_state.lastUpdate.table).toBe('user_profiles');
    expect(_state.lastUpdate.patch.login_streak).toBe(4);
    expect(_state.lastUpdate.patch.last_login_date).toBe(today());
  });

  it('does NOT attempt the direct write on any other RPC failure', async () => {
    _state.rpcResults.advance_login_streak = {
      data: null,
      error: { code: '42501', message: 'login_streak is RPC-only' },
    };

    const result = await recordLogin(user);

    expect(result.isNewDay).toBe(false);
    expect(result.streak).toBe(3);                       // unchanged current streak
    expect(_state.lastUpdate).toBeNull();
    expect(rpcNames()).not.toContain('increment_flex_coins');
  });
});

describe('recordWorkoutDay — advance_workout_streak RPC path', () => {
  beforeEach(() => {
    _state.profile = {
      workout_streak: 5,
      last_workout_date: yesterday(),
      longest_workout_streak: 9,
      flex_coins: 100,
    };
  });

  it('adopts the server-authoritative streak and never direct-writes profile columns', async () => {
    _state.rpcResults.advance_workout_streak = {
      data: { is_new_day: true, streak: 8, longest: 9 },
      error: null,
    };

    const result = await recordWorkoutDay(user);

    expect(result.isNewDay).toBe(true);
    expect(result.streak).toBe(8);                       // server value, not local 6
    expect(result.coinsAwarded).toBe(0);                 // day 8 is not a milestone
    expect(_state.lastUpdate).toBeNull();
    const advance = _state.rpcCalls.find(c => c.name === 'advance_workout_streak');
    expect(advance.params).toEqual({ p_today: today() });
  });

  it('no-ops when the server says today was already recorded', async () => {
    _state.rpcResults.advance_workout_streak = {
      data: { is_new_day: false, streak: 5, longest: 9 },
      error: null,
    };

    const result = await recordWorkoutDay(user);

    expect(result.isNewDay).toBe(false);
    expect(result.streak).toBe(5);
    expect(_state.lastUpdate).toBeNull();
  });

  it('falls back to the legacy direct UPDATE when the RPC is confirmed-missing (pre-173 host)', async () => {
    _state.rpcResults.advance_workout_streak = {
      data: null,
      error: { code: '42P01', message: 'relation does not exist' },
    };

    const result = await recordWorkoutDay(user);

    expect(result.isNewDay).toBe(true);
    expect(result.streak).toBe(6);                       // local math: 5 + 1
    expect(_state.lastUpdate.table).toBe('user_profiles');
    expect(_state.lastUpdate.patch.workout_streak).toBe(6);
    expect(_state.lastUpdate.patch.last_workout_date).toBe(today());
  });

  it('returns null and skips the direct write on any other RPC failure', async () => {
    _state.rpcResults.advance_workout_streak = {
      data: null,
      error: { code: '42501', message: 'workout_streak is RPC-only' },
    };

    const result = await recordWorkoutDay(user);

    expect(result).toBeNull();
    expect(_state.lastUpdate).toBeNull();
  });
});
