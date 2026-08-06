// The non-member gym preview (migration 301).
//
// The point of this feature is a privacy boundary, so the tests that
// matter are the ones about what does NOT come back. A preview that
// leaks a user_id is worse than no preview: it pairs an identity with
// "trains at this named physical address, on these days".

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('@/api/supabaseClient', () => ({ supabase: { rpc: (...a) => rpc(...a) } }));

const { getGymPublicPreview } = await import('../gymBusinesses');

const GYM = 'f2662d5b-0f51-4eb2-af34-8ddd73435b34';

beforeEach(() => rpc.mockReset());

describe('getGymPublicPreview', () => {
  it('withholds everything but the count below the threshold', async () => {
    rpc.mockResolvedValue({
      data: { member_count: 4, meets_threshold: false }, error: null,
    });

    const p = await getGymPublicPreview(GYM);

    // Four members is the Sanford YMCA today. Not squeamishness: the
    // roster is visible to members, so at that size an individual's
    // attendance is derivable from the aggregate by subtraction.
    expect(p.memberCount).toBe(4);
    expect(p.meetsThreshold).toBe(false);
    expect(p.shape).toEqual([]);
    expect(p.activeMembers).toBe(0);
  });

  it('returns the shape once the gym is big enough', async () => {
    rpc.mockResolvedValue({
      data: {
        member_count: 34, meets_threshold: true, active_members: 12,
        session_count: 18, active_days: 6, streak_shape: [6, 5, 5, 3, 2],
      },
      error: null,
    });

    const p = await getGymPublicPreview(GYM);

    expect(p).toMatchObject({
      memberCount: 34, meetsThreshold: true, activeMembers: 12,
      sessionCount: 18, activeDays: 6,
    });
    expect(p.shape).toEqual([6, 5, 5, 3, 2]);
  });

  it('carries no identity, whatever the server sends', async () => {
    // Belt and braces against the RPC ever growing a field it shouldn't:
    // the client shape is an allowlist, not a passthrough.
    rpc.mockResolvedValue({
      data: {
        member_count: 34, meets_threshold: true, active_members: 12,
        session_count: 18, active_days: 6, streak_shape: [6, 5],
        user_id: 'leaked', username: 'leaked', avatar_url: 'leaked',
      },
      error: null,
    });

    const p = await getGymPublicPreview(GYM);
    const serialised = JSON.stringify(p);

    expect(serialised).not.toMatch(/leaked/);
    expect(Object.keys(p).sort()).toEqual([
      'activeDays', 'activeMembers', 'meetsThreshold',
      'memberCount', 'sessionCount', 'shape',
    ]);
  });

  it('is silent on a pre-301 host rather than erroring into the page', async () => {
    rpc.mockResolvedValue({
      data: null, error: { code: '42883', message: 'function does not exist' },
    });
    expect(await getGymPublicPreview(GYM)).toBeNull();
  });

  it('does not call the RPC without a gym id', async () => {
    expect(await getGymPublicPreview(null)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
