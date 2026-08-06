import { describe, it, expect, beforeEach, vi } from 'vitest';

// Chainable supabase mock. The interesting surface here is RPC, not
// query building — three of the five exports are pure RPC wrappers — so
// this stages rpc() responses by name and records what was sent.
const _state = {
  rpcCalls: [],
  rpcResponses: {},
  tableRows: {},
  lastSelect: null,
  authUser: { id: 'user-1' },
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: async (name, args) => {
      _state.rpcCalls.push({ name, args });
      const staged = _state.rpcResponses[name];
      if (!staged) return { data: null, error: null };
      return staged;
    },
    auth: {
      getUser: async () => ({ data: { user: _state.authUser } }),
    },
    from: (table) => ({
      select: (cols) => {
        _state.lastSelect = cols;
        return {
          eq: () => ({
            maybeSingle: async () => _state.tableRows[table]
              ?? { data: null, error: null },
          }),
        };
      },
    }),
  },
}));

const patchProfileMock = vi.fn();
const getProfileMock = vi.fn(() => null);

vi.mock('@/api/profileCache', () => ({
  patchProfile: (...a) => patchProfileMock(...a),
  getProfile: (...a) => getProfileMock(...a),
}));

const reportErrorMock = vi.fn();
vi.mock('@/lib/reportError', () => ({
  reportError: (...a) => reportErrorMock(...a),
}));

import {
  setHomeGym, setHomeGymFromOsm, setHomeGymCustom, getCommunityProgress,
  getGymConsistencyBoard, resolveHomeGymId,
} from '../homeGym';

beforeEach(() => {
  _state.rpcCalls = [];
  _state.rpcResponses = {};
  _state.tableRows = {};
  _state.authUser = { id: 'user-1' };
  patchProfileMock.mockClear();
  getProfileMock.mockReturnValue(null);
  reportErrorMock.mockClear();
});

describe('setHomeGym', () => {
  it('patches the profile cache on success', async () => {
    _state.rpcResponses.set_home_gym = {
      data: { ok: true, gym_id: 'gym-9' }, error: null,
    };

    const res = await setHomeGym('gym-9');

    expect(res).toEqual({ ok: true, gymId: 'gym-9' });
    // The whole point of the profile-cache rule in CLAUDE.md: an RPC
    // that writes user_profiles must patch the module cache, or
    // db.auth.me() keeps handing back a row without the home gym.
    expect(patchProfileMock).toHaveBeenCalledWith({ home_gym_id: 'gym-9' });
  });

  it('does NOT patch the cache when the RPC reports failure', async () => {
    _state.rpcResponses.set_home_gym = {
      data: { ok: false, error: 'GYM_INACTIVE' }, error: null,
    };

    const res = await setHomeGym('gym-9');

    expect(res).toEqual({ ok: false, error: 'GYM_INACTIVE' });
    // Caching a value the server rejected is worse than being stale —
    // the UI would show a home gym that does not exist server-side.
    expect(patchProfileMock).not.toHaveBeenCalled();
  });

  it('passes null through to clear the home gym', async () => {
    _state.rpcResponses.set_home_gym = {
      data: { ok: true, gym_id: null, cleared: true }, error: null,
    };

    const res = await setHomeGym(null);

    expect(_state.rpcCalls[0].args).toEqual({ p_gym_id: null });
    expect(res).toEqual({ ok: true, gymId: null });
    expect(patchProfileMock).toHaveBeenCalledWith({ home_gym_id: null });
  });
});

