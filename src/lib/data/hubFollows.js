// src/lib/data/hubFollows.js
import { db } from '@/api/db';
import { notifyFriendFollow } from './notifications';
import * as users from './users';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';

const e = () => db.entities.HubFollow;

/** List emails the given user is following. */
export const listFollowing = async (email) => {
  if (!email) return [];
  const rows = await e().filter({ follower_email: email }, '-created_date', 500).catch(() => []);
  return rows.map(r => r.followee_email);
};

/** List emails of users following the given user (their followers). */
export const listFollowers = async (email) => {
  if (!email) return [];
  const rows = await e().filter({ followee_email: email }, '-created_date', 500).catch(() => []);
  return rows.map(r => r.follower_email);
};

/** Check if follower follows target. */
export const isFollowing = async (followerEmail, followeeEmail) => {
  if (!followerEmail || !followeeEmail) return false;
  if (followerEmail === followeeEmail) return false;
  const rows = await e().filter({ follower_email: followerEmail, followee_email: followeeEmail }, '-created_date', 1).catch(() => []);
  return rows.length > 0;
};

/**
 * Create a follow relationship. Idempotent — returns existing if already
 * followed.
 *
 * Optional `t` is the translation function from useLanguage; when
 * supplied, the resulting notification row is rendered in the sender's
 * language. Omitting it falls back to English (callers in non-React
 * contexts can skip it).
 */
export const follow = async (followerEmail, followeeEmail, { t } = {}) => {
  if (followerEmail === followeeEmail) return null;
  const existing = await e().filter({ follower_email: followerEmail, followee_email: followeeEmail }, '-created_date', 1).catch(() => []);
  if (existing.length > 0) return existing[0];
  // TOCTOU compensator: between the probe above and this insert, a
  // concurrent follow call (rapid double-tap, two tabs) can land first.
  // If hub_follows has a UNIQUE (follower_email, followee_email)
  // constraint, the second insert errors with 23505. Catch that and
  // re-read so both racers return the same canonical row instead of
  // one throwing a duplicate-key error at the user.
  let created;
  try {
    created = await e().create({ follower_email: followerEmail, followee_email: followeeEmail });
  } catch (err) {
    if (err?.code === '23505' || /duplicate key|unique constraint/i.test(err?.message || '')) {
      const reread = await e().filter({ follower_email: followerEmail, followee_email: followeeEmail }, '-created_date', 1).catch(() => []);
      if (reread.length > 0) return reread[0];
    }
    throw err;
  }
  // Notify the followee — non-blocking, fire and forget
  (async () => {
    try {
      const all = await users.list().catch(() => []);
      const followee = all.find(u => u.email?.toLowerCase() === followeeEmail.toLowerCase());
      const follower = all.find(u => u.email?.toLowerCase() === followerEmail.toLowerCase());
      if (followee?.id) {
        const followerName = follower?.username ? `@${follower.username}` : (followerEmail.split('@')[0] || 'Someone');
        // Per-recipient i18n via notify_friend_follow_for (migration 041).
        // The RPC reads the recipient's preferred_language server-side so
        // the title renders in their language, not the follower's. Falls
        // back to the legacy client-rendered notifyFriendFollow helper if
        // the RPC is unavailable (pre-migration hosts).
        const { error } = await supabase.rpc('notify_friend_follow_for', {
          p_user_id:       followee.id,
          p_follower_name: followerName,
        });
        if (error && (error.code === '42883' || error.code === '42P01')) {
          await notifyFriendFollow({
            recipientUserId: followee.id,
            recipientEmail:  followee.email,
            followerName,
            t,
          });
        } else if (error) {
          console.warn('[hubFollows] notify_friend_follow_for failed:', error);
        }
      }
    } catch { /* swallow — notification failure must not block follow */ }
  })();
  return created;
};

/** Remove a follow relationship. */
export const unfollow = async (followerEmail, followeeEmail) => {
  const existing = await e().filter({ follower_email: followerEmail, followee_email: followeeEmail }, '-created_date', 1).catch(() => []);
  if (existing.length === 0) return;
  await e().delete(existing[0].id).catch(() => {});
};

/**
 * Return up to `limit` friend-of-friend recommendations for `userEmail`.
 * Strategy:
 *   1. Fetch the following-lists of the user's current friends (up to 5).
 *   2. Collect everyone they follow who the user doesn't already follow.
 *   3. Shuffle and cap at `limit`, then fetch their profiles.
 * Falls back to any recent profiles with a username when the user has no friends yet.
 */
export const getRecommendations = async (userEmail, followingEmails = [], limit = 6) => {
  if (!userEmail) return [];

  const alreadyFollowing = new Set([userEmail, ...followingEmails]);

  if (followingEmails.length === 0) {
    // No friends yet — surface recent profiles as a starting point
    const { data } = await safeSelect({
      columns: ['email', 'username', 'avatar_url'],
      build: (cols) => supabase
        .from('user_profiles')
        .select(cols)
        .neq('email', userEmail)
        .not('username', 'is', null)
        .limit(limit),
    });
    return data ?? [];
  }

  // Friend-of-friend: sample up to 5 friends to keep queries light.
  // Pull BOTH directions — who they follow AND who follows them — so that
  // a friend who doesn't follow many people still surfaces their community.
  const sample = followingEmails.slice(0, 5);
  const friendLists = await Promise.all(
    sample.flatMap(email => [listFollowing(email), listFollowers(email)])
  );

  const candidates = [];
  const seen = new Set();
  for (const list of friendLists) {
    for (const email of list) {
      if (!alreadyFollowing.has(email) && !seen.has(email)) {
        candidates.push(email);
        seen.add(email);
      }
    }
  }

  // Fisher-Yates shuffle for fair random selection
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const selected = candidates.slice(0, limit);
  if (selected.length === 0) return [];

  const { data } = await safeSelect({
    columns: ['email', 'username', 'avatar_url'],
    build: (cols) => supabase
      .from('user_profiles')
      .select(cols)
      .in('email', selected),
  });
  return data ?? [];
};

/** Cascade-delete all follow rows involving a user (in either direction). */
export const purgeForUser = async (email) => {
  if (!email) return;
  const [asFollower, asFollowing] = await Promise.all([
    e().filter({ follower_email: email }, '-created_date', 500).catch(() => []),
    e().filter({ followee_email: email }, '-created_date', 500).catch(() => []),
  ]);
  await Promise.all([
    ...asFollower.map(r => e().delete(r.id).catch(() => {})),
    ...asFollowing.map(r => e().delete(r.id).catch(() => {})),
  ]);
};