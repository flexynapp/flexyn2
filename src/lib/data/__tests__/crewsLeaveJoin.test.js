// Tests for the one-crew-per-user rule and leaving (migration 252).
//
// The rule is enforced in two places on the server: a BEFORE INSERT trigger
// on crew_members (the catch-all, because createCrew inserts the membership
// row directly rather than through an RPC) and an explicit check inside
// join_crew_atomic so the common case returns something readable. These
// tests pin the CLIENT half — that both paths surface the refusal as a
// distinguishable reason rather than a generic failure, and that createCrew
// doesn't leave an orphaned crew behind when the membership is refused.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy    = vi.fn();
const fromSpy   = vi.fn();
const insertSpy = vi.fn();
const deleteSpy = vi.fn();

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

const { createCrew, joinCrew, leaveCrew } = await import('../crews');

beforeEach(() => {
  rpcSpy.mockReset(); fromSpy.mockReset(); insertSpy.mockReset(); deleteSpy.mockReset();
});

// ─────────────────────────────────────────────────────────────────────
// joinCrew — the refusal has to be distinguishable
// ─────────────────────────────────────────────────────────────────────
describe('joinCrew — one crew per user', () => {
  it('maps already_in_crew to its own error code', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { code: '23505', message: 'already_in_crew' } });
    await expect(joinCrew('c2', 'u1')).rejects.toMatchObject({ code: 'ALREADY_IN_CREW' });
  });

  it('keeps the ban refusal distinct from the one-crew refusal', async () => {
    // Both are 42501-adjacent on the server; the UI says different things.
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42501', message: 'banned_from_crew' } });
    await expect(joinCrew('c2', 'u1')).rejects.toMatchObject({ code: 'BANNED' });
  });

  it('still reports a full crew separately', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { code: '23514', message: 'crew_full' } });
    await expect(joinCrew('c2', 'u1')).rejects.toThrow(/full/i);
  });

  it('passes a successful join straight through', async () => {
    rpcSpy.mockResolvedValue({ data: { success: true, status: 'joined', crew_id: 'c2' }, error: null });
    expect((await joinCrew('c2', 'u1')).status).toBe('joined');
  });
});

// ─────────────────────────────────────────────────────────────────────
// createCrew — must not orphan a crew when the membership is refused
// ─────────────────────────────────────────────────────────────────────
describe('createCrew — one crew per user', () => {
  function wire({ memberError }) {
    fromSpy.mockImplementation((table) => {
      if (table === 'crews') {
        return {
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'new-crew' }, error: null }) }) }),
          delete: () => ({ eq: (...a) => { deleteSpy(...a); return Promise.resolve({ error: null }); } }),
        };
      }
      return { insert: async (row) => { insertSpy(row); return { error: memberError }; } };
    });
  }

  // Migration 357 made create_crew_atomic the founder's door and revoked
  // the client INSERT on crew_members that the two-statement path needed.
  // The RPC is the path that runs in production.
  it('creates the crew through the atomic RPC, touching no table directly', async () => {
    wire({ memberError: null });
    rpcSpy.mockResolvedValue({ data: { id: 'new-crew', name: 'Iron Union' }, error: null });

    const crew = await createCrew({ id: 'u1' }, 'Iron Union');

    expect(crew.id).toBe('new-crew');
    expect(rpcSpy).toHaveBeenCalledWith('create_crew_atomic', { p_name: 'Iron Union' });
    // No client INSERT: 357 revoked it, and a direct write here would be
    // the escalation path that migration closed.
    expect(insertSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('surfaces the one-crew rule from the RPC', async () => {
    wire({ memberError: null });
    rpcSpy.mockResolvedValue({ data: null, error: { code: '23505', message: 'already_in_crew' } });

    await expect(createCrew({ id: 'u1' }, 'Iron Union'))
      .rejects.toMatchObject({ code: 'ALREADY_IN_CREW' });
  });

  it('does not fall back on a real RPC failure', async () => {
    // Only "not deployed here" earns the legacy path. Anything else is a
    // genuine refusal and must not be retried against the raw tables.
    wire({ memberError: null });
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42501', message: 'unauthenticated' } });

    await expect(createCrew({ id: 'u1' }, 'Iron Union')).rejects.toMatchObject({ code: '42501' });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  // The legacy two-statement path. It exists only for the window between
  // this shipping to Netlify and migration 357 being applied, and it stops
  // working the moment it is — which is correct.
  it('falls back to the two-statement path when the RPC is not deployed', async () => {
    wire({ memberError: null });
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42883', message: 'no function' } });

    const crew = await createCrew({ id: 'u1' }, 'Iron Union');
    expect(crew.id).toBe('new-crew');
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ crew_id: 'new-crew', user_id: 'u1', is_admin: true }),
    );
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('on the fallback path, deletes the crew it just made when the membership is refused', async () => {
    wire({ memberError: { code: '23505', message: 'already_in_crew' } });
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42883', message: 'no function' } });

    await expect(createCrew({ id: 'u1' }, 'Iron Union'))
      .rejects.toMatchObject({ code: 'ALREADY_IN_CREW' });

    // Without this the trigger would leave a crew row with zero members —
    // invisible to My Crews, but live in discovery and impossible to lead.
    // The RPC path has no such window: it is one transaction.
    expect(deleteSpy).toHaveBeenCalledWith('id', 'new-crew');
  });
});

// ─────────────────────────────────────────────────────────────────────
// leaveCrew
// ─────────────────────────────────────────────────────────────────────
describe('leaveCrew', () => {
  it('short-circuits without a crew id', async () => {
    expect(await leaveCrew(null)).toEqual({ ok: false, reason: 'missing' });
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('reports a plain departure', async () => {
    rpcSpy.mockResolvedValue({ data: { ok: true, left: true, crew_deleted: false }, error: null });
    expect(await leaveCrew('c1')).toEqual({ ok: true, crewDeleted: false });
    expect(rpcSpy).toHaveBeenCalledWith('leave_crew', { p_crew_id: 'c1' });
  });

  it('flags when leaving deleted the crew', async () => {
    // Last member out. The UI says so rather than just "you left".
    rpcSpy.mockResolvedValue({ data: { ok: true, left: true, crew_deleted: true }, error: null });
    expect(await leaveCrew('c1')).toEqual({ ok: true, crewDeleted: true });
  });

  it('surfaces each refusal as its own reason', async () => {
    for (const reason of ['promote_first', 'active_war', 'not_a_member']) {
      rpcSpy.mockResolvedValue({ data: { ok: false, reason }, error: null });
      expect(await leaveCrew('c1')).toEqual({ ok: false, reason });
    }
  });

  it('reports not_deployed separately so the UI can stay quiet', async () => {
    rpcSpy.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect(await leaveCrew('c1')).toEqual({ ok: false, reason: 'not_deployed' });
  });

  it('never writes a table', async () => {
    rpcSpy.mockResolvedValue({ data: { ok: true, crew_deleted: false }, error: null });
    await leaveCrew('c1');
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
