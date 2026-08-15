// src/components/market/ItemDetailSheet.jsx
//
// The item detail view — the step that didn't exist. Tapping a listing
// used to jump straight from the grid tile to a "Confirm Purchase" modal,
// so a buyer committed coins having seen an emoji, a name and a number.
//
// This sits between them and answers the questions the grid can't:
//   • what IS this thing (catalog description)
//   • is it actually rare, or does everyone have one (sold count)
//   • what does it normally go for (completed-sale price history)
//   • can I get it cheaper right now (other live listings of the same item)
//
// Read-only. Every mutation still routes through the existing confirm
// dialogs, so the atomic purchase / trade-offer paths are untouched.

import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { X, Zap, Lock, Heart, TrendingUp, Store } from 'lucide-react';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import * as marketplace from '@/lib/data/marketplace';
import { findCatalogItem } from '@/lib/lootCatalog';
import { displayName } from '@/lib/userDisplay';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import {
  RarityBadge, RarityGlow, CoinAmount, rarityTint,
} from '@/components/loot/RarityVisuals';
import { useLanguage } from '@/lib/LanguageContext';
import TransText from '@/components/TransText';

// ─── Price history sparkline ──────────────────────────────────────────────────
// Deliberately a bar chart, not a line: marketplace_listings has no sold_at
// column, so the x-axis is "listing order", not real time. Drawing a line
// would imply a trend the data can't support. See priceStatsForItem.
function PriceBars({ prices, color }) {
  const max = Math.max(...prices);
  // Oldest-left reads more naturally than the newest-first fetch order.
  const ordered = [...prices].reverse();
  return (
    <div className="flex items-end gap-0.5 h-10" aria-hidden="true">
      {ordered.map((p, i) => (
        <div
          key={i}
          className="flex-1 min-w-[3px] rounded-sm"
          style={{
            height: `${Math.max(8, (p / max) * 100)}%`,
            backgroundColor: color,
            opacity: 0.35 + (0.65 * (i + 1)) / ordered.length,
          }}
        />
      ))}
    </div>
  );
}

