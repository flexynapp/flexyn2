import { describe, it, expect, beforeEach, vi } from 'vitest';

// leaveGym must clear user_profiles.home_gym_id when the gym being left
// IS the home gym. homeGym.js documents the invariant its set_home_gym
// RPCs hold — a home gym you aren't a member of is a home gym whose own
// leaderboard throws 42501 at you — and leaving is the other direction of
// it. The regression was silent: gym_businesses is read-all, so the gym
// card still rendered and only the two members-only reads went blank,
// both of which swallow 42501 on purpose. Nothing raised, so only a test
// asserting the SEQUENCE catches it coming back.

const _state = {
  deletes: [],
  homeGymId: null,
  authUser: { id: 'user-1' },
  // Ordered log of the two side effects, so the test can assert the
  // sequence rather than just that both happened.
  order: [],
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: _state.authUser } }) },
    from: (table) => ({
      delete: () => ({
        eq: (colA, valA) => ({
          eq: (colB, valB) => {
            _state.deletes.push({ table, [colA]: valA, [colB]: valB });
            _state.order.push('delete-membership');
            return Promise.resolve({ error: null });
          },
        }),
      }),
    }),
  },
}));

const setHomeGymMock = vi.fn(async () => {
  _state.homeGymId = null;
  _state.order.push('clear-home-gym');
  return { ok: true, gymId: null };
});

vi.mock('../homeGym', () => ({
  setHomeGym: (...a) => setHomeGymMock(...a),
  resolveHomeGymId: async () => _state.homeGymId,
}));

const { leaveGym } = await import('../gymBusinesses');

describe('leaveGym — the home-gym pointer', () => {
  beforeEach(() => {
    _state.deletes = [];
    _state.order = [];
    _state.homeGymId = null;
    _state.authUser = { id: 'user-1' };
    setHomeGymMock.mockClear();
  });

  it('clears the home gym when leaving it, before the membership row goes', async () => {
    _state.homeGymId = 'gym-a';

    const res = await leaveGym('gym-a');

    expect(res).toEqual({ ok: true });
    expect(setHomeGymMock).toHaveBeenCalledWith(null);
    // Order matters: clear the pointer, then drop the membership. The
    // reverse leaves a window where the profile points at a gym the user
    // is already not a member of — the exact state this fix removes.
    expect(_state.order).toEqual(['clear-home-gym', 'delete-membership']);
    expect(_state.deletes).toEqual([
      { table: 'gym_members', gym_id: 'gym-a', user_id: 'user-1' },
    ]);
  });

  it('leaves the home gym alone when leaving a DIFFERENT gym', async () => {
    _state.homeGymId = 'gym-a';

    const res = await leaveGym('gym-b');

    expect(res).toEqual({ ok: true });
    expect(setHomeGymMock).not.toHaveBeenCalled();
    expect(_state.deletes).toEqual([
      { table: 'gym_members', gym_id: 'gym-b', user_id: 'user-1' },
    ]);
  });

  it('does not call setHomeGym when the user has no home gym', async () => {
    _state.homeGymId = null;

    await leaveGym('gym-b');

    expect(setHomeGymMock).not.toHaveBeenCalled();
  });

  it('still leaves when the home-gym resolve throws', async () => {
    _state.homeGymId = 'gym-a';
    setHomeGymMock.mockImplementationOnce(async () => { throw new Error('offline'); });

    const res = await leaveGym('gym-a');

    // A stale pointer beats a Leave button that does nothing.
    expect(res).toEqual({ ok: true });
    expect(_state.deletes).toHaveLength(1);
  });

  it('is a no-op without a gym id or a signed-in user', async () => {
    expect(await leaveGym(null)).toEqual({ ok: false });

    _state.authUser = null;
    expect(await leaveGym('gym-a')).toEqual({ ok: false });
    expect(_state.deletes).toHaveLength(0);
  });
});
