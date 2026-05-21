// src/lib/data/dmMessageReactions.js
// Emoji reactions on DM messages (migration 064).
// Uses toggle_dm_reaction SECURITY DEFINER RPC so no RLS edge cases.

import { supabase } from '@/api/supabaseClient';

/**
 * Fetch all reactions for an array of message IDs in one round-trip.
 * Returns { [messageId]: [{ user_id, emoji }] }
 */
export const getReactionsForMessages = async (messageIds) => {
  if (!messageIds?.length) return {};
  const { data, error } = await supabase
    .from('dm_message_reactions')
    .select('message_id, user_id, emoji')
    .in('message_id', messageIds);
  if (error || !data) return {};
  const map = {};
  for (const r of data) {
    if (!map[r.message_id]) map[r.message_id] = [];
    map[r.message_id].push(r);
  }
  return map;
};

/**
 * Toggle a reaction on/off for the current user.
 * Returns true if the reaction now exists, false if it was removed.
 */
export const toggleReaction = async (messageId, userId, emoji) => {
  const { data, error } = await supabase.rpc('toggle_dm_reaction', {
    p_message_id: messageId,
    p_user_id:    userId,
    p_emoji:      emoji,
  });
  if (error) throw error;
  return !!data;
};
