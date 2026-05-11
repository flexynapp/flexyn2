// src/lib/data/hubComments.js
import { db } from '@/api/db';
import { containsProfanity } from '@/lib/profanityFilter';
import * as hubPosts from './hubPosts';
import * as hubCommentLikes from './hubCommentLikes';

const e = () => db.entities.HubComment;

function assertNoTextProfanity(fields) {
  for (const [key, val] of Object.entries(fields)) {
    if (typeof val === 'string' && containsProfanity(val)) {
      throw Object.assign(new Error(`Profanity detected in field "${key}"`), { code: 'PROFANITY', field: key });
    }
  }
}

/** List comments for a post, oldest first (chronological reading order). */
export const listForPost = async (postId, limit = 200) => {
  if (!postId) return [];
  return e().filter({ post_id: postId }, 'created_date', limit).catch(() => []);
};

/**
 * Atomically bump a counter on a comment. Reads the comment,
 * increments the field locally, writes back. NOT race-safe.
 */
export const incrementCounter = async (commentId, field, delta = 1) => {
  const rows = await e().filter({ id: commentId }).catch(() => []);
  const comment = rows?.[0];
  if (!comment) return null;
  const current = Number(comment[field] || 0);
  const next = Math.max(0, current + delta);
  return e().update(commentId, { [field]: next });
};

/**
 * Create a comment and bump the post's comment_count.
 * Passes parent_comment_id through unchanged (null for top-level).
 * Replies count toward post.comment_count the same way as top-level comments.
 *
 * NOTE: writes `body` AND `content` so the insert succeeds whether the
 * legacy `content` column still has a NOT NULL constraint or the newer
 * `body` column is the source of truth (migration 004 introduced `body`
 * but didn't drop `content` to avoid breaking older clients). The payload
 * cleanup in src/api/db.js will strip whichever column doesn't exist.
 */
export const create = async (data) => {
  assertNoTextProfanity({ body: data.body });
  const payload = {
    ...data,
    ...(data.body && data.content == null ? { content: data.body } : {}),
  };
  const created = await e().create(payload);
  if (data.post_id) {
    await hubPosts.incrementCounter(data.post_id, 'comment_count', +1);
  }
  return created;
};

/**
 * Delete a comment, cascade-delete its replies and all associated likes,
 * then decrement the post's comment_count by 1 + number of deleted replies.
 */
export const remove = async (commentId, postId) => {
  // Find replies whose parent_comment_id === commentId
  const replies = await e()
    .filter({ parent_comment_id: commentId }, '-created_date', 500)
    .catch(() => []);

  // Purge likes for this comment and all its replies
  const allIds = [commentId, ...replies.map(r => r.id)];
  await Promise.all(
    allIds.map(cid => hubCommentLikes.purgeLikesForComment(cid).catch(() => {}))
  );

  // Delete replies first, then the comment itself
  await Promise.all(replies.map(r => e().delete(r.id).catch(() => {})));
  await e().delete(commentId).catch(() => {});

  if (postId) {
    await hubPosts.incrementCounter(postId, 'comment_count', -(1 + replies.length));
  }
};

/**
 * Build a threaded structure from a flat list (sorted oldest-first).
 * Returns { topLevel: Comment[], repliesByParent: Map<string, Comment[]> }
 * Orphan replies (parent not in list) are skipped.
 */
export const buildThread = (comments) => {
  const byId = new Map(comments.map(c => [c.id, c]));
  const topLevel = [];
  const repliesByParent = new Map();

  for (const c of comments) {
    if (!c.parent_comment_id) {
      topLevel.push(c);
    } else if (byId.has(c.parent_comment_id)) {
      if (!repliesByParent.has(c.parent_comment_id)) {
        repliesByParent.set(c.parent_comment_id, []);
      }
      repliesByParent.get(c.parent_comment_id).push(c);
    }
    // else: orphan reply — skip
  }

  return { topLevel, repliesByParent };
};

/**
 * Cascade-delete all comments by a user, decrement post counters,
 * then purge their comment likes.
 */
export const purgeForUser = async (email) => {
  if (!email) return;
  const rows = await e().filter({ author_email: email }, '-created_date', 1000).catch(() => []);
  const decrements = {};
  for (const r of rows) {
    if (r.post_id) decrements[r.post_id] = (decrements[r.post_id] || 0) + 1;
  }
  await Promise.all(rows.map(r => e().delete(r.id).catch(() => {})));
  await Promise.all(
    Object.entries(decrements).map(([postId, n]) =>
      hubPosts.incrementCounter(postId, 'comment_count', -n).catch(() => {})
    )
  );
  // Purge comment likes AFTER comments are deleted so counter decrements
  // don't race against the row deletions above.
  await hubCommentLikes.purgeForUser(email);
};