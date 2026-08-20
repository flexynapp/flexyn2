// src/components/market/MarketFilterBar.jsx
//
// Sticky filter rail for the listings grid.
//
// Before this the Marketplace had SORT but no FILTER — you could order 60
// listings by price, but you couldn't ask for "epic stickers I can
// actually afford". Sort also lived in the banner as two separate toggle
// buttons; it belongs with the other controls that narrow the grid.
//
// All filtering is client-side over the already-fetched page of listings.
// That's deliberate at this scale (listActive caps at 60) and keeps every
// interaction instant. If the cap ever rises materially, push the
// predicates into the query instead.

import { useMemo } from 'react';
import { SlidersHorizontal, X, Heart } from 'lucide-react';
import { RARITY } from '@/lib/lootCatalog';
import { rarityTint, COIN } from '@/components/loot/RarityVisuals';
import { useLanguage } from '@/lib/LanguageContext';

export const DEFAULT_FILTERS = {
  type: 'all',        // 'all' | 'sale' | 'trade'
  rarities: [],       // [] = every rarity
  affordable: false,  // only listings the viewer can pay for
  saved: false,       // only listings the viewer hearted
  sort: 'recent',     // 'recent' | 'price-asc' | 'price-desc'
};

const TYPES = [
  { id: 'all',   label: 'All' },
  { id: 'sale',  label: 'Buy' },
  { id: 'trade', label: 'Trade' },
];

const SORTS = [
  { id: 'recent',     label: '🕐 Newest' },
  { id: 'price-asc',  label: '🏷️ Price ↑' },
  { id: 'price-desc', label: '🏷️ Price ↓' },
];

/** Count of filters that actually narrow the grid (sort doesn't). */
export function activeFilterCount(f) {
  return (f.type !== 'all' ? 1 : 0)
    + (f.rarities.length > 0 ? 1 : 0)
    + (f.affordable ? 1 : 0)
    + (f.saved ? 1 : 0);
}

/**
 * Apply the filter set to a listings array. Exported so the feed and its
 * tests share one definition of what "matching" means.
 */
export function applyFilters(listings, filters, flexCoins) {
  const { type, rarities, affordable, sort } = filters;
  let out = listings;

  if (type !== 'all')      out = out.filter(l => l.listing_type === type);
  if (rarities.length > 0) out = out.filter(l => rarities.includes(l.item_rarity));
  // "Can afford" only means anything for sale listings — a trade listing
  // costs no coins, so excluding them here would be wrong.
  if (affordable) {
    out = out.filter(l =>
      l.listing_type !== 'sale' || (l.asking_price ?? 0) <= flexCoins);
  }

  if (sort === 'recent') {
    // Featured listings float to the top of whatever the user asked for.
    // They used to render in a SEPARATE rail above the grid *and* again in
    // the grid itself — every featured listing appeared twice. The card
    // already carries its own "Featured" ribbon, so ordering is enough.
    return [...out].sort(byFeaturedThen(() => 0));
  }
  const dir = sort === 'price-asc' ? 1 : -1;
  return [...out].sort(byFeaturedThen((a, b) =>
    ((a.asking_price ?? 0) - (b.asking_price ?? 0)) * dir));
}

function isFeatured(l) {
  return !!l.is_featured && l.featured_until && new Date(l.featured_until) > new Date();
}

