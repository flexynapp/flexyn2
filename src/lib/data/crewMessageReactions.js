// src/lib/data/crewMessageReactions.js
// Emoji reactions on crew chat messages (migration 130).
// Mirrors dmMessageReactions.js — same table shape, same RPC pattern.

import { supabase } from '@/api/supabaseClient';
import { createBatcher } from '@/lib/microBatcher';

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

// Every rendered CrewMessageItem keeps a per-message reactions query
// alive on a 15s refetchInterval — without batching that's one DB query
// per visible message per tick (50 messages = 50 queries/15s per open
// chat). The intervals were all started at mount, so refetches land in
// the same tick; a 50ms window collapses them into ONE IN (...) query.
// TanStack still owns caching/invalidation per message key above this.
const reactionsBatcher = createBatcher(async (messageIds) => {
  const map = await getReactionsForMessages(messageIds);
  return new Map(messageIds.map((id) => [id, map[id] || []]));
}, { windowMs: 50 });

/**
 * Batched single-message read: same-tick callers share one round-trip.
 * Returns [{ user_id, emoji }] for the message (empty array if none).
 */
export const getReactionsForMessage = (messageId) => reactionsBatcher(messageId);

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
