/**
 * "Your likes are private, and they will always be private." — Sean, 12 Aug.
 *
 * That sentence is the whole design of this feature, so it is worth being
 * precise about WHERE the privacy actually lives. It is not in the UI hiding a
 * button. `listMyLikedPostIds` filters on `created_by`, a column db.js injects
 * from the signed-in user, and `hub_reactions` RLS scopes a SELECT to your own
 * rows — so there is no argument you can pass that returns someone else's
 * likes. The query cannot express the unsafe request.
 *
 * Since 2026-09-30 there is ONE other read path, and it is opt-out rather
 * than open: get_friends_liked_posts shows your likes to MUTUAL friends while
 * user_profiles.share_likes_with_friends is on (see friendLikes.test.js and
 * migration 20261001003000). This file still pins that the owner-scoped
 * read below cannot return anyone else's likes.
 *
 * The tests below pin that: the filter is present, it is not parameterised by
 * an arbitrary user, and it selects likes rather than every reaction.
 *
 * Also covered: `listByIds` must preserve the CALLER's order. The liked-posts
 * screen is sorted by when you liked something, not when it was written, and
 * a plain `.in()` returns rows in whatever order the planner feels like. That
 * kind of bug looks like "the list is shuffled sometimes", which is exactly
 * the sort of thing that gets dismissed as a fluke.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted, because vi.mock factories are lifted above every top-level
// declaration in the file — referencing a plain const from one throws
// "Cannot access before initialization" and collects zero tests.
const { chain, supabaseMock, filterMock } = vi.hoisted(() => {
  const chain = {};
  return {
    chain,
    supabaseMock: { from: vi.fn(() => chain) },
    filterMock: vi.fn(),
  };
});

vi.mock('@/api/supabaseClient', () => ({ supabase: supabaseMock }));
vi.mock('@/lib/data/ownedRows', () => ({
  ownedRows: () => ({ filter: (...a) => filterMock(...a) }),
}));

import { listMyLikedPostIds } from '@/lib/data/hubReactions';
import { listByIds } from '@/lib/data/hubPosts';

function seedChain(rows, error = null) {
  const calls = { select: null, eq: [], order: null, limit: null };
  Object.assign(chain, {
    select: vi.fn((c) => { calls.select = c; return chain; }),
    eq:     vi.fn((col, val) => { calls.eq.push([col, val]); return chain; }),
    order:  vi.fn((col, o) => { calls.order = [col, o]; return chain; }),
    limit:  vi.fn(async (n) => { calls.limit = n; return { data: rows, error }; }),
  });
  return calls;
}

beforeEach(() => { supabaseMock.from.mockClear(); filterMock.mockReset(); });

describe('listMyLikedPostIds — privacy', () => {
  it('scopes to the signed-in email and to likes only', async () => {
    const calls = seedChain([{ post_id: 'p1' }]);
    await listMyLikedPostIds('me@test.com');
    expect(supabaseMock.from).toHaveBeenCalledWith('hub_reactions');
    // Both filters are load-bearing: without created_by you would read
    // everyone's reactions; without reaction_type you would list dislikes and
    // emoji rows as "liked posts".
    //
    // This asserted ['reaction', 'like'] until 2026-08-30, and hub_reactions
    // has no `reaction` column — the real one is `reaction_type`. Because the
    // supabase chain is mocked here, the filter shape was all this could see,
    // so the test PINNED the broken query instead of catching it. A mocked
    // chain cannot tell you a column exists; only the schema can.
    expect(calls.eq).toContainEqual(['created_by', 'me@test.com']);
    expect(calls.eq).toContainEqual(['reaction_type', 'like']);
    // And never the column that does not exist.
    expect(calls.eq.map(([col]) => col)).not.toContain('reaction');
  });

  it('returns nothing without an email rather than querying unscoped', async () => {
    seedChain([{ post_id: 'p1' }]);
    expect(await listMyLikedPostIds(null)).toEqual([]);
    expect(await listMyLikedPostIds('')).toEqual([]);
    // The dangerous failure is a query that runs WITHOUT the created_by
    // filter, so assert it never reached the client at all.
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('orders newest-first and bounds the result', async () => {
    const calls = seedChain([]);
    await listMyLikedPostIds('me@test.com');
    expect(calls.order).toEqual(['created_date', { ascending: false }]);
    expect(calls.limit).toBe(200);
  });
});

describe('listMyLikedPostIds — shape', () => {
  it('de-dupes a post that has both a like and an emoji reaction', async () => {
    // The unique index is (created_by, post_id, emoji), so one post can carry
    // several rows. Without de-duping it would render twice in the list.
    seedChain([{ post_id: 'p1' }, { post_id: 'p1' }, { post_id: 'p2' }]);
    expect(await listMyLikedPostIds('me@test.com')).toEqual(['p1', 'p2']);
  });

  it('drops rows with no post_id', async () => {
    seedChain([{ post_id: null }, { post_id: 'p2' }]);
    expect(await listMyLikedPostIds('me@test.com')).toEqual(['p2']);
  });

  it('returns [] on a query error instead of throwing into the panel', async () => {
    seedChain(null, { message: 'boom' });
    expect(await listMyLikedPostIds('me@test.com')).toEqual([]);
  });
});

describe('listByIds — preserves the caller order', () => {
  it('returns posts in the order the ids were given, not the query order', async () => {
    // The DB hands these back newest-first; the caller asked for like-order.
    filterMock.mockResolvedValue([{ id: 'b' }, { id: 'a' }, { id: 'c' }]);
    expect(await listByIds(['c', 'a', 'b'])).toEqual([{ id: 'c' }, { id: 'a' }, { id: 'b' }]);
  });

  it('silently drops an id that no longer resolves', async () => {
    // A like pointing at a deleted post must vanish, not render an empty card.
    filterMock.mockResolvedValue([{ id: 'a' }]);
    expect(await listByIds(['a', 'deleted'])).toEqual([{ id: 'a' }]);
  });

  it('does not query at all for an empty list', async () => {
    expect(await listByIds([])).toEqual([]);
    expect(await listByIds(null)).toEqual([]);
    expect(filterMock).not.toHaveBeenCalled();
  });

  it('caps the id list so the IN clause stays bounded', async () => {
    filterMock.mockResolvedValue([]);
    await listByIds(Array.from({ length: 250 }, (_, i) => `p${i}`));
    expect(filterMock.mock.calls[0][0].id).toHaveLength(100);
  });

  it('survives the query failing', async () => {
    filterMock.mockRejectedValue(new Error('offline'));
    expect(await listByIds(['a'])).toEqual([]);
  });
});

/**
 * The Following feed includes your own posts.
 *
 * Sean, 12 Aug: "maybe we could have your own post show up under following…
 * in a weird way it's as if you follow yourself."
 *
 * Two things fall out of it. The feed you curated never showed you what you
 * put into it, so there was no way to see your own post in the context
 * everyone else sees it in. And the old guard returned [] the instant
 * followingEmails was empty, so a brand-new account's Following tab stayed
 * blank even after they had posted — the cold-start case, where an empty
 * screen is most likely to be read as "this app is broken".
 */
