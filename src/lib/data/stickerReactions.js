// src/lib/data/stickerReactions.js
// Sticker reactions on hub posts — backed by post_sticker_reactions table.

import { supabase } from '@/api/supabaseClient';
import { createBatcher } from '@/lib/microBatcher';

const PER_POST_LIMIT = 50;

// Every column but user_email: reactions render on posts everyone can see,
// and the reactor is identified by user_id / user_name.
const REACTION_COLUMNS = 'id, post_id, user_id, item_id, item_name, item_emoji, item_rarity, variant, created_at, user_avatar_url, user_name';

// Feed cards each fetch a post's sticker reactions on mount — one query
// per card. Coalesce same-tick calls into a single `post_id IN (…)`
// fetch. The global row cap scales with the batch size so the worst
// case matches what the old per-post queries could return combined;
// per-post slicing below re-applies the exact per-post cap.
const postReactionsBatcher = createBatcher(async (postIds) => {
  const { data, error } = await supabase
    .from('post_sticker_reactions')
    .select(REACTION_COLUMNS)
    .in('post_id', postIds)
    .order('created_at', { ascending: false })
    .limit(postIds.length * PER_POST_LIMIT);
  if (error) throw error;
  const byPost = new Map();
  for (const row of data ?? []) {
    const rows = byPost.get(row.post_id);
    if (rows) rows.push(row);
    else byPost.set(row.post_id, [row]);
  }
  // Newest-first per post → cap → reverse for chronological display.
  for (const [id, rows] of byPost) {
    byPost.set(id, rows.slice(0, PER_POST_LIMIT).reverse());
  }
  return byPost;
});

/** Fetch the most recent N sticker reactions for a post (default 50).
 *  Capped to avoid hammering the DB on viral posts; the UI shows a
 *  "+N more" rollup when the count exceeds the limit. */
export async function getPostReactions(postId, limit = PER_POST_LIMIT) {
  if (!postId) return [];
  if (limit === PER_POST_LIMIT) {
    return (await postReactionsBatcher(postId)) || [];
  }
  // Non-default limit — rare path, keep the exact single-post query.
  const { data, error } = await supabase
    .from('post_sticker_reactions')
    .select(REACTION_COLUMNS)
    .eq('post_id', postId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  // Reverse for chronological display order (UI expects oldest-first).
  return (data ?? []).reverse();
}

/** Get the current user's sticker reaction for a post (or null). */
export async function getMyReaction(postId, userId) {
  if (!postId || !userId) return null;
  const { data, error } = await supabase
    .from('post_sticker_reactions')
    .select(REACTION_COLUMNS)
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Place or replace the current user's sticker reaction.
 * sticker = { item_id, item_name, item_emoji, item_rarity, variant }
 *
 * NOTE: post_sticker_reactions.item_name is NOT NULL in the DB schema (set
 * by an early seed script before migration 010 ran). We MUST send a non-empty
 * item_name on insert, else Postgres rejects with "null value in column
 * 'item_name' violates not-null constraint". Fall back to the emoji or a
 * literal 'Sticker' so callers can be lazy.
 */
export async function reactWithSticker(postId, user, sticker) {
  if (!postId || !user?.id || !sticker) throw new Error('Missing args');
  const itemName = sticker.item_name || sticker.name || sticker.item_emoji || 'Sticker';
  const { error } = await supabase
    .from('post_sticker_reactions')
    .upsert({
      post_id:        postId,
      user_id:        user.id,
      user_email:     user.email,
      user_name:      user.username ?? 'User',
      user_avatar_url: user.avatar_url ?? null,
      item_id:        sticker.item_id,
      item_name:      itemName,
      item_emoji:     sticker.item_emoji,
      item_rarity:    sticker.item_rarity ?? 'common',
      variant:        sticker.variant ?? null,
    }, { onConflict: 'post_id,user_id' });
  if (error) throw error;
}

/** Remove the current user's sticker reaction from a post. */
export async function removeReaction(postId, userId) {
  if (!postId || !userId) return;
  const { error } = await supabase
    .from('post_sticker_reactions')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId);
  if (error) throw error;
}
