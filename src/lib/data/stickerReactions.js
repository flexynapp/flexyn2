// src/lib/data/stickerReactions.js
// Sticker reactions on hub posts — backed by post_sticker_reactions table.

import { supabase } from '@/api/supabaseClient';

/** Fetch all sticker reactions for a post, oldest first. */
export async function getPostReactions(postId) {
  if (!postId) return [];
  const { data, error } = await supabase
    .from('post_sticker_reactions')
    .select('*')
    .eq('post_id', postId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Get the current user's sticker reaction for a post (or null). */
export async function getMyReaction(postId, userId) {
  if (!postId || !userId) return null;
  const { data, error } = await supabase
    .from('post_sticker_reactions')
    .select('*')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Place or replace the current user's sticker reaction.
 * sticker = { item_id, item_emoji, item_rarity, variant }
 */
export async function reactWithSticker(postId, user, sticker) {
  if (!postId || !user?.id || !sticker) throw new Error('Missing args');
  const { error } = await supabase
    .from('post_sticker_reactions')
    .upsert({
      post_id:        postId,
      user_id:        user.id,
      user_email:     user.email,
      user_name:      user.username ?? user.email?.split('@')[0] ?? 'User',
      user_avatar_url: user.avatar_url ?? null,
      item_id:        sticker.item_id,
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