function byFeaturedThen(tiebreak) {
  return (a, b) => {
    const fa = isFeatured(a) ? 1 : 0;
    const fb = isFeatured(b) ? 1 : 0;
    if (fa !== fb) return fb - fa;
    return tiebreak(a, b);
  };
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MarketFilterBar({
  filters, onChange, resultCount, totalCount, savedCount = 0, availableRarities,
}) {
  const { tFallback } = useLanguage();
  const activeCount = activeFilterCount(filters);

  // Rarities that are actually ON THE MARKET, in catalog ladder order.
  //
  // This used to render all seven tiers unconditionally, so most of them
  // were guaranteed dead taps — a market holding common/rare/epic still
  // offered Mythic and Animated, and every one of those taps landed on
  // "Nothing matches those filters". A filter that can only fail isn't a
  // filter. A tier the viewer has already SELECTED always survives the cut,
  // or turning it back off would mean clearing every filter.
  //
  // An empty/absent set means "caller doesn't know yet" (first load, above
  // the loading spinner) — show the full ladder rather than an empty row.
  const rarityKeys = useMemo(() => {
    const all = Object.keys(RARITY);
    if (!availableRarities || availableRarities.size === 0) return all;
    return all.filter(r => availableRarities.has(r) || filters.rarities.includes(r));
  }, [availableRarities, filters.rarities]);

  const set = (patch) => onChange({ ...filters, ...patch });

  const toggleRarity = (r) => {
    const next = filters.rarities.includes(r)
      ? filters.rarities.filter(x => x !== r)
      : [...filters.rarities, r];
    set({ rarities: next });
  };

  return (
    // `top-14`, not `top-0`. Header.jsx is `lg:hidden fixed top-0 z-40` at
    // h-14 (56px) and /market is one of its CHILD_ROUTES, so on every phone
    // it paints over this bar's z-30. Layout's <main> has no overflow, so
    // the window is the scrollport and `top-0` pins here at viewport y=0 —
    // i.e. underneath 56px of opaque header. This bar is ~68px tall, so
    // scrolling the grid swallowed the whole Buy/Trade/Can-afford/Saved/Sort
    // row and left a sliver of the rarity chips. A sticky control that
    // disappears the moment you scroll is worse than a non-sticky one.
    // The header is hidden from lg up, hence the reset.
    //
    // The offset carries the safe-area inset too, for the same reason it is
    // 56 and not 0: the header's real height is 56 + env(safe-area-inset-top),
    // so a bare `top-14` re-created the original bug 59px higher up on every
    // notched phone — the bar stuck underneath the header instead of below it.
    <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] lg:top-0 z-30 -mx-4 px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-border">
      {/* Row 1 — chips scroll, sort does NOT.
          The sort <select> used to sit inside this scroll container with
          `ms-auto`, which aligns to the SCROLL width rather than the visible
          width: on a 375px viewport it rendered at x=361 in a 343px row,
          i.e. 102px off-screen and unreachable without discovering a
          sideways swipe. Sort is a primary control on a mobile-only app, so
          it lives outside the scroller and is always visible. */}
      <div className="flex items-center gap-1.5">
        <div
          className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide flex-1 min-w-0"
          style={{
            scrollbarWidth: 'none',
            // Fade the scroll edge. Without it the last visible chip is
            // sliced mid-word against the sort control ("Can affo…"), which
            // reads as broken rather than as "there's more this way".
            maskImage: 'linear-gradient(to right, #000 92%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to right, #000 92%, transparent 100%)',
          }}
        >
        <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden="true" />

        <div className="flex gap-1 shrink-0" role="group" aria-label={tFallback("marketFilterBar.listingType", "Listing type")}>
          {TYPES.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => set({ type: t.id })}
              aria-pressed={filters.type === t.id}
              className={`px-2.5 py-1 rounded-full text-micro font-bold transition-colors ${
                filters.type === t.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground active:text-foreground'
              }`}
            >
              {tFallback(`marketFilter.type.${t.id}`, t.label)}
            </button>
          ))}
        </div>

        <span className="w-px h-4 bg-border shrink-0" aria-hidden="true" />

        <button
          type="button"
          onClick={() => set({ affordable: !filters.affordable })}
          aria-pressed={filters.affordable}
          className={`shrink-0 px-2.5 py-1 rounded-full text-micro font-bold transition-colors ${
            filters.affordable
              ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-400/40'
              : 'bg-secondary text-muted-foreground hover:text-foreground active:text-foreground border border-transparent'
          }`}
        >
          {COIN} Can afford
        </button>

        {/* Saved was a top-level Browse/Saved tab strip sitting ABOVE the
            Marketplace banner — a whole row of chrome for what is just
            another way of narrowing the same grid, on a page already
            criticised for putting too much between the user and the
            listings. It's a filter, so it lives with the filters. */}
        <button
          type="button"
          onClick={() => set({ saved: !filters.saved })}
          aria-pressed={filters.saved}
          className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-micro font-bold transition-colors border ${
            filters.saved
              ? 'bg-red-500/15 text-red-500 border-red-400/40'
              : 'bg-secondary text-muted-foreground hover:text-foreground active:text-foreground border-transparent'
          }`}
        >
          <Heart className={`w-3 h-3 ${filters.saved ? 'fill-current' : ''}`} />
          Saved{savedCount > 0 ? ` (${savedCount})` : ''}
        </button>

        </div>

        <select
          value={filters.sort}
          onChange={(e) => set({ sort: e.target.value })}
          aria-label={tFallback("marketFilterBar.sortListings", "Sort listings")}
          className="shrink-0 bg-secondary border border-border rounded-full px-2 py-1 text-micro font-bold outline-none max-w-[104px]"
        >
          {SORTS.map(s => (
            // The sort ids carry a hyphen ('price-asc') and a hyphen in a key
            // path is invisible to every scan here — they all match [\w.]+.
            // Slugified to underscores, which is the house rule.
            <option key={s.id} value={s.id}>
              {tFallback(`marketFilter.sort.${s.id.replace(/-/g, '_')}`, s.label)}
            </option>
          ))}
        </select>
      </div>

      {/* Row 2 — rarity chips. Seven tiers don't fit 375px, so the rail
          scrolls; the mask fades the last chip out instead of slicing it
          mid-word, which reads as a broken layout rather than a hint.
          Hidden below two chips: a rail offering the only rarity on the
          market narrows nothing, it just costs a row. */}
      {rarityKeys.length > 1 && (
      <div
        className="flex items-center gap-1.5 mt-1.5 overflow-x-auto scrollbar-hide"
        style={{
          scrollbarWidth: 'none',
          maskImage: 'linear-gradient(to right, #000 88%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, #000 88%, transparent 100%)',
        }}
      >
        {rarityKeys.map(r => {
          const tint = rarityTint(r);
          const on = filters.rarities.includes(r);
          return (
            <button
              key={r}
              type="button"
              onClick={() => toggleRarity(r)}
              aria-pressed={on}
              className="shrink-0 px-2 py-0.5 rounded-full text-micro font-bold border transition-colors"
              style={{
                color: on ? tint.color : undefined,
                borderColor: on ? tint.color : 'hsl(var(--border))',
                background: on ? tint.surface : 'transparent',
              }}
            >
              {tFallback(`loot.rarity.${r}`, tint.label)}
            </button>
          );
        })}
      </div>
      )}

      {/* Row 3 — result count + clear, only once something is filtering */}
      {activeCount > 0 && (
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-micro text-muted-foreground">
            {resultCount} of {totalCount} listing{totalCount === 1 ? '' : 's'}
          </p>
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })}
            className="flex items-center gap-1 text-micro font-bold text-primary hover:underline"
          >
            <X className="w-3 h-3" /> {tFallback("trends.clearFilters", "Clear filters")}
          </button>
        </div>
      )}
    </div>
  );
}
