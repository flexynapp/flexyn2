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

import { ownedRows } from './ownedRows';
import { supabase } from '@/api/supabaseClient';
import { getProfile } from '@/api/profileCache';
import { isPollVote } from '@/lib/dmPolls';
import { reportError } from '@/lib/reportError';

const conv = () => ownedRows('hub_conversations');
const msg  = () => ownedRows('hub_messages');

// ── Per-conversation last-read tracking ───────────────────────────────────────
// Stored in localStorage so the badge clears instantly when a conversation is
// opened, even if the DB update is blocked by RLS (migration 011 fixes RLS).
const _READ_KEY_PREFIX = 'fn-conv-read-';
const _key = (convId) => `${_READ_KEY_PREFIX}${convId}`;
const _getLastRead  = (convId) => { try { return parseInt(localStorage.getItem(_key(convId)) || '0', 10); } catch { return 0; } };
const _setLastRead  = (convId) => { try { localStorage.setItem(_key(convId), Date.now().toString()); } catch {} };

/** Poll-vote control messages are an implementation detail — never surfaced. */
function _isControl(m) {
  return isPollVote(m?.body || m?.content || '');
}

/** Returns true if a message is unread by myEmailLc. */
function _isUnread(m, myEmailLc) {
  if (_isControl(m)) return false; // votes never ping the recipient
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 *
 * Creation runs through mig 234's `start_dm_conversation` RPC so the
 * request-vs-direct decision is made SERVER-SIDE, from the follow graph,
 * at the moment the row is inserted:
 *
 *   • recipient already follows the sender → accepted_emails holds BOTH
 *     participants, so the thread lands directly in the recipient's Inbox
 *   • otherwise → accepted_emails holds only the sender, so the thread
 *     lands in the recipient's Requests folder and the sender is capped
 *     at one message until it's accepted (RESTRICTIVE RLS policy).
 *
 * The RPC is also what clears a stale "declined" tombstone when the
 * decliner later starts the conversation themselves.
 *
 * Pre-234 hosts (RPC missing, 42883/42P01) fall through to the legacy
 * client-side find-then-insert path below so a partial deploy doesn't
 * break messaging.
 */
export const findOrCreateConversation = async (myEmail, other) => {
  if (!myEmail || !other) return null;

  // The peer may be passed as a user_id (uuid) or an email. An id goes
  // straight to start_dm_conversation(p_other_id), which looks the email up
  // server-side, so the caller never holds the other person's address.
  // Every in-app caller passes an id now; the email path below stays for
  // anything older still holding only an address.
  if (UUID_RE.test(String(other))) {
    const { data: convId, error } = await supabase
      .rpc('start_dm_conversation', { p_other_id: other });
    if (error) {
      // A refusal (request block, invalid recipient) has to stop here: it
      // is the gate, and there is no client-side path around it.
      reportError(error, { feature: 'dm.startConversation', level: 'warning' });
      throw error;
    }
    if (!convId) return null;
    const rows = await conv().filter({ id: convId }, '-last_message_at', 1).catch(() => []);
    return rows[0] ?? null;
  }
  const otherEmail = other;
  if (!otherEmail) return null;
  if (myEmail.toLowerCase() === otherEmail.toLowerCase()) return null;
  // Lower-case both emails on insert so RLS membership checks
  // (`auth.email() = ANY(participant_emails)`) succeed when the
  // signed-in user's JWT email differs in case (OAuth display-case
  // vs DB-canonical). Mig 116's group RPC already lowercases; the
  // 1:1 path was the inconsistency. Wave 57 (Messages audit) caught.
  const me = String(myEmail).toLowerCase();
  const otherLc = String(otherEmail).toLowerCase();
  const key = buildKey(me, otherLc);

  // Server-authoritative create/find. Only the PEER is passed — the
  // caller's identity comes from auth.uid()/auth.email() inside the RPC,
  // never from a client-supplied email (mig 108's lesson).
  const { data: rpcConvId, error: rpcError } = await supabase
    .rpc('start_dm_conversation', { p_other_email: otherLc });
  if (!rpcError && rpcConvId) {
    const fromRpc = await conv().filter({ id: rpcConvId }, '-last_message_at', 1).catch(() => []);
    if (fromRpc.length > 0) return fromRpc[0];
  }
  if (rpcError && rpcError.code !== '42883' && rpcError.code !== '42P01') {
    // The RPC is a GATE, not just a convenience — it enforces the
    // request block (mig 234's dm_request_blocks). Falling through to
    // the legacy client insert on a refusal would let a blocked sender
    // create the conversation anyway, so anything other than
    // "function not deployed" has to stop here.
    reportError(rpcError, { feature: 'dm.startConversation', level: 'warning' });
    throw rpcError;
  }

  const existing = await conv().filter({ participant_key: key }, '-last_message_at', 1).catch(() => []);
  if (existing.length > 0) return existing[0];
  try {
    return await conv().create({
      participant_key: key,
      participant_emails: [me, otherLc].sort(),
      last_message_at: new Date().toISOString(),
      last_message_preview: '',
    });
  } catch (err) {
    // Concurrent-tap race: two near-simultaneous "Message" taps both
    // see no existing row + both attempt insert. The UNIQUE index on
    // participant_key rejects the second with 23505. Re-query and
    // return the row the OTHER tap just inserted — both calls now
    // resolve to the same conversation. Wave 57 (Messages audit)
    // caught this; previously the second tap got a misleading "Could
    // not start conversation" toast even though a conversation existed.
    if (err?.code === '23505' || /duplicate key/i.test(err?.message || '')) {
      const retry = await conv().filter({ participant_key: key }, '-last_message_at', 1).catch(() => []);
      if (retry.length > 0) return retry[0];
    }
    throw err;
  }
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

  // Delivery receipts (mig 237). Pulling the rows above IS the delivery
  // event — the messages are now on this device — so stamp delivered_at
  // for whatever we just downloaded and didn't send ourselves. The RPC
  // re-derives membership from auth.uid()/auth.email() and only touches
  // rows where delivered_at IS NULL, so it's one write per message ever
  // and a no-op once a thread is caught up.
  //
  // Fire-and-forget: a failure here costs a tick, never the inbox.
  if (myConvIds.length > 0) {
    supabase
      .rpc('mark_messages_delivered', { p_conv_ids: myConvIds.slice(0, 200) })
      .then(({ error }) => {
        // 42883 = pre-237 host, RPC not deployed yet. Expected, stay quiet.
        if (error && error.code !== '42883' && error.code !== '42P01') {
          reportError(error, { feature: 'dm.markDelivered', level: 'warning' });
        }
      }, () => {});
  }
  const messagesByConvId = new Map();
  for (const m of allMyMessages) {
    const cid = m.conversation_id;
    if (!cid) continue;
    if (_isControl(m)) continue; // votes don't drive preview, sort, or unread
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

/**
 * List the most-recent `limit` messages in a conversation, returned in
 * chronological (oldest-first) reading order.
 *
 * The DB query fetches NEWEST-first (`-created_date`) so a busy thread
 * shows its latest activity — the previous `created_date` ascending +
 * limit fetched the oldest 200 rows ever, so past message #200 new
 * messages never loaded, and a post-send refetch returned a window that
 * didn't contain the just-sent row (it visibly vanished). We reverse the
 * newest-first window back to ascending for render so divider logic,
 * run-grouping, and scroll-to-bottom all see chat order.
 *
 * Callers that need the older history page in via `listOlderMessages`.
 */
export const listMessages = async (conversationId, limit = 200) => {
  if (!conversationId) return [];
  const newestFirst = await msg()
    .filter({ conversation_id: conversationId }, '-created_date', limit)
    .catch(() => []);
  // Reverse a shallow copy → ascending (oldest-first) for chat render.
  return newestFirst.slice().reverse();
};

/**
 * Cursor pager for older history. Fetches up to `limit` messages STRICTLY
 * older than `beforeCreatedDate` (an ISO timestamp — typically the
 * created_date of the currently-oldest row on screen), newest-first from
 * the DB, then reversed to ascending so the page can be prepended to the
 * existing list without re-sorting.
 *
 * Returns [] when there's no cursor or no older rows — the caller treats
 * an empty result as "reached the start of history" and hides the
 * "Load earlier" affordance.
 *
 * Uses the supabase client directly (not the entity `filter`, which only
 * supports equality maps) so we can express the `<` cursor bound. RLS
 * still scopes the read to conversation participants.
 */
export const listOlderMessages = async (conversationId, beforeCreatedDate, limit = 100) => {
  if (!conversationId || !beforeCreatedDate) return [];
  const { data, error } = await supabase
    .from('hub_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .lt('created_date', beforeCreatedDate)
    .order('created_date', { ascending: false })
    .limit(limit);
  if (error) {
    reportError(error, { feature: 'dm.listOlder', level: 'warning' });
    return [];
  }
  return (data || []).slice().reverse();
};

/**
 * Send a message. Writes `body` (primary) + `content` (mirror) so both old
 * and new queries work. Updates conversation's last_message_at and preview.
 * Pass `attachmentUrl` to include an image attachment (migration 012).
 */
export const sendMessage = async ({ conversationId, senderEmail, recipientEmail, recipientId, body, attachmentUrl, repliedToMessageId, repliedToSnippet, messageType, stickerId, durationMs }) => {
  if (!conversationId || !senderEmail || (!body && !attachmentUrl && !stickerId)) return null;
  // sender_name / sender_avatar are what notify_dm_received (mig 181) reads
  // to build the recipient's notification. NOTHING had ever written them —
  // 0 of 47 production rows carry either — so dm_received_text fell to its
  // 'Someone' branch and every DM notification in the app's history reads
  // "Someone sent you a message", with no avatar. Resolved from the profile
  // cache here rather than at each of the 12 call sites.
  const me = getProfile();
  const senderName   = me?.username || me?.full_name || null;
  const senderAvatar = me?.avatar_url || null;
  const created = await msg().create({
    conversation_id: conversationId,
    sender_email: senderEmail,
    ...(senderName   ? { sender_name:   senderName }   : {}),
    ...(senderAvatar ? { sender_avatar: senderAvatar } : {}),
    // recipient_email is optional metadata — DM delivery, block checks and
    // the dm_received notification all run off the conversation's
    // participant_emails, not this column. id-keyed callers pass
    // recipientId (the backfilled recipient_id) so they never read the
    // peer's email off the public_profiles view.
    ...(recipientEmail ? { recipient_email: recipientEmail } : {}),
    ...(recipientId ? { recipient_id: recipientId } : {}),
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
  // Poll votes are control messages — they neither bump the conversation
  // nor change its preview, so a flurry of votes doesn't churn the inbox.
  if (isPollVote(body || '')) return created;
  try {
    // Trade offers / responses embed a marker at the start of the body —
    // strip it for the conversation preview so the inbox shows the
    // human-readable text instead of the raw protocol prefix.
    let previewText = body || '';
    if (previewText.startsWith('[POLL_V1]')) {
      previewText = '📊 Poll';
    } else if (previewText.startsWith('[TRADE_OFFER_V1]')) {
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
      } else if (error) {
        // A real failure (e.g. RLS denial) — surface it instead of
        // silently dropping, otherwise read receipts and the DB unread
        // count silently drift. localStorage already cleared the badge.
        reportError(error, { feature: 'dm.markRead', level: 'warning' });
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

  // Server-side COUNT via dm_unread_count (mig 223) — replaces the
  // 400-newest-rows pull with a single integer over the wire, and is
  // exact regardless of account age. The localStorage last-read map is
  // passed along so the instant badge-clear on opening a conversation
  // (see _isUnread) survives: the RPC counts those conversations by
  // "newer than last-read" instead of read_at.
  try {
    const lastReads = {};
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(_READ_KEY_PREFIX)) continue;
        const ms = parseInt(localStorage.getItem(k) || '0', 10);
        if (ms > 0) lastReads[k.slice(_READ_KEY_PREFIX.length)] = ms;
      }
    } catch { /* storage unavailable → DB read_at semantics only */ }

    const { data, error } = await supabase.rpc('dm_unread_count', {
      p_last_reads: lastReads,
    });
    if (!error && typeof data === 'number') return data;
    // 42883 = function does not exist (migration 223 not yet applied).
    if (error && error.code !== '42883' && error.code !== '42P01') {
      console.warn('[hubMessages] dm_unread_count RPC failed, falling back:', error);
    }
  } catch (err) {
    console.warn('[hubMessages] dm_unread_count RPC threw, falling back:', err);
  }

  // Fallback path — pre-migration-223 legacy window count.
  const recent = await msg().filter({}, '-created_date', 400).catch(() => []);
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

/**
 * Delete the user's own messages, and delete only conversations that have
 * NO other participant. A conversation row is shared — deleting one the user
 * had with someone else would wipe that conversation for the other person
 * too, so we leave those intact (the user's messages are already removed).
 */
export const purgeForUser = async (email) => {
  if (!email) return;
  const emailLc = email.toLowerCase();
  const sentMessages = await msg().filter({ sender_email: email }, '-created_date', 1000).catch(() => []);
  await Promise.all(sentMessages.map(m => msg().remove(m.id).catch(() => {})));
  const myConvs = await conv().filter({}, '-created_date', 500).catch(() => []);
  const orphanConvs = myConvs.filter(c => {
    const others = (c.participant_emails || []).filter(e => e && e.toLowerCase() !== emailLc);
    return others.length === 0; // only the leaving user (or empty) → safe to delete
  });
  await Promise.all(orphanConvs.map(c => conv().remove(c.id).catch(() => {})));
};
