// src/pages/Capsules.jsx
//
// Capsules, "what opens next": the shelf of unopened capsules by tier, the
// published odds for the one selected, where the sticker set stands and the
// pity counter, with one Open (or Buy) at the bottom. From the round 2 design.
//
// Everything that decides something is a server call this page only fronts:
// purchase_shop_item buys a capsule, open_capsule_atomic (inside the global
// CapsuleOpener) spends one, get_capsule_pity reports the counter. The page
// reads capsule rows and never writes one.
//
// Dropped from the design, on purpose: the "No. 0182" serials over the shelf.
// Capsules carry no serial in the database, so there is nothing to print.

import { useEffect, useMemo, useState } from 'react';
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
  CAPSULE_TIERS, MAX_OPEN_AT_ONCE, defaultTier, oddsSegments, setTiers, shelfByTier, tierShopItem,
} from '@/lib/capsuleShelf';
import { requestOpenCapsules } from '@/lib/inventoryFlow';
import CapsuleCanister from '@/components/capsules/CapsuleCanister';
import PityMeter from '@/components/capsules/PityMeter';
import { OddsBar, SetBar } from '@/components/capsules/parts';
import { tierName, tierFinish, tierBlurb, rarityName } from '@/components/capsules/words';
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
  const [tier, setTier] = useState(null);
  // Start on the rarest tier the user can open. Chosen once the shelf has
  // loaded, and never again: a pick the user made stays theirs.
  useEffect(() => {
    if (tier == null && !isLoading) setTier(defaultTier(shelf));
  }, [tier, isLoading, shelf]);
  const current = tier ?? 'standard';

  const set = useMemo(() => {
    if (!inv) return null;
    const ownership = ownershipFrom(inv);
    return { ...buildCollection('stickers', ownership), tiers: setTiers(ownership.owned) };
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
  const others = CAPSULE_TIERS.filter(t => t !== current);
  // Selected in the middle, the other two either side of it.
  const order = { [others[0]]: 0, [current]: 1, [others[1]]: 2 };
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
        <div className="h-[clamp(190px,30vh,252px)] flex items-end justify-center gap-2.5 px-5">
          {CAPSULE_TIERS.map((t) => {
            const on = t === current;
            const owned = shelf[t].length > 0;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                aria-pressed={on}
                aria-label={tFallback('capsuleOpener.tierCapsule', '{tier} capsule', { tier: tierName(tFallback, t) })}
                className="flex flex-col items-center justify-end min-w-11"
                style={{ order: order[t] }}
              >
                <CapsuleCanister
                  tier={t}
                  height={on ? 'clamp(160px,26vh,226px)' : 'clamp(84px,13vh,111px)'}
                  style={{ opacity: on || owned ? 1 : 0.55 }}
                />
              </button>
            );
          })}
        </div>
        {/* The plank the canisters stand on. */}
        <div className="h-2.5 mx-3.5 bg-border rounded-t-sm border-t border-muted-foreground/25" aria-hidden="true" />
        <div className="h-1 mx-4 bg-background rounded-b-sm" aria-hidden="true" />
        <div className="flex justify-center gap-2 pt-2.5">
          {CAPSULE_TIERS.map((t) => {
            const on = t === current;
            const n = shelf[t].length;
            const p = tierShopItem(t)?.price;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                tabIndex={-1}
                aria-hidden="true"
                className="w-[104px] min-h-11 flex flex-col items-center gap-0.5"
                style={{ order: order[t] }}
              >
                <span className={`text-label font-semibold ${on ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {tierName(tFallback, t)}
                </span>
                <span className="inline-flex items-center gap-1 text-caption text-muted-foreground tabular-nums">
                  {n > 0
                    ? tFallback('capsules.onShelf', '×{n} on shelf', { n })
                    : p != null && <><FlexCoinIcon size={13} />{fmt(p)}</>}
                </span>
                <span className={`w-5 h-0.5 rounded-full mt-0.5 ${on ? 'bg-foreground' : 'bg-transparent'}`} />
              </button>
            );
          })}
        </div>
      </section>

      <div className="pt-4 flex flex-col items-center gap-0.5 text-center">
        <h2 className="font-display text-display">{tierName(tFallback, current)}</h2>
        <p className="text-label text-muted-foreground">
          {/* Two catalog strings joined; the join itself carries no words. */}
          {`${tierFinish(tFallback, current)}. ${tierBlurb(tFallback, current)}`}
        </p>
      </div>

      <div className="pt-5 flex flex-col gap-2">
        <div className="flex justify-between items-baseline">
          <span className="text-label font-semibold">{tFallback('capsuleRarityOdds.dropRates', 'Drop rates')}</span>
          <span className="text-caption text-muted-foreground">{tFallback('capsules.perOpen', 'per open')}</span>
        </div>
        <OddsBar segments={oddsSegments(current)} fmtPct={fmtPct} rarityLabel={(r) => rarityName(tFallback, r)} />
      </div>

      <div className="mt-4 pt-3 border-t flex flex-col gap-2">
        {set && (
          <Link to="/market/set" className="flex flex-col gap-2 min-h-11">
            <span className="flex justify-between items-baseline text-label">
              <span className="inline-flex items-center gap-0.5">
                {tFallback('capsules.set.title', 'The sticker set')}
                <ChevronRight className="w-4 h-4 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
              </span>
              <span className="tabular-nums text-muted-foreground">
                {tFallback('capsules.set.stickersOf', '{owned} of {total} stickers', { owned: set.owned, total: set.total })}
              </span>
            </span>
            <SetBar tiers={set.tiers} />
          </Link>
        )}
        <PityMeter />
      </div>

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