export default function ItemDetailSheet({
  listing,
  allListings = [],
  currentUser,
  flexCoins,
  isSaved,
  onToggleSave,
  onBuy,
  onOfferTrade,
  onCancel,
  onSellerClick,
  onSelectListing,
  onClose,
}) {
  const { tFallback } = useLanguage();
  useBodyScrollLock(!!listing);

  const itemId = listing?.item_id;

  const { data: priceStats, isLoading: priceLoading } = useQuery({
    queryKey: ['itemPriceStats', itemId],
    queryFn:  () => marketplace.priceStatsForItem(itemId),
    enabled:  !!itemId,
    staleTime: 5 * 60_000,
  });

  // Other live listings of the SAME item — the "can I get it cheaper right
  // now" answer. Cheapest first; sale listings before trade-only ones.
  const alternatives = useMemo(() => {
    if (!listing) return [];
    return allListings
      .filter(l => l.item_id === listing.item_id && l.id !== listing.id)
      .sort((a, b) => {
        const as = a.listing_type === 'sale' ? 0 : 1;
        const bs = b.listing_type === 'sale' ? 0 : 1;
        if (as !== bs) return as - bs;
        return (a.asking_price ?? Infinity) - (b.asking_price ?? Infinity);
      })
      .slice(0, 6);
  }, [listing, allListings]);

  if (!listing || typeof document === 'undefined') return null;

  const catalogItem = findCatalogItem(listing.item_id);
  const tint        = rarityTint(listing.item_rarity);
  // seller_user_id, not seller_email — see the note in ListingCard. A guest's
  // seller_email is '' so the email comparison hid Cancel on their own listing.
  const isMine      = !!currentUser?.id && listing.seller_user_id === currentUser.id;
  const isSale      = listing.listing_type === 'sale';
  const canAfford   = isSale && flexCoins >= (listing.asking_price ?? 0);

  // How this listing prices against the item's own history — the single
  // most useful number here, so it gets called out rather than left for
  // the buyer to eyeball off the bars.
  const vsMedian = (isSale && priceStats && listing.asking_price)
    ? Math.round(((listing.asking_price - priceStats.median) / priceStats.median) * 100)
    : null;

  // AnimatePresence lives INSIDE the portal, matching ItemIndexModal. A
  // parent-side AnimatePresence can't drive exit animations on a portaled
  // subtree, so wrapping it out there would silently skip the exit.
  return createPortal(
    <AnimatePresence>
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <motion.div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={listing.item_name}
        className="relative z-10 w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[88vh] flex flex-col overflow-hidden"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      >
        {/* Hero */}
        <div className="relative px-5 pt-5 pb-4 border-b border-border">
          <RarityGlow rarity={listing.item_rarity} className="rounded-none" />
          <div className="flex items-start gap-2 relative z-10">
            <div className="flex-1 flex flex-col items-center text-center gap-1.5">
              <span className="text-6xl leading-none">{listing.item_emoji}</span>
              <h2 className="font-heading font-bold text-lg leading-tight">{listing.item_name}</h2>
              <RarityBadge rarity={listing.item_rarity} />
              {catalogItem?.description && (
                <p className="text-muted-foreground text-xs max-w-xs mt-0.5">
                  {catalogItem.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={tFallback("common.close", "Close")}
              className="absolute top-0 end-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Price / trade requirement */}
          <div className="flex items-center justify-between">
            {isSale ? (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-300 font-bold text-xl">
                <FlexCoinIcon size={16} />
                <CoinAmount value={listing.asking_price ?? 0} />
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-blue-600 dark:text-blue-300 font-bold">
                <Zap className="w-4 h-4" />
                <TransText k="itemDetailSheet.wantsRarity" en="Wants {rarity}"
                  values={{ rarity: <span className="capitalize">{listing.trade_for_rarity ?? 'any'}+</span> }} />
              </span>
            )}
            {!isMine && onToggleSave && (
              <button
                type="button"
                onClick={() => onToggleSave(listing.id)}
                aria-label={isSaved ? 'Remove from saved' : 'Save for later'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-xs font-semibold hover:bg-secondary active:bg-secondary transition-colors"
              >
                <Heart className={`w-3.5 h-3.5 ${isSaved ? 'fill-red-500 text-red-500' : ''}`} />
                {isSaved ? 'Saved' : 'Save'}
              </button>
            )}
          </div>

          {/* What it normally goes for */}
          {priceLoading ? (
            <div className="h-24 rounded-xl bg-secondary/40 animate-pulse" />
          ) : priceStats ? (
            <section className="rounded-xl border border-border bg-secondary/30 p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <TrendingUp className="w-3.5 h-3.5 text-muted-foreground" />
                <h3 className="text-micro font-extrabold uppercase tracking-[0.18em] text-muted-foreground">
                  {tFallback("itemDetailSheet.sold", "Sold for")}
                </h3>
                <span className="text-micro text-muted-foreground ms-auto">
                  last {priceStats.count}
                </span>
              </div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="font-bold text-lg">
                  <CoinAmount value={priceStats.median} />
                </span>
                <span className="text-micro text-muted-foreground">
                  typical · range {priceStats.low}–{priceStats.high}
                </span>
              </div>
              <PriceBars prices={priceStats.recent} color={tint.color} />
              {vsMedian !== null && Math.abs(vsMedian) >= 5 && (
                <p className={`text-micro font-semibold mt-2 ${
                  vsMedian < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                }`}>
                  This one is {Math.abs(vsMedian)}% {vsMedian < 0 ? 'below' : 'above'} the typical price
                </p>
              )}
            </section>
          ) : (
            // Neutral, because we no longer know. This used to branch on the
            // sold count: "no priced sales yet" when the item had traded, and
            // "you're early" when it had not. With the count gone there is
            // nothing to tell those apart, and "you're early" is a claim about
            // the world we would be making without checking it. Price history
            // covers completed SALE listings that carried a price, which was
            // never the same thing as the sold counter anyway (mig 119 counts
            // trades too) — that mismatch is what put "1 sold all-time"
            // directly above "no sale history yet" on device.
            <p className="text-micro text-muted-foreground">
              No priced sales recorded for this item yet.
            </p>
          )}

          {/* Other live listings of the same item */}
          {alternatives.length > 0 && (
            <section>
              <h3 className="text-micro font-extrabold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                {tFallback("itemDetailSheet.alsoListedRightNow", "Also listed right now")}
              </h3>
              <ul className="space-y-1.5">
                {alternatives.map(alt => (
                  <li key={alt.id}>
                    <button
                      type="button"
                      onClick={() => onSelectListing?.(alt)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-secondary/30 hover:bg-secondary active:bg-secondary transition-colors text-start"
                    >
                      <Store className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs flex-1 min-w-0 truncate">{displayName(alt)}</span>
                      {alt.listing_type === 'sale' ? (
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-300 shrink-0">
                          <CoinAmount value={alt.asking_price ?? 0} />
                        </span>
                      ) : (
                        <span className="text-micro font-bold text-blue-600 dark:text-blue-300 shrink-0">
                          {tFallback("itemDetailSheet.trade", "Trade")}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Seller */}
          <section className="flex items-center justify-between pt-1">
            <span className="text-micro text-muted-foreground">
              <TransText k="itemDetailSheet.listedBy" en="Listed by {seller}"
                values={{ seller: <span className="text-foreground font-medium">{displayName(listing)}</span> }} />
            </span>
            {!isMine && onSellerClick && (
              <button
                type="button"
                onClick={() => onSellerClick(listing.seller_user_id)}
                className="text-micro font-bold text-primary hover:underline"
              >
                View profile →
              </button>
            )}
          </section>
        </div>

        {/* Sticky CTA */}
        <div className="px-5 py-3 border-t border-border bg-card">
          {isMine ? (
            <button
              onClick={() => onCancel(listing)}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-red-600 dark:text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 active:bg-red-500/20 transition-colors"
            >
              {tFallback("itemDetailSheet.cancelListing", "Cancel listing")}
            </button>
          ) : isSale ? (
            <button
              onClick={() => onBuy(listing)}
              disabled={!canAfford}
              className={[
                'w-full py-2.5 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-1.5',
                canAfford
                  ? 'bg-primary text-primary-foreground hover:opacity-90'
                  : 'bg-secondary text-muted-foreground border border-border cursor-not-allowed',
              ].join(' ')}
            >
              {!canAfford && <Lock className="w-3.5 h-3.5" />}
              {canAfford
                ? <TransText k="itemDetailSheet.buyForPrice" en="Buy · {price}"
                    values={{ price: <CoinAmount value={listing.asking_price ?? 0} /> }} />
                : <TransText k="itemDetailSheet.needMoreCoins" en="Need {amount} more"
                    values={{ amount: <CoinAmount value={(listing.asking_price ?? 0) - flexCoins} /> }} />}
            </button>
          ) : (
            <button
              onClick={() => onOfferTrade(listing)}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-blue-600 dark:text-blue-300 bg-blue-500/10 border border-blue-400/30 hover:bg-blue-500/20 active:bg-blue-500/20 transition-colors"
            >
              {tFallback("itemDetailSheet.offerATrade", "Offer a trade")}
            </button>
          )}
        </div>
      </motion.div>
    </div>
    </AnimatePresence>,
    document.body,
  );
}
