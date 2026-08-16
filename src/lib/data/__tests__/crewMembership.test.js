// Tests for src/lib/data/crewMembership.js.
//
// The contract worth locking in is that this module has no table write path
// at all. Migration 250 revoked INSERT/UPDATE/DELETE on crew_bans,
// crew_join_requests and crew_invites from `authenticated`, so every
// mutation must go through a SECURITY DEFINER RPC that re-derives authority
// from auth.uid(). A crew id plus a user id is not a capability — that was
// the bug migration 108 shipped. If a future change adds a .from(...) here,
// these fail.
//
// Mock shape mirrors crewWars.test.js.

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
  listJoinRequests,
  decideJoinRequest,
  banMember,
  unbanMember,
  inviteToCrew,
  getInactiveMembers,
} = await import('../crewMembership');

beforeEach(() => {
  rpcSpy.mockReset();
  fromSpy.mockReset();
});

// ─────────────────────────────────────────────────────────────────────
// listJoinRequests
// ─────────────────────────────────────────────────────────────────────
describe('listJoinRequests', () => {
  it('short-circuits without a crew id', async () => {
    expect(await listJoinRequests(null)).toEqual([]);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('passes the crew id and returns the rows', async () => {
    rpcSpy.mockResolvedValue({ data: [{ user_id: 'u1' }], error: null });
    expect(await listJoinRequests('c1')).toHaveLength(1);
    expect(rpcSpy).toHaveBeenCalledWith('list_crew_join_requests', { p_crew_id: 'c1' });
  });

  it('returns [] for a non-leader — the server decides, not the client', async () => {
    // The RPC returns an empty array rather than raising, so a non-leader
    // gets nothing to probe.
    rpcSpy.mockResolvedValue({ data: [], error: null });
    expect(await listJoinRequests('c1')).toEqual([]);
  });

  it('coerces a non-array payload', async () => {
    rpcSpy.mockResolvedValue({ data: 'nope', error: null });
    expect(await listJoinRequests('c1')).toEqual([]);
  });

  it('stays quiet when migration 250 is not deployed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect(await listJoinRequests('c1')).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────
// decideJoinRequest
// ─────────────────────────────────────────────────────────────────────
describe('decideJoinRequest', () => {
  it('sends the decision as a boolean', async () => {
    rpcSpy.mockResolvedValue({ data: { status: 'approved', changed: true }, error: null });

    const res = await decideJoinRequest('c1', 'u1', 'truthy');

    expect(rpcSpy).toHaveBeenCalledWith('decide_crew_join_request', {
      p_crew_id: 'c1', p_user_id: 'u1', p_approve: true,
    });
    expect(res).toEqual({ ok: true, status: 'approved', changed: true });
  });

  it('maps a full crew to its own reason', async () => {
    // The seat can go between the request and the decision; the RPC
    // re-checks capacity under a lock rather than trusting the screen.
    rpcSpy.mockResolvedValue({ data: null, error: { code: '23514', message: 'crew_full' } });
    expect(await decideJoinRequest('c1', 'u1', true)).toEqual({ ok: false, reason: 'crew_full' });
  });

  // The RPC's ONE non-raising failure. It returns {ok:false,
  // reason:'already_in_crew'} with error null, so the `if (error)` branch
  // above never fires — and the wrapper used to hardcode ok:true, which made
  // the reviewer's screen say "Approved — they're in" while the request
  // stayed pending and no crew_members row was written. Reproduced against
  // production before fixing: two private crews, one crewless applicant,
  // second approval returned exactly this.
  it('surfaces ok:false rather than reporting a phantom success', async () => {
    rpcSpy.mockResolvedValue({ data: { ok: false, reason: 'already_in_crew' }, error: null });
    const res = await decideJoinRequest('c1', 'u1', true);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('already_in_crew');
    expect(res.changed).toBe(false);
  });

  it('still reports success when the RPC actually approved', async () => {
    rpcSpy.mockResolvedValue({ data: { ok: true, status: 'approved', changed: true }, error: null });
    expect(await decideJoinRequest('c1', 'u1', true))
      .toEqual({ ok: true, status: 'approved', changed: true });
  });

  it('defaults a missing reason rather than returning undefined', async () => {
    rpcSpy.mockResolvedValue({ data: { ok: false }, error: null });
    expect((await decideJoinRequest('c1', 'u1', true)).reason).toBe('db_error');
  });

  it('maps 42501 to not_leader', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42501', message: 'nope' } });
    expect(await decideJoinRequest('c1', 'u1', true)).toEqual({ ok: false, reason: 'not_leader' });
  });

  it('rejects without calling out when ids are missing', async () => {
    expect(await decideJoinRequest(null, 'u1', true)).toEqual({ ok: false, reason: 'missing' });
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────
// banMember
// ─────────────────────────────────────────────────────────────────────
describe('banMember', () => {
  it('truncates an over-long reason and passes ids through', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: null });
    await banMember('c1', 'u1', 'x'.repeat(500));
    const args = rpcSpy.mock.calls[0][1];
    expect(args.p_crew_id).toBe('c1');
    expect(args.p_user_id).toBe('u1');
    expect(args.p_reason).toHaveLength(200);
  });

  it('sends null rather than an empty string when no reason is given', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: null });
    await banMember('c1', 'u1');
    expect(rpcSpy.mock.calls[0][1].p_reason).toBeNull();
  });

  it('distinguishes banning a leader from banning yourself', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'cannot ban another leader' } });
    expect(await banMember('c1', 'u1')).toEqual({ ok: false, reason: 'target_is_leader' });

    rpcSpy.mockResolvedValue({ data: null, error: { message: 'cannot ban yourself' } });
    expect(await banMember('c1', 'u1')).toEqual({ ok: false, reason: 'self' });
  });

  it('never writes a table', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: null });
    await banMember('c1', 'u1', 'spam');
    expect(fromSpy).not.toHaveBeenCalled();
  });
});

