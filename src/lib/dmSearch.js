// src/lib/dmSearch.js
//
// Client-side filtering for the DM conversation list.
//
// Searches what a person actually remembers about a thread:
//
//   • the other participant's USERNAME — the primary key people search
//     by ("what was that conversation with dave")
//   • the group TITLE, for group threads, which is that thread's name
//   • the LAST MESSAGE preview text, for "the one where they mentioned
//     the gym"
//
// Everything it reads is already in memory: the conversation rows from
// the `hubConversations` query and the id→profile map from
// `hubMessageProfiles`. No new fetch, no new round-trip.
//
// SCOPE: this filters the ALREADY-LOADED list, which is the last ~50
// conversations and only their most recent message. It deliberately does
// NOT search message bodies — that needs a server-side query over
// hub_messages (ideally a trigram or tsvector index on body, behind an
// RPC so RLS still applies). Worth doing if people ask for it; out of
// scope here, and pretending to do it client-side would silently return
// wrong results.
//
// Pure functions so the matching rule is testable without mounting the
// component or standing up a Supabase mock.

/** Lower-case + trim a raw query. Returns '' for anything unusable. */
export function normalizeQuery(raw) {
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

/**
 * Drop a leading protocol marker from message text.
 *
 * DM bodies can carry machine markers the inbox never shows the user —
 * `[TRADE_OFFER_V1]{...}`, `[TRADE_RESPONSE_V1]id:accepted`,
 * `[DUEL_INVITE_V1]{...}`, `[CREW_INVITE_V1]{...}` — each optionally
 * followed by a newline and a human-readable fallback line. Searching the
 * raw body would let a query like "duel_invite_v1" match threads whose
 * visible preview says nothing of the sort, so the marker (and its
 * payload line) is stripped and only the human text is searched.
 */
export function stripProtocolMarker(text) {
  if (typeof text !== 'string') return '';
  if (!text.startsWith('[')) return text;
  const close = text.indexOf(']');
  if (close === -1) return text;
  const newline = text.indexOf('\n');
  // Human-readable fallback lives after the first newline, when present.
  return newline === -1 ? '' : text.slice(newline + 1).trim();
}

/**
 * The strings a conversation is searchable by.
 * `profilesById` is the id→{username} map; `selfId` identifies the viewer
 * so the OTHER participant is the one resolved.
 */
export function conversationSearchFields(conv, { profilesById = {}, selfId = null } = {}) {
  if (!conv) return [];
  const otherId = (Array.isArray(conv.participant_ids) ? conv.participant_ids : [])
    .find(id => id && id !== selfId);
  const username = otherId ? profilesById[otherId]?.username : null;

  const lastText = conv.latestMessage?.body
    ?? conv.latestMessage?.content
    ?? conv.last_message_preview
    ?? '';

  return [username, conv.title, stripProtocolMarker(lastText)]
    .filter(v => typeof v === 'string' && v.length > 0);
}

/**
 * Does this conversation match the query? Case-insensitive substring
 * across username / group title / last-message preview. An empty query
 * matches everything, so clearing the field restores the full list.
 */
export function conversationMatchesQuery(conv, query, opts = {}) {
  const q = normalizeQuery(query);
  if (q === '') return true;
  if (!conv) return false;
  return conversationSearchFields(conv, opts).some(field => field.toLowerCase().includes(q));
}

/**
 * Filter a conversation list, preserving order.
 *
 * Callers pass the list for the ACTIVE tab (inbox / requests / archived),
 * so tab scoping is inherent — searching the Inbox can never surface a
 * Request or an Archived thread.
 */
export function filterConversationsByQuery(conversations, query, opts = {}) {
  if (!Array.isArray(conversations)) return [];
  const q = normalizeQuery(query);
  if (q === '') return conversations;
  return conversations.filter(conv => conversationMatchesQuery(conv, q, opts));
}
