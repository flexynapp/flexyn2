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
import { AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ShoppingBag, Heart, Package, SearchX } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { reportError } from '@/lib/reportError';
import * as marketplace from '@/lib/data/marketplace';
import * as inventory   from '@/lib/data/inventory';
import * as itemSoldCounts from '@/lib/data/itemSoldCounts';
import * as wishlist from '@/lib/data/marketplaceWishlist';
import { getFlexCoins } from '@/lib/data/coinShop';
import { addRecentlyViewed } from '@/lib/recentlyViewedListings';
import CoinShopModal from '@/components/hub/CoinShopModal';
import RecentlyViewedRail from '@/components/hub/RecentlyViewedRail';
import MarketplaceHeader from './MarketplaceHeader';
import TodayRail from './TodayRail';
import MarketFilterBar, { DEFAULT_FILTERS, applyFilters, activeFilterCount } from './MarketFilterBar';
import ListingCard from './ListingCard';
import BundleCard, { bundlePrice } from './BundleCard';
import ItemDetailSheet from './ItemDetailSheet';
import ListItemDialog from './ListItemDialog';
import TradeOfferDialog from './TradeOfferDialog';
import BuyConfirmDialog from './BuyConfirmDialog';
import { tileRow } from '@/lib/tileRows';
import { LIST_PRESENCE } from '@/lib/listMotion';

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
//
// `relative` is required, not cosmetic: AnimatePresence runs in popLayout
// mode here, which absolutely-positions an exiting card from its measured
// offsetTop/offsetLeft. Those are relative to the nearest POSITIONED
// ancestor, so a static row sends every exiting card to coordinates measured
// against something further up the tree.
const LISTING_ROW = `${tileRow({ gap: 3, cols: 2, smCols: 3, align: 'start' }).row} relative`;

