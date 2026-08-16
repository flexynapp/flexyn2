// src/components/market/TradeOfferDialog.jsx
// Pick one of your stickers and send it as a trade offer to a listing's
// seller. The offer travels as a [TRADE_OFFER_V1] payload inside a DM so
// HubChat can render it as an interactive TradeOfferCard.
// Split out of MarketplaceFeed.jsx.

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Zap, X } from 'lucide-react';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import { findOrCreateConversation, sendMessage } from '@/lib/data/hubMessages';
import * as tradeOffers from '@/lib/data/tradeOffers';
import { RARITY } from '@/lib/lootCatalog';
import { displayName } from '@/lib/userDisplay';
import { RarityBadge, RarityFrame } from '@/components/loot/RarityVisuals';
import { tileRow } from '@/lib/tileRows';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

// The sticker picker — 3 per row at every width. How many unlisted stickers
// you hold is arbitrary, so a partial last row was the usual case.
const PICKER = tileRow({ gap: 2, cols: 3 });

export default function TradeOfferDialog({ open, listing, userItems, user, onClose }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open && !!listing);
  const [selectedOffer, setSelectedOffer] = useState(null);
  const [busy, setBusy]                   = useState(false);

  const eligibleItems = (userItems ?? []).filter(
    i => !i.is_listed && i.item_type === 'sticker' && i.item_id !== listing?.item_id
  );

  const handleSend = async () => {
    if (!selectedOffer || !listing) return;
    if (!listing.inventory_id) {
      toast.error('This listing is missing its item. Refresh and try again.');
      return;
    }
    // A guest seller's listing carries seller_email = '' (mig 025 stamps it
    // from auth.email(), which is empty for a guest), and every DM call
    // below is keyed by email — so the offer message has nowhere to go.
    //
    // This has to bail BEFORE createOffer, which escrows the item
    // server-side: escrowing and then failing to deliver leaves the item
    // locked behind an offer nobody can see or answer. Resolving a guest's
    // address needs an RPC — public_profiles exposes id and username, no
    // email — so this is a hard stop until that lands.
    if (!listing.seller_email) {
      toast.error("Can't reach this seller. Trade offers aren't available on their listings yet.");
      return;
    }
    setBusy(true);
    try {
      // Create the REAL offer first. This escrows your item server-side
      // (migration 253) before the recipient ever sees the message, so it
      // can't also be sold or promised to someone else while they decide.
      // If this throws, no DM is sent — the previous flow sent the message
      // first and had nothing behind it either way.
      const offerId = await tradeOffers.createOffer({
        fromInventoryId: selectedOffer.id,
        toInventoryId:   listing.inventory_id,
        listingId:       listing.id,
      });

      const conv = await findOrCreateConversation(user.email, listing.seller_email);
      if (!conv) throw new Error('Could not open conversation');

      // Structured payload — HubChat detects the [TRADE_OFFER_V1] prefix and
      // renders an interactive card instead of raw text. A plain-text
      // fallback is concatenated below so older clients (or copy/paste)
      // still see something readable.
      const fromName = displayName(user);
      const tradePayload = {
        v: 1,
        type: 'trade_offer',
        // The real public.trade_offers row id. The card resolves live
        // status against it, so response state no longer depends on
        // localStorage or on scanning the conversation for reply markers.
        offerId,
        status: 'pending',
        fromEmail: user.email,
        fromName,
        toEmail: listing.seller_email,
        myItem: {
          inventoryId: selectedOffer.id,
          itemId: selectedOffer.item_id,
          name: selectedOffer.item_name,
          emoji: selectedOffer.item_emoji,
          rarity: selectedOffer.item_rarity,
        },
        theirItem: {
          listingId: listing.id,
          itemId: listing.item_id,
          name: listing.item_name,
          emoji: listing.item_emoji,
          rarity: listing.item_rarity,
          // marketplace_listings stores the price as asking_price. The
          // trade-offer template used to read listing.price, which doesn't
          // exist on the row, so every offer shipped price: null and the
          // recipient saw the listed price as blank.
          price: listing.asking_price ?? null,
        },
        createdAt: new Date().toISOString(),
      };
      const body = [
        '[TRADE_OFFER_V1]' + JSON.stringify(tradePayload),
        '',
        `🔁 Trade Offer from ${fromName}`,
        `I'm offering: ${selectedOffer.item_emoji} ${selectedOffer.item_name} (${RARITY[selectedOffer.item_rarity]?.label ?? selectedOffer.item_rarity})`,
        `For your: ${listing.item_emoji} ${listing.item_name} listed in the Marketplace.`,
        'Accept in the app and the items swap instantly.',
      ].join('\n');
      await sendMessage({
        conversationId: conv.id,
        senderEmail: user.email,
        recipientEmail: listing.seller_email,
        body,
      });
      toast.success('Trade offer sent. Your item is held until they answer.');
      onClose();
    } catch (err) {
      reportError(err, {
        feature: 'marketplace.trade-offer', level: 'warning',
        userEmail: user?.email, listingId: listing?.id,
      });
      toast.error(tradeOffers.tradeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open || !listing) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="relative z-10 bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
          <h3 className="font-heading font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-blue-500" /> {tFallback("tradeOfferDialog.offerATrade", "Offer a Trade")}
          </h3>
          <button
            onClick={onClose}
            aria-label={tFallback("common.close", "Close")}
            className="text-muted-foreground hover:text-foreground active:text-foreground p-1 rounded-lg hover:bg-secondary active:bg-secondary"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="text-sm text-muted-foreground">
            Offering for:{' '}
            <span className="text-foreground font-semibold">
              {listing.item_emoji} {listing.item_name}
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Choose a sticker from your bag to offer. It&apos;s held while they decide,
            and swaps automatically if they accept.
          </p>

          {eligibleItems.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-4">
              No eligible stickers to offer.
            </p>
          ) : (
            <div className={`${PICKER.row} max-h-52 overflow-y-auto`}>
              {eligibleItems.map(item => {
                const picked = selectedOffer?.id === item.id;
                return (
                  <RarityFrame
                    key={item.id}
                    rarity={item.item_rarity}
                    as="button"
                    glow={picked}
                    aria-pressed={picked}
                    onClick={() => setSelectedOffer(item)}
                    className={[
                      'flex flex-col items-center p-2 transition-all',
                      PICKER.item,
                      // The old implementation tried to tint the selection
                      // ring with a React `ringColor` style prop, which
                      // isn't a real CSS property — so "picked" was
                      // signalled by opacity alone. The rarity glow +
                      // full opacity now actually reads as selected.
                      picked ? 'opacity-100' : 'opacity-70 hover:opacity-100',
                    ].join(' ')}
                  >
                    <span className="text-2xl">{item.item_emoji}</span>
                    <span className="text-micro font-semibold mt-0.5 text-center">{item.item_name}</span>
                    <RarityBadge rarity={item.item_rarity} size="sm" />
                  </RarityFrame>
                );
              })}
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={!selectedOffer || busy}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold text-sm disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {busy ? 'Sending…' : 'Send Trade Offer via DM'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
