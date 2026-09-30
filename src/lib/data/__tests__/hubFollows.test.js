// src/lib/data/__tests__/hubFollows.test.js
//
// The follow graph is public, so its email columns handed anyone the
// address of everyone who follows or is followed. The app now names its
// columns (no email, no created_by) and matches only on user ids; these
// tests pin that, because the old email-keyed readers broke twice over
// the shape they returned and would break a third time as a 42501 once
// the columns are revoked.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const _followState = {
  filterCalls: [],
  filterReturn: [],
};

// The statements ownedRows sends are proven identical to the old client's
// in ownedRowsEquivalence.test.js; here each table's rows are faked.
vi.mock('@/lib/data/ownedRows', () => ({
  ownedRows: () => ({
    filter: vi.fn(async (conditions, sort, limit) => {
      _followState.filterCalls.push({ conditions, sort, limit });
      if (_followState.filterError) {
        const err = _followState.filterError;
        _followState.filterError = null;
        throw err;
      }
      return _followState.filterReturn;
    }),
  }),
}));

vi.mock('./notifications', () => ({ notifyFriendFollow: vi.fn() }));
vi.mock('../notifications', () => ({ notifyFriendFollow: vi.fn() }));
vi.mock('../conversationRequests', () => ({ acceptPendingRequestsFrom: vi.fn() }));
vi.mock('../users', () => ({ selectProfiles: vi.fn(async () => ({ data: [] })) }));
vi.mock('@/api/supabaseClient', () => ({
  supabase: { rpc: vi.fn(async () => ({ data: null, error: null })) },
}));
vi.mock('@/api/safeSelect', () => ({
  safeSelect: vi.fn(async () => ({ data: [], error: null })),
}));

const hubFollows = await import('../hubFollows');

beforeEach(() => {
  _followState.filterCalls = [];
  _followState.filterReturn = [];
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('the follow graph is read by id only', () => {
  it('names its columns, and none of them is an email', () => {
    expect(hubFollows.FOLLOW_COLUMNS).not.toMatch(/email|created_by/);
    expect(hubFollows.FOLLOW_COLUMNS).toMatch(/follower_id/);
    expect(hubFollows.FOLLOW_COLUMNS).toMatch(/followee_id/);
  });

  it('has no email-keyed readers left', () => {
    expect(hubFollows.listFollowing).toBeUndefined();
    expect(hubFollows.listFollowingPairs).toBeUndefined();
    expect(hubFollows.listFollowers).toBeUndefined();
  });

  it('listFollowingIds reads my own rows by follower_id', async () => {
    _followState.filterReturn = [{ followee_id: B }];
    expect(await hubFollows.listFollowingIds(A)).toEqual([B]);
    expect(_followState.filterCalls[0].conditions).toEqual({ follower_id: A });
  });

  it('isFollowing matches on both ids', async () => {
    _followState.filterReturn = [{ id: 'f1' }];
    expect(await hubFollows.isFollowing(A, B)).toBe(true);
    expect(_followState.filterCalls[0].conditions).toEqual({ follower_id: A, followee_id: B });
  });

  it('isFollowing refuses an email instead of filtering on one', async () => {
    expect(await hubFollows.isFollowing(A, 'them@x.com')).toBe(false);
    expect(_followState.filterCalls).toHaveLength(0);
  });

  it('getMutualFollowSince refuses an email instead of filtering on one', async () => {
    expect(await hubFollows.getMutualFollowSince('me@x.com', B)).toBeNull();
    expect(_followState.filterCalls).toHaveLength(0);
  });
});
