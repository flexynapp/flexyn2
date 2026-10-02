// src/pages/Capsules.jsx
//
// Capsules, "what opens next": the shelf of unopened capsules by tier, the
// published odds for the one selected (with the pity line drawn through
// them) and a fan of the sticker set, with one Open (or Buy) at the bottom.
// From the round 2 design.
//
// Everything that decides something is a server call this page only fronts:
// purchase_shop_item buys a capsule, open_capsule_atomic (inside the global
// CapsuleOpener) spends one, get_capsule_pity reports the counter. The page
// reads capsule rows and never writes one.
//
// Dropped from the design, on purpose: the "No. 0182" serials over the shelf.
// Capsules carry no serial in the database, so there is nothing to print.

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { toast } from '@/lib/toast';
import * as capsules from '@/lib/data/capsules';
import * as inventory from '@/lib/data/inventory';
import { getFlexCoins, purchaseItem } from '@/lib/data/coinShop';
import { buildCollection, ownershipFrom } from '@/lib/collection';
import {
  CAPSULE_TIERS, MAX_OPEN_AT_ONCE, defaultTier, setFan, setTiers, shelfByTier, shelfGeometry,
  shelfSlots, swapIntoCentre, tierShopItem,
} from '@/lib/capsuleShelf';
import { SPRING, TWEEN } from '@/lib/motion';
import { haptic } from '@/lib/haptic';
import { requestOpenCapsules } from '@/lib/inventoryFlow';
import CapsuleCanister from '@/components/capsules/CapsuleCanister';
import OddsLadder from '@/components/capsules/OddsLadder';
import SetFan from '@/components/capsules/SetFan';
import { tierName } from '@/components/capsules/words';
import FlexCoinIcon from '@/components/FlexCoinIcon';

