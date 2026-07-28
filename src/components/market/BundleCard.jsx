// src/components/market/BundleCard.jsx
// Shows all sale-type listings in a bundle as a grouped row with a
// discount badge. "Buy Bundle" fires the purchase_bundle RPC (mig 134).
// Split out of MarketplaceFeed.jsx.

import { motion } from 'framer-motion';
import { Package, Lock } from 'lucide-react';
import { displayName } from '@/lib/userDisplay';
import { useNumberFormatter } from '@/lib/intl';
import { RarityBadge, CoinAmount } from '@/components/loot/RarityVisuals';

export default function BundleCard({ bundle, listings, currentUser, flexCoins, onBuyBundle }) {
  const fmt = useNumberFormatter();
  const isMine = bundle.seller_email === currentUser?.email;
  const totalPrice = listings.reduce((sum, l) => sum + (l.asking_price ?? 0), 0);
  const discountedPrice = Math.max(1, Math.round(totalPrice * (1 - bundle.discount_pct / 100)));
  const savings = totalPrice - discountedPrice;
  const canAfford = flexCoins >= discountedPrice;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="col-span-full rounded-xl border-2 border-amber-400/50 bg-card p-4 gap-3 flex flex-col relative overflow-hidden"
    >
      {/* Bundle badge */}
      <div className="absolute top-3 end-3 flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500 text-amber-950 text-[10px] font-extrabold uppercase tracking-wide">
        <Package className="w-3 h-3" /> Bundle · {bundle.discount_pct}% off
      </div>

      <div>
        <p className="font-heading font-bold text-sm pe-24">{bundle.title}</p>
        <p className="text-muted-foreground text-[11px] mt-0.5">
          by {displayName(bundle)} · {listings.length} item{listings.length === 1 ? '' : 's'}
        </p>
      </div>

      {/* Item emoji row */}
      <div className="flex flex-wrap gap-2">
        {listings.map(l => (
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

      {!isMine && (
        <button
          onClick={() => onBuyBundle(bundle, listings, discountedPrice)}
          disabled={!canAfford}
          className={[
            'w-full py-2 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-1.5',
            canAfford
              ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-400/40 hover:bg-amber-500/30'
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
