// src/lib/data/friendLikes.js
//
// "Posts your friends liked" — the Friends tab of Hub → Activity.
//
// The server decides everything that is a privacy question:
// get_friends_liked_posts returns only (post, liker, time) triples where the
// liker is a MUTUAL follow who shares likes, nobody is blocking anybody, the
// post is one the viewer could read in the feed anyway, and the viewer shares
// too (the switch is reciprocal). See 20260930235000_friends_liked_posts.sql.
//
// This module only assembles rows. Posts are loaded through the ordinary
// RLS-scoped read (hubPosts.listByIds), so if the server and the feed ever
// disagree about a post, the row is dropped rather than shown. Names and
// avatars come from public_profiles by id.

import { supabase } from '@/api/supabaseClient';
import * as hubPosts from './hubPosts';

const PAGE = 60;

/**
 * Group raw (post_id, liker_id, liked_at) triples into one entry per post,
 * newest like first. Pure, exported for tests.
 */
export function groupByPost(triples = []) {
  const byPost = new Map();
  for (const t of triples) {
    if (!t?.post_id || !t?.liker_id) continue;
    let g = byPost.get(t.post_id);
    if (!g) {
      g = { postId: t.post_id, likerIds: [], lastLikedAt: t.liked_at };
      byPost.set(t.post_id, g);
    }
    if (!g.likerIds.includes(t.liker_id)) g.likerIds.push(t.liker_id);
    if (t.liked_at && (!g.lastLikedAt || t.liked_at > g.lastLikedAt)) g.lastLikedAt = t.liked_at;
  }
  return [...byPost.values()].sort((a, b) =>
    String(b.lastLikedAt || '').localeCompare(String(a.lastLikedAt || '')));
}

/**
 * The Friends activity list. Each entry:
 *   { post, author, likers: [{ id, username, avatar_url }], lastLikedAt }
 * `likers` is newest first. Returns [] when the viewer has sharing off.
 */
export async function listFriendsLikedPosts({ before = null } = {}) {
  const { data, error } = await supabase.rpc('get_friends_liked_posts', {
    p_limit: PAGE,
    p_before: before,
  });
  if (error) throw error;
  const groups = groupByPost(data || []);
  if (groups.length === 0) return [];

  const posts = await hubPosts.listByIds(groups.map(g => g.postId));
  const postById = new Map((posts || []).map(p => [p.id, p]));

  // One public_profiles read covers the likers and the post authors.
  const personIds = [...new Set([
    ...groups.flatMap(g => g.likerIds),
    ...(posts || []).map(p => p.user_id).filter(Boolean),
  ])];
  const { data: people, error: peopleError } = await supabase
    .from('public_profiles')
    .select('id, username, avatar_url')
    .in('id', personIds);
  if (peopleError) throw peopleError;
  const personById = new Map((people || []).map(p => [p.id, p]));

  return groups
    .map(g => {
      const post = postById.get(g.postId);
      return {
        post,
        author: post ? personById.get(post.user_id) || null : null,
        // A liker public_profiles will not show (blocked since, deleted) is
        // dropped rather than rendered nameless.
        likers: g.likerIds.map(id => personById.get(id)).filter(Boolean),
        lastLikedAt: g.lastLikedAt,
      };
    })
    .filter(e => e.post && e.likers.length > 0);
}

/** Turn sharing on or off for the signed-in user. */
export async function setShareLikesWithFriends(userId, next) {
  const { error } = await supabase
    .from('user_profiles')
    .update({ share_likes_with_friends: !!next })
    .eq('id', userId);
  if (error) throw error;
}
