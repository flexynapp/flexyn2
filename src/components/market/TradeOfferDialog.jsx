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
      toast.error(tFallback('tradeOfferDialog.missingItem', 'This listing is missing its item. Refresh and try again.'));
      return;
    }
    // The seller is reached by id. seller_email is '' on a guest's listing
    // (mig 025 stamps it from auth.email()), which used to make this a hard
    // stop, and it is another user's address the client should not need.
    // Checked BEFORE createOffer, which escrows the item server-side:
    // escrowing and then failing to deliver would lock it behind an offer
    // nobody can see.
    if (!listing.seller_user_id) {
      toast.error(tFallback('tradeOfferDialog.guestSeller', "Can't reach this seller. Trade offers aren't available on their listings yet."));
      return;
    }
    setBusy(true);
    // Set once create_trade_offer succeeds. From that moment the sticker is
    // in escrow, so any failure below must pull the offer back: otherwise the
    // recipient is never told, the sender sees a generic "Trade failed" and
    // assumes nothing happened, and the sticker stays locked behind an offer
    // only Trade history can reach.
    let offerId = null;
    try {
      // Create the REAL offer first. This escrows your item server-side
      // (migration 253) before the recipient ever sees the message, so it
      // can't also be sold or promised to someone else while they decide.
      // If this throws, no DM is sent — the previous flow sent the message
      // first and had nothing behind it either way.
      offerId = await tradeOffers.createOffer({
        fromInventoryId: selectedOffer.id,
        toInventoryId:   listing.inventory_id,
        listingId:       listing.id,
      });

      const conv = await findOrCreateConversation(user.email, listing.seller_user_id);
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
        // Ids, not emails: this body is readable by both people in the
        // conversation. Real offers resolve everything from offerId; only
        // pre-253 legacy payloads carried fromEmail/toEmail.
        fromId: user.id,
        fromName,
        toId: listing.seller_user_id,
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
      // This body is composed in the SENDER's language and read by the
      // RECIPIENT, so translating it here would render a Spanish sender's
      // offer in Spanish to a German seller. It stays English deliberately:
      // TradeOfferCard renders the payload above as a card in the reader's
      // own language, and HubMessages' inbox preview substitutes its own
      // summary, so these lines are a fallback almost nobody reads. Moving
      // them would need the RECIPIENT's language, which the client sending
      // the message does not have.
      const body = [
        '[TRADE_OFFER_V1]' + JSON.stringify(tradePayload),
        '',
        `🔁 Trade Offer from ${fromName}`,
        `I'm offering: ${selectedOffer.item_emoji} ${selectedOffer.item_name} (${RARITY[selectedOffer.item_rarity]?.label ?? selectedOffer.item_rarity})`,
        `For your: ${listing.item_emoji} ${listing.item_name} listed in the Marketplace.`,
        'Accept in the app and the items swap instantly.',
      ].join('\n');
      const sent = await sendMessage({
        conversationId: conv.id,
        senderEmail: user.email,
        recipientId: listing.seller_user_id,
        body,
      });
      // sendMessage returns null WITHOUT throwing when it has nothing to
      // send from (no senderEmail). That is a delivery failure too, and
      // treating it as success would announce an offer nobody received.
      if (!sent) throw new Error('trade_offer_dm_not_sent');
      toast.success(tFallback('tradeOfferDialog.offerSent', 'Trade offer sent. Your item is held until they answer.'));
      onClose();
    } catch (err) {
      reportError(err, {
        feature: 'marketplace.trade-offer', level: 'warning',
        userEmail: user?.email, listingId: listing?.id,
      });
      if (!offerId) {
        toast.error(tradeOffers.tradeErrorMessage(err, tFallback));
        return;
      }
      // The offer exists and is escrowed, but the DM that tells the seller
      // about it did not go out. Withdraw it with the same RPC Trade history
      // uses, which releases the sticker.
      try {
        await tradeOffers.cancel(offerId);
        toast.error(tFallback('tradeOfferDialog.deliveryFailedWithdrawn', "Couldn't deliver your offer, so it was withdrawn and your sticker is free again. Try again."));
      } catch {
        // cancel() already reported. Point at the one screen that lists the
        // offer and can pull it back.
        toast.error(tFallback('tradeOfferDialog.deliveryFailedHeld', "Couldn't deliver your offer. Open Trade history to pull it back and free your sticker."));
      }
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
            {tFallback('tradeOfferDialog.offeringFor', 'Offering for:')}{' '}
            <span className="text-foreground font-semibold">
              {listing.item_emoji} {listing.item_name}
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            {tFallback('tradeOfferDialog.pickHint', "Choose a sticker from your bag to offer. It's held while they decide, and swaps automatically if they accept.")}
          </p>

          {eligibleItems.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-4">
              {tFallback('tradeOfferDialog.noEligible', 'No eligible stickers to offer.')}
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
            {busy
              ? tFallback('tradeOfferDialog.sending', 'Sending…')
              : tFallback('tradeOfferDialog.sendViaDm', 'Send trade offer by DM')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
