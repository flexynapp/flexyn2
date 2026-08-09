// src/components/market/MarketplaceFeed.jsx
//
// Marketplace orchestrator — data fetching, mutation handlers, and layout.
// The presentational pieces live alongside this file:
//   MarketplaceHeader · DailyChestBlock · ListingCard · BundleCard
//   ListItemDialog · TradeOfferDialog · BuyConfirmDialog
//
// This file used to be ~1,500 lines containing all of the above inline.

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShoppingBag, Heart, Package, SearchX } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { reportError } from '@/lib/reportError';
import * as marketplace from '@/lib/data/marketplace';
import * as inventory   from '@/lib/data/inventory';
import * as itemSoldCounts from '@/lib/data/itemSoldCounts';
import * as wishlist from '@/lib/data/marketplaceWishlist';
import { addRecentlyViewed } from '@/lib/recentlyViewedListings';
import CoinShopModal from '@/components/hub/CoinShopModal';
import RecentlyViewedRail from '@/components/hub/RecentlyViewedRail';
import MarketplaceHeader from './MarketplaceHeader';
import TodayRail from './TodayRail';
import MarketFilterBar, { DEFAULT_FILTERS, applyFilters, activeFilterCount } from './MarketFilterBar';
import ListingCard from './ListingCard';
import BundleCard from './BundleCard';
import ItemDetailSheet from './ItemDetailSheet';
import ListItemDialog from './ListItemDialog';
import TradeOfferDialog from './TradeOfferDialog';
import BuyConfirmDialog from './BuyConfirmDialog';
import { tileRow } from '@/lib/tileRows';

// The listings feed: 2 cards per row on a phone, 3 from sm, wrapped and
// centred — a marketplace holds however many listings it holds, so a partial
// last row is the norm. `align: 'start'` stops a card stretching to the
// tallest card on its line. ListingCard asks tileRow() for the SAME spec, so
// the two halves agree by construction rather than by a copied string.
//
// NOT applied to the bundles row below. Every BundleCard is `col-span-full`,
// so that row is a full-width stack with no partial row to centre — and
// `col-span-full` is a GRID property a flex container silently ignores, so
// converting it would collapse each bundle to its content width.
const LISTING_ROW = tileRow({ gap: 3, cols: 2, smCols: 3, align: 'start' }).row;

// The filter bar's sort maps onto listActive's two params. Keeping the
// SERVER order in sync with the chosen sort matters: listActive caps at 60
// rows, so "price high→low" has to fetch the 60 most expensive listings,
// not re-sort the 60 newest.
const SORT_TO_QUERY = {
  'recent':     ['recent', 'desc'],
  'price-asc':  ['price',  'asc'],
  'price-desc': ['price',  'desc'],
};

