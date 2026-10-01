// src/lib/data/dmLifecycle.js
//
// Client wrappers for DM message lifecycle (migration 114):
//   • deleteMyMessage(messageId)        — soft-delete
//   • scheduleMyMessage(...)            — schedule a send for later
//   • cancelMyScheduledMessage(id)      — pull a pending message
//
// All three are SECURITY DEFINER RPCs gated on auth.uid() ownership;
// these are thin wrappers that propagate errors so the UI can show
// a retry toast.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';


/** Soft-delete one of your own messages. */
export async function deleteMyMessage(messageId) {
  if (!messageId) throw new Error('messageId required');
  const { error } = await supabase.rpc('delete_my_message', { p_message_id: messageId });
  if (error) throw error;
}

/**
 * Schedule a message to be released to the conversation at p_send_at.
 *
 * @param {object} opts
 * @param {string} opts.conversationId
 * @param {string} opts.recipientEmail
 * @param {string} opts.content
 * @param {string|Date} opts.sendAt   ISO string or Date; must be in the future.
 * @returns {Promise<string>}  the new message's UUID
 */
export async function scheduleMyMessage({ conversationId, recipientEmail, content, sendAt }) {
  if (!conversationId || !content || !sendAt) {
    throw new Error('conversationId, content, sendAt required');
  }
  const iso = typeof sendAt === 'string' ? sendAt : new Date(sendAt).toISOString();
  const { data, error } = await supabase.rpc('schedule_my_message', {
    p_conversation_id: conversationId,
    p_recipient_email: recipientEmail || null,
    p_content:         content,
    p_send_at:         iso,
  });
  if (error) throw error;
  return data;
}

/** Cancel a pending scheduled message you own. */
export async function cancelMyScheduledMessage(messageId) {
  if (!messageId) throw new Error('messageId required');
  const { error } = await supabase.rpc('cancel_my_scheduled_message', { p_message_id: messageId });
  if (error) throw error;
}

/**
 * Load all of the current user's pending scheduled messages. RLS
 * already restricts SELECT to messages where the viewer is a
 * participant; status filter does the rest.
 */
export async function listMyScheduled(userId) {
  if (!userId) return [];
  const { data, error } = await safeSelect({
    columns: ['id', 'conversation_id', 'content', 'scheduled_at', 'user_id'],
    build: (cols) => supabase
      .from('hub_messages')
      .select(cols)
      .eq('user_id', userId)
      .eq('status', 'scheduled')
      .order('scheduled_at', { ascending: true }),
  });
  if (error) return [];
  return data ?? [];
}
