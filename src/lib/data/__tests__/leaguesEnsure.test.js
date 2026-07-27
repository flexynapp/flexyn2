// Tests for ensureCurrentLeague in src/lib/data/leagues.js.
//
// The point of these is less "does it return a league" and more "does it
// still refuse to touch the leaderboard tables directly". The old
// implementation INSERTed into `leagues` from the browser, which returned
// 403 on every call because that table grants authenticated SELECT only
// and has no RLS insert policy — both locks deliberate, because a
// `leagues` row is a competition bracket that pays out rewards.
// Migration 242 moved the whole find-or-create-and-join into the
// ensure_my_league RPC. `fromSpy` exists so a future refactor that
// reintroduces a direct table write fails loudly here.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy = vi.fn();
const fromSpy = vi.fn();

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => rpcSpy(...args),
    from: (...args) => {
      fromSpy(...args);
      const chain = {
        select: () => chain,
        insert: () => chain,
        eq: () => chain,
        order: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
        limit: () => Promise.resolve({ data: [], error: null }),
      };
      return chain;
    },
  },
}));

vi.mock('./notifications', () => ({ notifyLeagueResolution: vi.fn() }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const { ensureCurrentLeague } = await import('../leagues');

const USER = { id: 'u1', email: 'me@example.com' };

beforeEach(() => {
  rpcSpy.mockReset();
  fromSpy.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('ensureCurrentLeague', () => {
  it('returns null without a user id, without calling the RPC', async () => {
    expect(await ensureCurrentLeague(null)).toBeNull();
    expect(await ensureCurrentLeague({})).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('goes through the ensure_my_league RPC', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: { league: { id: 'l1', tier: 'bronze' }, member: { id: 'm1', weekly_xp: 0 } },
      error: null,
    });
    const res = await ensureCurrentLeague(USER);
    expect(rpcSpy).toHaveBeenCalledWith('ensure_my_league');
    expect(res).toEqual({ league: { id: 'l1', tier: 'bronze' }, member: { id: 'm1', weekly_xp: 0 } });
  });

  it('passes NO arguments — tier and week are server-decided', async () => {
    // A client-passed tier would let anyone drop into Legend; a
    // client-passed week would let anyone join a resolved bracket.
    rpcSpy.mockResolvedValueOnce({
      data: { league: { id: 'l1' }, member: { id: 'm1' } },
      error: null,
    });
    await ensureCurrentLeague(USER);
    expect(rpcSpy.mock.calls[0]).toEqual(['ensure_my_league']);
  });

  it('never writes to leagues or league_members directly', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: { league: { id: 'l1' }, member: { id: 'm1' } },
      error: null,
    });
    await ensureCurrentLeague(USER);
    const tablesTouched = fromSpy.mock.calls.map(c => c[0]);
    expect(tablesTouched).not.toContain('leagues');
    expect(tablesTouched).not.toContain('league_members');
  });

  it('returns null and does not throw when the RPC errors', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'denied' } });
    expect(await ensureCurrentLeague(USER)).toBeNull();
  });

  it('returns null on a malformed payload rather than a half-built object', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { league: { id: 'l1' } }, error: null });
    expect(await ensureCurrentLeague(USER)).toBeNull();

    rpcSpy.mockResolvedValueOnce({ data: null, error: null });
    expect(await ensureCurrentLeague(USER)).toBeNull();
  });

  it('works for a user with no email on the client object', async () => {
    // Guest sessions carry a synthetic profile email the client may not
    // have; the RPC resolves identity itself via current_user_email().
    rpcSpy.mockResolvedValueOnce({
      data: { league: { id: 'l1' }, member: { id: 'm1' } },
      error: null,
    });
    const res = await ensureCurrentLeague({ id: 'u1' });
    expect(res).not.toBeNull();
    expect(rpcSpy).toHaveBeenCalledWith('ensure_my_league');
  });
});
