// src/lib/data/hubReactions.js
//
// Reactions are "like" or "dislike" stored in hub_reactions.
// Schema fields: created_by (email), post_id, emoji (= reaction_type), reaction_type, user_email
// The migration keeps emoji ↔ reaction_type and created_by ↔ user_email in sync via trigger,
// but we write the canonical schema fields here (created_by via auto-inject, emoji for the value).

import { db } from '@/api/db';
import * as hubPosts from './hubPosts';

const e = () => db.entities.HubReaction;

/** Get the current user's reaction (or null) for a given post. */
export const getMyReaction = async (postId, email) => {
  if (!postId || !email) return null;
  // Filter by created_by (auto-injected on insert) — migration also populates user_email
  const rows = await e().filter({ post_id: postId, created_by: email }, '-created_date', 1).catch(() => []);
  return rows[0] || null;
};

/**
 * Set the user's reaction on a post. Pass `null` to clear.
 * Handles all transitions: none→like, like→dislike, like→none, etc.
 * Updates the denormalised counters on the post (best-effort).
 */
export const setReaction = async (postId, email, newReaction /* 'like' | 'dislike' | null */) => {
  const existing = await getMyReaction(postId, email);

  // No-op if the reaction hasn't changed
  if (existing && existing.reaction_type === newReaction) return existing;

  // Decrement old counter if switching away from a previous reaction
  if (existing) {
    await e().delete(existing.id).catch(() => {});
    const field = existing.reaction_type === 'like' ? 'like_count' : 'dislike_count';
    await hubPosts.incrementCounter(postId, field, -1);
  }

  // Insert new reaction (if not clearing)
  if (newReaction) {
    // `created_by` and `user_id` are auto-injected by base44Client.create().
    // Write `reaction_type` AND `emoji` so both columns stay populated.
    const created = await e().create({
      post_id: postId,
      reaction_type: newReaction,
      emoji: newReaction,         // schema unique constraint uses (created_by, post_id, emoji)
      user_email: email,          // redundant but kept for legacy queries
    });
    const field = newReaction === 'like' ? 'like_count' : 'dislike_count';
    await hubPosts.incrementCounter(postId, field, +1);
    return created;
  }

  return null;
};

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
