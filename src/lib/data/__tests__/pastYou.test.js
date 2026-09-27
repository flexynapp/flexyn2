// Past You data layer (migration 20260927130000) and the guest check that
// gates it.
//
// The assertions that matter: the guest refusal comes back TAGGED, so the
// card opens the connect flyout rather than a generic error toast; an RPC
// that is missing degrades to null rather than a zeroed race; and a result
// older than two days is not shown as "last week's result" forever.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
let row = null;
vi.mock('@/api/supabaseClient', () => {
  const chain = {
    select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain,
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return {
    supabase: {
      rpc: (...a) => rpc(...a),
      from: () => chain,
      auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    },
  };
});

const { startPastYou, getPastYouState, getMyPastYou, withReason, ghostBoostPct, pastYouBasis } = await import('@/lib/data/pastYou');
const { isGuestAccount } = await import('@/lib/guestIdentity');

beforeEach(() => { rpc.mockReset(); row = null; });

describe('startPastYou', () => {
  it('asks the server with the chosen type', async () => {
    rpc.mockResolvedValue({ data: [{ id: 'm1', level: 1 }], error: null });
    const m = await startPastYou('cardio');
    expect(rpc).toHaveBeenCalledWith('past_you_start', { p_type: 'cardio' });
    expect(m.id).toBe('m1');
  });

  it('tags a guest refusal so the card can open the connect flyout', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'guest_account', code: '42501' } });
    await expect(startPastYou('gym')).rejects.toMatchObject({ reason: 'guest_account' });
  });

  it('tags a live human match', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'rival_in_progress' } });
    await expect(startPastYou('gym')).rejects.toMatchObject({ reason: 'rival_in_progress' });
  });
});

describe('getPastYouState', () => {
  it('maps the server row into numbers and dates', async () => {
    rpc.mockResolvedValue({ data: [{
      you_score: '2500', ghost_pace: '286', target: '1000', level: 3, baseline: '1000',
      baseline_weeks: 2, prs: 1, started_at: '2026-09-25T00:00:00Z', ends_at: '2026-10-02T00:00:00Z',
    }], error: null });
    const s = await getPastYouState('m1');
    expect(s).toMatchObject({ you: 2500, ghostPace: 286, target: 1000, level: 3, baselineWeeks: 2, prs: 1 });
    expect(s.endsAt).toBeInstanceOf(Date);
  });

  it('is null, not a zeroed race, when the RPC is unavailable', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect(await getPastYouState('m1')).toBeNull();
  });
});

describe('getMyPastYou', () => {
  it('returns a live race', async () => {
    row = { id: 'm1', status: 'active' };
    expect((await getMyPastYou()).id).toBe('m1');
  });

  it('keeps a result for two days, then lets it go', async () => {
    row = { id: 'm1', status: 'completed', settled_at: new Date(Date.now() - 86400_000).toISOString() };
    expect(await getMyPastYou()).not.toBeNull();
    row = { id: 'm1', status: 'completed', settled_at: new Date(Date.now() - 3 * 86400_000).toISOString() };
    expect(await getMyPastYou()).toBeNull();
  });
});

describe('getMyPastYou after quitting', () => {
  it('shows nothing when the newest race was abandoned, not the race before it', async () => {
    row = { id: 'm2', status: 'abandoned' };
    expect(await getMyPastYou()).toBeNull();
  });
});

describe('helpers', () => {
  it('ghost boost is 4% per level above 1', () => {
    expect(ghostBoostPct(1)).toBe(0);
    expect(ghostBoostPct(3)).toBe(8);
  });

  it('withReason leaves an unknown error untagged', () => {
    expect(withReason({ message: 'boom' }).reason).toBeUndefined();
  });

  it('isGuestAccount reads the flag, then the guest address', () => {
    expect(isGuestAccount({ is_anonymous: true, email: null })).toBe(true);
    expect(isGuestAccount({ id: 'x', email: 'guest_x@flexyn.guest' })).toBe(true);
    expect(isGuestAccount({ is_anonymous: false, email: 'a@b.com' })).toBe(false);
    expect(isGuestAccount(null)).toBe(false);
  });

  it('a guest who connected an account is not a guest, whatever the profile email says', () => {
    // user_profiles.email keeps the guest address after linking; the flag wins.
    expect(isGuestAccount({ is_anonymous: false, email: 'guest_x@flexyn.guest' })).toBe(false);
  });
});

describe('pastYouBasis', () => {
  it('names the starter target when there is no history', () => {
    expect(pastYouBasis('gym', 10000, 0)).toBe('starter');
  });
  it('names the floor when a light average was raised to it', () => {
    expect(pastYouBasis('gym', 5000, 4)).toBe('floor');
    expect(pastYouBasis('cardio', 2500, 2)).toBe('floor');
  });
  it('names the real average above the floor', () => {
    expect(pastYouBasis('gym', 5545, 4)).toBe('weeks');
    expect(pastYouBasis('cardio', 2501, 1)).toBe('weeks');
  });
});
