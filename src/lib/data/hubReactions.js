// src/lib/data/hubReactions.js
//
// Reactions are "like" or "dislike" stored in hub_reactions.
// Schema fields: created_by (email), post_id, emoji (= reaction_type), reaction_type, user_email
// The migration keeps emoji ↔ reaction_type and created_by ↔ user_email in sync via trigger,
// but we write the canonical schema fields here (created_by via auto-inject, emoji for the value).

import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';
import { createBatcher } from '@/lib/microBatcher';
import * as hubPosts from './hubPosts';

const e = () => db.entities.HubReaction;

// ── Batched my-reaction reads ────────────────────────────────────────────
//
// Every feed card fires getMyReaction + getMyEmojiReaction on mount —
// 2 queries × N cards per page. Both read the same table with the same
// (post_id, created_by) predicate, so one batcher serves both: calls
// landing in the same tick collapse into a single
// `post_id IN (…) AND created_by = email` query, and each helper picks
// what it needs from the per-post row list (newest-first, mirroring the
// old per-post `-created_date` order). One batcher per email — in
// practice just the signed-in user. Covered by the table's
// (created_by, post_id, emoji) unique index.
const myRowsBatchers = new Map();
const loadMyRows = (email, postId) => {
  let batcher = myRowsBatchers.get(email);
  if (!batcher) {
    batcher = createBatcher(async (postIds) => {
      const { data, error } = await supabase
        .from('hub_reactions')
        .select('*')
        .in('post_id', postIds)
        .eq('created_by', email)
        .order('created_date', { ascending: false });
      if (error) throw error;
      const byPost = new Map();
      for (const row of data || []) {
        const rows = byPost.get(row.post_id);
        if (rows) rows.push(row);
        else byPost.set(row.post_id, [row]);
      }
      return byPost;
    });
    myRowsBatchers.set(email, batcher);
  }
  return batcher(postId);
};

/** Get the current user's reaction (or null) for a given post. */
export const getMyReaction = async (postId, email) => {
  if (!postId || !email) return null;
  // Filter by created_by (auto-injected on insert) — migration also populates user_email
  const rows = await loadMyRows(email, postId).catch(() => null);
  return rows?.[0] || null;
};

/**
 * Set the user's reaction on a post. Pass `null` to clear.
 * Handles all transitions: none→like, like→dislike, like→none, etc.
 *
 * Atomicity: prefers the set_post_reaction RPC (migration 024) which
 * performs delete+insert+counter updates inside a single transaction.
 * The old non-atomic path remains as a fallback for users who haven't
 * applied migration 024 yet — same per-step behavior as before, including
 * the small drift risk if a partial failure happens between writes.
 */
export const setReaction = async (postId, email, newReaction /* 'like' | 'dislike' | null */) => {
  // Atomic path — migration 024.
  try {
    const { error } = await supabase.rpc('set_post_reaction', {
      p_post_id:  postId,
      p_reaction: newReaction,
    });
    if (!error) {
      // RPC succeeded. Return the new reaction's row shape (or null) for
      // callers — fetch only when we transitioned INTO a non-null state.
      if (newReaction) return getMyReaction(postId, email);
      return null;
    }
    // 42883 = function does not exist (migration not yet applied).
    // 42P01 = relation does not exist. Anything else is real — log and fall through.
    if (error.code !== '42883' && error.code !== '42P01') {
      console.warn('[hubReactions] RPC failed, falling back:', error);
    }
  } catch (err) {
    console.warn('[hubReactions] RPC threw, falling back:', err);
  }

  // Fallback path — non-atomic, pre-migration-024.
  const existing = await getMyReaction(postId, email);
  if (existing && existing.reaction_type === newReaction) return existing;

  if (existing) {
    await e().delete(existing.id).catch(() => {});
    const field = existing.reaction_type === 'like' ? 'like_count' : 'dislike_count';
    await hubPosts.incrementCounter(postId, field, -1);
  }

  if (newReaction) {
    const created = await e().create({
      post_id: postId,
      reaction_type: newReaction,
      emoji: newReaction,
      user_email: email,
    });
    const field = newReaction === 'like' ? 'like_count' : 'dislike_count';
    await hubPosts.incrementCounter(postId, field, +1);
    return created;
  }

  return null;
};

