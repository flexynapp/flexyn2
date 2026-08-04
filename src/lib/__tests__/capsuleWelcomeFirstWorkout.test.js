// Unit tests for grantWelcomeCapsule + grantForFirstWorkout — the two
// client wrappers over the RPCs added in migration 277.
//
// These two grants had NEVER landed. Both went through a `_grantCapsule`
// helper that did a bare `.from('user_capsules').insert(...)`, and
// user_capsules has no INSERT policy for `authenticated` — the economy
// lockdown. Every call returned 42501, and both call sites are
// fire-and-forget with a `.catch()` that reports to Sentry and shows the
// user nothing, so a new user's welcome capsule and the first-workout
// premium + 75 coins silently never arrived.
//
// Nothing caught it. There were no tests for either function, and a test
// that mocked Supabase and asserted the insert "worked" would have passed
// while shipping exactly this bug — which is why the assertions below are
// about WHICH RPC is called and what the client does with the reply, never
// about a table write.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const _state = {
  capsuleCount: 0,
  firstWorkoutGranted: false,
  coins: 100,
  rpcError: null,
  calls: [],
};

function simulateWelcome() {
  if (_state.rpcError) return { data: null, error: _state.rpcError };
  if (_state.capsuleCount > 0) {
    return { data: { granted: false, reason: 'already_has_capsules' }, error: null };
  }
  _state.capsuleCount += 1;
  return { data: { granted: true, capsule_type: 'standard' }, error: null };
}

function simulateFirstWorkout() {
  if (_state.rpcError) return { data: null, error: _state.rpcError };
  if (_state.firstWorkoutGranted) {
    return { data: { granted: false, reason: 'already_granted' }, error: null };
  }
  _state.firstWorkoutGranted = true;
  _state.capsuleCount += 1;
  _state.coins += 75;
  return {
    data: {
      granted: true, capsule_type: 'premium', coins: 75, new_balance: _state.coins,
    },
    error: null,
  };
}

const _patched = [];
vi.mock('@/api/profileCache', () => ({
  patchProfile: (patch) => { _patched.push(patch); },
}));

vi.mock('@/api/safeSelect', () => ({ safeSelect: async () => ({ data: [], error: null }) }));

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: async (fnName) => {
      _state.calls.push(fnName);
      if (fnName === 'grant_welcome_capsule')       return simulateWelcome();
      if (fnName === 'grant_first_workout_capsule') return simulateFirstWorkout();
      return { data: null, error: { code: '42883', message: `unknown RPC: ${fnName}` } };
    },
    // Deliberately hostile: any attempt to write user_capsules from the
    // client is what this migration exists to remove, so the mock makes
    // that path fail loudly rather than quietly pass.
    from: (table) => {
      throw new Error(`client tried to query "${table}" directly — grants must use an RPC`);
    },
  },
}));

const { grantWelcomeCapsule, grantForFirstWorkout } = await import('../data/capsules');

const UID = 'user-1';
const EMAIL = 'a@b.c';

beforeEach(() => {
  _state.capsuleCount = 0;
  _state.firstWorkoutGranted = false;
  _state.coins = 100;
  _state.rpcError = null;
  _state.calls = [];
  _patched.length = 0;
});

describe('grantWelcomeCapsule', () => {
  it('goes through the RPC, never a client table write', async () => {
    await grantWelcomeCapsule(UID, EMAIL);
    expect(_state.calls).toEqual(['grant_welcome_capsule']);
  });

  it('grants once and reports it', async () => {
    await expect(grantWelcomeCapsule(UID, EMAIL)).resolves.toBe(true);
    expect(_state.capsuleCount).toBe(1);
  });

  it('is a no-op for a user who already has capsules', async () => {
    _state.capsuleCount = 3;
    await expect(grantWelcomeCapsule(UID, EMAIL)).resolves.toBe(false);
    expect(_state.capsuleCount).toBe(3);
  });

  it('returns false on a second call rather than granting twice', async () => {
    await grantWelcomeCapsule(UID, EMAIL);
    await expect(grantWelcomeCapsule(UID, EMAIL)).resolves.toBe(false);
    expect(_state.capsuleCount).toBe(1);
  });

  it('short-circuits without calling the RPC when identity is missing', async () => {
    await expect(grantWelcomeCapsule(null, EMAIL)).resolves.toBe(false);
    await expect(grantWelcomeCapsule(UID, null)).resolves.toBe(false);
    expect(_state.calls).toEqual([]);
  });

  // The old code swallowed everything. A grant that fails must reach the
  // caller so its reportError sees it — that is the only reason we would
  // ever have learned about the 42501.
  it('propagates an RPC error instead of silently reporting success', async () => {
    _state.rpcError = { code: '42501', message: 'permission denied' };
    await expect(grantWelcomeCapsule(UID, EMAIL)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('grantForFirstWorkout', () => {
  it('goes through the RPC, never a client table write', async () => {
    await grantForFirstWorkout(UID, EMAIL);
    expect(_state.calls).toEqual(['grant_first_workout_capsule']);
  });

  it('grants the premium capsule and the 75 coins once', async () => {
    await expect(grantForFirstWorkout(UID, EMAIL)).resolves.toBe(true);
    expect(_state.capsuleCount).toBe(1);
    expect(_state.coins).toBe(175);
  });

  it('is a no-op on a second call — the flag moves in the same transaction', async () => {
    await grantForFirstWorkout(UID, EMAIL);
    await expect(grantForFirstWorkout(UID, EMAIL)).resolves.toBe(false);
    expect(_state.capsuleCount).toBe(1);
    expect(_state.coins).toBe(175);
  });

  // flex_coins may only be cached from a number the SERVER returned —
  // migration 142 rejects client writes to it and 264's ledger trigger can
  // clamp a credit, so a locally-computed balance would cache a value that
  // never persisted. The RPC's new_balance is exactly that server number.
  it('caches the flag and the server-returned balance', async () => {
    await grantForFirstWorkout(UID, EMAIL);
    expect(_patched).toHaveLength(1);
    expect(_patched[0]).toEqual({
      first_workout_capsule_granted: true,
      flex_coins: 175,
    });
  });

  it('does not cache a balance the server did not return', async () => {
    // A host whose RPC predates the new_balance field must not have a
    // number invented for it.
    _state.firstWorkoutGranted = false;
    const { supabase } = await import('@/api/supabaseClient');
    const orig = supabase.rpc;
    supabase.rpc = async () => ({ data: { granted: true, capsule_type: 'premium' }, error: null });
    await grantForFirstWorkout(UID, EMAIL);
    supabase.rpc = orig;
    expect(_patched[0]).toEqual({ first_workout_capsule_granted: true });
  });

  it('writes nothing to the profile cache when the grant was a no-op', async () => {
    _state.firstWorkoutGranted = true;
    await expect(grantForFirstWorkout(UID, EMAIL)).resolves.toBe(false);
    expect(_patched).toEqual([]);
  });

  it('short-circuits without calling the RPC when identity is missing', async () => {
    await expect(grantForFirstWorkout(null, EMAIL)).resolves.toBe(false);
    expect(_state.calls).toEqual([]);
  });

  it('propagates an RPC error instead of silently reporting success', async () => {
    _state.rpcError = { code: '42501', message: 'permission denied' };
    await expect(grantForFirstWorkout(UID, EMAIL)).rejects.toMatchObject({ code: '42501' });
  });
});