import { fetchFollowingWindow, fetchOlderFollowing } from '@/lib/data/hubPosts';

describe('Following feed membership', () => {
  it('adds the viewer to the author set', async () => {
    filterMock.mockResolvedValue([]);
    await fetchFollowingWindow(['id-a'], 'id-me');
    expect(filterMock.mock.calls[0][0].user_id).toContain('id-me');
  });

  it('returns your own posts even when you follow nobody', async () => {
    filterMock.mockResolvedValue([{ id: 'mine' }]);
    const out = await fetchFollowingWindow([], 'id-me');
    expect(filterMock).toHaveBeenCalled();
    expect(out).toEqual([{ id: 'mine' }]);
  });

  it('still returns nothing when there is no viewer and no follows', async () => {
    filterMock.mockResolvedValue([{ id: 'x' }]);
    expect(await fetchFollowingWindow([], null)).toEqual([]);
    expect(filterMock).not.toHaveBeenCalled();
  });

  it('does not list the viewer twice when they somehow follow themselves', async () => {
    // A duplicate in an IN clause is a wasted slot against the 100 cap.
    filterMock.mockResolvedValue([]);
    await fetchFollowingWindow(['id-me', 'id-a'], 'id-me');
    const ids = filterMock.mock.calls[0][0].user_id;
    expect(ids.filter(id => id === 'id-me')).toHaveLength(1);
  });

  it('pagination uses the same membership, so page 2 keeps your posts', async () => {
    // Mismatched membership here would make your own posts vanish on scroll,
    // which reads as the feed losing them rather than as a different query.
    const { supabase } = await import('@/api/supabaseClient');
    const calls = [];
    const cols = [];
    const chain2 = {
      select: () => chain2,
      in: (col, vals) => { calls.push(vals); cols.push(col); return chain2; },
      lt: () => chain2,
      order: () => chain2,
      limit: async () => ({ data: [], error: null }),
    };
    supabase.from.mockReturnValueOnce(chain2);
    await fetchOlderFollowing(['id-a'], '2026-08-12T00:00:00Z', 50, 'id-me');
    expect(cols[0]).toBe('user_id');
    expect(calls[0]).toContain('id-me');
  });
});
