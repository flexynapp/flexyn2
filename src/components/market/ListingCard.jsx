// src/components/market/ListingCard.jsx
//
// One marketplace listing as a 64px row, from the round 2 design: the die-cut
// sticker, the name, rarity and seller, and on the right the asking price
// over the catalog value (or, for a trade, what the seller wants). Tapping
// the row opens the listing detail, which is where buying, trading, saving,
// cancelling and deleting all live now.

import { memo } from 'react';
import { motion } from 'framer-motion';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import Sticker from '@/components/capsules/Sticker';
import { rarityName } from '@/components/capsules/words';
import { rarityTint } from '@/components/loot/RarityVisuals';
import { catalogValue } from '@/lib/capsuleShelf';
import { displayName } from '@/lib/userDisplay';
import { listItemMotion } from '@/lib/listMotion';
import { useNumberFormatter } from '@/lib/intl';
import { useLanguage } from '@/lib/LanguageContext';

// memo() is load-bearing: the feed re-renders on every unrelated piece of its
// own state, and without this each of those re-rendered all 60 rows. It holds
// only while MarketplaceFeed hands down stable callbacks (see `cardProps`).
function ListingCard({
  listing,
  currentUser,
  recentlySold = false,
  boughtByMe = false,
  onOpenDetail,
}) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  // seller_user_id, NOT seller_email: a guest's seller_email is '' while
  // their profile email is synthesized, so an email match never held.
  const isMine = !!currentUser?.id && listing.seller_user_id === currentUser.id;
  const isSale = listing.listing_type === 'sale';
  const tint = rarityTint(listing.item_rarity);
  const catalog = catalogValue(listing.item_id);
  const isFeatured = !!listing.is_featured
    && listing.featured_until
    && new Date(listing.featured_until) > new Date();

  const note = !isSale
    ? (listing.trade_for_rarity
      ? tFallback('listingCard.forRarityOrBetter', 'for {rarity} or better', { rarity: rarityName(tFallback, listing.trade_for_rarity) })
      : tFallback('listingCard.forAnyTrade', 'for any sticker'))
    : isMine
      ? tFallback('listingCard.yours', 'Your listing')
      : catalog != null
        ? tFallback('listingCard.catalog', 'Catalog {n}', { n: fmt(catalog) })
        : null;

  return (
    <motion.li
      {...listItemMotion({ dim: recentlySold })}
      className={`relative border-t list-none ${recentlySold ? 'pointer-events-none' : ''}`}
    >
      <button
        type="button"
        onClick={() => onOpenDetail?.(listing)}
        disabled={!onOpenDetail || recentlySold}
        className="w-full h-16 flex items-center gap-3 text-start"
      >
        <Sticker itemId={listing.item_id} emoji={listing.item_emoji} rarity={listing.item_rarity} size={46} />
        <span className="flex-1 min-w-0 flex flex-col gap-0.5">
          <span className="text-body font-semibold truncate">{listing.item_name}</span>
          <span className="text-caption text-muted-foreground truncate">
            <span style={{ color: tint.color }}>{rarityName(tFallback, listing.item_rarity)}</span>
            {' · '}
            {isFeatured && <>{tFallback('listingCard.featured', 'Featured')}{' · '}</>}
            {displayName(listing)}
          </span>
        </span>
        <span className="flex flex-col items-end gap-0.5 shrink-0">
          <span className="inline-flex items-center gap-1 text-body font-semibold tabular-nums">
            {isSale
              ? <><FlexCoinIcon size={15} />{fmt(listing.asking_price ?? 0)}</>
              : tFallback('marketFilter.type.trade', 'Trade')}
          </span>
          {note && <span className="text-caption text-muted-foreground tabular-nums">{note}</span>}
        </span>
      </button>

      {/* A listing that just left the feed stays ~5s under a stamp before it
          collapses out. A self-buy reads Yours rather than Sold. */}
      {recentlySold && (
        <span className="absolute inset-0 flex items-center justify-center bg-background/60" aria-hidden="true">
          <span className="stamp text-foreground border border-foreground rounded-sm px-2 py-0.5 -rotate-6">
            {boughtByMe
              ? tFallback('listingCard.stampYours', 'Yours')
              : tFallback('listingCard.stampSold', 'Sold')}
          </span>
        </span>
      )}
    </motion.li>
  );
}

export default memo(ListingCard);
