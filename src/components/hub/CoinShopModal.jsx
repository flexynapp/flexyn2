// src/components/hub/CoinShopModal.jsx
//
// Direct coin → item shop. Opens from the bag/inventory area. Sells:
//   • Capsules (Standard / Premium / Elite)
//   • Streak Freezes
//
// Marketplace remains player-to-player. This is the system shop.

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Coins, X, Loader2, Sparkles } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { supabase } from '@/api/supabaseClient';
import { SHOP_CATALOG, purchaseItem, getCapsuleOdds, BEST_VALUE_SKU } from '@/lib/data/coinShop';

// Rarity accent per SKU. The bag and the marketplace already colour items by
// rarity; the shop sold the *sources* of those items as flat neutral rows, so
// an Elite Capsule looked exactly like a Standard one in the place you buy it.
const RARITY_STYLE = {
  common:   { ring: 'ring-slate-400/30',   text: 'text-slate-400',   glow: '' },
  uncommon: { ring: 'ring-emerald-400/40', text: 'text-emerald-400', glow: '' },
  rare:     { ring: 'ring-sky-400/40',     text: 'text-sky-400',     glow: 'shadow-sky-500/10' },
  epic:     { ring: 'ring-fuchsia-400/50', text: 'text-fuchsia-400', glow: 'shadow-fuchsia-500/20' },
};

// Spending this much or more asks for confirmation first. A single mistap on
// the Elite row currently spends 1,000 coins — roughly a month of daily
// quests — with no undo. Habitica gates every spend behind a confirm modal;
// gating only the expensive half keeps the cheap path fast.
const CONFIRM_THRESHOLD = 350;

// SKU → camelCase translation-key segment. Single source of truth so adding
// a new shop item only requires one edit instead of two chained replaces.
const SKU_TO_CAMEL = {
  capsule_standard: 'standardCapsule',
  capsule_premium:  'premiumCapsule',
  capsule_elite:    'eliteCapsule',
  streak_freeze:    'streakFreeze',
};

