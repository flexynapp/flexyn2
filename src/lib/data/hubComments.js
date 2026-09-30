// src/lib/data/hubComments.js
import { ownedRows } from './ownedRows';
import { supabase } from '@/api/supabaseClient';
import { containsProfanity } from '@/lib/profanityFilter';
import * as hubPosts from './hubPosts';
import * as hubCommentLikes from './hubCommentLikes';

// created_by and author_email are the commenter's email, readable by anyone
// who can see the post, so the app names its columns without them and tells
// commenters apart by user_id.
export const COMMENT_COLUMNS = 'id, user_id, post_id, parent_comment_id, author_name, author_avatar, content, body, likes_count, like_count, created_at, created_date, updated_at';
const e = () => ownedRows('hub_comments', { columns: COMMENT_COLUMNS });

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
 * but didn't drop `content` to avoid breaking older clients). Both columns
 * exist in production (checked 2026-09-27), both nullable.
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

  // Fan out a notification to the recipient. Server-side i18n + recipient
  // resolution via notify_comment_reply_for (migration 086):
  //   • top-level comment → post author gets "alice commented on your post"
  //   • reply              → parent comment author gets "alice replied to
  //                          your comment"
  // The RPC computes the recipient itself so the client doesn't have to
  // know which case it's in. The 034 trigger on notifications turns this
  // into a Web Push if the recipient is subscribed and hasn't muted the
  // 'social' category in their notification_prefs. Pre-086 hosts (RPC
  // missing) silently no-op so comment creation still succeeds.
  if (created?.id) {
    try {
      const { error: rpcErr } = await supabase.rpc('notify_comment_reply_for', {
        p_comment_id: created.id,
      });
      if (rpcErr && rpcErr.code !== '42883' && rpcErr.code !== '42P01') {
        // Real RPC failure — the comment itself was already written
        // which is the canonical event. Log without throwing so the
        // caller's optimistic UI doesn't roll back.
        console.warn('[hubComments] notify_comment_reply_for failed:', rpcErr);
      }
    } catch (e) {
      // Network/unexpected throw. Non-critical to the comment itself.
      console.warn('[hubComments] notify_comment_reply_for threw:', e?.message || e);
    }
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
  await Promise.all(replies.map(r => e().remove(r.id).catch(() => {})));
  await e().remove(commentId).catch(() => {});

  if (postId) {
    await hubPosts.incrementCounter(postId, 'comment_count', -(1 + replies.length));
  }
};

/**
 * Build a threaded structure from a flat list (sorted oldest-first).
 * Returns { topLevel: Comment[], repliesByParent: Map<string, Comment[]> }
 *
 * Orphan replies — replies whose parent_comment_id no longer exists in the
 * list (parent was deleted between fetches, or never visible to this user
 * due to RLS) — are PROMOTED to top-level rather than silently dropped.
 * Previously they vanished from the UI, which meant a user's reply could
 * become invisible to them with no warning. Promotion preserves the
 * content; the slightly orphaned context is a smaller harm than losing
 * the comment altogether.
 */
export const buildThread = (comments) => {
  const byId = new Map(comments.map(c => [c.id, c]));
  const topLevel = [];
  const childrenOf = new Map();

  for (const c of comments) {
    if (!c.parent_comment_id) {
      topLevel.push(c);
    } else if (byId.has(c.parent_comment_id)) {
      if (!childrenOf.has(c.parent_comment_id)) childrenOf.set(c.parent_comment_id, []);
      childrenOf.get(c.parent_comment_id).push(c);
    } else {
      // Orphan reply — parent is gone. Promote to top-level so the
      // comment remains visible. Tag with an orphan flag so the UI can
      // surface a small "in reply to a deleted comment" hint if desired.
      topLevel.push({ ...c, _orphan: true });
    }
  }

  // Collect a root's ENTIRE descendant tree, not just its direct children,
  // and present it as one flat chronological run.
  //
  // This used to group a single level: `repliesByParent` was keyed by
  // parent_comment_id and the renderer only ever looked up a TOP-LEVEL id. A
  // reply to a reply therefore keyed itself under the reply, nothing asked for
  // that key, and the comment vanished — it saved to the database perfectly
  // and simply never appeared. Nothing errored, so the only symptom was a
  // comment the author could see land and then never find again.
  //
  // Flattening rather than nesting is deliberate. Indentation per level is
  // unusable on a 375px screen by about the third reply, so this follows the
  // Instagram/YouTube model: one visual level of indent, unlimited logical
  // depth, and who-answered-whom is carried by the @mention in the body. The
  // true parent is still stored, so a future renderer can rebuild the real
  // tree without a data migration.
  const repliesByParent = new Map();
  for (const root of topLevel) {
    const flat = [];
    // Depth-first, tracking visited ids: a malformed parent chain (a cycle
    // introduced by a bad write or a manual edit) would otherwise hang the
    // render thread rather than dropping one comment.
    const seen = new Set([root.id]);
    const walk = (id) => {
      for (const child of childrenOf.get(id) || []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        const parent = byId.get(child.parent_comment_id);
        flat.push({
          ...child,
          // Who this specific reply answers, for the "replying to @x" hint.
          // Null when it answers the root, where the hint would be noise.
          _replyTo: parent && parent.id !== root.id
            ? { user_id: parent.user_id, author_name: parent.author_name }
            : null,
        });
        walk(child.id);
      }
    };
    walk(root.id);
    if (flat.length) {
      flat.sort((a, b) => new Date(a.created_date || 0) - new Date(b.created_date || 0));
      repliesByParent.set(root.id, flat);
    }
  }

  return { topLevel, repliesByParent };
};
