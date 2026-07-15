// src/lib/data/hubFollows.js
import { db } from '@/api/db';
import { notifyFriendFollow } from './notifications';
import * as users from './users';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';

const e = () => db.entities.HubFollow;

// A follow participant may be passed as a user_id (uuid) or an email.
// Callers on id-keyed surfaces pass ids so they never have to read another
// user's email off the public_profiles view; legacy callers still pass
// emails. The bidirectional hub_follows trigger (mig 208 + 217) fills
// whichever column is left null, so either form yields a fully-populated
// row and both id- and email-keyed reads keep working.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const followMatch = (participant, idKey, emailKey) =>
  UUID_RE.test(String(participant ?? ''))
    ? { [idKey]: participant }
    : { [emailKey]: String(participant ?? '').toLowerCase() };

/**
 * Returns up to N popular active users the caller isn't following.
 * Backs the Hub feed "Suggested follows" rail. Server-side ranking
 * is follower_count DESC, total_posts DESC, created_at ASC.
 *
 * Returns [] on pre-091 host (RPC missing) so the rail gracefully
 * hides instead of erroring.
 */
export const getSuggestedFollowees = async (limit = 8) => {
  const { data, error } = await supabase.rpc('get_suggested_followees', { p_limit: limit });
  if (error) {
    if (error.code === '42883' || error.code === '42P01') return [];
    return [];
  }
  return Array.isArray(data) ? data : [];
};

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

/**
 * List the user_ids the given user is following — the id-keyed twin of
 * listFollowing(). follower_id / followee_id are backfilled and
 * trigger-maintained (mig 208), so this reads the same follow graph
 * without touching emails. Prefer this over listFollowing() on paths that
 * resolve profiles by id (e.g. the stories feed) so they never depend on
 * the public_profiles email column.
 */
export const listFollowingIds = async (userId) => {
  if (!userId) return [];
  const rows = await e().filter({ follower_id: userId }, '-created_date', 500).catch(() => []);
  return rows.map(r => r.followee_id).filter(Boolean);
};

/** List the user_ids following the given user — id-keyed twin of listFollowers(). */
export const listFollowersIds = async (userId) => {
  if (!userId) return [];
  const rows = await e().filter({ followee_id: userId }, '-created_date', 500).catch(() => []);
  return rows.map(r => r.follower_id).filter(Boolean);
};

/** Check if follower follows target. */
export const isFollowing = async (followerEmail, followeeEmail) => {
  if (!followerEmail || !followeeEmail) return false;
  if (followerEmail === followeeEmail) return false;
  const rows = await e().filter({ follower_email: followerEmail, followee_email: followeeEmail }, '-created_date', 1).catch(() => []);
  return rows.length > 0;
};

/**
 * If two users mutually follow each other, returns the date of the
 * EARLIER follow (i.e., when the friendship effectively started — the
 * second follow is just the reciprocation that confirmed it).
 *
 * Returns null when the pair is not mutual or when either row is
 * missing. Returns an ISO date string when mutual.
 *
 * Powers the "Training together since March 2025" anniversary line on
 * HubProfile — only needs the month/year, but exposing the full date
 * lets the consumer decide whether to also fire an anniversary glow
 * when the calendar date matches.
 */
