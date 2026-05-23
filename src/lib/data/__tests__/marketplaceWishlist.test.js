// Tests for src/lib/data/marketplaceWishlist.js — listMine / add /
// remove / toggle wrappers for the marketplace save-for-later table
// (mig 121). Mocks supabase.from to verify call shape.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const fromSpy = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (...args) => fromSpy(...args) },
}));

const { listMine, add, remove, toggle } = await import('../marketplaceWishlist');

beforeEach(() => fromSpy.mockReset());

describe('listMine', () => {
  it('returns [] when userId is missing', async () => {
    expect(await listMine(null)).toEqual([]);
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it('queries newest-first scoped to the user', async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ listing_id: 'L1' }], error: null });
    const eq    = vi.fn().mockReturnValue({ order });
    fromSpy.mockReturnValue({ select: () => ({ eq }) });
    const rows = await listMine('u1');
    expect(fromSpy).toHaveBeenCalledWith('marketplace_wishlist');
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(rows).toHaveLength(1);
  });

  it('returns [] on supabase error', async () => {
    fromSpy.mockReturnValue({
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: null, error: { code: 'X' } }) }) }),
    });
    expect(await listMine('u1')).toEqual([]);
  });
});

describe('add', () => {
  it('throws when either id is missing', async () => {
    await expect(add(null, 'L1')).rejects.toThrow();
    await expect(add('u1', null)).rejects.toThrow();
  });

  it('upserts with PK onConflict', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    fromSpy.mockReturnValue({ upsert });
    await add('u1', 'L1');
    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'u1', listing_id: 'L1' },
      { onConflict: 'user_id,listing_id' },
    );
  });

  it('propagates RPC errors', async () => {
    fromSpy.mockReturnValue({
      upsert: () => Promise.resolve({ error: { code: 'X', message: 'fail' } }),
    });
    await expect(add('u1', 'L1')).rejects.toMatchObject({ code: 'X' });
  });
});

describe('remove', () => {
  it('throws when either id is missing', async () => {
    await expect(remove(null, 'L1')).rejects.toThrow();
    await expect(remove('u1', null)).rejects.toThrow();
  });

  it('deletes scoped to (user_id, listing_id)', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const del = vi.fn().mockReturnValue({ eq: eq1 });
    fromSpy.mockReturnValue({ delete: del });
    await remove('u1', 'L1');
    expect(del).toHaveBeenCalled();
    expect(eq1).toHaveBeenCalledWith('user_id', 'u1');
    expect(eq2).toHaveBeenCalledWith('listing_id', 'L1');
  });
});

describe('toggle', () => {
  it('removes when currentlySaved=true and returns false', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    fromSpy.mockReturnValue({ delete: () => ({ eq: eq1 }) });
    expect(await toggle('u1', 'L1', true)).toBe(false);
  });

  it('adds when currentlySaved=false and returns true', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    fromSpy.mockReturnValue({ upsert });
    expect(await toggle('u1', 'L1', false)).toBe(true);
  });
});
