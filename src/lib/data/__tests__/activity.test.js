// Tests for src/lib/data/activity.js — the live-activity RPC wrappers.
//
// All three functions are thin shims around supabase.rpc calls with
// graceful degradation on pre-088 hosts (42883 / 42P01). The tests
// verify the envelope shape, the error swallowing, and the return
// types on each path.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: { rpc: (...args) => rpc(...args) },
}));

let activity;
beforeEach(async () => {
  vi.resetModules();
  rpc.mockReset();
  activity = await import('../activity');
});

describe('markActive', () => {
  it('passes the duration through and returns the active_until value', async () => {
    rpc.mockResolvedValue({ data: '2026-05-22T15:00:00Z', error: null });
    const result = await activity.markActive(60);
    expect(result).toBe('2026-05-22T15:00:00Z');
    expect(rpc).toHaveBeenCalledWith('mark_workout_active', { p_duration_minutes: 60 });
  });

  it('defaults to 90 minutes when called without args', async () => {
    rpc.mockResolvedValue({ data: '2026-05-22T15:00:00Z', error: null });
    await activity.markActive();
    expect(rpc).toHaveBeenCalledWith('mark_workout_active', { p_duration_minutes: 90 });
  });

  it('returns null on pre-088 hosts (42883)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect(await activity.markActive()).toBe(null);
  });

  it('returns null on table-missing (42P01)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42P01' } });
    expect(await activity.markActive()).toBe(null);
  });

  it('returns null on generic errors (without throwing)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '50000', message: 'db' } });
    expect(await activity.markActive()).toBe(null);
  });

  it('returns null on network throws', async () => {
    rpc.mockRejectedValueOnce(new Error('network'));
    expect(await activity.markActive()).toBe(null);
  });
});

describe('clearActive', () => {
  it('calls the RPC with no args', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await activity.clearActive();
    expect(rpc).toHaveBeenCalledWith('clear_workout_active');
  });

  it('does not throw on pre-088 host', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883' } });
    await expect(activity.clearActive()).resolves.toBeUndefined();
  });

  it('does not throw on generic errors', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '50000', message: 'db' } });
    await expect(activity.clearActive()).resolves.toBeUndefined();
  });
});

describe('getActiveFollowees', () => {
  it('returns the array of active followees', async () => {
    const fakeRows = [
      { user_id: 'u1', username: 'alice', avatar_url: null, active_until: '2026-05-22T15:00:00Z' },
      { user_id: 'u2', username: 'bob',   avatar_url: null, active_until: '2026-05-22T14:30:00Z' },
    ];
    rpc.mockResolvedValue({ data: fakeRows, error: null });
    const result = await activity.getActiveFollowees();
    expect(result).toEqual(fakeRows);
  });

  it('returns [] (not null) on pre-088 host', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect(await activity.getActiveFollowees()).toEqual([]);
  });

  it('returns [] when the RPC returns null data', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await activity.getActiveFollowees()).toEqual([]);
  });

  it('returns [] when supabase throws', async () => {
    rpc.mockRejectedValueOnce(new Error('boom'));
    expect(await activity.getActiveFollowees()).toEqual([]);
  });
});
