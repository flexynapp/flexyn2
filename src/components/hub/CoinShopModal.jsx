// src/components/hub/CoinShopModal.jsx
//
// Direct coin → item shop. Opens from the bag/inventory area. Sells:
//   • Capsules (Standard / Premium / Elite)
//   • Streak Freezes
//
// Marketplace remains player-to-player. This is the system shop.

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence, useDragControls } from 'framer-motion';
import { X, Loader2 } from 'lucide-react';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { supabase } from '@/api/supabaseClient';
import { SHOP_CATALOG, purchaseItem, getCapsuleOdds, BEST_VALUE_SKU } from '@/lib/data/coinShop';
import CapsuleCanister from '@/components/capsules/CapsuleCanister';
import Sticker from '@/components/capsules/Sticker';
import { tierName, rarityName } from '@/components/capsules/words';
import { inkStyle, SHELF_ORDER } from '@/components/loot/Shelf';
import { stickerSet } from '@/lib/capsuleShelf';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { haptic } from '@/lib/haptic';
import { DURATION, EASE_OUT } from '@/lib/motion';

// Layout (option C of the bag redesign, Kegan 2026-10-02): one capsule at a
// time, picked with a three-way switch. The canister, then the odds as a
// ladder rarest first, then a strip of real stickers each rarity can drop.
// It replaced three ringed rows, each with its own badge and a one-line odds
// summary, which hid the full table behind "epic+" arithmetic.

const TIERS = ['standard', 'premium', 'elite'];
const SKU_FOR = { standard: 'capsule_standard', premium: 'capsule_premium', elite: 'capsule_elite' };

// Spending this much or more asks for confirmation first. A single mistap on
// Elite spends 1,000 coins, roughly a month of daily quests, with no undo.
const CONFIRM_THRESHOLD = 350;

// SKU → camelCase translation-key segment. Single source of truth so adding
// a new shop item only requires one edit instead of two chained replaces.
const SKU_TO_CAMEL = {
  capsule_standard: 'standardCapsule',
  capsule_premium:  'premiumCapsule',
  capsule_elite:    'eliteCapsule',
  streak_freeze:    'streakFreeze',
};

// How many sticker faces the preview strip shows per rarity.
const FACES_PER_RARITY = 3;

/**
 * Published drop odds as a ladder, rarest first, each rarity with a few of
 * the real stickers it can give. Both app stores require loot-box odds to be
 * disclosed before purchase, and these are the full table, not a summary.
 */
