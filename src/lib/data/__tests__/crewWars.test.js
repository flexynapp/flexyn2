// Tests for src/lib/data/crewWars.js.
//
// The interesting contract is what this module is NOT allowed to do any
// more. Migration 247 revoked INSERT/UPDATE/DELETE on crew_wars and
// crew_war_contributions from `authenticated`, because the old
// "crew_wars_update" RLS policy let any member of either crew write
// crew_a_score straight from the browser and skip migration 180's clamp.
// So every mutation here has to go through an RPC, and the legacy
// read-modify-write fallback that used to sit under the old contribute
// call must stay deleted. Migration 249 went further and removed the
// client-supplied number entirely: scoring is now recomputed server-side
// from workout_logs, so the sync RPC takes no arguments. These tests fail
// loudly if either property is ever given back.
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
  syncMyCrewWarProgress,
  getWarBreakdown,
  crewWarScore,
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
// syncMyCrewWarProgress — argument-free, server-derived
// ─────────────────────────────────────────────────────────────────────

describe('syncMyCrewWarProgress', () => {
  it('calls the RPC with no arguments at all', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { wars: 2 }, error: null });

    const res = await syncMyCrewWarProgress();

    // The whole point of migration 249: the client sends no numbers, so
    // there is nothing for a crafted client to inflate. If a future change
    // reintroduces a params object here, that property is gone.
    expect(rpcSpy).toHaveBeenCalledWith('sync_my_crew_war_progress');
    expect(rpcSpy.mock.calls[0]).toHaveLength(1);
    expect(res).toEqual({ ok: true, wars: 2 });
  });

  it('never writes a table', async () => {
    rpcSpy.mockResolvedValueOnce({ data: { wars: 1 }, error: null });
    await syncMyCrewWarProgress();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('defaults a missing war count rather than propagating undefined', async () => {
    rpcSpy.mockResolvedValueOnce({ data: {}, error: null });
    expect(await syncMyCrewWarProgress()).toEqual({ ok: true, wars: 0 });
  });

  it('stays quiet when migration 249 is not deployed yet', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const code of ['42883', '42P01']) {
      rpcSpy.mockResolvedValueOnce({ data: null, error: { code } });
      expect(await syncMyCrewWarProgress()).toEqual({ ok: false, reason: 'db_error' });
    }
    // The hourly recompute cron still settles the score, so a missing RPC
    // during the deploy window is expected rather than a defect.
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('maps 42501 to unauthenticated and warns on real failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rpcSpy.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    expect(await syncMyCrewWarProgress()).toEqual({ ok: false, reason: 'unauthenticated' });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────
// crewWarScore — must match _crew_war_score in migration 249
// ─────────────────────────────────────────────────────────────────────

describe('crewWarScore', () => {
  it('blends volume, sessions and days the way the server does', () => {
    // floor(20000/100) + 4*50 + 3*100 = 200 + 200 + 300
    expect(crewWarScore({ volume_lbs: 20000, sessions: 4, days_active: 3 })).toBe(700);
  });

  it('weights consistency above raw tonnage', () => {
    // The product goal: six people training often beat one XP farmer.
    const grinder   = crewWarScore({ volume_lbs: 40000, sessions: 2, days_active: 1 });
    const consistent = crewWarScore({ volume_lbs: 12000, sessions: 6, days_active: 6 });
    expect(consistent).toBeGreaterThan(grinder);
  });

  it('applies the same per-member ceilings as the server', () => {
    const huge = crewWarScore({ volume_lbs: 9e9, sessions: 999, days_active: 999 });
    // 200000/100 + 28*50 + 7*100 = 2000 + 1400 + 700
    expect(huge).toBe(4100);
  });

  it('floors negatives and junk to zero', () => {
    expect(crewWarScore({ volume_lbs: -5, sessions: -2, days_active: -1 })).toBe(0);
    expect(crewWarScore({})).toBe(0);
    expect(crewWarScore()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// getWarBreakdown
// ─────────────────────────────────────────────────────────────────────

describe('getWarBreakdown', () => {
  it('short-circuits on a falsy war id', async () => {
    expect(await getWarBreakdown(null)).toBeNull();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('normalises the payload and passes the war id through', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: {
        war_id: 'war-1',
        my_crew_id: 'crew-1',
        totals: [{ crew_id: 'crew-1', score: 700 }],
        members: [{ user_id: 'u1', score: 700 }],
      },
      error: null,
    });

    const res = await getWarBreakdown('war-1');

    expect(rpcSpy).toHaveBeenCalledWith('get_crew_war_breakdown', { p_war_id: 'war-1' });
    expect(res.myCrewId).toBe('crew-1');
    expect(res.totals).toHaveLength(1);
    expect(res.members).toHaveLength(1);
  });

  it('coerces non-array totals/members rather than propagating them', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: { war_id: 'w', my_crew_id: 'c', totals: null, members: 'nope' },
      error: null,
    });
    const res = await getWarBreakdown('w');
    expect(res.totals).toEqual([]);
    expect(res.members).toEqual([]);
  });

  it('returns null when the caller is not in either crew', async () => {
    // The RPC returns SQL NULL for a non-participant.
    rpcSpy.mockResolvedValueOnce({ data: null, error: null });
    expect(await getWarBreakdown('war-1')).toBeNull();
  });

  it('never writes a table', async () => {
    rpcSpy.mockResolvedValueOnce({ data: null, error: null });
    await getWarBreakdown('war-1');
    expect(fromSpy).not.toHaveBeenCalled();
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
