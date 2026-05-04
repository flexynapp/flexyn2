// src/lib/data/hubMessages.js
//
// SECURITY: Messages are protected by Base44 RLS — the entity's read rule
// requires the requester to be either sender or recipient. This is
// access-controlled, not end-to-end encrypted. See BACKEND_CONTRACT.md
// section on Hub for the migration path to true E2E.

import { base44 } from '@/api/base44Client';

const conv = () => base44.entities.HubConversation;
const msg  = () => base44.entities.HubMessage;

/** Build a stable participant_key from two emails. */
const buildKey = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join('|');

/**
 * Find or create a 1:1 conversation between two users.
 * Idempotent — returns the existing conversation if one exists.
 */
export const findOrCreateConversation = async (myEmail, otherEmail) => {
  if (!myEmail || !otherEmail) return null;
  if (myEmail.toLowerCase() === otherEmail.toLowerCase()) return null; // can't DM yourself
  const key = buildKey(myEmail, otherEmail);
  const existing = await conv().filter({ participant_key: key }, '-created_date', 1).catch(() => []);
  if (existing.length > 0) return existing[0];
  return conv().create({
    participant_key: key,
    participant_emails: [myEmail, otherEmail].sort(),
    last_message_at: new Date().toISOString(),
    last_message_preview: '',
  });
};

/**
 * List conversations the user is in, sorted by most recent activity.
 * The RLS read rule guarantees only their own conversations are returned.
 */
export const listMyConversations = async (myEmail, limit = 50) => {
  if (!myEmail) return [];
  const myEmailLc = myEmail.toLowerCase();

  // 1. Fetch all conversations the user is in (case-insensitive)
  const all = await conv().filter({}, '-last_message_at', 200).catch(() => []);
  const mine = all.filter(c =>
    (c.participant_emails || []).some(e => e?.toLowerCase() === myEmailLc)
  );

  // 2. Group duplicates by participant_key
  const groups = new Map();
  for (const c of mine) {
    const key = c.participant_key;
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  // 3. Fetch ALL my recent messages in one batch — single query, then group locally
  const allMyMessages = await msg().filter({}, '-created_date', 500).catch(() => []);
  const messagesByConvId = new Map();
  for (const m of allMyMessages) {
    const cid = m.conversation_id;
    if (!cid) continue;
    if (!messagesByConvId.has(cid)) messagesByConvId.set(cid, []);
    messagesByConvId.get(cid).push(m);
  }

  // 4. For each duplicate group, pick the conversation with the most recent
  //    message, and aggregate unread counts across all duplicates in the group
  const deduped = [];
  for (const group of groups.values()) {
    let best = null;
    let bestMsg = null;
    let bestTime = 0;
    let unreadCount = 0;

    for (const c of group) {
      const msgs = messagesByConvId.get(c.id) || [];
      // Track latest message across the group
      if (msgs.length > 0) {
        const latest = msgs[0]; // already sorted -created_date
        const t = new Date(latest.created_date).getTime();
        if (t > bestTime) {
          best = c;
          bestMsg = latest;
          bestTime = t;
        }
      }
      // Sum unread (incoming, not yet read) across the group
      unreadCount += msgs.filter(m =>
        !m.read_at &&
        m.recipient_email?.toLowerCase() === myEmailLc
      ).length;
    }

    // Fallback: no messages in any duplicate — pick the most recently created
    if (!best) {
      group.sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0));
      best = group[0];
    }

    deduped.push({ ...best, latestMessage: bestMsg, unreadCount });
  }

  // 5. Sort the inbox by actual latest message time
  deduped.sort((a, b) => {
    const aT = a.latestMessage ? new Date(a.latestMessage.created_date).getTime()
                               : new Date(a.last_message_at || 0).getTime();
    const bT = b.latestMessage ? new Date(b.latestMessage.created_date).getTime()
                               : new Date(b.last_message_at || 0).getTime();
    return bT - aT;
  });

  return deduped.slice(0, limit);
};

/** List messages in a conversation, oldest first (chat reading order). */
export const listMessages = async (conversationId, limit = 200) => {
  if (!conversationId) return [];
  return msg().filter({ conversation_id: conversationId }, 'created_date', limit).catch(() => []);
};

/**
 * Send a message. Updates the conversation's last_message_at and preview.
 */
export const sendMessage = async ({ conversationId, senderEmail, recipientEmail, body }) => {
  if (!conversationId || !senderEmail || !recipientEmail || !body) return null;
  const created = await msg().create({
    conversation_id: conversationId,
    sender_email: senderEmail,
    recipient_email: recipientEmail,
    body,
  });
  // Bump conversation activity timestamp + preview
  try {
    await conv().update(conversationId, {
      last_message_at: new Date().toISOString(),
      last_message_preview: body.slice(0, 80),
    });
  } catch { /* non-blocking */ }
  return created;
};

/** Mark all messages in a conversation as read by the current user. */
export const markRead = async (conversationId, myEmail) => {
  if (!conversationId || !myEmail) return;
  const unread = await msg().filter(
    { conversation_id: conversationId, recipient_email: myEmail },
    '-created_date', 100
  ).catch(() => []);
  const now = new Date().toISOString();
  await Promise.all(
    unread.filter(m => !m.read_at).map(m =>
      msg().update(m.id, { read_at: now }).catch(() => {})
    )
  );
};

/** Total unread message count for inbox badge. */
export const unreadCountFor = async (myEmail) => {
  if (!myEmail) return 0;
  // Best-effort — fetch up to 200 most recent unread-eligible messages
  const recent = await msg().filter(
    { recipient_email: myEmail }, '-created_date', 200
  ).catch(() => []);
  return recent.filter(m => !m.read_at).length;
};

/** Cascade-delete all messages and conversations involving a user. */
export const purgeForUser = async (email) => {
  if (!email) return;
  // Delete messages where they're sender OR recipient (RLS allows sender-delete only;
  // recipient messages will be orphaned but unreachable since the conversation is gone)
  const sentMessages = await msg().filter({ sender_email: email }, '-created_date', 1000).catch(() => []);
  await Promise.all(sentMessages.map(m => msg().delete(m.id).catch(() => {})));
  // Delete conversations the user participated in (RLS scopes this naturally)
  const myConvs = await conv().filter({}, '-created_date', 500).catch(() => []);
  await Promise.all(myConvs.map(c => conv().delete(c.id).catch(() => {})));
};