describe('unbanMember', () => {
  it('reports how many bans were lifted', async () => {
    rpcSpy.mockResolvedValue({ data: { removed: 1 }, error: null });
    expect(await unbanMember('c1', 'u1')).toEqual({ ok: true, removed: 1 });
  });

  it('degrades quietly on failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    rpcSpy.mockResolvedValue({ data: null, error: { code: 'XX' } });
    expect(await unbanMember('c1', 'u1')).toEqual({ ok: false, removed: 0 });
    warn.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────
// inviteToCrew
// ─────────────────────────────────────────────────────────────────────
describe('inviteToCrew', () => {
  it('binds the invite to a named user', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: null });
    await inviteToCrew('c1', 'u1');
    // Before 250 the DM body's crew id was itself the capability. The
    // invite is now a row keyed to the invitee.
    expect(rpcSpy).toHaveBeenCalledWith('invite_to_crew', {
      p_crew_id: 'c1', p_user_id: 'u1',
    });
  });

  it('refuses to invite somebody who is banned', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { message: 'that person is banned from this crew' } });
    expect(await inviteToCrew('c1', 'u1')).toEqual({ ok: false, reason: 'banned' });
  });

  it('reports not_deployed separately so callers can stay silent', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect(await inviteToCrew('c1', 'u1')).toEqual({ ok: false, reason: 'not_deployed' });
  });
});

// ─────────────────────────────────────────────────────────────────────
// getInactiveMembers
// ─────────────────────────────────────────────────────────────────────
describe('getInactiveMembers', () => {
  it('defaults to a 21-day window', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    await getInactiveMembers('c1');
    expect(rpcSpy).toHaveBeenCalledWith('get_crew_inactive_members', {
      p_crew_id: 'c1', p_days: 21,
    });
  });

  it('passes a custom window through', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    await getInactiveMembers('c1', 45);
    expect(rpcSpy.mock.calls[0][1].p_days).toBe(45);
  });

  it('returns the rows, including never-active members', async () => {
    rpcSpy.mockResolvedValue({
      data: [{ user_id: 'u1', last_seen: null }, { user_id: 'u2', last_seen: '2026-06-01' }],
      error: null,
    });
    const rows = await getInactiveMembers('c1');
    expect(rows).toHaveLength(2);
    expect(rows[0].last_seen).toBeNull();
  });

  it('never writes a table', async () => {
    rpcSpy.mockResolvedValue({ data: [], error: null });
    await getInactiveMembers('c1');
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
