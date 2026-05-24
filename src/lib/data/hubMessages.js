// src/lib/data/hubMessages.js
//
// SECURITY: Messages are protected by Supabase RLS — read access requires
// the requester to be a participant in the conversation.
//
// hub_messages column reference (see migrations 001 + 004):
//   body             TEXT  — message content (primary write field)
//   content          TEXT  — kept in sync with body by migration 004 backfill
//   created_date     TIMESTAMPTZ (default now())
//   created_at       TIMESTAMPTZ (original, same value)
//   recipient_email  TEXT
//   read_at          TIMESTAMPTZ — set when recipient reads the message
//   read_by          TEXT[]      — array version (base schema)
//   sender_email     TEXT
//   conversation_id  UUID

import { db } from '@/api/db';
import { supabase } from '@/api/supabaseClient';

const conv = () => db.entities.HubConversation;
const msg  = () => db.entities.HubMessage;

// ── Per-conversation last-read tracking ───────────────────────────────────────
// Stored in localStorage so the badge clears instantly when a conversation is
// opened, even if the DB update is blocked by RLS (migration 011 fixes RLS).
const _key = (convId) => `fn-conv-read-${convId}`;
const _getLastRead  = (convId) => { try { return parseInt(localStorage.getItem(_key(convId)) || '0', 10); } catch { return 0; } };
const _setLastRead  = (convId) => { try { localStorage.setItem(_key(convId), Date.now().toString()); } catch {} };

/** Returns true if a message is unread by myEmailLc. */
function _isUnread(m, myEmailLc) {
  if (m.sender_email?.toLowerCase() === myEmailLc) return false;
  const lastRead = _getLastRead(m.conversation_id);
  if (lastRead > 0) {
    // localStorage entry beats DB — gives instant badge clearing
    const msgMs = new Date(m.created_date || m.created_at || 0).getTime();
    return msgMs > lastRead;
  }
  return !m.read_at; // fall back to DB column
}

/** Build a stable participant_key from two emails. */
const buildKey = (a, b) => [a.toLowerCase(), b.toLowerCase()].sort().join('|');

/**
 * Create a group DM with the caller + the supplied participant emails.
 * Backed by mig 116's create_group_conversation RPC, which validates
 * the 3-10 participant range, de-dupes, and auto-accepts the creator
 * so the group lands in their main inbox.
 *
 * @param {string[]} emails  participant emails (caller excluded)
 * @param {string}   [title]   optional display name; empty string → NULL
 * @returns {Promise<string>}  the new conversation's id
 */
