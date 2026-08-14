// src/components/market/BuyConfirmDialog.jsx
// Final confirm step before purchase_listing fires. Split out of
// MarketplaceFeed.jsx (was ~1,500 lines).

import { motion } from 'framer-motion';
import { RarityBadge, CoinAmount } from '@/components/loot/RarityVisuals';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

export default function BuyConfirmDialog({ open, listing, onClose, onConfirm, busy }) {
  const { tFallback } = useLanguage();
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open && !!listing);
  if (!open || !listing) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <motion.div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        className="relative z-10 bg-card border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 flex flex-col gap-4"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      >
        <h3 className="font-heading font-bold text-lg text-center">{tFallback("buyConfirmDialog.confirmPurchase", "Confirm Purchase")}</h3>
        <div className="flex flex-col items-center gap-2">
          <span className="text-5xl">{listing.item_emoji}</span>
          <p className="font-semibold">{listing.item_name}</p>
          <RarityBadge rarity={listing.item_rarity} />
          <p className="text-amber-500 dark:text-amber-300 font-bold text-lg mt-1">
            <CoinAmount value={listing.asking_price ?? 0} /> Flex Coins
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-secondary text-secondary-foreground font-semibold text-sm hover:bg-secondary/80 active:bg-secondary/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 text-white font-bold text-sm disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {busy ? 'Buying…' : 'Buy Now'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
