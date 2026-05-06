// src/components/hub/TradeOfferCard.jsx
//
// Renders a structured Trade Offer payload inside HubChat as an interactive
// card. The payload is embedded in the message body with a [TRADE_OFFER_V1]
// prefix so clients that recognize it can show this card; clients that don't
// fall through to the plain-text portion of the body that follows.

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowRightLeft, Check, X, Coins } from 'lucide-react';
import { toast } from 'sonner';
import { RARITY } from '@/lib/lootCatalog';
import { sendMessage } from '@/lib/data/hubMessages';

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
 * @param {object} props
 * @param {object} props.payload - parsed trade offer
 * @param {boolean} props.isMine - whether the current user sent this offer
 *   (drives "you offered" vs "they offered" framing + accept/decline visibility)
 * @param {object} props.user - current user (for sending replies)
 * @param {string} props.conversationId - conversation to send replies into
 */
export default function TradeOfferCard({ payload, isMine, user, conversationId }) {
  const [busy, setBusy] = useState(false);
  const [responded, setResponded] = useState(null); // 'accepted' | 'declined' | null

  const myItem    = isMine ? payload.myItem : payload.theirItem;
  const theirItem = isMine ? payload.theirItem : payload.myItem;
  const myItemRarity    = RARITY[myItem?.rarity] ?? RARITY.common;
  const theirItemRarity = RARITY[theirItem?.rarity] ?? RARITY.common;

  const handleResponse = async (accept) => {
    if (busy || responded) return;
    setBusy(true);
    try {
      const replyBody = accept
        ? `✅ Trade accepted! I'll send ${theirItem.emoji} ${theirItem.name} now.`
        : `❌ Trade declined.`;
      const recipient = isMine ? payload.toEmail : payload.fromEmail;
      await sendMessage({
        conversationId,
        senderEmail: user.email,
        recipientEmail: recipient,
        body: replyBody,
      });
      setResponded(accept ? 'accepted' : 'declined');
      toast.success(accept ? 'Trade accepted' : 'Trade declined');
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
      <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-primary/15 to-fuchsia-500/15 border-b border-border">
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
            responded === 'accepted' ? 'text-emerald-500' : 'text-muted-foreground'
          }`}>
            {responded === 'accepted' ? '✓ Accepted' : '✕ Declined'}
          </p>
        ) : isMine ? (
          <p className="text-center text-[10px] text-muted-foreground">
            Waiting for response…
          </p>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => handleResponse(false)}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md border border-border text-xs font-bold hover:bg-secondary transition-colors disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
              Decline
            </button>
            <button
              onClick={() => handleResponse(true)}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              Accept
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
