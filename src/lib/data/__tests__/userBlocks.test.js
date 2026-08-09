// Tests for src/lib/data/userBlocks.js — full-scope block / unblock
// wrappers around the migration 106 RPCs. Mocks supabase.rpc + .from
// and verifies the call shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy = vi.fn();
const fromSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => rpcSpy(...args),
    from: (...args) => fromSpy(...args),
  },
}));

const { listBlocks, blockUserFull, unblockUserFull } = await import('../userBlocks');

beforeEach(() => {
  rpcSpy.mockReset();
  fromSpy.mockReset();
});

describe('listBlocks', () => {
  it('returns [] for null userId without hitting the network', async () => {
    expect(await listBlocks(null)).toEqual([]);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('selects blocked_email + blocked_id + created_at scoped to the user', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [{ blocked_email: 'b@x.com', created_at: '2025-01-01' }],
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    fromSpy.mockReturnValue({ select });

    const rows = await listBlocks('u1');
    expect(fromSpy).toHaveBeenCalledWith('user_blocks');
    // blocked_id is what Settings renders a handle from — the list must
    // never fall back to showing the address (migration 309).
    expect(select).toHaveBeenCalledWith('blocked_email, blocked_id, created_at');
    expect(eq).toHaveBeenCalledWith('blocker_id', 'u1');
    expect(rows).toHaveLength(1);
  });

  it('returns [] on supabase error', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { code: 'oops' } });
    fromSpy.mockReturnValue({ select: () => ({ eq: () => ({ order }) }) });
    expect(await listBlocks('u1')).toEqual([]);
  });
});

describe('blockUserFull', () => {
  it('throws when email is missing', async () => {
    await expect(blockUserFull(null)).rejects.toThrow(/email/);
    await expect(blockUserFull('')).rejects.toThrow(/email/);
  });

  it('calls the block_user_full RPC with the email', async () => {
    rpcSpy.mockResolvedValueOnce({ error: null });
    await blockUserFull('foe@x.com');
    expect(rpcSpy).toHaveBeenCalledWith('block_user_full', { p_blocked_email: 'foe@x.com' });
  });

  it('throws when the RPC returns an error', async () => {
    rpcSpy.mockResolvedValueOnce({ error: { code: '22023', message: 'cannot_block_self' } });
    await expect(blockUserFull('me@x.com')).rejects.toMatchObject({ code: '22023' });
  });
});

describe('unblockUserFull', () => {
  it('throws when email is missing', async () => {
    await expect(unblockUserFull(null)).rejects.toThrow(/email/);
  });

  it('calls the unblock_user_full RPC with the email', async () => {
    rpcSpy.mockResolvedValueOnce({ error: null });
    await unblockUserFull('foe@x.com');
    expect(rpcSpy).toHaveBeenCalledWith('unblock_user_full', { p_blocked_email: 'foe@x.com' });
  });

  it('throws when the RPC returns an error', async () => {
    rpcSpy.mockResolvedValueOnce({ error: { code: 'XX', message: 'fail' } });
    await expect(unblockUserFull('foe@x.com')).rejects.toMatchObject({ code: 'XX' });
  });
});
