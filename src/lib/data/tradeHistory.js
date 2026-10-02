// src/lib/data/tradeHistory.js
//
// Reconstructs the user's trade history from the existing hub_messages
// stream. Trade offers are sent as messages with [TRADE_OFFER_V1]
// markers + JSON payload (see TradeOfferCard.jsx); responses come back
// as [TRADE_RESPONSE_V1]<offerId>:<accepted|declined> markers in
// reply messages.
//
// Why no dedicated table: the markers already carry every field we
// need (offerId, items, sender, recipient, timestamp, response). A
// separate `trade_completions` table would duplicate data and add
// a hot-path write to the trade-accept flow for no read-time gain
// other apps can't reproduce.
//
// Strategy:
//   1. Fetch the viewer's recent messages (sent + received).
//   2. Parse each for offer or response markers.
//   3. Pair offers with their responses by offerId.
//   4. Return entries sorted newest-first.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';


const OFFER_MARKER    = '[TRADE_OFFER_V1]';
const RESPONSE_MARKER = '[TRADE_RESPONSE_V1]';

function parseOffer(body) {
  if (!body?.startsWith?.(OFFER_MARKER)) return null;
  const after = body.slice(OFFER_MARKER.length);
  const newlineIdx = after.indexOf('\n');
  const json = newlineIdx >= 0 ? after.slice(0, newlineIdx) : after;
  try {
    const payload = JSON.parse(json);
    if (payload?.type !== 'trade_offer') return null;
    return payload;
  } catch { return null; }
}

function parseResponse(body) {
  if (!body?.startsWith?.(RESPONSE_MARKER)) return null;
  const head = body.slice(RESPONSE_MARKER.length);
  const newlineIdx = head.indexOf('\n');
  const first = newlineIdx >= 0 ? head.slice(0, newlineIdx) : head;
  const colon = first.indexOf(':');
  if (colon < 0) return null;
  const offerId = first.slice(0, colon).trim();
  const status  = first.slice(colon + 1).trim();
  if (!offerId || (status !== 'accepted' && status !== 'declined')) return null;
  return { offerId, status };
}

/**
 * Pair offers with responses, returning an array of:
 *   {
 *     offerId, sentAt, respondedAt | null,
 *     fromEmail, toEmail,   (legacy payloads only)
 *     myItem, theirItem,
 *     status: 'pending' | 'accepted' | 'declined',
 *     iAmSender: boolean,
 *   }
 *
 * The pairing logic is exported separately so it can be unit-tested
 * without going near supabase.
 */
export function pairOffersWithResponses(messages, myId) {
  const me = String(myId || '');
  const offers = new Map();
  const responses = new Map();

  for (const m of messages || []) {
    const body = m?.body || m?.content || '';
    const offer = parseOffer(body);
    if (offer) {
      offers.set(offer.offerId, {
        ...offer,
        sentAt: m.created_at,
        senderId: m.user_id,
      });
      continue;
    }
    const response = parseResponse(body);
    if (response) {
      const prev = responses.get(response.offerId);
      // Keep the LATEST response per offer — if the user changes their
      // mind by sending another reply, the most recent wins.
      if (!prev || new Date(m.created_at) > new Date(prev.respondedAt)) {
        responses.set(response.offerId, {
          status: response.status,
          respondedAt: m.created_at,
        });
      }
    }
  }

  const out = [];
  for (const [offerId, payload] of offers.entries()) {
    const r = responses.get(offerId);
    out.push({
      offerId,
      sentAt:      payload.sentAt,
      respondedAt: r?.respondedAt || null,
      fromEmail:   payload.fromEmail,
      toEmail:     payload.toEmail,
      myItem:      payload.myItem,
      theirItem:   payload.theirItem,
      status:      r?.status || 'pending',
      // The offer message's sender. Payloads carry fromId since 253; the
      // message row's user_id covers the legacy ones too.
      iAmSender:   !!me && String(payload.senderId || payload.fromId || '') === me,
    });
  }
  return out.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
}

/**
 * Fetch the user's trade history. Scans recent hub_messages where
 * the user is sender OR recipient and pairs offers with responses.
 *
 * @param {string} myId
 * @param {number} [limit=500]   max messages to scan
 */
export async function listMyTrades(myId, limit = 500) {
  if (!myId) return [];
  // We need messages from any conversation the viewer participates
  // in. The simplest correct read uses the existing RLS-protected
  // hub_messages table: RLS already restricts to messages the viewer
  // can see, so a bare select is safe.
  // `body` and `content` are the two names this table has used for the
  // message text across migrations, and pairOffersWithResponses reads
  // whichever is present — so a strip here degrades to the other rather
  // than to nothing.
  const { data, error } = await safeSelect({
    columns: ['id', 'conversation_id', 'user_id', 'body', 'content', 'created_at'],
    build: (cols) => supabase
      .from('hub_messages')
      .select(cols)
      .order('created_at', { ascending: false })
      .limit(limit),
  });
  if (error) return [];
  return pairOffersWithResponses(data || [], myId);
}