describe('setHomeGymFromOsm', () => {
  it('sends osmType through so node/way ids cannot collide', async () => {
    _state.rpcResponses.set_home_gym_from_osm = {
      data: { ok: true, gym_id: 'gym-new', created: true }, error: null,
    };

    const res = await setHomeGymFromOsm({
      osmId: 123, osmType: 'way', name: 'Iron Works', lat: 40.1, lon: -74.2,
    });

    expect(res).toEqual({ ok: true, gymId: 'gym-new', created: true });
    // OSM ids are unique only WITHIN a type. Dropping the type would let
    // node/123 and way/123 — different places — share one gym row and
    // therefore one leaderboard. Mig 275 keys on (osm_type, osm_id).
    expect(_state.rpcCalls[0].args).toMatchObject({
      p_osm_type: 'way', p_osm_id: 123, p_name: 'Iron Works',
      p_lat: 40.1, p_lng: -74.2,
    });
  });

  it("defaults osmType to node when Overpass didn't supply one", async () => {
    _state.rpcResponses.set_home_gym_from_osm = {
      data: { ok: true, gym_id: 'g', created: false }, error: null,
    };

    await setHomeGymFromOsm({ osmId: 7, name: 'X', lat: 1, lon: 2 });

    expect(_state.rpcCalls[0].args.p_osm_type).toBe('node');
  });

  it('maps the profanity trigger 23514 to NAME_REJECTED', async () => {
    _state.rpcResponses.set_home_gym_from_osm = {
      data: null, error: { code: '23514', message: 'gym_name_profanity' },
    };

    const res = await setHomeGymFromOsm({
      osmId: 5, osmType: 'node', name: 'bad', lat: 1, lon: 2,
    });

    // Distinct from a generic failure so the UI can say "this gym can't
    // be added" rather than inviting an infinite retry.
    expect(res).toEqual({ ok: false, error: 'NAME_REJECTED' });
    expect(patchProfileMock).not.toHaveBeenCalled();
  });

  it('rejects a payload with no osm id without calling the RPC', async () => {
    const res = await setHomeGymFromOsm({ name: 'X', lat: 1, lon: 2 });

    expect(res).toEqual({ ok: false, error: 'BAD_OSM_ID' });
    expect(_state.rpcCalls).toHaveLength(0);
  });
});

