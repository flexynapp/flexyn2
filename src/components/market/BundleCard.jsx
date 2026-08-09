// src/components/market/BundleCard.jsx
// Shows all sale-type listings in a bundle as a grouped row with a
// discount badge. "Buy Bundle" fires the purchase_bundle RPC (mig 134).
// Split out of MarketplaceFeed.jsx.

import { motion } from 'framer-motion';
import { Package, Lock } from 'lucide-react';
import { displayName } from '@/lib/userDisplay';
import { listItemMotion } from '@/lib/listMotion';
import { useNumberFormatter } from '@/lib/intl';
import { RarityBadge, CoinAmount } from '@/components/loot/RarityVisuals';

/**
 * What a bundle costs, mirroring purchase_bundle (mig 134).
 *
 * SALE listings only. The RPC sums `status='active' AND listing_type='sale'`,
 * so counting a trade listing here advertises a price above the one actually
 * charged — and a trade item shown in the bundle's emoji row implies it comes
 * with the purchase, which it does not.
 *
 * Still an ESTIMATE, and knowingly so: `rows` is whatever the 60-row listings
 * page happened to contain, so a bundle with items outside that page renders
 * low. The RPC's `paid_price` is the authoritative number and is what the
 * success toast reports. Making this exact needs the bundle's own listings
 * fetched by bundle_id rather than filtered out of the feed page.
 *
 * Exported so the card and the feed's "Can afford" filter can't drift.
 */
export function bundlePrice(bundle, rows) {
  const total = (rows ?? [])
    .filter(l => l.listing_type === 'sale')
    .reduce((sum, l) => sum + (l.asking_price ?? 0), 0);
  return { total, price: Math.max(1, Math.round(total * (1 - bundle.discount_pct / 100))) };
}

export default function BundleCard({
  bundle, listings, currentUser, flexCoins, onBuyBundle, onCancelBundle,
}) {
  const fmt = useNumberFormatter();
  // seller_user_id, not seller_email — the same guest hole ListingCard and
  // ItemDetailSheet both document and fixed. create_marketplace_listing
  // stamps seller_email from auth.email(), which is '' for a guest account,
  // so this comparison never matched and a guest saw "Buy bundle" on their
  // own bundle. purchase_bundle then raises cannot_buy_own_bundle — a dead
  // end with no way back to cancelling it.
  const isMine = !!currentUser?.id && bundle.seller_user_id === currentUser.id;
  const saleListings = listings.filter(l => l.listing_type === 'sale');
  const { total: totalPrice, price: discountedPrice } = bundlePrice(bundle, listings);
  const savings = totalPrice - discountedPrice;
  const canAfford = flexCoins >= discountedPrice;

  return (
    <motion.div
      // Same shape as ListingCard — see src/lib/listMotion.js. `col-span-full`
      // is why this row stayed a grid rather than moving to tileRow(): a flex
      // container silently ignores it.
      {...listItemMotion()}
      className="col-span-full rounded-xl border-2 border-amber-400/50 bg-card p-4 gap-3 flex flex-col relative overflow-hidden"
    >
      {/* Bundle badge */}
      <div className="absolute top-3 end-3 flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 text-amber-950 text-micro font-extrabold uppercase tracking-wide">
        <Package className="w-3 h-3" /> Bundle · {bundle.discount_pct}% off
      </div>

      <div>
        <p className="font-heading font-bold text-sm pe-24">{bundle.title}</p>
        <p className="text-muted-foreground text-micro mt-0.5">
          {/* The name comes off a LISTING, not the bundle.
              marketplace_bundles has no seller_username column — it carries
              seller_user_id and seller_email only — and displayName never
              surfaces an email, so `displayName(bundle)` fell through every
              field it checks and every bundle on the page read "by Athlete".
              Since mig 320 the sold set is restricted to the bundle owner's
              own listings, so any of them carries the right name. */}
          by {displayName(saleListings[0] ?? bundle)} · {saleListings.length} item{saleListings.length === 1 ? '' : 's'}
        </p>
      </div>

      {/* Item emoji row — sale listings only, matching what the purchase
          actually transfers. */}
      <div className="flex flex-wrap gap-2">
        {saleListings.map(l => (
          <div key={l.id} className="flex flex-col items-center gap-0.5">
            <span className="text-2xl">{l.item_emoji}</span>
            <RarityBadge rarity={l.item_rarity} size="sm" />
          </div>
        ))}
      </div>

      {/* Pricing */}
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-xs line-through">
          <CoinAmount value={totalPrice} />
        </span>
        <span className="text-amber-600 dark:text-amber-300 font-bold text-base">
          <CoinAmount value={discountedPrice} />
        </span>
        <span className="text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
          Save {fmt(savings)}
        </span>
      </div>

      {isMine ? (
        /* Your own bundle rendered as a dead end: no button at all, on a
           card that still advertised a price. The owner needs both halves —
           what they actually net (the discount is theirs to fund since mig
           320, and the number above is what the BUYER pays) and a way back
           out, since bundling is otherwise irreversible from the UI. */
        <div className="flex flex-col gap-2">
          <p className="text-micro text-muted-foreground">
            Your bundle · you receive <CoinAmount value={discountedPrice} /> of the{' '}
            <CoinAmount value={totalPrice} /> listed
          </p>
          {onCancelBundle && (
            <button
              onClick={() => onCancelBundle(bundle)}
              className="w-full py-2 rounded-lg text-sm font-bold text-red-600 dark:text-red-300 bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 active:bg-red-500/20 transition-colors"
            >
              Break up bundle
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => onBuyBundle(bundle, listings, discountedPrice)}
          disabled={!canAfford}
          className={[
            'w-full py-2 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-1.5',
            canAfford
              ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-400/40 hover:bg-amber-500/30 active:bg-amber-500/30'
              : 'bg-secondary text-muted-foreground border border-border cursor-not-allowed',
          ].join(' ')}
        >
          {!canAfford && <Lock className="w-3.5 h-3.5" />}
          Buy bundle · <CoinAmount value={discountedPrice} />
        </button>
      )}
    </motion.div>
  );
}
