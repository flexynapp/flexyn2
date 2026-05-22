// src/lib/data/storyReactions.js
//
// Emoji reactions on stories, backed by migration 097. One reaction
// per (story, user) — sending a different emoji overwrites the
// previous one. Similar shape to post_sticker_reactions but at the
// story granularity.

import { supabase } from '@/api/supabaseClient';

const ALLOWED_EMOJIS = ['😍', '🔥', '💪', '😂', '🎉', '👏'];

/** Returns true when the given emoji is in the allowed set. */
export function isAllowedReactionEmoji(emoji) {
  return ALLOWED_EMOJIS.includes(emoji);
}

export { ALLOWED_EMOJIS };

/**
 * Set the current user's emoji reaction on a story. Upsert on
 * (story_id, user_id). A null/undefined emoji REMOVES the existing
 * reaction.
 */
export async function reactToStory(storyId, emoji) {
  if (!storyId) return { ok: false, reason: 'no_story' };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return { ok: false, reason: 'unauthenticated' };

  if (emoji == null) {
    const { error } = await supabase
      .from('story_reactions')
      .delete()
      .eq('story_id', storyId)
      .eq('user_id', user.id);
    if (error) return { ok: false, reason: 'db_error' };
    return { ok: true, removed: true };
  }

  if (!isAllowedReactionEmoji(emoji)) {
    return { ok: false, reason: 'invalid_emoji' };
  }

  const { error } = await supabase
    .from('story_reactions')
    .upsert({
      story_id:   storyId,
      user_id:    user.id,
      user_email: user.email,
      user_name:  user.user_metadata?.username || null,
      emoji,
    }, { onConflict: 'story_id,user_id' });
  if (error) return { ok: false, reason: 'db_error' };
  return { ok: true };
}

/** List all reactions for a story. Returns array of rows. */
export async function listReactionsForStory(storyId, limit = 100) {
  if (!storyId) return [];
  const { data, error } = await supabase
    .from('story_reactions')
    .select('id, user_id, user_email, user_name, emoji, created_at')
    .eq('story_id', storyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data ?? [];
}

/** Get the current user's reaction for a story (or null). */
export async function getMyReactionForStory(storyId) {
  if (!storyId) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const { data, error } = await supabase
    .from('story_reactions')
    .select('emoji')
    .eq('story_id', storyId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) return null;
  return data?.emoji ?? null;
}
