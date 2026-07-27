// Tests for src/lib/data/crewWars.js.
//
// The interesting contract is what this module is NOT allowed to do any
// more. Migration 247 revoked INSERT/UPDATE/DELETE on crew_wars and
// crew_war_contributions from `authenticated`, because the old
// "crew_wars_update" RLS policy let any member of either crew write
// crew_a_score straight from the browser and skip migration 180's clamp.
// So every mutation here has to go through an RPC, and the legacy
// read-modify-write fallback that used to sit under contributeWarXp must
// stay deleted. These tests fail loudly if it ever comes back.
//
// Mock shape mirrors crewChallenges.test.js.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy  = vi.fn();
const fromSpy = vi.fn();

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc:  (...args) => rpcSpy(...args),
    from: (...args) => fromSpy(...args),
    auth: { getUser: vi.fn() },
  },
}));

const {
  contributeWarXp,
  joinWarMatchmaking,
  leaveWarMatchmaking,
  getQueuedWarForCrew,
  getWarScore,
  getOpponentScore,
  getOpponentCrewId,
  isWarWinner,
} = await import('../crewWars');

beforeEach(() => {
  rpcSpy.mockReset();
  fromSpy.mockReset();
});

// ─────────────────────────────────────────────────────────────────────
// contributeWarXp — RPC only, no table writes
// ─────────────────────────────────────────────────────────────────────

describe('contributeWarXp', () => {
  it('routes through the atomic RPC and never writes a table', async () => {
    rpcSpy.mockResolvedValueOnce({ error: null });

    await contributeWarXp('war-1', 'crew-1', 120);

    expect(rpcSpy).toHaveBeenCalledWith('contribute_crew_war_xp', {
      p_war_id:  'war-1',
      p_crew_id: 'crew-1',
      p_xp:      120,
    });
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('floors a fractional XP amount before sending it', async () => {
    rpcSpy.mockResolvedValueOnce({ error: null });
    await contributeWarXp('war-1', 'crew-1', 99.9);
    expect(rpcSpy.mock.calls[0][1].p_xp).toBe(99);
  });

  it('does NOT fall back to a direct table write when the RPC fails', async () => {
    // 42883 used to trigger the legacy read-modify-write path. Under 247
    // that path can only 403, and silently "succeeding" would hide a
    // broken deploy.
    rpcSpy.mockResolvedValueOnce({ error: { code: '42883', message: 'missing' } });

    await contributeWarXp('war-1', 'crew-1', 50);

    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('ignores non-positive and missing inputs without calling out', async () => {
    await contributeWarXp('war-1', 'crew-1', 0);
    await contributeWarXp('war-1', 'crew-1', -10);
    await contributeWarXp(null, 'crew-1', 10);
    await contributeWarXp('war-1', null, 10);
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// joinWarMatchmaking / leaveWarMatchmaking
// ─────────────────────────────────────────────────────────────────────

describe('joinWarMatchmaking', () => {
  it('calls the leader-gated RPC with only the crew id', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { status: 'queued', war_id: 'w1' }, error: null });

    const res = await joinWarMatchmaking('crew-1');

    expect(rpcSpy).toHaveBeenCalledWith('join_crew_war_queue', { p_crew_id: 'crew-1' });
    expect(fromSpy).not.toHaveBeenCalled();
    expect(res).toEqual({ status: 'queued', warId: 'w1' });
  });

  it('surfaces the matched result when the RPC pairs on arrival', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { status: 'matched', war_id: 'w9' }, error: null });
    expect(await joinWarMatchmaking('crew-1')).toEqual({ status: 'matched', warId: 'w9' });
  });

  it('defaults to queued when the server omits a status', async () => {
    rpcSpy.mockResolvedValueOnce({ data: {}, error: null });
    expect(await joinWarMatchmaking('crew-1')).toEqual({ status: 'queued', warId: null });
  });

  it('throws on an RPC error so the UI can show why', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'only a crew leader can enter matchmaking' },
    });
    await expect(joinWarMatchmaking('crew-1')).rejects.toMatchObject({ code: '42501' });
  });

  it('throws without a crew id', async () => {
    await expect(joinWarMatchmaking(null)).rejects.toThrow();
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

describe('leaveWarMatchmaking', () => {
  it('calls the RPC and reports how many entries went', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { ok: true, removed: 1 }, error: null });

    const res = await leaveWarMatchmaking('crew-1');

    expect(rpcSpy).toHaveBeenCalledWith('leave_crew_war_queue', { p_crew_id: 'crew-1' });
    expect(res).toEqual({ ok: true, removed: 1 });
  });

  it('degrades quietly on failure', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    expect(await leaveWarMatchmaking('crew-1')).toEqual({ ok: false, removed: 0 });
  });
});

