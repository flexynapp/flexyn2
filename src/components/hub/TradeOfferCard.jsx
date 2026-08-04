// src/components/hub/TradeOfferCard.jsx
//
// Renders a structured Trade Offer payload inside HubChat as an interactive
// card. The payload is embedded in the message body with a [TRADE_OFFER_V1]
// prefix so clients that recognize it can show this card; clients that don't
// fall through to the plain-text portion of the body that follows.
//
// SEMANTICS — two modes, and the difference is load-bearing:
//
//   REAL (migration 253+): payload.offerId is a public.trade_offers UUID.
//   Accept calls respond_to_trade_offer, which swaps the two inventory
//   rows atomically. Status is read live from the table, so it's correct
//   on every device and survives a cache clear.
//
//   LEGACY: offers sent before 253 carry a synthetic offerId and have no
//   row behind them. Accept still just posts a text reply and the two
//   users hand-deliver, exactly as before. Those cards keep the old
//   "items aren't transferred automatically" disclaimer, because for them
//   it's still true. Do NOT show real-trade copy on a legacy card.

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Check, X, Coins, Info, ShieldCheck } from 'lucide-react';
import { toast } from '@/lib/toast';
import { RARITY } from '@/lib/lootCatalog';
import { sendMessage } from '@/lib/data/hubMessages';
import * as tradeOffers from '@/lib/data/tradeOffers';

// Local persistence key for "did the user already respond to this offer".
// Without this, the buttons reappeared on chat re-mount and the user could
// reply multiple times. Keyed by conversationId + offerId so it's stable
// across reloads on the same device.
const responseKey = (conversationId, offerId) =>
  `flexyn-trade-response:${conversationId || 'unknown'}:${offerId || 'unknown'}`;

/**
 * Parse a hub_messages.body string. Returns the parsed trade payload + the
 * remaining plain-text body (for non-trade messages or fallback display),
 * or null if the body isn't a trade offer.
 */
