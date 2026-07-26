// src/lib/data/conversationRequests.js
//
// Client wrappers for the "Message Requests" inbox (migration 113).
//
// Acceptance state lives in hub_conversations.accepted_emails (text[]).
// A conversation appears in Requests when:
//   • the viewer is a participant
//   • AND their email is NOT in accepted_emails
//
// Acceptance happens either explicitly via the accept_conversation
// RPC, OR implicitly when the viewer sends a message (mig 113's
// trg_auto_accept_on_send trigger appends the sender).

import { supabase } from '@/api/supabaseClient';

/**
 * Explicitly accept a conversation (move it from Requests to inbox).
 * Idempotent server-side (the SQL guards against duplicate appends).
 */
export async function acceptConversation(convId) {
  if (!convId) throw new Error('convId required');
  const { error } = await supabase.rpc('accept_conversation', { p_conv_id: convId });
  if (error) throw error;
}

/**
 * Decline (delete) a message request. The conversation row is SHARED by
 * both participants, so a hard delete would also wipe the sender's copy —
 * mig 234's decline_conversation instead appends the caller's email to
 * `declined_emails`, which hides the thread for them only.
 *
 * Cleared again if they accept it later, start the conversation
 * themselves, or follow the other person (mig 235).
 */
export async function declineConversation(convId) {
  if (!convId) throw new Error('convId required');
  const { error } = await supabase.rpc('decline_conversation', { p_conv_id: convId });
  if (error) throw error;
}

/**
 * Mirror of mig 234's `dm_pending_send_allowed` RLS check, for UI only.
 *
 * A pending sender gets exactly ONE message until the recipient accepts.
 * The database is the enforcement point (a RESTRICTIVE INSERT policy on
 * hub_messages); this exists so the composer can disable itself and
 * explain why instead of letting the user type into a wall.
 *
 * Returns true when the viewer is BLOCKED from sending.
 *
 * @param {object} conversation        row with participant_emails + accepted_emails
 * @param {string} myEmail
 * @param {number} myMessageCount      messages the viewer already has in the thread
 */
export function isPendingRequestSendBlocked(conversation, myEmail, myMessageCount) {
  if (!conversation || !myEmail) return false;
  // Groups are exempt server-side — a creator legitimately talks into a
  // group whose members haven't accepted yet (mig 116).
  if (conversation.is_group) return false;
  const participants = Array.isArray(conversation.participant_emails)
    ? conversation.participant_emails.map(e => String(e).toLowerCase())
    : [];
  if (participants.length !== 2) return false;
  const myLc = String(myEmail).toLowerCase();
  const accepted = Array.isArray(conversation.accepted_emails)
    ? conversation.accepted_emails.map(e => String(e).toLowerCase())
    : [];
  const pending = participants.filter(e => e !== myLc && !accepted.includes(e));
  if (pending.length === 0) return false;
  return Number(myMessageCount || 0) >= 1;
}

/**
 * Partition a fetched conversation list into requests + inbox based on
 * the viewer's email + the conversation's accepted_emails array AND
 * the viewer's follow graph.
 *
 * A conversation lives in REQUESTS when ALL of the following hold:
 *   • viewer's email is NOT in c.accepted_emails
 *   • the other participant is NOT in the viewer's follows
 *
 * The second condition is what makes this "stranger filtering" — DMs
 * from accounts you already follow skip Requests even on first send.
 *
 * Conversations the viewer has DECLINED (mig 234's declined_emails)
 * are dropped from both lists — a decline hides the thread for the
 * decliner without destroying the sender's copy of the shared row.
 *
 * @param {Array} conversations  fetched list (each with participant_emails + accepted_emails)
 * @param {string} myEmail
 * @param {Set<string>|string[]} followingEmails  emails the viewer follows
 * @returns {{ inbox: Array, requests: Array }}
 */
export function partitionConversations(conversations, myEmail, followingEmails) {
  if (!Array.isArray(conversations) || !myEmail) {
    return { inbox: conversations || [], requests: [] };
  }
  const myLc = String(myEmail).toLowerCase();
  const followSet = followingEmails instanceof Set
    ? new Set(Array.from(followingEmails).map(e => String(e).toLowerCase()))
    : new Set((followingEmails || []).map(e => String(e).toLowerCase()));

  const inbox = [];
  const requests = [];
  for (const c of conversations) {
    const declined = Array.isArray(c.declined_emails)
      ? c.declined_emails.map(e => String(e).toLowerCase())
      : [];
    if (declined.includes(myLc)) continue;
    const accepted = Array.isArray(c.accepted_emails)
      ? c.accepted_emails.map(e => String(e).toLowerCase())
      : [];
    const participantsLc = Array.isArray(c.participant_emails)
      ? c.participant_emails.map(e => String(e).toLowerCase())
      : [];
    const otherEmails = participantsLc.filter(e => e !== myLc);
    // Self-conversations and orphaned conversations (participant_emails
    // missing/empty due to schema drift) used to route to the Requests
    // folder forever because `followsAny` was false. A conversation the
    // viewer participates in with no other participants is either a
    // self-DM or a transient creation state — surface it in the inbox
    // so it isn't permanently hidden. (Audit 17 #F20.)
    const isSelfOrOrphan = otherEmails.length === 0 && participantsLc.includes(myLc);
    const followsAny = otherEmails.some(e => followSet.has(e));
    const accepted_by_me = accepted.includes(myLc);
    if (accepted_by_me || followsAny || isSelfOrOrphan) {
      inbox.push(c);
    } else {
      requests.push(c);
    }
  }
  return { inbox, requests };
}