// There was an "admin sandbox" here — a hardcoded username list that granted
// free capsules by inserting straight into user_capsules, and showed those
// accounts a fake 1,000,000 coin balance. Removed in migration 266: the check
// passed on the EMAIL LOCAL PART too, so anyone signing up as
// admin@anything.com got it, and the INSERT it relied on is exactly the grant
// that let any client mint Elite Capsules for free. A client-side privilege
// test is not a security boundary.
export default function CoinShopModal({ open, onClose }) {
  const { user } = useAuth();
  const { t, tFallback } = useLanguage();
  const queryClient = useQueryClient();
  const fmt = useNumberFormatter();
  const [busySku, setBusySku] = useState(null);
  const [confirmSku, setConfirmSku] = useState(null);

  // Reset busySku when the modal closes — without this, a purchase
  // that the user dismissed mid-flight (close X, escape, backdrop tap)
  // left busySku pinned to the SKU. Reopening the modal showed the
  // spinner still spinning on a stale state with no way to retry.
  useEffect(() => {
    if (!open) { setBusySku(null); setConfirmSku(null); }
  }, [open]);

  // Subscribe to balance so the header updates after each purchase
  const { data: profile } = useQuery({
    queryKey: ['coinShopProfile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('user_profiles')
        .select('flex_coins')
        .eq('id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user?.id && open,
    staleTime: 5_000,
  });

  const balance = profile?.flex_coins ?? 0;

  const handlePurchase = async (sku) => {
    if (busySku) return;
    setBusySku(sku);
    try {
      const item = SHOP_CATALOG[sku];
      const result = await purchaseItem(user, sku);

      if (result.success) {
        // Use translated item name in the success toast
        const camel = SKU_TO_CAMEL[item.sku];
        const itemNameKey = camel ? `shop.${camel}.name` : null;
        const translatedName = itemNameKey ? t(itemNameKey) : null;
        const displayName = translatedName && translatedName !== itemNameKey ? translatedName : item.name;
        toast.success(t('shop.purchasedToast').replace('{item}', displayName), { icon: item.icon });
        queryClient.invalidateQueries({ queryKey: ['coinShopProfile'] });
        queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        queryClient.invalidateQueries({ queryKey: ['userCapsules', user?.email] });
        queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user?.email] });
        queryClient.invalidateQueries({ queryKey: ['loginStreakProfile'] });
      } else if (result.error === 'insufficient_coins') {
        toast.error(t('shop.notEnoughCoins'));
      } else {
        toast.error(t('shop.purchaseFailed'));
      }
    } finally {
      setBusySku(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-0 md:p-4"
      >
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 30, opacity: 0 }}
          transition={{ type: 'spring', damping: 24, stiffness: 280 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full md:w-[460px] max-h-[88vh] bg-card border-t md:border md:rounded-2xl rounded-t-2xl overflow-hidden flex flex-col shadow-2xl"
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.3 }}
          onDragEnd={(_e, info) => {
            if (info.velocity.y >= 300 || info.offset.y >= 80) onClose?.();
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div>
              <h2 className="font-heading font-bold text-base">{t('shop.title')}</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <Coins className="w-3.5 h-3.5 text-primary" />
                <span className="font-bold tabular-nums text-sm">{fmt(balance)}</span>
                <span className="text-[11px] text-muted-foreground">{t('shop.balance')}</span>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-md hover:bg-secondary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Items */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {Object.values(SHOP_CATALOG).map((item) => (
              <ShopRow
                key={item.sku}
                item={item}
                balance={balance}
                busy={busySku === item.sku}
                onBuy={() => {
                  if (item.price >= CONFIRM_THRESHOLD) setConfirmSku(item.sku);
                  else handlePurchase(item.sku);
                }}
                fmt={fmt}
                t={t}
              />
            ))}
          </div>

          {/* Footer hint — the only "how do I get coins?" affordance in the
              modal, so it stays visible rather than being replaced by an
              error state. */}
          <div className="p-3 border-t border-border text-[11px] text-center text-muted-foreground">
            {t('shop.hint')}
          </div>

          {/* Confirm step for expensive SKUs. */}
          <AnimatePresence>
            {confirmSku && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/55 backdrop-blur-[2px] flex items-center justify-center p-5 z-10"
                onClick={() => setConfirmSku(null)}
              >
                <motion.div
                  initial={{ scale: 0.94, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.94, opacity: 0 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-[300px] rounded-2xl bg-card border border-border p-4 text-center shadow-2xl"
                >
                  <div className="text-4xl mb-2" aria-hidden="true">{SHOP_CATALOG[confirmSku].icon}</div>
                  <p className="font-heading font-bold text-sm">
                    {t(`shop.${SKU_TO_CAMEL[confirmSku]}.name`)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 mb-3">
                    {tFallback('shop.confirmBody', 'Spend {n} coins? This cannot be undone.', {
                      n: fmt(SHOP_CATALOG[confirmSku].price),
                    })}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmSku(null)}
                      className="flex-1 py-2 rounded-lg bg-secondary text-xs font-bold"
                    >
                      {tFallback('common.cancel', 'Cancel')}
                    </button>
                    <button
                      onClick={() => { const sku = confirmSku; setConfirmSku(null); handlePurchase(sku); }}
                      className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold"
                    >
                      {tFallback('shop.confirmBuy', 'Buy')}
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
  );
}

function ShopRow({ item, balance, busy, onBuy, fmt, t }) {
  const { tFallback } = useLanguage();
  const affordable = balance >= item.price;
  const shortfall = Math.max(0, item.price - balance);
  const progress = Math.min(100, (balance / item.price) * 100);
  const odds = getCapsuleOdds(item.sku);
  const rarity = RARITY_STYLE[item.rarity] || RARITY_STYLE.common;
  const isBestValue = item.sku === BEST_VALUE_SKU;
  // Translation key derived from sku via SKU_TO_CAMEL (single source of truth).
  const camelKey = SKU_TO_CAMEL[item.sku] || null;
  const nameKey = camelKey ? `shop.${camelKey}.name` : null;
  const descKey = camelKey ? `shop.${camelKey}.desc` : null;
  const translatedName = nameKey ? t(nameKey) : null;
  const translatedDesc = descKey ? t(descKey) : null;
  const displayName = translatedName && translatedName !== nameKey ? translatedName : item.name;
  const displayDesc = translatedDesc && translatedDesc !== descKey ? translatedDesc : item.description;

  return (
    <div className={`rounded-xl bg-background/60 border border-border/50 p-3 ring-1 ${rarity.ring} ${rarity.glow} ${isBestValue ? 'shadow-md' : ''}`}>
      <div className="flex items-center gap-3">
        <div className="text-3xl shrink-0" aria-hidden="true">{item.icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={`font-heading font-bold text-sm truncate ${rarity.text}`}>{displayName}</p>
            {/* Best value is computed from real price-per-epic in
                coinShop.js, not hand-labelled, so it can't drift out of
                sync with the odds table. */}
            {isBestValue && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-[9px] font-bold uppercase tracking-wider">
                <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />
                {tFallback('shop.bestValue', 'Best value')}
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">{displayDesc}</p>
          {/* Published drop odds. Both app stores require these to be
              disclosed before a loot-box purchase, and the Elite copy used
              to claim "guaranteed epic+" when the real number is 30%. */}
          {odds && (
            <p className="text-[10px] text-muted-foreground/80 tabular-nums mt-0.5">
              {tFallback('shop.odds', '{epic}% epic+ · {legendary}% legendary+', {
                epic: (odds.epicPlus * 100).toFixed(1),
                legendary: (odds.legendaryPlus * 100).toFixed(1),
              })}
            </p>
          )}
        </div>
        <button
          onClick={onBuy}
          disabled={!affordable || busy}
          className="flex items-center gap-1 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
        >
          {/* Show a spinner while the purchase RPC is in flight — the
              disabled-button state alone gave no signal that anything
              was happening and users would tap again, blocked by busySku
              but with no feedback explaining why. */}
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          <Coins className="w-3 h-3" />
          <span className="tabular-nums">{fmt(item.price)}</span>
        </button>
      </div>

      {/* Unaffordable is a gap, not a dead end.
          The median live balance is 5 coins against a 100-coin cheapest SKU,
          so a padlock and a greyed button is what almost everyone sees — with
          nothing telling them how short they are or what closes the gap.
          Habitica's balanceInfo.vue flags *which* currency is short and by
          how much rather than just disabling; same idea here. */}
      {!affordable && (
        <div className="mt-2">
          <div className="h-1 rounded-full bg-border overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-primary/70"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
            {tFallback('shop.shortBy', '{n} coins to go — earn them from daily quests, streaks and level-ups.', {
              n: fmt(shortfall),
            })}
          </p>
        </div>
      )}
    </div>
  );
}