// ─────────────────────────────────────────────────────────────────────
// getQueuedWarForCrew — read shape
// ─────────────────────────────────────────────────────────────────────

describe('getQueuedWarForCrew', () => {
  function mockQueueQuery({ data, error }) {
    const maybeSingle = vi.fn().mockResolvedValue({ data, error });
    const limit  = vi.fn().mockReturnValue({ maybeSingle });
    const order  = vi.fn().mockReturnValue({ limit });
    const is     = vi.fn().mockReturnValue({ order });
    const eq2    = vi.fn().mockReturnValue({ is });
    const eq1    = vi.fn().mockReturnValue({ eq: eq2 });
    const select = vi.fn().mockReturnValue({ eq: eq1 });
    fromSpy.mockReturnValue({ select });
    return { eq1, eq2, is };
  }

  it('filters to this crew, matchmaking status, and an unpaired slot', async () => {
    const { eq1, eq2, is } = mockQueueQuery({ data: { id: 'w1' }, error: null });

    const row = await getQueuedWarForCrew('crew-1');

    expect(fromSpy).toHaveBeenCalledWith('crew_wars');
    expect(eq1).toHaveBeenCalledWith('crew_a_id', 'crew-1');
    expect(eq2).toHaveBeenCalledWith('status', 'matchmaking');
    expect(is).toHaveBeenCalledWith('crew_b_id', null);
    expect(row).toEqual({ id: 'w1' });
  });

  it('returns null for a falsy crew id and on error', async () => {
    expect(await getQueuedWarForCrew(null)).toBeNull();
    expect(fromSpy).not.toHaveBeenCalled();

    mockQueueQuery({ data: null, error: { code: 'XX' } });
    expect(await getQueuedWarForCrew('crew-1')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pure scoring helpers
// ─────────────────────────────────────────────────────────────────────

describe('scoring helpers', () => {
  const war = {
    crew_a_id: 'a', crew_b_id: 'b',
    crew_a_score: 300, crew_b_score: 120,
    winner_crew_id: 'a',
  };

  it('reads my score and my opponent\'s from either side', () => {
    expect(getWarScore(war, 'a')).toBe(300);
    expect(getWarScore(war, 'b')).toBe(120);
    expect(getOpponentScore(war, 'a')).toBe(120);
    expect(getOpponentScore(war, 'b')).toBe(300);
  });

  it('resolves the opponent crew id', () => {
    expect(getOpponentCrewId(war, 'a')).toBe('b');
    expect(getOpponentCrewId(war, 'b')).toBe('a');
  });

  it('reports the winner from the server-written column only', () => {
    expect(isWarWinner(war, 'a')).toBe(true);
    expect(isWarWinner(war, 'b')).toBe(false);
  });

  it('degrades to 0 / null on missing input', () => {
    expect(getWarScore(null, 'a')).toBe(0);
    expect(getOpponentScore(war, null)).toBe(0);
    expect(getOpponentCrewId(null, 'a')).toBeNull();
  });
});
