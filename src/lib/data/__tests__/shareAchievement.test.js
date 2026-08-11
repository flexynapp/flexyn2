// shareAchievementPost — one-tap "post this badge to Hub".
//
// The load-bearing detail is the UUID guard. `hub_posts.linked_entity_id`
// is a uuid column and a badge id is a slug ('first_rep'), so sending
// the id straight through raises 22P02 and the whole share fails. That
// was invisible for months because until migration 323 no achievement
// could be unlocked to share in the first place — the guard has never
// been exercised in production (0 rows of post_type='achievement' as of
// 2026-08-11), which is exactly why it is worth pinning here.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('@/lib/data/hubPosts', () => ({ create: (...a) => create(...a) }));

const { shareAchievementPost } = await import('@/lib/data/shareAchievement');

const USER = { email: 'a@b.c', username: 'kegan', avatar_url: null };
const BADGE = {
  achievement_id: 'first_rep',
  name: 'First Rep',
  description: 'Logged your first workout.',
  icon: '🥉',
  unlockedDate: '2026-08-07T10:00:00Z',
};

beforeEach(() => { create.mockReset(); create.mockResolvedValue({ id: 'post-1' }); });

describe('shareAchievementPost', () => {
  it('nulls linked_entity_id for a SLUG id rather than raising 22P02', async () => {
    await shareAchievementPost({ user: USER, achievement: BADGE });
    const post = create.mock.calls[0][0];
    expect(post.linked_entity_id).toBeNull();
    // The id the renderer actually reads survives in the snapshot.
    expect(post.linked_entity_snapshot.achievement_id).toBe('first_rep');
  });

  it('passes a genuine UUID through, since that column is for real links', async () => {
    const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    await shareAchievementPost({ user: USER, achievement: { ...BADGE, achievement_id: uuid } });
    expect(create.mock.calls[0][0].linked_entity_id).toBe(uuid);
  });

  it('carries the unlock DATE into the snapshot under the key the renderer reads', async () => {
    // AchievementBlock renders snap.unlocked_date. The caller supplies
    // `unlockedDate` (camel), so a rename on either side silently drops
    // the date line off every shared badge.
    await shareAchievementPost({ user: USER, achievement: BADGE });
    expect(create.mock.calls[0][0].linked_entity_snapshot.unlocked_date)
      .toBe('2026-08-07T10:00:00Z');
  });

  it('stamps now() when the badge carries no date, rather than posting undefined', async () => {
    await shareAchievementPost({
      user: USER,
      achievement: { ...BADGE, unlockedDate: undefined },
    });
    const d = create.mock.calls[0][0].linked_entity_snapshot.unlocked_date;
    expect(Number.isNaN(Date.parse(d))).toBe(false);
  });

  it('posts as an achievement, publicly, with a readable body', async () => {
    await shareAchievementPost({ user: USER, achievement: BADGE });
    const post = create.mock.calls[0][0];
    expect(post.post_type).toBe('achievement');
    expect(post.linked_entity_type).toBe('achievement');
    expect(post.privacy).toBe('public');
    expect(post.body).toContain('First Rep');
    expect(post.author_name).toBe('@kegan');
  });

  it('refuses invalid args instead of posting a badge-shaped blank', async () => {
    expect(await shareAchievementPost({ user: null, achievement: BADGE }))
      .toEqual({ ok: false, error: 'invalid_args' });
    expect(await shareAchievementPost({ user: USER, achievement: {} }))
      .toEqual({ ok: false, error: 'invalid_args' });
    expect(create).not.toHaveBeenCalled();
  });

  it('returns { ok:false, error } instead of throwing when the insert fails', async () => {
    create.mockRejectedValue(new Error('22P02 invalid input syntax for type uuid'));
    const res = await shareAchievementPost({ user: USER, achievement: BADGE });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('22P02');
  });
});