export const getMutualFollowSince = async (emailA, emailB) => {
  if (!emailA || !emailB || emailA === emailB) return null;
  // Two single-row reads in parallel — cheaper than a full mutual list.
  const [aFollowsB, bFollowsA] = await Promise.all([
    e().filter({ follower_email: emailA, followee_email: emailB }, '-created_date', 1).catch(() => []),
    e().filter({ follower_email: emailB, followee_email: emailA }, '-created_date', 1).catch(() => []),
  ]);
  if (aFollowsB.length === 0 || bFollowsA.length === 0) return null;
  const dateA = aFollowsB[0]?.created_date;
  const dateB = bFollowsA[0]?.created_date;
  if (!dateA || !dateB) return null;
  // Date-aware compare — a `"2026-05-25"` (date-only) vs
  // `"2026-05-25T00:00:00Z"` (full ISO) string compare returns the
  // shorter one as "earlier" even when they represent the same moment.
  // (Audit 17 #F22.)
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return dateA < dateB ? dateA : dateB;
  return a < b ? dateA : dateB;
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
export const follow = async (follower, followee, { t } = {}) => {
  if (!follower || !followee || String(follower) === String(followee)) return null;
  const matchBoth = {
    ...followMatch(follower, 'follower_id', 'follower_email'),
    ...followMatch(followee, 'followee_id', 'followee_email'),
  };
  const existing = await e().filter(matchBoth, '-created_date', 1).catch(() => []);
  if (existing.length > 0) return existing[0];
  // TOCTOU compensator: between the probe above and this insert, a
  // concurrent follow call (rapid double-tap, two tabs) can land first.
  // If hub_follows has a UNIQUE constraint on the pair, the second insert
  // errors with 23505. Catch that and re-read so both racers return the
  // same canonical row instead of one throwing a duplicate-key error.
  let created;
  try {
    created = await e().create({ ...matchBoth });
  } catch (err) {
    if (err?.code === '23505' || /duplicate key|unique constraint/i.test(err?.message || '')) {
      const reread = await e().filter(matchBoth, '-created_date', 1).catch(() => []);
      if (reread.length > 0) return reread[0];
    }
    throw err;
  }
  // Notify the followee — non-blocking, fire and forget.
  //
  // Uses the follow row's own ids instead of scanning users.list() and
  // matching by email. The BEFORE INSERT trigger (mig 208) resolves
  // follower_id / followee_id from the emails at write time, and
  // create() returns the row via insert().select(), so both ids are on
  // `created` here. This removes a public_profiles email read AND an
  // O(all-users) fetch from the follow hot path.
  (async () => {
    try {
      const followeeId = created?.followee_id;
      if (!followeeId) return;

      // Follower's @handle for the notification title — a single targeted
      // profile read by id, not a full-list scan.
      let followerName = 'Someone';
      if (created?.follower_id) {
        const { data: followerProfile } = await users.selectProfiles((from) => from
          .select('username')
          .eq('id', created.follower_id)
          .single());
        if (followerProfile?.username) followerName = `@${followerProfile.username}`;
      }

      // Per-recipient i18n via notify_friend_follow_for (migration 041).
      // The RPC reads the recipient's preferred_language server-side so
      // the title renders in their language, not the follower's. Falls
      // back to the legacy client-rendered notifyFriendFollow helper if
      // the RPC is unavailable (pre-migration hosts).
      const { error } = await supabase.rpc('notify_friend_follow_for', {
        p_user_id:       followeeId,
        p_follower_name: followerName,
      });
      if (error && (error.code === '42883' || error.code === '42P01')) {
        await notifyFriendFollow({
          recipientUserId: followeeId,
          recipientEmail:  created?.followee_email ?? null,
          followerName,
          t,
        });
      } else if (error) {
        console.warn('[hubFollows] notify_friend_follow_for failed:', error);
      }
    } catch { /* swallow — notification failure must not block follow */ }
  })();
  return created;
};

/** Remove a follow relationship. follower/followee may be id or email. */
export const unfollow = async (follower, followee) => {
  const matchBoth = {
    ...followMatch(follower, 'follower_id', 'follower_email'),
    ...followMatch(followee, 'followee_id', 'followee_email'),
  };
  const existing = await e().filter(matchBoth, '-created_date', 1).catch(() => []);
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
export const getRecommendations = async (userId, followingIds = [], limit = 6) => {
  if (!userId) return [];

  const alreadyFollowing = new Set([userId, ...followingIds]);

  // Always include a slice of RECENT signups in addition to any
  // friend-of-friend recommendations. Without this, new accounts that
  // aren't in anyone's network are invisible to existing users with
  // 2+ follows. ("We've had like 10 new users and none of them shown
  // up.") We reserve up to half the slots for recent signups so the
  // friend-of-friend signal still drives the main rail.
  const recentSlots = Math.max(2, Math.ceil(limit / 2));
  const fofSlots    = Math.max(0, limit - recentSlots);

  const { data: recentData } = await safeSelect({
    columns: ['id', 'username', 'avatar_url', 'created_at'],
    build: (cols) => users.selectProfiles((from) => from
      .select(cols)
      .neq('id', userId)
      .not('username', 'is', null)
      .order('created_at', { ascending: false })
      .limit(recentSlots * 4)), // overfetch so we have room after filtering
  });
  const recentFiltered = (recentData ?? [])
    .filter(p => !alreadyFollowing.has(p.id))
    .slice(0, recentSlots);

  // Track everyone we'll surface so friend-of-friend doesn't duplicate
  // someone the recent-signups bucket already chose.
  const picked = new Map();
  for (const p of recentFiltered) picked.set(p.id, p);

  if (followingIds.length === 0) {
    // No friends yet — fill remaining slots with extra recent profiles.
    // We already overfetched above so just take more from the same list.
    const extra = (recentData ?? [])
      .filter(p => !alreadyFollowing.has(p.id) && !picked.has(p.id))
      .slice(0, fofSlots);
    for (const p of extra) picked.set(p.id, p);
    return Array.from(picked.values()).slice(0, limit);
  }

  // Friend-of-friend: sample up to 5 friends to keep queries light.
  // Pull BOTH directions — who they follow AND who follows them — so that
  // a friend who doesn't follow many people still surfaces their community.
  const sample = followingIds.slice(0, 5);
  const friendLists = await Promise.all(
    sample.flatMap(id => [listFollowingIds(id), listFollowersIds(id)])
  );

  const candidates = [];
  const seen = new Set();
  for (const list of friendLists) {
    for (const id of list) {
      if (!alreadyFollowing.has(id) && !seen.has(id) && !picked.has(id)) {
        candidates.push(id);
        seen.add(id);
      }
    }
  }

  // Fisher-Yates shuffle for fair random selection
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  const fofSelected = candidates.slice(0, fofSlots);
  if (fofSelected.length > 0) {
    const { data: fofData } = await safeSelect({
      columns: ['id', 'username', 'avatar_url'],
      build: (cols) => users.selectProfiles((from) => from
        .select(cols)
        .in('id', fofSelected)),
    });
    for (const p of (fofData ?? [])) {
      if (!picked.has(p.id)) picked.set(p.id, p);
    }
  }

  return Array.from(picked.values()).slice(0, limit);
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