// src/lib/data/hubCommentLikes.js
//
// Schema: id, created_by (email — auto-injected), user_id (uuid — auto-injected),
//         comment_id uuid, created_at, created_date
// Unique constraint: (created_by, comment_id)
// Likes are publicly readable, so the app never reads created_by (the
// liker's email): it names its columns and matches the liker by user_id.

import { ownedRows } from './ownedRows';
import * as hubComments from './hubComments';

export const LIKE_COLUMNS = 'id, user_id, comment_id, created_at, created_date';
const e = () => ownedRows('hub_comment_likes', { columns: LIKE_COLUMNS });

/** Get the current user's like row for a comment, or null. */
export const getMyLike = async (commentId, userId) => {
  if (!commentId || !userId) return null;
  const rows = await e().filter({ comment_id: commentId, user_id: userId }, '-created_date', 1).catch(() => []);
  return rows[0] || null;
};

/**
 * Batch-resolve like state for a visible thread.
 * Returns a Set<string> of comment IDs the user has liked.
 */
export const listLikedCommentIds = async (userId, commentIds) => {
  if (!userId || !commentIds || commentIds.length === 0) return new Set();
  const rows = await e().filter({ user_id: userId, comment_id: commentIds }, '-created_date', 1000).catch(() => []);
  const wanted = new Set(commentIds);
  return new Set(rows.filter(r => wanted.has(r.comment_id)).map(r => r.comment_id));
};

/**
 * Set liked state for a comment. Pass liked=true to like, false to unlike.
 */
export const setLiked = async (commentId, userId, liked) => {
  const existing = await getMyLike(commentId, userId);

  if (liked) {
    if (existing) return existing; // already liked — no-op
    // created_by and user_id are injected by ownedRows.create; see
    // src/lib/data/ownedRows.js.
    const created = await e().create({ comment_id: commentId });
    await hubComments.incrementCounter(commentId, 'like_count', +1);
    return created;
  } else {
    if (!existing) return null; // already not liked — no-op
    await e().remove(existing.id).catch(() => {});
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
  await Promise.all(rows.map(r => e().remove(r.id).catch(() => {})));
};