export function parseTradeOffer(body) {
  if (!body || typeof body !== 'string') return null;
  if (!body.startsWith('[TRADE_OFFER_V1]')) return null;
  // Pull the JSON between the marker and the next newline (or end).
  const after = body.slice('[TRADE_OFFER_V1]'.length);
  const newlineIdx = after.indexOf('\n');
  const jsonStr = newlineIdx >= 0 ? after.slice(0, newlineIdx) : after;
  try {
    const payload = JSON.parse(jsonStr);
    if (payload?.type !== 'trade_offer') return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Parse a hub_messages.body string for a trade RESPONSE marker. Replies to
 * an offer carry `[TRADE_RESPONSE_V1]<offerId>:<accepted|declined>` as the
 * first line of the body so any client (including the original sender)
 * can recover the response state from the server, not just from local
 * storage. Returns `{ offerId, response }` or null.
 */
export function parseTradeResponse(body) {
  if (!body || typeof body !== 'string') return null;
  if (!body.startsWith('[TRADE_RESPONSE_V1]')) return null;
  const after = body.slice('[TRADE_RESPONSE_V1]'.length);
  const newlineIdx = after.indexOf('\n');
  const head = newlineIdx >= 0 ? after.slice(0, newlineIdx) : after;
  const colonIdx = head.indexOf(':');
  if (colonIdx < 0) return null;
  const offerId = head.slice(0, colonIdx).trim();
  const response = head.slice(colonIdx + 1).trim();
  if (!offerId || (response !== 'accepted' && response !== 'declined')) return null;
  return { offerId, response };
}

/**
 * Serialize a trade-response marker into a message body. The marker is the
 * first line so parseTradeResponse can read it without scanning, and a
 * human-readable line follows so clients that DON'T know about the marker
 * still render something useful.
 */
export function formatTradeResponseBody(offerId, accepted) {
  const status = accepted ? 'accepted' : 'declined';
  const friendly = accepted
    ? `✅ I'd like to do this trade. Let's coordinate delivery in chat.`
    : `❌ Not interested in this trade — thanks for asking!`;
  return `[TRADE_RESPONSE_V1]${offerId}:${status}\n${friendly}`;
}

/**
 * @param {object} props
 * @param {object} props.payload - parsed trade offer
 * @param {boolean} props.isMine - whether the current user sent this offer
 *   (drives "you offered" vs "they offered" framing + accept/decline visibility)
 * @param {object} props.user - current user (for sending replies)
 * @param {string} props.conversationId - conversation to send replies into
 */
export default function TradeOfferCard({ payload, isMine, user, conversationId, conversationMessages = [] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [responded, setResponded] = useState(null); // 'accepted' | 'declined' | null

  // Two-tier response state:
  //   1. SERVER (canonical) — any message in the conversation carrying
  //      [TRADE_RESPONSE_V1]<offerId>:<...> is the source of truth. Works
  //      across devices and survives reload/cache clear.
  //   2. LOCAL STORAGE (fallback) — hydrated only when no server-side
  //      response exists yet (e.g. between send and refetch). Keeps the
  //      "you replied" state instant even before the message round-trips.
  const offerId = payload?.offerId
    || `${payload?.fromEmail || ''}|${payload?.myItem?.name || ''}|${payload?.theirItem?.name || ''}`;
  // Real offers resolve their status from the table. A UUID-shaped id is
  // the discriminator: legacy ids were `${Date.now()}-${random}`.
  const isReal = tradeOffers.isRealOfferId(payload?.offerId);
  const { data: liveOffer } = useQuery({
    queryKey: ['tradeOffer', payload?.offerId],
    queryFn:  () => tradeOffers.getById(payload.offerId),
    enabled:  isReal,
    staleTime: 15_000,
  });

  const serverResponse = useMemo(() => {
    for (const m of conversationMessages) {
      const parsed = parseTradeResponse(m?.body || m?.content || '');
      if (parsed && parsed.offerId === offerId) return parsed.response;
    }
    return null;
  }, [conversationMessages, offerId]);
  useEffect(() => {
    // For a real offer the TABLE is the truth — ignore chat markers and
    // localStorage entirely. 'cancelled' surfaces as declined; from the
    // recipient's side the practical outcome is the same.
    if (isReal) {
      if (!liveOffer) return;
      setResponded(liveOffer.status === 'pending' ? null
        : liveOffer.status === 'accepted' ? 'accepted' : 'declined');
      return;
    }
    if (serverResponse) {
      // Server already knows the answer — adopt it and mirror into local
      // storage so a quick re-mount before next fetch still feels instant.
      setResponded(serverResponse);
      try { localStorage.setItem(responseKey(conversationId, offerId), serverResponse); } catch { /* ignore */ }
      return;
    }
    // No server signal yet — fall back to local storage.
    try {
      const stored = localStorage.getItem(responseKey(conversationId, offerId));
      if (stored === 'accepted' || stored === 'declined') setResponded(stored);
    } catch { /* SSR / no localStorage */ }
  }, [conversationId, offerId, serverResponse, isReal, liveOffer]);

  const myItem    = isMine ? payload.myItem : payload.theirItem;
  const theirItem = isMine ? payload.theirItem : payload.myItem;
  const myItemRarity    = RARITY[myItem?.rarity] ?? RARITY.common;
  const theirItemRarity = RARITY[theirItem?.rarity] ?? RARITY.common;

  const handleResponse = async (accept) => {
    if (busy || responded) return;
    setBusy(true);

    // ── Real offer: the swap happens server-side, atomically. ──────────
    if (isReal) {
      try {
        await tradeOffers.respond(payload.offerId, accept);
        setResponded(accept ? 'accepted' : 'declined');
        qc.invalidateQueries({ queryKey: ['tradeOffer', payload.offerId] });
        qc.invalidateQueries({ queryKey: ['tradeHistory'] });
        qc.invalidateQueries({ queryKey: ['userInventory', user?.email] });
        qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
        toast.success(accept ? 'Traded! Check your bag.' : 'Offer declined.');
      } catch (err) {
        toast.error(tradeOffers.tradeErrorMessage(err));
        // Re-read: the failure usually means the offer is no longer
        // pending, and the card should stop offering buttons for it.
        qc.invalidateQueries({ queryKey: ['tradeOffer', payload.offerId] });
      } finally {
        setBusy(false);
      }
      return;
    }

    // ── Legacy offer: post a text reply, nothing moves. ────────────────
    try {
      // Reply body carries a [TRADE_RESPONSE_V1] marker so any device viewing
      // this conversation can recover the response state from the server.
      // Localstorage is still updated optimistically so the UI doesn't flash
      // back to the buttons before the next message refetch lands.
      const replyBody = formatTradeResponseBody(offerId, accept);
      const recipient = isMine ? payload.toEmail : payload.fromEmail;
      await sendMessage({
        conversationId,
        senderEmail: user.email,
        recipientEmail: recipient,
        body: replyBody,
      });
      const next = accept ? 'accepted' : 'declined';
      setResponded(next);
      try { localStorage.setItem(responseKey(conversationId, offerId), next); } catch { /* ignore */ }
      toast.success(accept ? 'Reply sent — yes' : 'Reply sent — no thanks');
    } catch (err) {
      console.warn('[TradeOfferCard] reply failed:', err);
      toast.error('Could not send reply');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-[260px] sm:w-[300px] rounded-2xl overflow-hidden border border-border bg-card shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-primary/15 to-primary/15 border-b border-border">
        <ArrowRightLeft className="w-3.5 h-3.5 text-primary" />
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
          Trade Offer
        </p>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {isMine ? 'You sent' : `From ${payload.fromName || 'someone'}`}
        </span>
      </div>

      {/* Items — side-by-side */}
      <div className="p-3 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {/* Their side / "you'd give up" */}
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {isMine ? 'You give' : 'They want'}
          </p>
          <div className="text-3xl">{theirItem?.emoji || '❓'}</div>
          <p className="text-[11px] font-medium leading-tight">{theirItem?.name || '—'}</p>
          <span
            className="text-[9px] font-bold uppercase tracking-wider"
            style={{ color: theirItemRarity.color }}
          >
            {theirItem?.rarity || 'common'}
          </span>
          {theirItem?.price ? (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Coins className="w-2.5 h-2.5" />
              {theirItem.price}
            </span>
          ) : null}
        </div>

        <ArrowRightLeft className="w-4 h-4 text-muted-foreground" />

        {/* Your side / "you'd get" */}
        <div className="flex flex-col items-center gap-1 text-center">
          <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            {isMine ? 'You get' : 'You receive'}
          </p>
          <div className="text-3xl">{myItem?.emoji || '❓'}</div>
          <p className="text-[11px] font-medium leading-tight">{myItem?.name || '—'}</p>
          <span
            className="text-[9px] font-bold uppercase tracking-wider"
            style={{ color: myItemRarity.color }}
          >
            {myItem?.rarity || 'common'}
          </span>
        </div>
      </div>

      {/* Action row */}
      <div className="px-3 pb-3">
        {responded ? (
          <p className={`text-center text-[11px] font-bold uppercase tracking-wider ${
            responded === 'accepted' ? 'text-success' : 'text-muted-foreground'
          }`}>
            {responded === 'accepted'
              ? (isReal ? '✓ Traded' : '✓ You replied yes')
              : (isReal ? '✕ Declined' : '✕ You replied no')}
          </p>
        ) : isMine ? (
          <p className="text-center text-[10px] text-muted-foreground">
            Waiting for their reply…
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <button
                onClick={() => handleResponse(false)}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md border border-border text-xs font-bold hover:bg-secondary transition-colors disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" />
                No thanks
              </button>
              <button
                onClick={() => handleResponse(true)}
                disabled={busy}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                I'm in
              </button>
            </div>
            {isReal ? (
              <p className="flex items-start gap-1 mt-2 text-[9px] text-success dark:text-success leading-snug">
                <ShieldCheck className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                <span>
                  Their item is already held. Accept and the two items swap instantly.
                </span>
              </p>
            ) : (
              <p className="flex items-start gap-1 mt-2 text-[9px] text-muted-foreground leading-snug">
                <Info className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                <span>
                  This sends a reply in chat. You and {payload.fromName || 'the sender'} arrange
                  delivery yourselves — items aren&apos;t transferred automatically.
                </span>
              </p>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