describe('getCommunityProgress', () => {
  it('normalises the RPC row to numbers', async () => {
    _state.rpcResponses.get_gym_community_progress = {
      data: [{
        member_count: '12', active_members: '5', workout_count: '31',
        total_volume: '84210.5', active_days: '18',
      }],
      error: null,
    };

    const res = await getCommunityProgress('gym-1');

    // Postgres BIGINT/NUMERIC arrive as strings over PostgREST; the
    // progress bar does arithmetic on these, and '12' / '5' would
    // concatenate rather than divide.
    expect(res).toEqual({
      memberCount: 12, activeMembers: 5, workoutCount: 31,
      totalVolume: 84210.5, activeDays: 18,
    });
  });

  it('returns null and stays silent on the membership gate', async () => {
    _state.rpcResponses.get_gym_community_progress = {
      data: null, error: { code: '42501', message: 'not a member' },
    };

    const res = await getCommunityProgress('gym-1');

    expect(res).toBeNull();
    // 42501 is the expected gate for a non-member, not a defect. Paging
    // Sentry for it would bury real errors in noise.
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('reports genuine errors', async () => {
    _state.rpcResponses.get_gym_community_progress = {
      data: null, error: { code: '500', message: 'boom' },
    };

    expect(await getCommunityProgress('gym-1')).toBeNull();
    expect(reportErrorMock).toHaveBeenCalled();
  });
});

describe('getGymConsistencyBoard', () => {
  it('returns [] rather than throwing when the gate rejects', async () => {
    _state.rpcResponses.get_gym_consistency_leaderboard = {
      data: null, error: { code: '42501' },
    };

    expect(await getGymConsistencyBoard('gym-1')).toEqual([]);
    expect(reportErrorMock).not.toHaveBeenCalled();
  });
});

describe('resolveHomeGymId', () => {
  it('trusts the passed-in context value without querying', async () => {
    expect(await resolveHomeGymId('gym-ctx')).toBe('gym-ctx');
    expect(_state.lastSelect).toBeNull();
  });

  it('falls back to the profile cache when context is stale', async () => {
    getProfileMock.mockReturnValue({ home_gym_id: 'gym-cached' });

    // Straight after onboarding, AuthContext still holds the pre-pick
    // profile while patchProfile has already recorded the new gym.
    // Reading only the context renders "you haven't picked a gym yet"
    // at someone who picked one a minute ago.
    expect(await resolveHomeGymId(null)).toBe('gym-cached');
    expect(_state.lastSelect).toBeNull();
  });

  it('queries user_profiles as the last resort', async () => {
    _state.tableRows.user_profiles = {
      data: { home_gym_id: 'gym-db' }, error: null,
    };

    expect(await resolveHomeGymId(undefined)).toBe('gym-db');
    expect(_state.lastSelect).toBe('home_gym_id');
  });

  it('returns null when signed out', async () => {
    _state.authUser = null;

    expect(await resolveHomeGymId(null)).toBeNull();
  });
});

describe('setHomeGymCustom', () => {
  // The path for a gym OpenStreetMap has never heard of (mig 299).
  // setHomeGymFromOsm keys on (osm_type, osm_id), so before this a user
  // whose gym isn't mapped had no route to a home gym at all — and no
  // search radius can reach a place that isn't in the dataset.

  it('sends the typed name and the caller\'s own coordinates', async () => {
    _state.rpcResponses.set_home_gym_custom = {
      data: { ok: true, gym_id: 'gym-new', created: true }, error: null,
    };

    const res = await setHomeGymCustom({
      name: '  Planet Fitness Sanford  ', lat: 43.4387179, lng: -70.7746224,
    });

    expect(res).toEqual({ ok: true, gymId: 'gym-new', created: true });
    expect(_state.rpcCalls[0]).toEqual({
      name: 'set_home_gym_custom',
      args: {
        p_name: 'Planet Fitness Sanford',
        p_lat: 43.4387179,
        p_lng: -70.7746224,
        p_city: null,
        p_state: null,
      },
    });
    expect(patchProfileMock).toHaveBeenCalledWith({ home_gym_id: 'gym-new' });
  });

  it('reports created:false when the RPC reused an existing gym', async () => {
    // Two people at the same gym must land on ONE row, or the
    // leaderboard splits in half and neither half sees the other.
    _state.rpcResponses.set_home_gym_custom = {
      data: { ok: true, gym_id: 'gym-shared', created: false }, error: null,
    };

    expect(await setHomeGymCustom({ name: 'The Gym', lat: 43.4, lng: -70.7 }))
      .toEqual({ ok: true, gymId: 'gym-shared', created: false });
  });

  it('rejects a too-short name without calling the RPC', async () => {
    expect(await setHomeGymCustom({ name: 'X', lat: 43.4, lng: -70.7 }))
      .toEqual({ ok: false, error: 'NAME_REQUIRED' });
    expect(_state.rpcCalls).toHaveLength(0);
  });

  it('rejects a missing fix without calling the RPC', async () => {
    // A gym with no coordinates cannot be placed on the map, and the RPC
    // rejects it anyway — no reason to spend the round trip.
    expect(await setHomeGymCustom({ name: 'Real Gym', lat: undefined, lng: -70.7 }))
      .toEqual({ ok: false, error: 'BAD_COORDS' });
    expect(_state.rpcCalls).toHaveLength(0);
  });

  it('surfaces the profanity trigger as NAME_REJECTED', async () => {
    // 23514 is mig 158's check. Its own code so the UI can say something
    // better than "try again" about a name it will never accept.
    _state.rpcResponses.set_home_gym_custom = {
      data: null, error: { code: '23514', message: 'violates check constraint' },
    };

    expect(await setHomeGymCustom({ name: 'a bad name', lat: 43.4, lng: -70.7 }))
      .toEqual({ ok: false, error: 'NAME_REJECTED' });
    expect(patchProfileMock).not.toHaveBeenCalled();
  });

  it('passes the server\'s own error code through', async () => {
    _state.rpcResponses.set_home_gym_custom = {
      data: { ok: false, error: 'CREATE_LIMIT' }, error: null,
    };

    expect(await setHomeGymCustom({ name: 'Gym 21', lat: 43.4, lng: -70.7 }))
      .toEqual({ ok: false, error: 'CREATE_LIMIT' });
    expect(patchProfileMock).not.toHaveBeenCalled();
  });
});