/**
 * Get the current user's emoji reaction on a post (if any). Emoji
 * reactions are independent from like/dislike — a user can have both.
 * Returns the emoji string or null.
 */
export async function getMyEmojiReaction(postId, email) {
  if (!postId || !email) return null;
  // Shares the batched (post_id IN …) fetch with getMyReaction; emoji
  // reactions are the rows with reaction_type NULL, newest first.
  const rows = await loadMyRows(email, postId).catch(() => null);
  return rows?.find((r) => r.reaction_type == null)?.emoji || null;
}

/**
 * Set or clear the user's emoji reaction on a post. Pass null to clear.
 * Returns the new emoji_reaction_count on success, or null on RPC error.
 */
export async function setEmojiReaction(postId, emoji) {
  if (!postId) return null;
  try {
    const { data, error } = await supabase.rpc('set_post_emoji_reaction', {
      p_post_id: postId,
      p_emoji:   emoji || null,
    });
    if (error) {
      if (error.code === '42883' || error.code === '42P01') return null;
      console.warn('[hubReactions] emoji RPC failed:', error);
      return null;
    }
    return Number(data) || 0;
  } catch (err) {
    console.warn('[hubReactions] emoji RPC threw:', err?.message || err);
    return null;
  }
}

/** Cascade-delete all reactions by a user and decrement post counters. */
export const purgeForUser = async (email) => {
  if (!email) return;
  const rows = await e().filter({ created_by: email }, '-created_date', 1000).catch(() => []);
  const dec = {};
  for (const r of rows) {
    if (!r.post_id || !r.reaction_type) continue;
    dec[r.post_id] = dec[r.post_id] || { like: 0, dislike: 0 };
    dec[r.post_id][r.reaction_type] = (dec[r.post_id][r.reaction_type] || 0) + 1;
  }
  await Promise.all(rows.map(r => e().delete(r.id).catch(() => {})));
  await Promise.all(
    Object.entries(dec).flatMap(([postId, counts]) => [
      counts.like    ? hubPosts.incrementCounter(postId, 'like_count',    -counts.like).catch(() => {})    : null,
      counts.dislike ? hubPosts.incrementCounter(postId, 'dislike_count', -counts.dislike).catch(() => {}) : null,
    ].filter(Boolean))
  );
};

/**
 * Post ids the signed-in user has LIKED, newest first.
 *
 * Reads `created_by` rather than taking a user id parameter: the column is
 * auto-injected on insert (see db.js makeEntity) and the table's RLS scopes a
 * SELECT to your own rows, so this can only ever return your own likes. That
 * is the whole privacy model for this screen — there is no view of anyone
 * else's likes to accidentally expose, because the query cannot express one.
 *
 * Ids only. The posts themselves are fetched separately so a like pointing at
 * a deleted post simply drops out instead of rendering a broken row.
 */
export const listMyLikedPostIds = async (email, limit = 200) => {
  if (!email) return [];
  const { data, error } = await supabase
    .from('hub_reactions')
    .select('post_id, created_date')
    .eq('created_by', email)
    .eq('reaction', 'like')
    .order('created_date', { ascending: false })
    .limit(limit);
  if (error) return [];
  // De-dupe defensively: the unique index is (created_by, post_id, emoji), so
  // a like plus an emoji reaction on the same post is two rows, and without
  // this the post would render twice.
  const seen = new Set();
  const ids = [];
  for (const row of data || []) {
    if (!row.post_id || seen.has(row.post_id)) continue;
    seen.add(row.post_id);
    ids.push(row.post_id);
  }
  return ids;
};
