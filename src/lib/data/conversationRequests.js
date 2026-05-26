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
