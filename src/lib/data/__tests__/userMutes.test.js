// Tests for src/lib/data/userMutes.js — soft mute (Hub-feed-scoped).
// Migration 107's user_mutes table. Mocks supabase.from + verifies
// the call shape for each operation.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (...args) => fromSpy(...args) },
}));

const { listMutes, muteUser, unmuteUser } = await import('../userMutes');

beforeEach(() => {
  fromSpy.mockReset();
});

describe('listMutes', () => {
  it('returns [] for null userId without hitting the network', async () => {
    expect(await listMutes(null)).toEqual([]);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('selects muted_email + created_at scoped to the user', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ muted_email: 'noisy@x.com', created_at: '2025-01-01' }],
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ order });
    fromSpy.mockReturnValue({ select: () => ({ eq }) });
    const rows = await listMutes('u1');
    expect(fromSpy).toHaveBeenCalledWith('user_mutes');
    expect(eq).toHaveBeenCalledWith('muter_id', 'u1');
    expect(rows).toHaveLength(1);
  });

  it('returns [] on supabase error', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { code: 'oops' } });
    fromSpy.mockReturnValue({ select: () => ({ eq: () => ({ order }) }) });
    expect(await listMutes('u1')).toEqual([]);
  });
});

describe('muteUser', () => {
  it('throws when user or email is missing', async () => {
    await expect(muteUser(null, 'x@y.com')).rejects.toThrow();
    await expect(muteUser({ id: 'u1', email: 'u1@x.com' }, null)).rejects.toThrow();
    await expect(muteUser({ id: 'u1' }, 'x@y.com')).rejects.toThrow();
  });

  it('upserts the (muter_id, muted_email) tuple with onConflict', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    fromSpy.mockReturnValue({ upsert });
    await muteUser({ id: 'u1', email: 'u1@x.com' }, 'noisy@x.com');
    expect(upsert).toHaveBeenCalledWith(
      { muter_id: 'u1', muter_email: 'u1@x.com', muted_email: 'noisy@x.com' },
      { onConflict: 'muter_id,muted_email' },
    );
  });

  it('throws when the upsert returns an error', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { code: 'XX', message: 'fail' } });
    fromSpy.mockReturnValue({ upsert });
    await expect(muteUser({ id: 'u1', email: 'u1@x.com' }, 'x@y.com'))
      .rejects.toMatchObject({ code: 'XX' });
  });
});

describe('unmuteUser', () => {
  it('throws when userId or email is missing', async () => {
    await expect(unmuteUser(null, 'x@y.com')).rejects.toThrow();
    await expect(unmuteUser('u1', null)).rejects.toThrow();
  });

  it('deletes the row scoped to (muter_id, muted_email)', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const del = vi.fn().mockReturnValue({ eq: eq1 });
    fromSpy.mockReturnValue({ delete: del });
    await unmuteUser('u1', 'noisy@x.com');
    expect(del).toHaveBeenCalled();
    expect(eq1).toHaveBeenCalledWith('muter_id', 'u1');
    expect(eq2).toHaveBeenCalledWith('muted_email', 'noisy@x.com');
  });
});
