// transferLeadership — src/lib/data/crews.js
//
// Handing over a crew is two writes that must not be two requests. The
// old leader steps down and the new one steps up, and migration 357's
// guard trigger refuses any demotion that would leave the crew with zero
// leaders — so a client doing this as two calls would either be rejected
// halfway or leave the crew briefly leaderless depending on the order it
// chose. The whole point of the RPC is that the client cannot choose.
//
// These tests pin the shape of the call and the error codes the UI
// branches on. The server behaviour itself was verified against
// production in a rolled-back transaction (migration 359's header).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy  = vi.fn();
const fromSpy = vi.fn();

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc:  (...a) => rpcSpy(...a),
    from: (...a) => fromSpy(...a),
    auth: { getUser: vi.fn() },
  },
}));
vi.mock('@/api/safeSelect', () => ({ safeSelect: async () => ({ data: [], error: null }) }));
vi.mock('@/lib/data/users', () => ({ selectProfiles: async () => ({ data: [] }) }));
vi.mock('@/api/db', () => ({ db: { entities: {} } }));
vi.mock('@/lib/imageCompress', () => ({ compressImage: async (f) => f }));
vi.mock('@/lib/profanityFilter', () => ({ containsProfanity: () => false }));

const { transferLeadership } = await import('../crews');

beforeEach(() => {
  rpcSpy.mockReset();
  fromSpy.mockReset();
});

describe('transferLeadership', () => {
  it('goes through the RPC and touches no table directly', async () => {
    rpcSpy.mockResolvedValue({ data: { ok: true, new_leader: 'u2' }, error: null });

    const res = await transferLeadership('c1', 'u2');

    expect(rpcSpy).toHaveBeenCalledWith('transfer_crew_leadership', {
      p_crew_id: 'c1',
      p_to_user: 'u2',
    });
    // Two client UPDATEs would be refused halfway by 357's guard.
    expect(fromSpy).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true, newLeader: 'u2' });
  });

  it('falls back to the requested id when the RPC omits new_leader', async () => {
    rpcSpy.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await transferLeadership('c1', 'u2')).toEqual({ ok: true, newLeader: 'u2' });
  });

  it('surfaces 42501 when the caller is not the leader', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'only a crew leader can hand over the crew' },
    });
    await expect(transferLeadership('c1', 'u2')).rejects.toMatchObject({ code: '42501' });
  });

  it('surfaces 22023 when the target is not in the crew', async () => {
    rpcSpy.mockResolvedValue({
      data: null,
      error: { code: '22023', message: 'that person is not in this crew' },
    });
    await expect(transferLeadership('c1', 'nobody')).rejects.toMatchObject({ code: '22023' });
  });

  it('does not swallow an unexpected failure', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { code: '08006', message: 'connection lost' } });
    await expect(transferLeadership('c1', 'u2')).rejects.toMatchObject({ code: '08006' });
  });
});