export const createGroupConversation = async (emails, title = null) => {
  if (!Array.isArray(emails) || emails.length < 2) {
    throw new Error('group_min_participants');
  }
  const { data, error } = await supabase.rpc('create_group_conversation', {
    p_emails: emails,
    p_title:  title,
  });
  if (error) throw error;
  return data;
};

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

  // 3. Fetch recent messages SCOPED to the user's actual conversations.
  // Was filter({}, ...) limit 500 — RLS already scoped to readable
  // messages but the DB still had to read+filter every row in the
  // window. Pinning conversation_id pushes the scope into the index
  // (idx_hub_messages_conversation_id_created_at) so the read cost
  // scales with the user's own activity, not the global message rate.
  // TODO(scale): replace with a SECURITY DEFINER RPC that returns
  // (conversation_id, latest_message, unread_count) per row in one
  // SQL query using DISTINCT ON.
  const myConvIds = mine.map(c => c.id).filter(Boolean);
  const allMyMessages = myConvIds.length > 0
    ? await msg().filter({ conversation_id: myConvIds }, '-created_date', 200).catch(() => [])
    : [];
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
        const latest = msgs[0]; // already sorted -created_date
        const t = new Date(latest.created_date || latest.created_at || 0).getTime();
        if (t > bestTime) {
          best = c;
          bestMsg = latest;
          bestTime = t;
        }
      }
      // Count unread: incoming messages I haven't read yet
      unreadCount += msgs.filter(m => _isUnread(m, myEmailLc)).length;
    }

    // Fallback: no messages — pick the most recently created conversation
    if (!best) {
      group.sort((a, b) =>
        new Date(b.created_date || b.created_at || 0) -
        new Date(a.created_date || a.created_at || 0)
      );
      best = group[0];
    }

    deduped.push({ ...best, latestMessage: bestMsg, unreadCount });
  }

  // 5. Sort inbox by actual latest message time
  deduped.sort((a, b) => {
    const aT = a.latestMessage
      ? new Date(a.latestMessage.created_date || a.latestMessage.created_at || 0).getTime()
      : new Date(a.last_message_at || 0).getTime();
    const bT = b.latestMessage
      ? new Date(b.latestMessage.created_date || b.latestMessage.created_at || 0).getTime()
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
 * Send a message. Writes `body` (primary) + `content` (mirror) so both old
 * and new queries work. Updates conversation's last_message_at and preview.
 * Pass `attachmentUrl` to include an image attachment (migration 012).
 */
export const sendMessage = async ({ conversationId, senderEmail, recipientEmail, body, attachmentUrl, repliedToMessageId, repliedToSnippet, messageType, stickerId, durationMs }) => {
  if (!conversationId || !senderEmail || (!body && !attachmentUrl && !stickerId)) return null;
  const created = await msg().create({
    conversation_id: conversationId,
    sender_email: senderEmail,
    ...(recipientEmail ? { recipient_email: recipientEmail } : {}),
    body: body || '',
    content: body || '', // keep content in sync for queries that use either column
    ...(attachmentUrl ? { attachment_url: attachmentUrl } : {}),
    ...(repliedToMessageId ? { replied_to_message_id: repliedToMessageId, replied_to_snippet: repliedToSnippet || '' } : {}),
    // Rich-media fields (mig 115). The db-layer's strip-and-retry
    // handles pre-115 hosts by dropping unknown columns and saving the
    // base row, so these add no risk to deployment ordering.
    ...(messageType ? { message_type: messageType } : {}),
    ...(stickerId   ? { sticker_id: stickerId } : {}),
    ...(durationMs != null ? { duration_ms: Math.round(durationMs) } : {}),
  });
  try {
    // Trade offers / responses embed a marker at the start of the body —
    // strip it for the conversation preview so the inbox shows the
    // human-readable text instead of the raw protocol prefix.
    let previewText = body || '';
    if (previewText.startsWith('[TRADE_OFFER_V1]')) {
      const newlineIdx = previewText.indexOf('\n');
      previewText = newlineIdx >= 0 ? previewText.slice(newlineIdx + 1).trim() : '';
      if (!previewText) previewText = '🔁 Trade offer';
    } else if (previewText.startsWith('[TRADE_RESPONSE_V1]')) {
      const newlineIdx = previewText.indexOf('\n');
      previewText = newlineIdx >= 0 ? previewText.slice(newlineIdx + 1).trim() : '';
      if (!previewText) previewText = '↩️ Trade reply';
    } else if (previewText.startsWith('[CREW_INVITE_V1]')) {
      previewText = '👥 Crew invite';
    } else if (previewText.startsWith('[DUEL_INVITE_V1]')) {
      previewText = '⚔️ Duel challenge';
    }
    const preview = previewText ? previewText.slice(0, 80) : '📎 Image';
    await conv().update(conversationId, {
      last_message_at: new Date().toISOString(),
      last_message_preview: preview,
    });
  } catch { /* non-blocking */ }
  return created;
};

/**
 * Mark all unread incoming messages in a conversation as read.
 * localStorage is updated immediately so the badge clears instantly.
 *
 * DB read_at is set via the `mark_message_read` SECURITY DEFINER RPC
 * (migration 141). The previous version called .update({read_at}) on
 * each row directly, which required the over-broad hub_messages UPDATE
 * RLS policy from mig 011 — that policy was tightened in 141 because
 * it also permitted recipients to rewrite sender content. The RPC is
 * column-scoped (only flips read_at) and gates on conversation
 * membership server-side.
 *
 * The post-migration RPC path is the primary write. If a host hasn't
 * yet applied 141 the RPC isn't defined and the direct UPDATE is
 * attempted as a one-shot fallback; both failures are swallowed
 * because read_at drift is a soft UX issue (the badge clears via the
 * localStorage write above either way).
 */
export const markRead = async (conversationId, myEmail) => {
  if (!conversationId || !myEmail) return;

  // ① Instant local clear — badge drops to 0 even before the DB round-trip
  _setLastRead(conversationId);

  const myEmailLc = myEmail.toLowerCase();
  const all = await msg().filter(
    { conversation_id: conversationId },
    '-created_date', 300
  ).catch(() => []);

  const unread = all.filter(m =>
    m.sender_email?.toLowerCase() !== myEmailLc && !m.read_at
  );

  // RPC fan-out — server validates membership + column-restricts to read_at.
  // Pre-141 fallback: try the direct UPDATE so the soft UX path doesn't
  // regress on hosts that haven't applied the migration yet. Both swallow
  // errors; the localStorage badge clear above is the source of truth
  // for the immediate UI.
  await Promise.all(
    unread.map(async (m) => {
      const { error } = await supabase.rpc('mark_message_read', { p_message_id: m.id });
      if (error && (error.code === '42883' || error.code === '42P01')) {
        // Pre-141 host — RPC not deployed. Direct update succeeds while
        // the old broad RLS policy is still in place.
        await msg().update(m.id, { read_at: new Date().toISOString() }).catch(() => {});
      }
    })
  );
};

/**
 * Total unread message count for inbox badge.
 * Uses read_at (null = unread) and sender_email to exclude own messages.
 * RLS ensures only messages in the user's conversations are returned.
 *
 * Limit reduced 500 → 100. Inbox badges over 99+ are capped anyway, so
 * the only loss is precision past that cap. TODO(scale): replace with
 * a SECURITY DEFINER `unread_message_count_for(p_email)` RPC that runs
 * `SELECT COUNT(*) FROM hub_messages WHERE ...` server-side instead of
 * pulling rows over the wire.
 */
export const unreadCountFor = async (myEmail) => {
  if (!myEmail) return 0;
  const myEmailLc = myEmail.toLowerCase();
  const recent = await msg().filter({}, '-created_date', 100).catch(() => []);
  return recent.filter(m => _isUnread(m, myEmailLc)).length;
};

/**
 * Toggle the is_pinned flag on a DM message via the SECURITY DEFINER RPC.
 * Only participants of the conversation may pin.
 * @param {string} messageId — UUID of the hub_message row
 * @returns {Promise<boolean>} the new is_pinned value
 */
export async function togglePinDmMessage(messageId) {
  const { data, error } = await supabase.rpc('toggle_pin_dm_message', { p_message_id: messageId });
  if (error) throw error;
  return !!data;
}

/** Cascade-delete all messages and conversations involving a user. */
export const purgeForUser = async (email) => {
  if (!email) return;
  const sentMessages = await msg().filter({ sender_email: email }, '-created_date', 1000).catch(() => []);
  await Promise.all(sentMessages.map(m => msg().delete(m.id).catch(() => {})));
  const myConvs = await conv().filter({}, '-created_date', 500).catch(() => []);
  await Promise.all(myConvs.map(c => conv().delete(c.id).catch(() => {})));
};
