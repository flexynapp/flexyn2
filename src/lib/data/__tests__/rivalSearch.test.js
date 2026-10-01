// getMyRivalSearch / cancelRivalSearch (migration 20261001230000).
//
// A roll that finds nobody close leaves the player first in line for 48
// hours. The card shows that wait only if this module reports it, so the
// mapping and the "not waiting" case are what matter: a null must stay null
// (the card falls back to "Find Your Rival"), and an RPC error must throw
// rather than look like "not waiting".

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { rpc: (...a) => rpc(...a) },
}));
vi.mock('@/lib/data/users', () => ({ selectProfiles: vi.fn() }));
vi.mock('@/lib/data/pastYou', () => ({ withReason: (e) => e }));

const { getMyRivalSearch, cancelRivalSearch } = await import('@/lib/data/gymRival');

beforeEach(() => rpc.mockReset());

describe('getMyRivalSearch', () => {
  it('maps the open search', async () => {
    rpc.mockResolvedValue({ data: [{ rival_type: 'cardio', expires_at: '2026-10-03T10:00:00Z' }], error: null });
    await expect(getMyRivalSearch()).resolves.toEqual({ rivalType: 'cardio', expiresAt: '2026-10-03T10:00:00Z' });
    expect(rpc).toHaveBeenCalledWith('get_my_rival_search');
  });

  it('treats anything but cardio as a gym search', async () => {
    rpc.mockResolvedValue({ data: [{ rival_type: 'gym', expires_at: 'x' }], error: null });
    await expect(getMyRivalSearch()).resolves.toMatchObject({ rivalType: 'gym' });
  });

  it('returns null when not waiting', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(getMyRivalSearch()).resolves.toBeNull();
  });

  it('throws on an error rather than reporting "not waiting"', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(getMyRivalSearch()).rejects.toEqual({ message: 'boom' });
  });
});

describe('cancelRivalSearch', () => {
  it('calls the RPC and throws on error', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(cancelRivalSearch()).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('cancel_rival_search');
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'no' } });
    await expect(cancelRivalSearch()).rejects.toEqual({ message: 'no' });
  });
});
