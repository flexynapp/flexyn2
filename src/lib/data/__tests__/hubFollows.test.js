// src/lib/data/__tests__/hubFollows.test.js
//
// Covers the SHAPE of what the follow-graph readers return, which is the
// thing that has broken twice.
//
// listFollowing() returns Array<string>. Two separate surfaces treated it
// as an array of hub_follows ROWS and read `.followee_email` / `.username`
// off each entry — always undefined, so both silently saw an empty follow
// graph. In HubMessages that mis-filed every friend's DM into Requests
// (audit 10 #1); in NewGroupDMModal it emptied the people picker outright,
// so group DMs could not be created at all.
//
// listFollowingPairs() exists for the second case: a picker needs the id
// (to resolve a username off public_profiles) AND the email (what
// create_group_conversation takes), and since mig 220 dropped email from
// the view, neither can be derived from the other.

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

describe('listFollowing', () => {
  it('returns bare emails — NOT row objects', async () => {
    _followState.filterReturn = [
      { followee_email: 'a@x.com', followee_id: 'id-a' },
      { followee_email: 'b@x.com', followee_id: 'id-b' },
    ];
    const list = await hubFollows.listFollowing('me@x.com');
    expect(list).toEqual(['a@x.com', 'b@x.com']);
    // The contract a caller must not get wrong: there is no `.email` to read.
    expect(list.every(item => typeof item === 'string')).toBe(true);
    expect(list[0].followee_email).toBeUndefined();
  });

  it('returns [] without querying when the email is missing', async () => {
    expect(await hubFollows.listFollowing(null)).toEqual([]);
    expect(_followState.filterCalls).toHaveLength(0);
  });
});

describe('listFollowingPairs', () => {
  it('returns { id, email } pairs a picker can both render and address', async () => {
    _followState.filterReturn = [
      { followee_email: 'a@x.com', followee_id: 'id-a' },
      { followee_email: 'b@x.com', followee_id: 'id-b' },
    ];
    const pairs = await hubFollows.listFollowingPairs('me@x.com');
    expect(pairs).toEqual([
      { id: 'id-a', email: 'a@x.com' },
      { id: 'id-b', email: 'b@x.com' },
    ]);
  });

  it('reads the caller\'s own follow rows, keyed by follower_email', async () => {
    _followState.filterReturn = [];
    await hubFollows.listFollowingPairs('Me@X.com');
    expect(_followState.filterCalls[0].conditions).toEqual({ follower_email: 'Me@X.com' });
  });

  it('lower-cases the email so membership checks line up', async () => {
    _followState.filterReturn = [{ followee_email: 'MixedCase@X.com', followee_id: 'id-a' }];
    const pairs = await hubFollows.listFollowingPairs('me@x.com');
    expect(pairs[0].email).toBe('mixedcase@x.com');
  });

  it('keeps a row whose id has not been backfilled — the email still addresses them', async () => {
    _followState.filterReturn = [{ followee_email: 'a@x.com', followee_id: null }];
    const pairs = await hubFollows.listFollowingPairs('me@x.com');
    expect(pairs).toEqual([{ id: null, email: 'a@x.com' }]);
  });

  it('drops a row with no email, since it cannot be added to a group', async () => {
    _followState.filterReturn = [
      { followee_email: null, followee_id: 'id-a' },
      { followee_email: 'b@x.com', followee_id: 'id-b' },
    ];
    const pairs = await hubFollows.listFollowingPairs('me@x.com');
    expect(pairs).toEqual([{ id: 'id-b', email: 'b@x.com' }]);
  });

  it('returns [] without querying when the email is missing', async () => {
    expect(await hubFollows.listFollowingPairs(undefined)).toEqual([]);
    expect(_followState.filterCalls).toHaveLength(0);
  });

  it('returns [] rather than throwing when the query fails', async () => {
    _followState.filterError = new Error('network');
    expect(await hubFollows.listFollowingPairs('me@x.com')).toEqual([]);
  });
});
