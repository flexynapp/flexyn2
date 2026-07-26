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
import { safeSelect } from '@/api/safeSelect';

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
 * Delete a message request — a REAL destructive purge, not a hide.
 *
 * mig 234's purge_message_request drops the hub_conversations row, which
 * cascades to hub_messages and everything hanging off them (DM emoji
 * reactions, DM polls, poll votes), so nothing is left orphaned. Both
 * participants lose the thread — the sender's copy goes too.
 *
 * Attachment blobs are cleaned up SERVER-side, inside the same RPC. They
 * can't be cleaned up from here: the storage object lives under the
 * SENDER's user-id folder, and the uploads bucket's delete policy (mig
 * 008) only lets a user remove their own files — while the participant
 * running the purge is always the recipient.
 *
 * The purge also records a pair-keyed request block so the same person
 * can't immediately open a fresh request. That block is cleared if the
 * blocker later follows them or starts a conversation with them.
 *
 * The server refuses to purge anything that isn't still a pending
 * request for the caller: it must be a 2-person, non-group thread the
 * caller participates in and has NOT accepted. An accepted conversation
 * raises `conversation_already_accepted` rather than being destroyed out
 * from under the other person; Archive is the affordance for those.
 *
 * @returns {Promise<boolean>} true when a row was actually deleted;
 *   false when it was already gone (treated as success by callers).
 */
export async function purgeMessageRequest(convId) {
  if (!convId) throw new Error('convId required');
  const { data, error } = await supabase.rpc('purge_message_request', { p_conv_id: convId });
  if (error) throw error;
  return !!data;
}

/**
 * Withdraw your OWN outgoing message request — the sender-side mirror of
 * purgeMessageRequest.
 *
 * purge is gated on "the CALLER has not accepted", which the sender can
 * never satisfy (start_dm_conversation auto-accepts whoever opened the
 * thread). mig 234's unsend_message_request is gated the other way: the
 * OTHER party must not have accepted, so an un-actioned request can be
 * taken back but a live conversation still can't be destroyed.
 *
 * It writes NO request block. Withdrawing a message is not blocking the
 * person you were trying to reach — recording one here would silently
 * stop THEM from ever opening a conversation with you.
 *
 * @returns {Promise<boolean>} true when a row was actually deleted;
 *   false when it was already gone (treated as success by callers).
 */
export async function unsendMessageRequest(convId) {
  if (!convId) throw new Error('convId required');
  const { data, error } = await supabase.rpc('unsend_message_request', { p_conv_id: convId });
  if (error) throw error;
  return !!data;
}

/**
 * True when `conversation` is the viewer's own outgoing request that the
 * recipient has not acted on yet — i.e. exactly the case unsend covers.
 *
 * These live in the viewer's INBOX (they accepted it by creating it), so
 * without this they look like any other thread and there is nowhere to
 * offer "unsend".
 */
export function isOutgoingPendingRequest(conversation, myEmail) {
  if (!conversation || !myEmail) return false;
  if (conversation.is_group) return false;
  const participants = Array.isArray(conversation.participant_emails)
    ? conversation.participant_emails.map(e => String(e).toLowerCase())
    : [];
  if (participants.length !== 2) return false;
  const myLc = String(myEmail).toLowerCase();
  if (!participants.includes(myLc)) return false;
  const accepted = Array.isArray(conversation.accepted_emails)
    ? conversation.accepted_emails.map(e => String(e).toLowerCase())
    : [];
  // I accepted (I opened it) and the other side has not.
  if (!accepted.includes(myLc)) return false;
  return participants.some(e => e !== myLc && !accepted.includes(e));
}

/**
 * Following someone is consent to hear from them, so any pending request
 * they already sent should move straight to the Inbox. Accepts the 1:1
 * conversation between the two emails if the follower hasn't accepted it
 * yet; a no-op otherwise.
 *
 * Mig 235's trg_dm_accept_conversations_on_follow does this server-side.
 * This client mirror exists for two reasons: it makes the flip instant
 * instead of waiting on the 15s inbox poll, and it keeps the behaviour
 * working on a host that has the frontend deployed but hasn't had the
 * SQL pasted in yet. Both paths are idempotent, so running both is safe.
 *
 * @returns {Promise<boolean>} true when a conversation was accepted
 */
export async function acceptPendingRequestsFrom(followerEmail, followeeEmail) {
  if (!followerEmail || !followeeEmail) return false;
  const me   = String(followerEmail).toLowerCase();
  const them = String(followeeEmail).toLowerCase();
  if (me === them) return false;

  // Same stable pair key findOrCreateConversation builds.
  const key = [me, them].sort().join('|');
  const { data } = await safeSelect({
    columns: ['id', 'accepted_emails'],
    build: (cols) => supabase
      .from('hub_conversations')
      .select(cols)
      .eq('participant_key', key)
      .limit(1),
  });
  const row = (data ?? [])[0];
  if (!row?.id) return false;

  const accepted = Array.isArray(row.accepted_emails)
    ? row.accepted_emails.map(e => String(e).toLowerCase())
    : [];
  if (accepted.includes(me)) return false;

  await acceptConversation(row.id);
  return true;
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
