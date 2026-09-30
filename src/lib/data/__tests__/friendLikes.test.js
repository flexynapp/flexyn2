/**
 * Friends' likes. The privacy rules live in get_friends_liked_posts; what is
 * pinned here is the client's half of the contract:
 *   - it asks the RPC (never hub_reactions directly),
 *   - it loads posts through the RLS-scoped read, so a post that read will not
 *     return is DROPPED rather than shown from the RPC's ids alone,
 *   - a liker public_profiles will not return is dropped rather than shown
 *     nameless,
 *   - several friends liking one post become one row, newest like first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { supabaseMock, listByIdsMock, profilesIn } = vi.hoisted(() => {
  const profilesIn = vi.fn();
  return {
    profilesIn,
    listByIdsMock: vi.fn(),
    supabaseMock: {
      rpc: vi.fn(),
      from: vi.fn(() => ({
        select: vi.fn(() => ({ in: profilesIn })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      })),
    },
  };
});

vi.mock('@/api/supabaseClient', () => ({ supabase: supabaseMock }));
vi.mock('../hubPosts', () => ({ listByIds: (...a) => listByIdsMock(...a) }));

import { groupByPost, listFriendsLikedPosts } from '../friendLikes';

beforeEach(() => {
  supabaseMock.rpc.mockReset();
  supabaseMock.from.mockClear();
  listByIdsMock.mockReset();
  profilesIn.mockReset();
});

describe('groupByPost', () => {
  it('folds several likers of one post into one entry, newest post first', () => {
    const out = groupByPost([
      { post_id: 'p2', liker_id: 'b', liked_at: '2026-09-30T12:00:00Z' },
      { post_id: 'p1', liker_id: 'a', liked_at: '2026-09-30T11:00:00Z' },
      { post_id: 'p2', liker_id: 'c', liked_at: '2026-09-30T10:00:00Z' },
    ]);
    expect(out.map(g => g.postId)).toEqual(['p2', 'p1']);
    expect(out[0].likerIds).toEqual(['b', 'c']);
    expect(out[0].lastLikedAt).toBe('2026-09-30T12:00:00Z');
  });

  it('ignores malformed rows and duplicate likers', () => {
    const out = groupByPost([
      null,
      { post_id: 'p1' },
      { post_id: 'p1', liker_id: 'a', liked_at: '2026-09-30T11:00:00Z' },
      { post_id: 'p1', liker_id: 'a', liked_at: '2026-09-30T11:00:00Z' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].likerIds).toEqual(['a']);
  });
});

describe('listFriendsLikedPosts', () => {
  it('reads through the RPC and never touches hub_reactions', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: [], error: null });
    const out = await listFriendsLikedPosts();
    expect(out).toEqual([]);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('get_friends_liked_posts', { p_limit: 60, p_before: null });
    expect(supabaseMock.from).not.toHaveBeenCalledWith('hub_reactions');
  });

  it('drops a post the RLS read does not return, and a liker public_profiles hides', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [
        { post_id: 'visible', liker_id: 'maya', liked_at: '2026-09-30T12:00:00Z' },
        { post_id: 'visible', liker_id: 'gone', liked_at: '2026-09-30T11:30:00Z' },
        { post_id: 'hidden',  liker_id: 'maya', liked_at: '2026-09-30T11:00:00Z' },
      ],
      error: null,
    });
    listByIdsMock.mockResolvedValue([{ id: 'visible', content: 'PR day', user_id: 'jordan' }]);
    profilesIn.mockResolvedValue({ data: [
      { id: 'maya', username: 'maya', avatar_url: null },
      { id: 'jordan', username: 'jordan', avatar_url: null },
    ], error: null });

    const out = await listFriendsLikedPosts();
    expect(listByIdsMock).toHaveBeenCalledWith(['visible', 'hidden']);
    expect(supabaseMock.from).toHaveBeenCalledWith('public_profiles');
    expect(out).toHaveLength(1);
    expect(out[0].post.id).toBe('visible');
    expect(out[0].likers.map(l => l.id)).toEqual(['maya']);
    expect(out[0].author.username).toBe('jordan');
    expect(profilesIn).toHaveBeenCalledWith('id', ['maya', 'gone', 'jordan']);
  });

  it('surfaces an RPC error instead of rendering an empty list', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
    await expect(listFriendsLikedPosts()).rejects.toEqual({ code: '42501' });
  });
});
