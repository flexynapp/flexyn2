// A fixed reward (regimen, recipe, meal, water) goes through grant_action_xp,
// which returns what it actually credited: the server's own amount for the
// action, less anything the daily cap held back. That number used to be
// dropped, so the regimen toast printed a constant (+100, a grant of 60)
// and kept printing it after the cap had paid nothing.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let rpcCalls = [];
let grantResult;

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: vi.fn(async (name, args) => {
      rpcCalls.push([name, args]);
      if (name === 'grant_action_xp') return grantResult;
      return { data: { new_achievements: [], unlocked_count: 0 }, error: null };
    }),
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.co' } } }),
    },
  },
}));
vi.mock('@/lib/pushCleanup', () => ({ unsubscribePushOnLogout: vi.fn() }));
vi.mock('@/lib/data/users', () => ({ selectProfiles: vi.fn() }));

const { db } = await import('../db');

const grant = () => db.functions.invoke('updateUserXpAndAchievements', {
  xp_gained: 60, action_type: 'regimen_created',
});

describe('updateUserXpAndAchievements, fixed rewards', () => {
  beforeEach(() => { rpcCalls = []; });

  it('reports what the server credited', async () => {
    grantResult = { data: 60, error: null };
    const res = await grant();
    expect(rpcCalls[0]).toEqual(['grant_action_xp', { p_action_type: 'regimen_created', p_xp: 60 }]);
    expect(res.xp_awarded).toBe(60);
  });

  it('reports a capped grant as the smaller amount, not the one asked for', async () => {
    grantResult = { data: 20, error: null };
    expect((await grant()).xp_awarded).toBe(20);
  });

  it('reports zero when the grant failed', async () => {
    grantResult = { data: null, error: { message: 'boom' } };
    expect((await grant()).xp_awarded).toBe(0);
  });
});