export function OddsLadder({ table, fmtPct }) {
  const { tFallback } = useLanguage();
  const set = useMemo(() => stickerSet(), []);
  const rows = SHELF_ORDER.filter(r => (table?.[r] ?? 0) > 0);
  return (
    <ul className="flex flex-col divide-y" aria-label={tFallback('collectionModal.capsuleOdds', 'Capsule odds')}>
      {rows.map(r => {
        const faces = set.filter(s => s.rarity === r).slice(0, FACES_PER_RARITY);
        return (
          <li key={r} className="h-11 flex items-center gap-2">
            <span className="w-24 shrink-0 text-label font-semibold rarity-ink" style={inkStyle(r)}>{rarityName(tFallback, r)}</span>
            <span className="flex-1 flex items-center -space-x-1.5 rtl:space-x-reverse" aria-hidden="true">
              {faces.map(f => <Sticker key={f.id} itemId={f.id} emoji={f.emoji} rarity={f.rarity} size={26} />)}
            </span>
            <span className="text-label font-semibold tabular-nums">{fmtPct(table[r] * 100)}</span>
          </li>
        );
      })}
    </ul>
  );
}

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
        haptic('success');
        toast.success(t('shop.purchasedToast', { item: displayName }), { icon: item.icon });
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

  const [tier, setTier] = useState('standard');
  useEffect(() => { if (!open) setTier('standard'); }, [open]);
  const fmtPct = (n) => `${fmt(n, { maximumFractionDigits: 1 })}%`;
  const sku = SKU_FOR[tier];
  const item = SHOP_CATALOG[sku];
  const odds = getCapsuleOdds(sku);
  const freeze = SHOP_CATALOG.streak_freeze;
  const buy = (target) => {
    haptic('light');
    if (SHOP_CATALOG[target].price >= CONFIRM_THRESHOLD) setConfirmSku(target);
    else handlePurchase(target);
  };

  return (
    <AnimatePresence>
      {open && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/60 z-50 flex items-end md:items-center justify-center p-0 md:p-4"
      >
        <motion.div
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 30, opacity: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={tFallback('shop.title', 'Coin shop')}
          className="relative w-full md:w-[460px] max-h-[88vh] bg-card border-t md:border md:rounded-2xl rounded-t-2xl overflow-hidden flex flex-col shadow-md"
          drag="y"
          // Handle-only. With a live listener framer writes
          // `touch-action: pan-x` here, and touch-action resolves down the
          // ancestor chain — so the scrolling body below could not be
          // panned. See BottomSheet.jsx for the full mechanism.
          dragListener={false}
          dragControls={dragControls}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.3 }}
          onDragEnd={(_e, info) => {
            if (info.velocity.y >= 300 || info.offset.y >= 80) onClose?.();
          }}
        >
          {/* Header — doubles as the drag surface. The close button is
              excluded so a pointerdown that starts a drag can't swallow its
              tap. */}
          <div
            onPointerDown={(e) => {
              if (e.target.closest('button')) return;
              dragControls.start(e);
            }}
            className="flex items-center gap-2 ps-5 pe-2 pt-4 touch-none select-none"
          >
            <h2 className="flex-1 font-heading font-bold text-title">{tFallback('shop.title', 'Coin shop')}</h2>
            <span className="inline-flex items-center gap-1.5 text-label font-semibold tabular-nums" aria-label={tFallback('shop.balanceAria', 'Your balance: {n} coins', { n: fmt(balance) })}>
              <FlexCoinIcon size={18} />
              {fmt(balance)}
            </span>
            <button
              onClick={onClose}
              aria-label={tFallback('common.close', 'Close')}
              className="w-11 h-11 inline-flex items-center justify-center rounded-full text-muted-foreground"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pt-4" style={{ paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}>
            {/* The three capsules, one at a time. */}
            <div className="flex gap-1 p-1 rounded-full bg-background" role="tablist">
              {TIERS.map(t => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={t === tier}
                  onClick={() => { haptic('light'); setTier(t); }}
                  className={`flex-1 h-9 rounded-full text-label font-semibold transition-colors duration-150 ${
                    t === tier ? 'bg-card text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {tierName(tFallback, t)}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tier}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                className="pt-6 flex flex-col gap-2"
              >
                <div className="flex items-center gap-4">
                  <CapsuleCanister tier={tier} height={128} />
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    {sku === BEST_VALUE_SKU && (
                      <span className="text-caption font-semibold text-primary">{tFallback('shop.bestValue', 'Best value')}</span>
                    )}
                    <p className="font-heading font-bold text-title">
                      {tFallback('userBag.tierCapsule', '{tier} capsule', { tier: tierName(tFallback, tier) })}
                    </p>
                  </div>
                </div>
                {odds && (
                  <div className="pt-4">
                    <OddsLadder table={odds.table} fmtPct={fmtPct} />
                  </div>
                )}
                <div className="pt-4">
                  <BuyButton price={item.price} balance={balance} busy={busySku === sku} onBuy={() => buy(sku)} fmt={fmt} full />
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Streak freeze: the one thing here that is not a capsule. */}
            <div className="mt-6 pt-4 border-t flex items-center gap-3">
              <span className="w-12 shrink-0 flex justify-center text-3xl leading-none" aria-hidden="true">{freeze.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-body font-semibold">{t('shop.streakFreeze.name')}</span>
                <span className="block text-caption text-muted-foreground">{t('shop.streakFreeze.desc')}</span>
              </span>
              <BuyButton price={freeze.price} balance={balance} busy={busySku === freeze.sku} onBuy={() => buy(freeze.sku)} fmt={fmt} />
            </div>

            {/* The only "how do I get coins?" line in the shop. */}
            <p className="pt-6 text-caption text-center text-muted-foreground">{t('shop.hint')}</p>
          </div>

          {/* Confirm step for expensive SKUs. */}
          <AnimatePresence>
            {confirmSku && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black/55 flex items-center justify-center p-5 z-10"
                onClick={() => setConfirmSku(null)}
              >
                <motion.div
                  initial={{ scale: 0.96, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.96, opacity: 0 }}
                  transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-[300px] rounded-2xl bg-card border p-4 text-center shadow-md flex flex-col items-center gap-2"
                >
                  {SHOP_CATALOG[confirmSku]?.grants?.type === 'capsule'
                    ? <CapsuleCanister tier={SHOP_CATALOG[confirmSku].grants.capsuleType} height={72} />
                    : <span className="text-4xl leading-none" aria-hidden="true">{SHOP_CATALOG[confirmSku]?.icon}</span>}
                  <p className="font-heading font-bold text-body">
                    {t(`shop.${SKU_TO_CAMEL[confirmSku]}.name`)}
                  </p>
                  <p className="text-label text-muted-foreground">
                    {tFallback('shop.confirmBody', 'Spend {n} coins? This cannot be undone.', {
                      n: fmt(SHOP_CATALOG[confirmSku].price),
                    })}
                  </p>
                  <div className="pt-2 w-full flex gap-2">
                    <button
                      onClick={() => setConfirmSku(null)}
                      className="flex-1 h-11 rounded-full border text-label font-semibold"
                    >
                      {tFallback('common.cancel', 'Cancel')}
                    </button>
                    <button
                      onClick={() => { const target = confirmSku; setConfirmSku(null); handlePurchase(target); }}
                      className="flex-1 h-11 rounded-full bg-primary text-primary-foreground text-label font-bold"
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

/**
 * Price on a button. Short of coins, it is not a dead grey button: it says
 * how far off you are (Habitica's balanceInfo does the same), and stays
 * disabled. The median live balance is well under the cheapest capsule, so
 * this is what most people see.
 */
function BuyButton({ price, balance, busy, onBuy, fmt, full = false }) {
  const { tFallback } = useLanguage();
  const short = Math.max(0, price - balance);
  const width = full ? 'w-full' : 'shrink-0';
  if (short > 0) {
    return (
      <button
        type="button"
        disabled
        className={`${width} h-11 px-4 rounded-full border inline-flex items-center justify-center gap-1.5 text-label font-semibold text-muted-foreground tabular-nums`}
      >
        <FlexCoinIcon size={14} />
        {fmt(price)}
        <span className="font-normal">· {tFallback('shop.toGo', '{n} to go', { n: fmt(short) })}</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onBuy}
      disabled={busy}
      className={`${width} h-11 px-5 rounded-full bg-primary text-primary-foreground inline-flex items-center justify-center gap-1.5 text-label font-bold tabular-nums active:scale-[0.98] transition-transform duration-150`}
    >
      {/* A spinner while the purchase RPC is in flight: a disabled button
          alone gave no signal and people tapped again. */}
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlexCoinIcon size={14} />}
      {tFallback('shop.buyFor', 'Buy for {n}', { n: fmt(price) })}
    </button>
  );
}
