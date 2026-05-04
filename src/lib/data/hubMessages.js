// src/lib/data/hubMessages.js
//
// SECURITY: Messages are protected by Supabase RLS — read access requires
// the requester to be a participant in the conversation. This is
// access-controlled, not end-to-end encrypted.
//
// Column reference for hub_messages table:
//   content          TEXT   (message body)
//   created_at       TIMESTAMPTZ
//   read_by          TEXT[] (array of emails that have read the message)
//   sender_email     TEXT
//   conversation_id  UUID

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
  if (myEmail.toLowerCase() === otherEmail.toLowerCase()) return null;
  const key = buildKey(myEmail, otherEmail);
  const existing = await conv().filter({ participant_key: key }, '-last_message_at', 1).catch(() => []);
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
 * RLS guarantees only their own conversations are returned.
 */
export const listMyConversations = async (myEmail, limit = 50) => {
  if (!myEmail) return [];
  const myEmailLc = myEmail.toLowerCase();

  // 1. Fetch all conversations the user is in
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

  // 3. Fetch all recent messages in one batch — group locally
  const allMyMessages = await msg().filter({}, '-created_at', 500).catch(() => []);
  const messagesByConvId = new Map();
  for (const m of allMyMessages) {
    const cid = m.conversation_id;
    if (!cid) continue;
    if (!messagesByConvId.has(cid)) messagesByConvId.set(cid, []);
    messagesByConvId.get(cid).push(m);
  }

  // 4. For each duplicate group, pick the conversation with the most recent message
  const deduped = [];
  for (const group of groups.values()) {
    let best = null;
    let bestMsg = null;
    let bestTime = 0;
    let unreadCount = 0;

    for (const c of group) {
      const msgs = messagesByConvId.get(c.id) || [];
      if (msgs.length > 0) {
        const latest = msgs[0]; // already sorted -created_at
        const t = new Date(latest.created_at).getTime();
        if (t > bestTime) {
          best = c;
          bestMsg = latest;
          bestTime = t;
        }
      }
      // Count unread: messages where I'm not the sender AND my email isn't in read_by
      unreadCount += msgs.filter(m =>
        m.sender_email?.toLowerCase() !== myEmailLc &&
        !(m.read_by || []).some(e => e?.toLowerCase() === myEmailLc)
      ).length;
    }

    // Fallback: no messages — pick the most recently created conversation
    if (!best) {
      group.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      best = group[0];
    }

    deduped.push({ ...best, latestMessage: bestMsg, unreadCount });
  }

  // 5. Sort inbox by actual latest message time
  deduped.sort((a, b) => {
    const aT = a.latestMessage ? new Date(a.latestMessage.created_at).getTime()
                               : new Date(a.last_message_at || 0).getTime();
    const bT = b.latestMessage ? new Date(b.latestMessage.created_at).getTime()
                               : new Date(b.last_message_at || 0).getTime();
    return bT - aT;
  });

  return deduped.slice(0, limit);
};

/** List messages in a conversation, oldest first (chat reading order). */
export const listMessages = async (conversationId, limit = 200) => {
  if (!conversationId) return [];
  return msg().filter({ conversation_id: conversationId }, 'created_at', limit).catch(() => []);
};

/**
 * Send a message. Updates the conversation's last_message_at and preview.
 */
export const sendMessage = async ({ conversationId, senderEmail, body }) => {
  if (!conversationId || !senderEmail || !body) return null;
  const created = await msg().create({
    conversation_id: conversationId,
    sender_email: senderEmail,
    content: body,
    read_by: [],
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

/**
 * Mark all unread incoming messages in a conversation as read.
 * Appends myEmail to the read_by array for each unread message.
 */
export const markRead = async (conversationId, myEmail) => {
  if (!conversationId || !myEmail) return;
  const myEmailLc = myEmail.toLowerCase();

  // Fetch all messages in the conversation (RLS limits to participants)
  const all = await msg().filter(
    { conversation_id: conversationId },
    '-created_at', 200
  ).catch(() => []);

  // Only mark messages sent by others that I haven't read yet
  const unread = all.filter(m =>
    m.sender_email?.toLowerCase() !== myEmailLc &&
    !(m.read_by || []).some(e => e?.toLowerCase() === myEmailLc)
  );

  await Promise.all(
    unread.map(m =>
      msg().update(m.id, {
        read_by: [...(m.read_by || []), myEmail],
      }).catch(() => {})
    )
  );
};

/** Total unread message count for inbox badge. */
export const unreadCountFor = async (myEmail) => {
  if (!myEmail) return 0;
  const myEmailLc = myEmail.toLowerCase();
  // RLS ensures we only see messages in our conversations
  const recent = await msg().filter({}, '-created_at', 500).catch(() => []);
  return recent.filter(m =>
    m.sender_email?.toLowerCase() !== myEmailLc &&
    !(m.read_by || []).some(e => e?.toLowerCase() === myEmailLc)
  ).length;
};

/** Cascade-delete all messages and conversations involving a user. */
export const purgeForUser = async (email) => {
  if (!email) return;
  const sentMessages = await msg().filter({ sender_email: email }, '-created_at', 1000).catch(() => []);
  await Promise.all(sentMessages.map(m => msg().delete(m.id).catch(() => {})));
  const myConvs = await conv().filter({}, '-created_at', 500).catch(() => []);
  await Promise.all(myConvs.map(c => conv().delete(c.id).catch(() => {})));
};
