// src/lib/data/crewMessageReactions.js
// Emoji reactions on crew chat messages (migration 130).
// Mirrors dmMessageReactions.js — same table shape, same RPC pattern.

import { supabase } from '@/api/supabaseClient';

/**
 * Fetch all reactions for an array of crew message IDs in one round-trip.
 * Returns { [messageId]: [{ user_id, emoji }] }
 */
export const getReactionsForMessages = async (messageIds) => {
  if (!messageIds?.length) return {};
  const { data, error } = await supabase
    .from('crew_message_reactions')
    .select('message_id, user_id, emoji')
    .in('message_id', messageIds);
  if (error || !data) return {};
  const map = {};
  for (const r of data) {
    if (!map[r.message_id]) map[r.message_id] = [];
    map[r.message_id].push({ user_id: r.user_id, emoji: r.emoji });
  }
  return map;
};

/**
 * Toggle a reaction on/off for the current user.
 * Falls back gracefully if the table/RPC doesn't exist yet (pre-migration).
 * Returns true if the reaction now exists, false if it was removed.
 */
export const toggleReaction = async (messageId, userId, emoji) => {
  try {
    const { data, error } = await supabase.rpc('toggle_crew_reaction', {
      p_message_id: messageId,
      p_user_id:    userId,
      p_emoji:      emoji,
    });
    if (error) throw error;
    return !!data;
  } catch {
    // Pre-migration fallback — direct upsert/delete without the RPC.
    // The try/catch is intentional: if neither the RPC nor the table
    // exists, we swallow the error so the UI remains functional.
    const exists = await supabase
      .from('crew_message_reactions')
      .select('id')
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji)
      .maybeSingle()
      .then(({ data }) => !!data)
      .catch(() => false);

    if (exists) {
      await supabase
        .from('crew_message_reactions')
        .delete()
        .eq('message_id', messageId)
        .eq('user_id', userId)
        .eq('emoji', emoji)
        .catch(() => {});
      return false;
    } else {
      await supabase
        .from('crew_message_reactions')
        .upsert({ message_id: messageId, user_id: userId, emoji })
        .catch(() => {});
      return true;
    }
  }
};
