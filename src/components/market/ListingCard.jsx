// src/components/market/ListingCard.jsx
// One marketplace listing tile. Split out of MarketplaceFeed.jsx.

import { motion } from 'framer-motion';
import { Coins, Zap, Lock, Heart, Star } from 'lucide-react';
import * as itemSoldCounts from '@/lib/data/itemSoldCounts';
import { displayName } from '@/lib/userDisplay';
import {
  RarityBadge, RarityFrame, RarityGlow, CoinAmount,
} from '@/components/loot/RarityVisuals';

export default function ListingCard({
  listing,
  currentUser,
  flexCoins,
  onBuy,
  onCancel,
  onOfferTrade,
  recentlySold = false,
  boughtByMe = false,
  soldCount = 0,
  onSellerClick,
  onOpenDetail,
  isSaved = false,
  onToggleSave,
}) {
  // Key on seller_user_id, NOT seller_email. create_marketplace_listing
  // (mig 025) stamps seller_email from auth.email(), which is '' for guest
  // accounts — while the profile's email is the synthesized
  // guest_<uid>@flexyn.guest. So an email comparison never matched for a
  // guest: they saw a Buy button on their own listing (the server rejects
  // self-purchase, so it just dead-ended) and had no way to cancel it.
  // marketplace.listBySeller already keys on user_id for this exact reason.
  const isMine     = !!currentUser?.id && listing.seller_user_id === currentUser.id;
  const isSale     = listing.listing_type === 'sale';
  const canAfford  = isSale && flexCoins >= (listing.asking_price ?? 0);
  const soldLabel  = itemSoldCounts.formatSoldCount(soldCount);
  const isFeatured = !!listing.is_featured
    && listing.featured_until
    && new Date(listing.featured_until) > new Date();

  return (
    <RarityFrame
      rarity={listing.item_rarity}
      as={motion.div}
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={[
        'flex flex-col p-3 gap-2 overflow-hidden transition-opacity',
        isFeatured ? 'ring-2 ring-amber-400/70' : '',
        recentlySold ? 'pointer-events-none opacity-50' : '',
      ].join(' ')}
    >
      {/* Featured ribbon (mig 122) */}
      {isFeatured && (
        <div className="absolute top-2 start-2 z-20 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-400 text-amber-950 text-micro font-extrabold uppercase tracking-wider">
          <Star className="w-2.5 h-2.5 fill-current" /> Featured
        </div>
      )}

      {/* Heart save-for-later (mig 121) — hidden on own listings */}
      {!isMine && !recentlySold && onToggleSave && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleSave(listing.id); }}
          aria-label={isSaved ? 'Remove from saved' : 'Save for later'}
          className="absolute top-2 end-2 z-20 w-7 h-7 rounded-full bg-background/70 border border-border flex items-center justify-center hover:bg-background active:bg-background transition-colors"
        >
          <Heart className={`w-3.5 h-3.5 ${isSaved ? 'fill-red-500 text-red-500' : 'text-muted-foreground'}`} />
        </button>
      )}

      <RarityGlow rarity={listing.item_rarity} />

      {/* Sold stamp — when a listing transitions to sold (via realtime or a
          polled refresh) we keep the card visible for ~5s with a diagonal
          SOLD overlay before it collapses out of the grid. Communicates
          marketplace activity + creates urgency for the listings still
          active. Self-buy gets the warmer YOURS! variant. */}
      {recentlySold && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20" aria-hidden="true">
          <span
            className="font-black text-2xl tracking-widest text-rose-400 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)] rotate-[-12deg] select-none"
            style={{ textShadow: '0 0 8px rgba(0,0,0,0.4)' }}
          >
            {boughtByMe ? 'YOURS!' : 'SOLD'}
          </span>
        </div>
      )}

      {/* Item — tapping opens the detail sheet. The explicit Buy / Offer
          Trade buttons below stay a direct path to the commit step, so a
          buyer who already knows what they want still gets there in one
          tap; everyone else gets a screen that explains what they're
          about to spend coins on. */}
      <button
        type="button"
        onClick={() => onOpenDetail?.(listing)}
        disabled={!onOpenDetail || recentlySold}
        aria-label={`View details for ${listing.item_name}`}
        className="flex flex-col items-center gap-1 relative z-10 rounded-lg -mx-1 px-1 py-0.5 enabled:hover:bg-foreground/5 transition-colors"
      >
        <span className="text-4xl leading-none">{listing.item_emoji}</span>
        <span className="text-xs font-semibold text-center leading-tight">{listing.item_name}</span>
        <RarityBadge rarity={listing.item_rarity} size="sm" />
      </button>

      {/* Seller — tap to open their HubProfile. Excludes own listings. */}
      <p className="text-muted-foreground text-micro text-center relative z-10">
        by{' '}
        {isMine || !onSellerClick ? (
          <span className="font-medium">{displayName(listing)}</span>
        ) : (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onSellerClick(listing.seller_user_id); }}
            className="font-medium text-foreground/80 hover:text-foreground active:text-foreground hover:underline"
          >
            {displayName(listing)}
          </button>
        )}
        {soldLabel && <span> · {soldLabel}</span>}
      </p>

      {/* Listing type badge */}
      <div className="flex justify-center relative z-10">
        {isSale ? (
          <span className="flex items-center gap-1 text-micro font-bold bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-400/30 rounded-full px-2 py-0.5">
            <Coins className="w-3 h-3" /> For Sale
          </span>
        ) : (
          <span className="flex items-center gap-1 text-micro font-bold bg-blue-500/20 text-blue-600 dark:text-blue-300 border border-blue-400/30 rounded-full px-2 py-0.5">
            <Zap className="w-3 h-3" /> For Trade
          </span>
        )}
      </div>

      {/* Price / trade requirement */}
      <div className="text-center relative z-10">
        {isSale ? (
          <p className="text-amber-600 dark:text-amber-300 font-bold text-sm">
            <CoinAmount value={listing.asking_price ?? 0} />
          </p>
        ) : (
          <p className="text-blue-600 dark:text-blue-300 text-xs font-medium">
            Want: <span className="capitalize">{listing.trade_for_rarity ?? 'any'}+</span>
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5 relative z-10 mt-auto">
        {isMine ? (
          <button
            onClick={() => onCancel(listing)}
            className="w-full py-1.5 rounded-lg text-xs font-bold text-red-600 dark:text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 active:bg-red-500/20 transition-colors"
          >
            Cancel
          </button>
        ) : isSale ? (
          <button
            onClick={() => onBuy(listing)}
            disabled={!canAfford}
            className={[
              'w-full py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1',
              canAfford
                ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-400/40 hover:bg-amber-500/30 active:bg-amber-500/30'
                : 'bg-secondary text-muted-foreground border border-border cursor-not-allowed',
            ].join(' ')}
          >
            {!canAfford && <Lock className="w-3 h-3" />}
            Buy · <CoinAmount value={listing.asking_price ?? 0} />
          </button>
        ) : (
          <button
            onClick={() => onOfferTrade(listing)}
            className="w-full py-1.5 rounded-lg text-xs font-bold text-blue-600 dark:text-blue-300 bg-blue-500/10 border border-blue-400/30 hover:bg-blue-500/20 active:bg-blue-500/20 transition-colors"
          >
            Offer Trade
          </button>
        )}
      </div>
    </RarityFrame>
  );
}
