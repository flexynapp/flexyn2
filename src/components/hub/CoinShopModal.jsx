// src/components/hub/CoinShopModal.jsx
//
// Direct coin → item shop. Opens from the bag/inventory area. Sells:
//   • Capsules (Standard / Premium / Elite)
//   • Streak Freezes
//
// Marketplace remains player-to-player. This is the system shop.

import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, Loader2, Sparkles } from 'lucide-react';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { supabase } from '@/api/supabaseClient';
import { SHOP_CATALOG, purchaseItem, getCapsuleOdds, BEST_VALUE_SKU } from '@/lib/data/coinShop';
import CapsuleIcon from '@/components/loot/CapsuleIcon';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

/**
 * Shop row icon. Capsule SKUs draw the real capsule; everything else
 * (streak freeze) is still a glyph. The catalog's `icon` string stays the
 * fallback — it's what the purchase toast uses, which can't hold a node.
 */
function ShopIcon({ item, size }) {
  if (item?.grants?.type === 'capsule') {
    return <CapsuleIcon type={item.grants.capsuleType} size={size} className="shrink-0" />;
  }
  return <div className="shrink-0 leading-none" style={{ fontSize: size }} aria-hidden="true">{item?.icon}</div>;
}

// Rarity accent per SKU. The bag and the marketplace already colour items by
// rarity; the shop sold the *sources* of those items as flat neutral rows, so
// an Elite Capsule looked exactly like a Standard one in the place you buy it.
const RARITY_STYLE = {
  common:   { ring: 'ring-slate-400/30',   text: 'text-slate-400',   glow: '' },
  uncommon: { ring: 'ring-success/40', text: 'text-success', glow: '' },
  rare:     { ring: 'ring-info/40',     text: 'text-info',     glow: 'shadow-info/10' },
  epic:     { ring: 'ring-primary/50', text: 'text-primary', glow: 'shadow-primary/20' },
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
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock(open);
  const dragControls = useDragControls();
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
        // The Marketplace opens this modal over itself (TodayRail → Open
        // shop) and gates its Buy buttons on ['flexCoins']. Without this the
        // shop spends coins the feed underneath still thinks you have.
        queryClient.invalidateQueries({ queryKey: ['flexCoins', user?.id] });
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
          // Handle-only. With a live listener framer writes
          // `touch-action: pan-x` here, and touch-action resolves down the
          // ancestor chain — so the `overflow-y-auto` item list below could
          // not be panned, and the shop was capped at whatever fitted in
          // 88vh. See BottomSheet.jsx for the full mechanism.
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.3 }}
          onDragEnd={(_e, info) => {
            if (info.velocity.y >= 300 || info.offset.y >= 80) onClose?.();
          }}
        >
          {/* Header — doubles as the drag surface, since this sheet has no
              pill. The close button is excluded so a pointerdown that starts
              a drag can't swallow its tap. */}
          <div
            onPointerDown={(e) => {
              if (e.target.closest('button')) return;
              dragControls.start(e);
            }}
            className="flex items-center justify-between p-4 border-b border-border cursor-grab active:cursor-grabbing touch-none select-none">
            <div>
              <h2 className="font-heading font-bold text-base">{t('shop.title')}</h2>
              <div className="flex items-center gap-1.5 mt-0.5">
                <FlexCoinIcon size={14} />
                <span className="font-bold tabular-nums text-sm">{fmt(balance)}</span>
                <span className="text-micro text-muted-foreground">{t('shop.balance')}</span>
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label={tFallback("common.close", "Close")}
              className="p-1.5 rounded-md hover:bg-secondary active:bg-secondary transition-colors"
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
          <div className="p-3 border-t border-border text-micro text-center text-muted-foreground">
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
                  <div className="mb-2 flex justify-center">
                    <ShopIcon item={SHOP_CATALOG[confirmSku]} size={40} />
                  </div>
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
        <ShopIcon item={item} size={30} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className={`font-heading font-bold text-sm truncate ${rarity.text}`}>{displayName}</p>
            {/* Best value is computed from real price-per-epic in
                coinShop.js, not hand-labelled, so it can't drift out of
                sync with the odds table. */}
            {isBestValue && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/15 text-primary text-micro font-bold uppercase tracking-wider">
                <Sparkles className="w-2.5 h-2.5" aria-hidden="true" />
                {tFallback('shop.bestValue', 'Best value')}
              </span>
            )}
          </div>
          <p className="text-micro text-muted-foreground">{displayDesc}</p>
          {/* Published drop odds. Both app stores require these to be
              disclosed before a loot-box purchase, and the Elite copy used
              to claim "guaranteed epic+" when the real number is 30%. */}
          {odds && (
            <p className="text-micro text-muted-foreground/80 tabular-nums mt-0.5">
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
          <FlexCoinIcon size={12} />
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
          <p className="text-micro text-muted-foreground mt-1 tabular-nums">
            {tFallback('shop.shortBy', '{n} coins to go — earn them from daily quests, streaks and level-ups.', {
              n: fmt(shortfall),
            })}
          </p>
        </div>
      )}
    </div>
  );
}