// Stable empty values. A `= []` / `= new Map()` default in a destructured
// useQuery result allocates a NEW one on every render, which changes the
// identity every child sees — enough on its own to defeat memo() on all 60
// cards and to re-run any effect that depends on the list.
const NO_LISTINGS = [];
const NO_COUNTS   = new Map();
const NO_SAVED    = new Set();
const NO_BUNDLES  = [];
const NOOP = () => {};

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

  // Sold-fade tracking — the listing ROWS that just disappeared from the
  // active feed. We render the SOLD overlay for ~5s before the listing
  // actually collapses out of the grid. boughtByMe is separate so a self-buy
  // gets the warmer YOURS! variant.
  //
  // This holds the rows themselves, not just their ids, and that is the fix
  // for a feature that had never once rendered. It used to keep a Set of ids
  // and re-read the vanished rows out of previousListingsRef at render time,
  // on the stated assumption that the ref was "always one render behind". It
  // wasn't: the effect below flagged the ids and overwrote the ref in the
  // SAME pass, so by the time the flagged render ran, the ref already held
  // the post-sale list and the filter `recentlySold.has(l.id) && !listings
  // .find(...)` could not match anything. No SOLD stamp, no YOURS!, ever.
  // A ref is not a snapshot — if you need the old value at render time,
  // store it.
  const [soldFading,    setSoldFading]    = useState(() => new Map()); // id → row
  const [boughtByMeIds, setBoughtByMeIds] = useState(() => new Set());
  const previousListingsRef = useRef([]);
  // Which server query previousListingsRef was captured from — see the
  // sort-change guard in the diffing effect.
  const feedQueryKeyRef = useRef(null);

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
  // Identity of the server query behind `listings`. Declared here rather than
  // beside its only consumer because the sold-fade effect names it in a deps
  // array, and a deps array is evaluated synchronously — declared later this
  // is the TDZ ReferenceError described above handleUndoCancel.
  const feedQueryKey = `${sortBy}|${sortDir}`;
  const {
    data: rawListings, isLoading: loadingListings, isError: listingsError,
    isPlaceholderData, refetch,
  } = useQuery({
    queryKey: ['marketplaceListings', sortBy, sortDir],
    queryFn:  () => marketplace.listActive(60, sortBy, sortDir),
    staleTime: 15_000,
    // Sort is part of the query key, so changing it is a DIFFERENT query with
    // no cache of its own: the grid unmounted to a spinner and remounted the
    // whole thing a moment later. That full teardown is the harshest
    // transition on this screen and it fires on a control the user is likely
    // to try more than once. keepPreviousData holds the current rows on
    // screen and swaps them in place when the new order lands.
    placeholderData: keepPreviousData,
  });
  // useMemo, not a bare ternary: `Array.isArray(x) ? x : []` mints a fresh
  // array on every render in the not-yet-loaded case, and this value is both
  // an effect dependency and a prop on 60 memoized children.
  const listings = useMemo(
    () => (Array.isArray(rawListings) ? rawListings : NO_LISTINGS),
    [rawListings]
  );

  // Sold-counts lookup — one bulk query for every visible listing's item_id.
  // Re-runs only when the set of visible item_ids changes.
  const visibleItemIds = useMemo(
    () => Array.from(new Set(listings.map(l => l.item_id).filter(Boolean))),
    [listings]
  );
  const { data: soldCountMap = NO_COUNTS } = useQuery({
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
  const { data: savedIds = NO_SAVED } = useQuery({
    queryKey: ['marketplaceWishlist', user?.id],
    queryFn:  async () => {
      const rows = await wishlist.listMine(user.id);
      return new Set(rows.map(r => r.listing_id));
    },
    enabled:   !!user?.id,
    staleTime: 60_000,
  });
  // Reads the current wishlist out of the cache rather than closing over
  // `savedIds`. Closing over it put savedIds in the deps array, so every
  // heart tap minted a new callback → new cardProps → a re-render of all 60
  // tiles to change one heart. Each card still gets its own `isSaved` prop,
  // so memo() lets exactly the tapped card re-render.
  const handleToggleSave = useCallback(async (listingId) => {
    if (!user?.id || !listingId) return;
    const currentlySaved = !!qc.getQueryData(['marketplaceWishlist', user.id])?.has(listingId);
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
  }, [user?.id, qc]);

  // Bundle deals (mig 134).
  const { data: activeBundles = NO_BUNDLES } = useQuery({
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
      await qc.invalidateQueries({ queryKey: ['flexCoins', user.id] });
    } catch (err) {
      // Every branch the RPC can raise gets its own line. The two that were
      // missing both landed on "try again", which is advice that cannot
      // work: retrying your own bundle fails identically forever, and so
      // does one whose listings have all sold.
      const raw = err.message || '';
      const msg =
          raw.includes('insufficient_coins')      ? 'Not enough coins for this bundle.'
        : raw.includes('bundle_not_available')    ? 'This bundle is no longer available.'
        : raw.includes('cannot_buy_own_bundle')   ? "That's your own bundle — you can't buy it."
        : raw.includes('bundle_empty')            ? 'Everything in this bundle has already sold.'
        : raw.includes('bundle_not_found')        ? 'This bundle is no longer available.'
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
    // Only diff against data the server actually returned. Before
    // keepPreviousData a sort change emptied `listings` for the duration of
    // the refetch, so this read "all 60 listings just disappeared" and swept
    // every id into the sold set — 60 state writes and a 5s timer, on a tap
    // that sold nothing. The guard keeps that true if the query ever has no
    // data again (first load, error).
    if (!Array.isArray(rawListings)) return;

    const previous     = previousListingsRef.current;
    const previousKey  = feedQueryKeyRef.current;
    previousListingsRef.current = listings;
    feedQueryKeyRef.current     = feedQueryKey;

    // A sort change is a DIFFERENT query over the same market, not a change
    // in the market. listActive caps at 60 rows, so above that cap the two
    // pages legitimately hold different listings and diffing across them
    // reports everything the new sort dropped as "just sold" — up to a full
    // grid of SOLD stamps on a tap that sold nothing. Resync and wait for
    // the next same-key render. (Invisible while the sold-fade was dead;
    // it is not any more.)
    if (previousKey !== null && previousKey !== feedQueryKey) return;

    const currIds = new Set(listings.map(l => l.id));
    const gone    = previous.filter(l => !currIds.has(l.id));
    if (gone.length === 0) return;

    setSoldFading(prev => {
      const next = new Map(prev);
      gone.forEach(l => next.set(l.id, l));
      return next;
    });
    const timer = setTimeout(() => {
      setSoldFading(prev => {
        const next = new Map(prev);
        gone.forEach(l => next.delete(l.id));
        return next;
      });
      setBoughtByMeIds(prev => {
        const next = new Set(prev);
        gone.forEach(l => next.delete(l.id));
        return next;
      });
    }, 5000);
    return () => clearTimeout(timer);
  }, [listings, rawListings, feedQueryKey]);

  const { data: rawMyItems } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn:  () => inventory.listItems(user.email),
    enabled:  !!user?.email,
    staleTime: 30_000,
  });
  const myItems = Array.isArray(rawMyItems) ? rawMyItems : [];
  const listableCount = myItems.filter(i => !i.is_listed && i.item_type === 'sticker').length;

  // ── Coin balance ───────────────────────────────────────────────────────────
  //
  // NOT `user.flex_coins`. That is a bootstrap snapshot: AuthContext reads the
  // profile once at sign-in and refreshes it only on an auth event or the
  // loot-equipped / theme-changed events, none of which this screen fires. So
  // every coin-dependent control here — the header balance, the "Can afford"
  // filter, each card's Buy button, each BundleCard's Buy bundle button — kept
  // the pre-transaction number after a purchase, a bundle buy or a daily-chest
  // claim, and Refresh could not fix it either. The visible failure was a Buy
  // button that looked affordable and came back `insufficient_coins`.
  //
  // The invalidations on ['userProfile', email] scattered through this file
  // never addressed it: nothing here reads that query, and per the profile
  // cache rules in CLAUDE.md refetching it hands back the same cached object
  // anyway. This is its own key so `handleRefresh` and every mutation below
  // can invalidate it explicitly.
  //
  // Falls back to the snapshot, never to 0 — 0 disables every Buy button on
  // the page, which is a worse wrong answer than a stale one.
  const { data: liveCoins } = useQuery({
    queryKey: ['flexCoins', user?.id],
    queryFn:  () => getFlexCoins(user.id),
    enabled:  !!user?.id,
    staleTime: 15_000,
  });
  const flexCoins = liveCoins ?? user?.flex_coins ?? 0;

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
        // The balance is a query now precisely so it can be in this list.
        // It's the number the "Can afford" filter and every Buy button are
        // gated on, so a refresh that skipped it left the most consequential
        // value on the page as the one thing the button couldn't reload.
        qc.invalidateQueries({ queryKey: ['flexCoins', user?.id] }),
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
      await qc.invalidateQueries({ queryKey: ['flexCoins', user.id] });
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

  // Everything the grid could show before ANY filter runs. Bundled listings
  // are always excluded because they're rendered as bundle cards above.
  const browsableListings = useMemo(
    () => listings.filter(l => !bundledListingIds.has(l.id)),
    [listings, bundledListingIds]
  );

  // Saved is a filter now, not a separate view.
  const viewListings = useMemo(
    () => (filters.saved ? browsableListings.filter(l => savedIds.has(l.id)) : browsableListings),
    [browsableListings, savedIds, filters.saved]
  );

  // …then narrow by the filter bar and float featured to the top.
  const visibleListings = useMemo(
    () => applyFilters(viewListings, filters, flexCoins),
    [viewListings, filters, flexCoins]
  );
  const filtersActive = activeFilterCount(filters) > 0;

  // How many of the listings ON THIS PAGE are saved — not how many rows the
  // wishlist holds. `savedIds.size` counts every listing the viewer has ever
  // hearted, including ones that have since sold, so the chip read
  // "Saved (12)" and tapping it showed three. The chip's number has to be
  // the number of cards the tap produces.
  const savedHereCount = useMemo(
    () => browsableListings.reduce((n, l) => n + (savedIds.has(l.id) ? 1 : 0), 0),
    [browsableListings, savedIds]
  );

  // Rarities actually on the market, so the bar can stop offering tiers that
  // can only ever return nothing.
  const availableRarities = useMemo(() => {
    const s = new Set();
    browsableListings.forEach(l => { if (l.item_rarity) s.add(l.item_rarity); });
    return s;
  }, [browsableListings]);

  // Bundles obeyed nothing but the Saved filter: "Can afford" with 40 coins
  // still left a 900-coin bundle sitting above the grid, and a rarity or
  // Buy/Trade filter left it there too. A control that narrows the grid but
  // not the row above it reads as broken, so the same filters apply — with
  // the two that need a bundle-shaped reading spelled out.
  const visibleBundles = useMemo(() => {
    if (filters.saved) return NO_BUNDLES;
    // A bundle is a coin purchase, so Trade excludes it outright.
    if (filters.type === 'trade') return NO_BUNDLES;
    return activeBundles.filter(b => {
      const rows = bundleMap.get(b.id);
      if (!rows) return false;
      const saleRows = rows.filter(l => l.listing_type === 'sale');
      if (saleRows.length === 0) return false;
      // Rarity matches if ANY item in the bundle qualifies — you're buying
      // the whole set, so one epic is reason enough to show it to someone
      // filtering for epics.
      if (filters.rarities.length > 0
        && !saleRows.some(l => filters.rarities.includes(l.item_rarity))) return false;
      if (filters.affordable && flexCoins < bundlePrice(b, rows).price) return false;
      return true;
    });
  }, [activeBundles, bundleMap, filters, flexCoins]);

  // Sold-fade rows, put through the SAME predicate as the live grid. They
  // used to render unfiltered, so a "Trade only" grid could show a sold Buy
  // tile, and a sold card could sit directly under "Nothing matches those
  // filters" — a card the filter says isn't there.
  const soldFadeListings = useMemo(() => {
    if (soldFading.size === 0) return NO_LISTINGS;
    const live = new Set(listings.map(l => l.id));
    const rows = [...soldFading.values()].filter(
      l => !live.has(l.id) && !bundledListingIds.has(l.id));
    return applyFilters(
      filters.saved ? rows.filter(l => savedIds.has(l.id)) : rows,
      filters, flexCoins,
    );
  }, [soldFading, listings, bundledListingIds, filters, savedIds, flexCoins]);

  // Shared props for every ListingCard so the render sites (main grid,
  // sold-fade) can't drift apart.
  //
  // Every handler is a useCallback and the object itself is a useMemo — that
  // is what makes memo() on ListingCard actually hold. These were inline
  // arrow functions in a fresh object literal, so the object's identity
  // changed on EVERY render of this component, and this component re-renders
  // for the refresh spinner, the detail sheet, a purchase, a wishlist tap and
  // five queries settling. Each of those re-rendered all 60 tiles, and when
  // one lands mid-filter it re-renders them while framer is animating them.
  const handleBuyClick = useCallback((l) => {
    if (user?.email) addRecentlyViewed(user.email, l);
    setBuyTarget(l);
  }, [user?.email]);
  const handleTradeClick = useCallback((l) => {
    if (user?.email) addRecentlyViewed(user.email, l);
    setTradeTarget(l);
  }, [user?.email]);
  const handleOpenDetail = useCallback((l) => {
    if (user?.email) addRecentlyViewed(user.email, l);
    setDetailTarget(l);
  }, [user?.email]);

  const cardProps = useMemo(() => ({
    currentUser: user,
    flexCoins,
    onCancel: handleCancel,
    onBuy: handleBuyClick,
    onOfferTrade: handleTradeClick,
    onSellerClick: handleSellerClick,
    onToggleSave: handleToggleSave,
    onOpenDetail: handleOpenDetail,
  }), [
    user, flexCoins, handleCancel, handleBuyClick, handleTradeClick,
    handleSellerClick, handleToggleSave, handleOpenDetail,
  ]);

  // A sold-fade tile is inert, so it overrides every handler with the SAME
  // noop rather than a fresh `() => {}` per render — an inline noop is a new
  // function identity each time and would re-render those tiles continuously
  // for the whole 5 seconds they are on screen.
  const soldCardProps = useMemo(() => ({
    ...cardProps,
    recentlySold: true,
    onBuy: NOOP,
    onCancel: NOOP,
    onOfferTrade: NOOP,
    onOpenDetail: undefined,
  }), [cardProps]);

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
        onClaimed={() => {
          // The chest pays coins, so the balance has to move — this used to
          // invalidate only ['userProfile'], which nothing on this screen
          // reads, so claiming left the header on the pre-claim number.
          qc.invalidateQueries({ queryKey: ['userProfile', user.email] });
          qc.invalidateQueries({ queryKey: ['flexCoins', user.id] });
          qc.invalidateQueries({ queryKey: ['userInventory', user.email] });
        }}
        onOpenShop={() => setShopOpen(true)}
      />

      <MarketFilterBar
        filters={filters}
        onChange={setFilters}
        resultCount={visibleListings.length}
        // The count before ANY narrowing, Saved included. It used to be
        // viewListings.length, which already had Saved applied — so with
        // Saved on, the row read "3 of 3 listings" and the denominator
        // stopped meaning anything.
        totalCount={browsableListings.length}
        savedCount={savedHereCount}
        availableRarities={availableRarities}
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
      ) : listings.length === 0 && soldFading.size === 0 ? (
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
          {visibleBundles.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 mb-2 px-1">
                <Package className="w-3.5 h-3.5 text-amber-500" />
                <h3 className="text-xs font-extrabold uppercase tracking-[0.18em] text-amber-500">
                  Bundle deals
                </h3>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 relative">
                <AnimatePresence {...LIST_PRESENCE}>
                  {visibleBundles.map(bundle => (
                    <BundleCard
                      key={bundle.id}
                      bundle={bundle}
                      listings={bundleMap.get(bundle.id) || []}
                      currentUser={user}
                      flexCoins={flexCoins}
                      onBuyBundle={handleBuyBundle}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* The row is a plain div. It used to be `<motion.div layout>`,
              which added a projection node whose only job was animating the
              row's own height — so while 40 cards flew toward their new
              slots, the container they were flying into was moving too.
              With exits out of flow the row can just snap to its new height.

              `isPlaceholderData` is the sort-change window: the rows on
              screen are the previous sort's, correct but about to reorder.
              A light dim says "this is being replaced" without the teardown
              a spinner caused. Safe as a CSS transition here — nothing on
              this element is framer-animated any more. */}
          <div
            className={`${LISTING_ROW} transition-opacity duration-150 ${
              isPlaceholderData ? 'opacity-60' : 'opacity-100'
            }`}
          >
            <AnimatePresence {...LIST_PRESENCE}>
              {visibleListings.map(listing => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  soldCount={soldCountMap.get(listing.item_id) || 0}
                  isSaved={savedIds.has(listing.id)}
                  {...cardProps}
                />
              ))}
              {/* Sold-fade cards — the just-removed listings, held on screen
                  with the SOLD overlay for ~5s before they collapse out. The
                  rows come from soldFading, which captured them at the moment
                  they vanished; see the note on that state for why reading
                  them back out of previousListingsRef never worked. */}
              {soldFadeListings.map(listing => (
                <ListingCard
                  key={`sold-${listing.id}`}
                  listing={listing}
                  soldCount={soldCountMap.get(listing.item_id) || 0}
                  isSaved={savedIds.has(listing.id)}
                  {...soldCardProps}
                  boughtByMe={boughtByMeIds.has(listing.id)}
                />
              ))}
            </AnimatePresence>
          </div>

          {/* Filtered everything out — distinct from "marketplace is quiet",
              and the fix is one tap rather than "come back later". */}
          {visibleListings.length === 0 && soldFadeListings.length === 0 && filtersActive && (
            <div className="flex flex-col items-center justify-center py-14 gap-3 text-center">
              <SearchX className="w-10 h-10 text-muted-foreground/50" />
              <p className="font-heading font-bold">Nothing matches those filters</p>
              <p className="text-muted-foreground text-sm max-w-xs">
                {/* browsableListings, not viewListings: the button below
                    clears Saved too, so this has to promise what clearing
                    actually reveals. */}
                {browsableListings.length} listing{browsableListings.length === 1 ? '' : 's'} available — try widening the search.
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
