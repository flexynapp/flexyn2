// src/lib/data/hubCommentLikes.js
//
// Schema: id, created_by (email — auto-injected), user_id (uuid — auto-injected),
//         comment_id uuid, created_at, created_date
// Unique constraint: (created_by, comment_id)
// We filter by `created_by` (email) which is auto-injected on every create().

import { base44 } from '@/api/base44Client';
import * as hubComments from './hubComments';

const e = () => base44.entities.HubCommentLike;

/** Get the current user's like row for a comment, or null. */
export const getMyLike = async (commentId, email) => {
  if (!commentId || !email) return null;
  const rows = await e().filter({ comment_id: commentId, created_by: email }, '-created_date', 1).catch(() => []);
  return rows[0] || null;
};

/**
 * Batch-resolve like state for a visible thread.
 * Returns a Set<string> of comment IDs the user has liked.
 */
export const listLikedCommentIds = async (email, commentIds) => {
  if (!email || !commentIds || commentIds.length === 0) return new Set();
  const rows = await e().filter({ created_by: email }, '-created_date', 1000).catch(() => []);
  const wanted = new Set(commentIds);
  return new Set(rows.filter(r => wanted.has(r.comment_id)).map(r => r.comment_id));
};

/**
 * Set liked state for a comment. Pass liked=true to like, false to unlike.
 */
export const setLiked = async (commentId, email, liked) => {
  const existing = await getMyLike(commentId, email);

  if (liked) {
    if (existing) return existing; // already liked — no-op
    // created_by and user_id are auto-injected by base44Client.create()
    const created = await e().create({ comment_id: commentId });
    await hubComments.incrementCounter(commentId, 'like_count', +1);
    return created;
  } else {
    if (!existing) return null; // already not liked — no-op
    await e().delete(existing.id).catch(() => {});
    await hubComments.incrementCounter(commentId, 'like_count', -1);
    return null;
  }
};

/**
 * Delete all like rows for a specific comment (used when deleting the comment).
 * Does NOT decrement like_count since the comment itself is being deleted.
 */
export const purgeLikesForComment = async (commentId) => {
  if (!commentId) return;
  const rows = await e().filter({ comment_id: commentId }, '-created_date', 500).catch(() => []);
  await Promise.all(rows.map(r => e().delete(r.id).catch(() => {})));
};

/**
 * Cascade-delete all like rows for a user and decrement affected comment counters.
 * Used during account deletion.
 */
export const purgeForUser = async (email) => {
  if (!email) return;
  const rows = await e().filter({ created_by: email }, '-created_date', 1000).catch(() => []);
  const dec = {};
  for (const r of rows) {
    if (!r.comment_id) continue;
    dec[r.comment_id] = (dec[r.comment_id] || 0) + 1;
  }
  await Promise.all(rows.map(r => e().delete(r.id).catch(() => {})));
  await Promise.all(
    Object.entries(dec).map(([cid, n]) =>
      hubComments.incrementCounter(cid, 'like_count', -n).catch(() => {})
    )
  );
};
