// src/lib/data/hubFollows.js
import { db } from '@/api/db';
import { notifyFriendFollow } from './notifications';
import * as users from './users';
import { supabase } from '@/api/supabaseClient';

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
  const created = await e().create({ follower_email: followerEmail, followee_email: followeeEmail });
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