export default function Capsules() {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const { user } = useAuth();
  const qc = useQueryClient();

  // Same key and reader as the bag, so an open from either place refreshes
  // both, and the opener's "open the next" reads this cache.
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['userCapsules', user?.email],
    queryFn: () => capsules.listUnopenedCapsules(user.email),
    enabled: !!user?.email,
    staleTime: 15_000,
  });
  const { data: coins } = useQuery({
    queryKey: ['flexCoins', user?.id],
    queryFn: () => getFlexCoins(user.id),
    enabled: !!user?.id,
    staleTime: 15_000,
  });
  const { data: inv } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn: () => inventory.listItems(user.email),
    enabled: !!user?.email,
    staleTime: 30_000,
  });

  const shelf = useMemo(() => shelfByTier(rows), [rows]);
  // The shelf left to right; the middle one is the capsule chosen.
  const [slots, setSlots] = useState(null);
  // Start on the rarest tier the user can open. Chosen once the shelf has
  // loaded, and never again: a pick the user made stays theirs.
  useEffect(() => {
    if (slots == null && !isLoading) setSlots(shelfSlots(defaultTier(shelf)));
  }, [slots, isLoading, shelf]);
  const arranged = slots ?? shelfSlots('standard');
  const current = arranged[1];
  const choose = (t) => {
    if (t === current) return;
    haptic('subtle');
    setSlots(swapIntoCentre(arranged, t));
  };
  const geo = useShelfGeometry();

  const set = useMemo(() => {
    if (!inv) return null;
    const ownership = ownershipFrom(inv);
    return {
      ...buildCollection('stickers', ownership),
      tiers: setTiers(ownership.owned),
      ownedIds: ownership.owned,
      fan: setFan(inv),
    };
  }, [inv]);

  const onShelf = shelf[current].length;
  const shopItem = tierShopItem(current);
  const price = shopItem?.price ?? null;
  const [confirmBuy, setConfirmBuy] = useState(false);
  const [buying, setBuying] = useState(false);
  useEffect(() => { setConfirmBuy(false); }, [current]);

  const open = (n) => {
    const take = shelf[current].slice(0, Math.min(n, MAX_OPEN_AT_ONCE));
    if (take.length) requestOpenCapsules(take);
  };

  const buy = async () => {
    if (!shopItem || buying) return;
    if (!confirmBuy) { setConfirmBuy(true); return; }
    setBuying(true);
    try {
      const res = await purchaseItem(user, shopItem.sku);
      if (res.success) {
        // The balance the SERVER returned, never one computed here.
        if (typeof res.newBalance === 'number') qc.setQueryData(['flexCoins', user?.id], res.newBalance);
        toast.success(tFallback('capsules.bought', 'A {tier} capsule is on your shelf.', { tier: tierName(tFallback, current) }));
        qc.invalidateQueries({ queryKey: ['userCapsules', user?.email] });
        qc.invalidateQueries({ queryKey: ['userCapsulesCount', user?.email] });
        qc.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        qc.invalidateQueries({ queryKey: ['coinShopProfile'] });
      } else if (res.error === 'insufficient_coins') {
        toast.error(tFallback('shop.notEnoughCoins', 'Not enough coins'));
      } else {
        toast.error(tFallback('shop.purchaseFailed', 'Purchase failed. Try again'));
      }
    } finally {
      setBuying(false);
      setConfirmBuy(false);
    }
  };

  const canAfford = coins == null || price == null || coins >= price;
  const fmtPct = (n) => `${fmt(n, { maximumFractionDigits: 1 })}%`;

  return (
    <div className="px-4 pt-2 md:px-8 md:pt-8 max-w-3xl mx-auto flex flex-col">
      <h1 className="sr-only lg:not-sr-only lg:font-display lg:text-display lg:pb-4">
        {tFallback('capsules.title', 'Capsules')}
      </h1>

      <div className="flex items-center justify-between h-11">
        <span className="eyebrow">{tFallback('capsules.yourShelf', 'Your shelf')}</span>
        <span className="inline-flex items-center gap-1.5 text-body font-semibold tabular-nums" aria-label={tFallback('capsules.balance', 'Your coins')}>
          <FlexCoinIcon size={18} />
          {coins == null ? '' : fmt(coins)}
        </span>
      </div>

      {/* The shelf band bleeds to the screen edge: it is the one dominant
          element here. */}
      <section className="-mx-4 md:mx-0 md:rounded-2xl border-y md:border bg-card pt-3 pb-3 flex flex-col">
        {/* Every canister is drawn at the chosen size and the two beside it
            are scaled down from their base, so a pick is pure transform: the
            tapped one slides to the middle and grows while the one it replaces
            slides out to its spot and shrinks. The incoming one rides in front
            so the two read as passing each other. */}
        <div className="relative h-[clamp(190px,30vh,252px)]">
          {CAPSULE_TIERS.map((t) => {
            const slot = arranged.indexOf(t);
            const on = slot === 1;
            const owned = shelf[t].length > 0;
            return (
              <motion.button
                key={t}
                type="button"
                onClick={() => choose(t)}
                aria-pressed={on}
                aria-label={tFallback('capsuleOpener.tierCapsule', '{tier} capsule', { tier: tierName(tFallback, t) })}
                className="absolute bottom-0 left-1/2 block"
                style={{
                  width: geo.width,
                  marginLeft: -geo.width / 2,
                  transformOrigin: '50% 100%',
                  zIndex: on ? 2 : 1,
                }}
                initial={false}
                animate={{
                  x: (slot - 1) * geo.offset,
                  scale: on ? 1 : geo.side,
                  opacity: on || owned ? 1 : 0.55,
                }}
                transition={{ ...SPRING.press, opacity: TWEEN }}
              >
                <CapsuleCanister tier={t} height={geo.big} />
              </motion.button>
            );
          })}
        </div>
        {/* The plank the canisters stand on. */}
        <div className="h-2.5 mx-3.5 bg-border rounded-t-sm border-t border-muted-foreground/25" aria-hidden="true" />
        <div className="h-1 mx-4 bg-background rounded-b-sm" aria-hidden="true" />
        {/* The names ride with their canisters. Each sits on the card colour so
            the one sliding in covers the one sliding out instead of the two
            words printing over each other. */}
        <div className="relative h-11 mt-2.5">
          {CAPSULE_TIERS.map((t) => {
            const slot = arranged.indexOf(t);
            const on = slot === 1;
            const n = shelf[t].length;
            const p = tierShopItem(t)?.price;
            return (
              <motion.button
                key={t}
                type="button"
                onClick={() => choose(t)}
                tabIndex={-1}
                aria-hidden="true"
                className="absolute top-0 left-1/2 -ml-[52px] w-[104px] min-h-11 flex flex-col items-center gap-0.5 bg-card"
                style={{ zIndex: on ? 2 : 1 }}
                initial={false}
                animate={{ x: (slot - 1) * geo.labelOffset }}
                transition={SPRING.press}
              >
                <span className={`text-label font-semibold transition-colors ${on ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {tierName(tFallback, t)}
                </span>
                <span className="inline-flex items-center gap-1 text-caption text-muted-foreground tabular-nums">
                  {n > 0
                    ? `×${n}`
                    : p != null && <><FlexCoinIcon size={13} />{fmt(p)}</>}
                </span>
                <span className={`w-5 h-0.5 rounded-full mt-0.5 bg-foreground transition-opacity ${on ? 'opacity-100' : 'opacity-0'}`} />
              </motion.button>
            );
          })}
        </div>
      </section>

      <div className="pt-4 flex flex-col items-center gap-0.5 text-center">
        {/* Name only. The finish is on screen as the canister itself and the
            odds are the bar below, so a sentence repeating either was text
            for its own sake (Kegan, 2026-10-02). */}
        <h2 className="font-display text-display">{tierName(tFallback, current)}</h2>
      </div>

      <div className="pt-5">
        <OddsLadder tier={current} tiers={set?.tiers ?? null} owned={set?.ownedIds ?? null} fmtPct={fmtPct} />
      </div>

      {set && (
        <Link to="/market/set" className="mt-1 h-14 border-t flex items-center gap-3 text-label">
          <SetFan items={set.fan} />
          <span className="flex-1 min-w-0 tabular-nums text-muted-foreground">
            {tFallback('capsules.set.inYourSet', '{owned} of {total} in your set', { owned: set.owned, total: set.total })}
          </span>
          <ChevronRight className="w-4 h-4 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
        </Link>
      )}

      {/* Pinned above the bottom nav. The spacer keeps the last line clear. */}
      <div className="h-6 shrink-0" />
      <div className="sticky bottom-[var(--nav-h)] lg:bottom-0 -mx-4 px-4 md:mx-0 md:px-0 pt-3 pb-3 bg-background flex flex-col gap-1">
        {onShelf > 0 ? (
          <>
            <button
              type="button"
              onClick={() => open(1)}
              className="h-14 rounded-full bg-primary text-primary-foreground font-display text-title"
            >
              {current === 'elite'
                ? tFallback('capsules.openElite', 'Open elite')
                : current === 'premium'
                  ? tFallback('capsules.openPremium', 'Open premium')
                  : tFallback('capsules.openStandard', 'Open standard')}
            </button>
            {onShelf > 1 && (
              <button type="button" onClick={() => open(onShelf)} className="h-11 text-label font-semibold">
                {onShelf > MAX_OPEN_AT_ONCE
                  ? tFallback('capsules.openTen', 'Open {n} at once', { n: MAX_OPEN_AT_ONCE })
                  : tFallback('capsules.openAll', 'Open all {n} at once', { n: onShelf })}
              </button>
            )}
          </>
        ) : price != null && (
          <>
            <button
              type="button"
              onClick={buy}
              disabled={buying || !canAfford}
              className="h-14 rounded-full bg-primary text-primary-foreground font-display text-title inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {confirmBuy
                ? tFallback('capsules.confirmBuy', 'Confirm, spend {price}', { price: fmt(price) })
                : tFallback('capsules.buyFor', 'Buy for {price}', { price: fmt(price) })}
            </button>
            {!canAfford ? (
              <p className="h-11 flex items-center justify-center text-label text-muted-foreground">
                {tFallback('capsules.shortBy', 'You need {n} more coins', { n: fmt(price - coins) })}
              </p>
            ) : confirmBuy && (
              <button type="button" onClick={() => setConfirmBuy(false)} className="h-11 text-label font-semibold">
                {tFallback('common.cancel', 'Cancel')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Shelf geometry for the current viewport height, recomputed on resize so the
 * canisters keep the sizes the old CSS clamps gave them.
 */
const readShelfGeometry = () => shelfGeometry(typeof window === 'undefined' ? 800 : window.innerHeight);

function useShelfGeometry() {
  const [geo, setGeo] = useState(readShelfGeometry);
  useEffect(() => {
    const onResize = () => setGeo(readShelfGeometry());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return geo;
}
