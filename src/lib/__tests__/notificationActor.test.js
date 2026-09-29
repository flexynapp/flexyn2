import { describe, it, expect } from 'vitest';
import { actorRefOf, actorKey, collectActorRefs } from '@/lib/notificationActor';

const ME = '11111111-1111-4111-8111-111111111111';
const SEAN = 'ead69f89-3a1e-4bf2-9d3e-444648e01f98';

describe('actorRefOf', () => {
  it('reads the person from each writer\'s own key', () => {
    expect(actorRefOf({ type: 'post_like', user_id: ME, metadata: { actor_id: SEAN } })).toEqual({ id: SEAN });
    expect(actorRefOf({ type: 'comment_reply', user_id: ME, metadata: { commenter_id: SEAN } })).toEqual({ id: SEAN });
    expect(actorRefOf({ type: 'coin_gift', user_id: ME, metadata: { senderId: SEAN } })).toEqual({ id: SEAN });
    expect(actorRefOf({ type: 'duel_invite', user_id: ME, metadata: { challenger_id: SEAN } })).toEqual({ id: SEAN });
  });

  it('never uses an email, even when the row carries one', () => {
    expect(actorRefOf({ type: 'post_like', user_id: ME, metadata: { actor_email: 'a@b.c' } })).toBeNull();
  });

  it('looks up a follow or post by username only when it is an @username', () => {
    expect(actorRefOf({ type: 'friend_follow', metadata: { followerName: '@kegan' } })).toEqual({ username: 'kegan' });
    // An email prefix could be a stranger's username: never looked up.
    expect(actorRefOf({ type: 'friend_post', metadata: { posterName: 'kegan' } })).toBeNull();
  });

  it('ignores rows no person is behind, and the reader\'s own id', () => {
    expect(actorRefOf({ type: 'quest_claimed', metadata: { actor_id: SEAN } })).toBeNull();
    expect(actorRefOf({ type: 'post_like', user_id: SEAN, metadata: { actor_id: SEAN } })).toBeNull();
    expect(actorRefOf({ type: 'post_like', metadata: null })).toBeNull();
  });
});

describe('collectActorRefs', () => {
  it('dedupes ids and usernames', () => {
    const rows = [
      { type: 'post_like', metadata: { actor_id: SEAN } },
      { type: 'comment_reply', metadata: { commenter_id: SEAN } },
      { type: 'friend_follow', metadata: { followerName: '@kegan' } },
    ];
    expect(collectActorRefs(rows)).toEqual({ ids: [SEAN], usernames: ['kegan'] });
    expect(actorKey({ id: SEAN })).toBe(`id:${SEAN}`);
    expect(actorKey({ username: 'kegan' })).toBe('u:kegan');
  });
});