export default function MarketplaceFeed() {
  const { user } = useAuth();
  const qc       = useQueryClient();
  const navigate = useNavigate();

  const [showListDialog, setShowListDialog] = useState(false);
  const [tradeTarget,    setTradeTarget]    = useState(null);
  const [buyTarget,      setBuyTarget]      = useState(null);
  const [buyBusy,        setBuyBusy]        = useState(false);
  const [shopOpen,       setShopOpen]       = useState(false);

  // Sold-fade tracking — listing IDs that just disappeared from the active
  // feed. We render the SOLD overlay for ~5s before the listing actually
  // collapses out of the grid. boughtByMe is separate so a self-buy gets
  // the warmer YOURS! variant.
  const [recentlySold,  setRecentlySold]  = useState(() => new Set());
  const [boughtByMeIds, setBoughtByMeIds] = useState(() => new Set());
  const previousListingsRef = useRef([]);

  const [filters, setFilters] = useState(DEFAULT_FILTERS);

  // The listing whose detail sheet is open. Distinct from buyTarget — the
  // sheet is the read step, buyTarget is the commit step.
  const [detailTarget, setDetailTarget] = useState(null);

  const [refreshing, setRefreshing] = useState(false);
  // Set to true in the effect BODY, not just at useRef init. React's
  // StrictMode double-invokes effects in dev: mount → cleanup → mount. A
  // cleanup-only ref latches false on that first synthetic unmount and never
  // recovers, so the settle timer below would decline to clear the spinner
  // and the refresh icon would spin forever — in dev only, which is exactly
  // where it would be mistaken for a hung request.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);


  // ── Data fetching ──────────────────────────────────────────────────────────
  const [sortBy, sortDir] = SORT_TO_QUERY[filters.sort] ?? SORT_TO_QUERY.recent;
  const { data: rawListings, isLoading: loadingListings, isError: listingsError, refetch } = useQuery({
    queryKey: ['marketplaceListings', sortBy, sortDir],
    queryFn:  () => marketplace.listActive(60, sortBy, sortDir),
    staleTime: 15_000,
  });
  const listings = Array.isArray(rawListings) ? rawListings : [];

  // Sold-counts lookup — one bulk query for every visible listing's item_id.
  // Re-runs only when the set of visible item_ids changes.
  const visibleItemIds = useMemo(
    () => Array.from(new Set(listings.map(l => l.item_id).filter(Boolean))),
    [listings]
  );
  const { data: soldCountMap = new Map() } = useQuery({
    queryKey: ['itemSoldCounts', visibleItemIds.join(',')],
    queryFn:  () => itemSoldCounts.countsFor(visibleItemIds),
    enabled:  visibleItemIds.length > 0,
    staleTime: 60_000,
  });

  // Routes to /hub?profile=<user_id> — the canonical profile URL.
  const handleSellerClick = useCallback((sellerId) => {
    if (!sellerId) return;
    navigate(`/hub?profile=${encodeURIComponent(sellerId)}`);
  }, [navigate]);

  // Wishlist (mig 121). Toggle is optimistic via setQueryData so the heart
  // fills/unfills instantly.
  const { data: savedIds = new Set() } = useQuery({
    queryKey: ['marketplaceWishlist', user?.id],
    queryFn:  async () => {
      const rows = await wishlist.listMine(user.id);
      return new Set(rows.map(r => r.listing_id));
    },
    enabled:   !!user?.id,
    staleTime: 60_000,
  });
  const handleToggleSave = useCallback(async (listingId) => {
    if (!user?.id || !listingId) return;
    const currentlySaved = savedIds.has(listingId);
    qc.setQueryData(['marketplaceWishlist', user.id], (prev) => {
      const next = new Set(prev || []);
      if (currentlySaved) next.delete(listingId); else next.add(listingId);
      return next;
    });
    try {
      await wishlist.toggle(user.id, listingId, currentlySaved);
    } catch {
      qc.setQueryData(['marketplaceWishlist', user.id], (prev) => {
        const next = new Set(prev || []);
        if (currentlySaved) next.add(listingId); else next.delete(listingId);
        return next;
      });
      toast.error('Could not update wishlist — try again.');
    }
  }, [user?.id, savedIds, qc]);

  // Bundle deals (mig 134).
  const { data: activeBundles = [] } = useQuery({
    queryKey: ['marketplaceBundles'],
    queryFn: marketplace.listActiveBundles,
    staleTime: 60_000,
  });

  // Group listings by bundle_id so BundleCard gets a pre-filtered list.
  const bundleMap = useMemo(() => {
    const map = new Map(); // bundleId → [listing, ...]
    listings.forEach(l => {
      if (!l.bundle_id) return;
      if (!map.has(l.bundle_id)) map.set(l.bundle_id, []);
      map.get(l.bundle_id).push(l);
    });
    return map;
  }, [listings]);

  // IDs already shown inside a bundle card — excluded from the regular grid.
  const bundledListingIds = useMemo(() => {
    const ids = new Set();
    bundleMap.forEach(ls => ls.forEach(l => ids.add(l.id)));
    return ids;
  }, [bundleMap]);

  const handleBuyBundle = useCallback(async (bundle) => {
    if (!user?.id) return;
    try {
      const result = await marketplace.purchaseBundle(bundle.id);
      toast.success(`Bundle purchased! 🪙 ${result.paid_price} spent. Items are yours.`);
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      await qc.invalidateQueries({ queryKey: ['marketplaceBundles'] });
      await qc.invalidateQueries({ queryKey: ['userInventory', user.email] });
    } catch (err) {
      const msg = err.message?.includes('insufficient_coins')
        ? 'Not enough coins for this bundle.'
        : err.message?.includes('bundle_not_available')
        ? 'This bundle is no longer available.'
        : 'Could not purchase bundle — try again.';
      toast.error(msg);
    }
  }, [user?.id, user?.email, qc]);

  // Featured listings no longer get their own rail above the grid. They
  // rendered there AND again in the grid below — every featured listing
  // appeared twice, because the grid only excluded BUNDLED ids, never
  // featured ones. applyFilters floats them to the top instead, and the
  // card's own Featured ribbon does the signalling.

  // Detect listings that disappeared between the previous render and this
  // one — those are the just-sold (or cancelled) ones. Mark them for a 5s
  // sold-fade overlay, then clean them up.
  useEffect(() => {
    const prevIds = new Set(previousListingsRef.current.map(l => l.id));
    const currIds = new Set(listings.map(l => l.id));
    const disappeared = [...prevIds].filter(id => !currIds.has(id));
    if (disappeared.length === 0) {
      previousListingsRef.current = listings;
      return;
    }
    setRecentlySold(prev => {
      const next = new Set(prev);
      disappeared.forEach(id => next.add(id));
      return next;
    });
    const timer = setTimeout(() => {
      setRecentlySold(prev => {
        const next = new Set(prev);
        disappeared.forEach(id => next.delete(id));
        return next;
      });
      setBoughtByMeIds(prev => {
        const next = new Set(prev);
        disappeared.forEach(id => next.delete(id));
        return next;
      });
    }, 5000);
    previousListingsRef.current = listings;
    return () => clearTimeout(timer);
  }, [listings]);

  const { data: rawMyItems } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn:  () => inventory.listItems(user.email),
    enabled:  !!user?.email,
    staleTime: 30_000,
  });
  const myItems = Array.isArray(rawMyItems) ? rawMyItems : [];
  const listableCount = myItems.filter(i => !i.is_listed && i.item_type === 'sticker').length;

  const flexCoins = user?.flex_coins ?? 0;

  // ── Refresh ────────────────────────────────────────────────────────────────
  //
  // The header's refresh button used to be `() => refetch()`, which reloaded
  // ONE of the five queries this view is built from. Everything else on the
  // screen — bundle deals, sold counts, the wishlist hearts, and the "List
  // Item · N" count that comes from your inventory — kept whatever it had
  // cached, so "refresh" refreshed part of the page and the rest silently
  // disagreed with the server until its own staleTime expired.
  //
  // invalidateQueries rather than refetch(): listings are keyed by
  // ['marketplaceListings', sortBy, sortDir], so refetch() only reloaded the
  // sort you happened to be on and left the other two cached. Invalidating
  // the prefix refetches the mounted one and marks the rest stale.
  //
  // MIN_SPIN_MS: a warm refetch resolves in well under 100ms, which renders
  // as a single frame of spin — indistinguishable from nothing happening.
  // Holding the spinner briefly is the whole point of the control.
  const MIN_SPIN_MS = 450;
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    const startedAt = Date.now();
    try {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['marketplaceListings'] }),
        qc.invalidateQueries({ queryKey: ['marketplaceBundles'] }),
        qc.invalidateQueries({ queryKey: ['itemSoldCounts'] }),
        qc.invalidateQueries({ queryKey: ['marketplaceWishlist', user?.id] }),
        qc.invalidateQueries({ queryKey: ['userInventory', user?.email] }),
      ]);
    } catch (err) {
      // The listings query renders its own error state, so this is only
      // worth reporting — not worth a second toast on top of it.
      reportError(err, {
        feature: 'marketplace.refresh', level: 'warning', userEmail: user?.email,
      });
    } finally {
      const elapsed = Date.now() - startedAt;
      const settle = () => { if (mountedRef.current) setRefreshing(false); };
      if (elapsed < MIN_SPIN_MS) setTimeout(settle, MIN_SPIN_MS - elapsed);
      else settle();
    }
  }, [refreshing, qc, user?.id, user?.email]);

  // ── Undo a cancel ──────────────────────────────────────────────────────────
  //
  // Declared ABOVE handleCancel on purpose: handleCancel names it in its
  // useCallback deps array, and a deps array is evaluated synchronously when
  // useCallback runs. Declared the other way round this is a TDZ
  // ReferenceError that dev mode can hide and minified production doesn't —
  // the 2026-05-23 Hub crash was exactly this shape.
  //
  // "Undo" re-lists rather than un-cancelling. There is no un-cancel RPC and
  // adding one would mean a migration plus a new way to resurrect a listing
  // server-side; `create_marketplace_listing` (mig 025) already validates
  // ownership, checks the item isn't listed, and sets is_listed in one
  // transaction, so restoring the same terms through it is both correct and
  // free. The visible outcome is identical — same item, same price, back on
  // the market. The difference is that it's a NEW listing row: the cancelled
  // one stays cancelled, and the restored listing sorts as newest rather than
  // returning to its original position.
  const handleUndoCancel = useCallback(async (listing) => {
    try {
      await marketplace.createListing({
        inventory_id:     listing.inventory_id,
        listing_type:     listing.listing_type,
        asking_price:     listing.asking_price ?? null,
        trade_for_rarity: listing.trade_for_rarity ?? null,
      });
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      await qc.invalidateQueries({ queryKey: ['userInventory', user?.email] });
    } catch (err) {
      reportError(err, {
        feature: 'marketplace.undo-cancel', level: 'warning',
        userEmail: user?.email, listingId: listing?.id,
      });
      // Names the recovery path: the item is safely back in the bag either
      // way, so "it's still yours, list it again" is the accurate thing to
      // say rather than a bare "something went wrong".
      toast.error("Couldn't restore that listing — the item's still in your bag.");
    }
  }, [qc, user?.email]);

  // ── Cancel listing ─────────────────────────────────────────────────────────
  const handleCancel = useCallback(async (listing) => {
    try {
      await marketplace.cancelListing(listing.id);
      // cancel_marketplace_listing (mig 078) clears is_listed in the same
      // transaction. The client cannot write it — user_inventory has no
      // UPDATE policy — so the old `inventory.setListed(false)` here threw
      // 42501 on every cancel, dropping a successful cancel into the catch
      // and telling the user it had failed.
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      await qc.invalidateQueries({ queryKey: ['userInventory', user?.email] });
      // The Undo is what makes this toast render at all: src/lib/toast.js
      // suppresses every non-error variant unless it carries an `action`, so
      // the bare toast.success that used to be here showed nothing. It also
      // happens to be the right affordance — cancelling is one tap with no
      // confirm step, so a mis-tap needs a way back.
      toast.success('Pulled it back.', {
        action: {
          label: 'Undo',
          onClick: () => { void handleUndoCancel(listing); },
        },
      });
    } catch (err) {
      reportError(err, {
        feature: 'marketplace.cancel-listing', level: 'warning',
        userEmail: user?.email, listingId: listing?.id,
      });
      toast.error('Could not cancel — try again.');
    }
  }, [qc, user?.email, handleUndoCancel]);

  // ── Buy item ───────────────────────────────────────────────────────────────
  // Server-atomic via the purchase_listing RPC (mig 025): locks the listing,
  // validates the buyer can afford it, deducts buyer coins, credits seller,
  // transfers the inventory row, marks the listing completed — all in one
  // transaction. Replaces a 5-step client-orchestrated sequence that had a
  // double-sell race and a free-item cheat path.
  const handleBuyConfirm = useCallback(async () => {
    if (!buyTarget || !user) return;
    setBuyBusy(true);
    try {
      await marketplace.purchaseListing(buyTarget.id);
      // Flag this listing for the warmer YOURS! sold-fade variant BEFORE
      // the next refetch removes it from the feed.
      const justBoughtId = buyTarget.id;
      setBoughtByMeIds(prev => {
        const next = new Set(prev);
        next.add(justBoughtId);
        return next;
      });
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      await qc.invalidateQueries({ queryKey: ['userInventory', user.email] });
      await qc.invalidateQueries({ queryKey: ['userProfile', user.email] });
      toast.success(`You bought ${buyTarget.item_emoji} ${buyTarget.item_name}!`);
      setBuyTarget(null);
    } catch (err) {
      reportError(err, { feature: 'marketplace.purchase', level: 'warning', userEmail: user?.email });
      const msg = err?.message || '';
      if (/insufficient_coins/.test(msg)) {
        toast.error('Not enough Flex Coins for this purchase.');
      } else if (/item no longer available/.test(msg)) {
        toast.error('That item was already sold or is no longer available.');
        qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      } else if (/listing is /.test(msg)) {
        toast.error('That listing is no longer active.');
        qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
      } else if (/cannot purchase your own listing/.test(msg)) {
        toast.error("You can't buy your own listing.");
      } else {
        toast.error('Purchase failed: ' + (msg || 'unknown error'));
      }
    } finally {
      setBuyBusy(false);
    }
  }, [buyTarget, user, qc]);

  // Saved is a filter now, not a separate view. Bundled listings are always
  // excluded from the grid because they're rendered as bundle cards above.
  const viewListings = useMemo(() => {
    const base = listings.filter(l => !bundledListingIds.has(l.id));
    return filters.saved ? base.filter(l => savedIds.has(l.id)) : base;
  }, [listings, savedIds, filters.saved, bundledListingIds]);

  // …then narrow by the filter bar and float featured to the top.
  const visibleListings = useMemo(
    () => applyFilters(viewListings, filters, flexCoins),
    [viewListings, filters, flexCoins]
  );
  const filtersActive = activeFilterCount(filters) > 0;

  // Shared props for every ListingCard so the three render sites (featured
  // rail, main grid, sold-fade) can't drift apart.
  const cardProps = {
    currentUser: user,
    flexCoins,
    onCancel: handleCancel,
    onBuy: (l) => { if (user?.email) addRecentlyViewed(user.email, l); setBuyTarget(l); },
    onOfferTrade: (l) => { if (user?.email) addRecentlyViewed(user.email, l); setTradeTarget(l); },
    onSellerClick: handleSellerClick,
    onToggleSave: handleToggleSave,
    onOpenDetail: (l) => {
      if (user?.email) addRecentlyViewed(user.email, l);
      setDetailTarget(l);
    },
  };

  return (
    <div className="flex flex-col gap-4">
      <MarketplaceHeader
        flexCoins={flexCoins}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onList={() => setShowListDialog(true)}
        onOpenTradeHistory={() => navigate('/market/trades')}
        listableCount={listableCount}
      />

      <TodayRail
        user={user}
        onClaimed={() => qc.invalidateQueries({ queryKey: ['userProfile', user.email] })}
        onOpenShop={() => setShopOpen(true)}
      />

      <MarketFilterBar
        filters={filters}
        onChange={setFilters}
        resultCount={visibleListings.length}
        totalCount={viewListings.length}
        savedCount={savedIds.size}
      />

      {/* Listings grid */}
      {loadingListings ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
      ) : listingsError ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <ShoppingBag className="w-12 h-12 text-muted-foreground/50" />
          <p className="text-muted-foreground font-medium">Could not load listings</p>
          <button onClick={() => refetch()} className="text-primary text-sm hover:underline">
            Try again
          </button>
        </div>
      ) : filters.saved && savedIds.size === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <Heart className="w-12 h-12 text-muted-foreground/50" />
          <p className="font-heading font-bold">No saved listings yet</p>
          <p className="text-muted-foreground text-sm max-w-xs">
            Tap the ♥ on any listing to save it here.
          </p>
          <button
            onClick={() => setFilters(f => ({ ...f, saved: false }))}
            className="mt-1 px-4 py-2 rounded-full bg-primary text-primary-foreground font-bold text-sm"
          >
            Browse marketplace →
          </button>
        </div>
      ) : listings.length === 0 && recentlySold.size === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <ShoppingBag className="w-12 h-12 text-muted-foreground/50" />
          <p className="font-heading font-bold">Marketplace is quiet</p>
          <p className="text-muted-foreground text-sm max-w-xs">
            No one&apos;s listing right now — be the trendsetter.
          </p>
          {listableCount > 0 && (
            <button
              type="button"
              onClick={() => setShowListDialog(true)}
              className="mt-2 px-4 py-2 rounded-full bg-primary text-primary-foreground font-bold text-sm shadow-md hover:opacity-90 transition-opacity"
            >
              List the first item →
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Bundle deal rows (mig 134) — browse view only. Bundled items
              are excluded from the regular grid below. */}
          {!filters.saved && activeBundles.some(b => bundleMap.has(b.id)) && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <Package className="w-3.5 h-3.5 text-amber-500" />
                <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-amber-500">
                  Bundle deals
                </h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <AnimatePresence>
                  {activeBundles
                    .filter(b => bundleMap.has(b.id) && bundleMap.get(b.id).some(l => l.listing_type === 'sale'))
                    .map(bundle => (
                      <BundleCard
                        key={bundle.id}
                        bundle={bundle}
                        listings={bundleMap.get(bundle.id) || []}
                        currentUser={user}
                        flexCoins={flexCoins}
                        onBuyBundle={handleBuyBundle}
                      />
                    ))
                  }
                </AnimatePresence>
              </div>
            </div>
          )}

          <motion.div layout className={LISTING_ROW}>
            <AnimatePresence>
              {visibleListings.map(listing => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  soldCount={soldCountMap.get(listing.item_id) || 0}
                  isSaved={savedIds.has(listing.id)}
                  {...cardProps}
                />
              ))}
              {/* Sold-fade cards — re-render the just-removed listings from
                  the previous snapshot with the SOLD overlay for ~5s before
                  they collapse out. previousListingsRef is always one render
                  behind, so it still holds the pre-sale data. */}
              {previousListingsRef.current
                .filter(l => recentlySold.has(l.id) && !listings.find(x => x.id === l.id))
                .map(listing => (
                  <ListingCard
                    key={`sold-${listing.id}`}
                    listing={listing}
                    soldCount={soldCountMap.get(listing.item_id) || 0}
                    isSaved={savedIds.has(listing.id)}
                    {...cardProps}
                    recentlySold
                    boughtByMe={boughtByMeIds.has(listing.id)}
                    onBuy={() => {}}
                    onCancel={() => {}}
                    onOfferTrade={() => {}}
                    onOpenDetail={undefined}
                  />
                ))}
            </AnimatePresence>
          </motion.div>

          {/* Filtered everything out — distinct from "marketplace is quiet",
              and the fix is one tap rather than "come back later". */}
          {visibleListings.length === 0 && filtersActive && (
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
              <SearchX className="w-10 h-10 text-muted-foreground/50" />
              <p className="font-heading font-bold">Nothing matches those filters</p>
              <p className="text-muted-foreground text-sm max-w-xs">
                {viewListings.length} listing{viewListings.length === 1 ? '' : 's'} available — try widening the search.
              </p>
              <button
                type="button"
                onClick={() => setFilters({ ...DEFAULT_FILTERS, sort: filters.sort })}
                className="mt-1 px-4 py-2 rounded-full bg-primary text-primary-foreground font-bold text-sm"
              >
                Clear filters
              </button>
            </div>
          )}

          {/* Recently viewed — moved BELOW the grid. As a pre-grid rail it
              was another band of chrome between the user and the listings,
              and it's a "pick up where you left off" affordance, which is a
              reasonable thing to find after you've scanned what's new. */}
          {user?.email && (
            <div className="mt-4">
              <RecentlyViewedRail
                userEmail={user.email}
                listings={listings}
                onSelect={(listing) => setDetailTarget(listing)}
              />
            </div>
          )}
        </>
      )}

      {/* Item detail — the read step between the grid and any commit step.
          It owns its own AnimatePresence inside the portal. */}
      {detailTarget && (
        <ItemDetailSheet
          listing={detailTarget}
          allListings={listings}
          currentUser={user}
          flexCoins={flexCoins}
          isSaved={savedIds.has(detailTarget.id)}
          onToggleSave={handleToggleSave}
          onSellerClick={handleSellerClick}
          onSelectListing={(l) => setDetailTarget(l)}
          onBuy={(l) => { setDetailTarget(null); setBuyTarget(l); }}
          onOfferTrade={(l) => { setDetailTarget(null); setTradeTarget(l); }}
          onCancel={(l) => { setDetailTarget(null); handleCancel(l); }}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {/* Dialogs */}
      <AnimatePresence>
        {showListDialog && (
          <ListItemDialog
            open={showListDialog}
            onClose={() => setShowListDialog(false)}
            userItems={myItems}
            user={user}
            onSuccess={() => setShowListDialog(false)}
          />
        )}
        {tradeTarget && (
          <TradeOfferDialog
            open={!!tradeTarget}
            listing={tradeTarget}
            userItems={myItems}
            user={user}
            onClose={() => setTradeTarget(null)}
          />
        )}
        {buyTarget && (
          <BuyConfirmDialog
            open={!!buyTarget}
            listing={buyTarget}
            onClose={() => !buyBusy && setBuyTarget(null)}
            onConfirm={handleBuyConfirm}
            busy={buyBusy}
          />
        )}
      </AnimatePresence>

      {/* Coin Shop — opened via the Buy More Capsules CTA */}
      <CoinShopModal open={shopOpen} onClose={() => setShopOpen(false)} />
    </div>
  );
}
