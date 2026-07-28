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
export default function MarketFilterBar({ filters, onChange, resultCount, totalCount, savedCount = 0 }) {
  const activeCount = activeFilterCount(filters);

  // Only offer rarities that exist in the catalog, in ladder order.
  const rarityKeys = useMemo(() => Object.keys(RARITY), []);

  const set = (patch) => onChange({ ...filters, ...patch });

  const toggleRarity = (r) => {
    const next = filters.rarities.includes(r)
      ? filters.rarities.filter(x => x !== r)
      : [...filters.rarities, r];
    set({ rarities: next });
  };

  return (
    <div className="sticky top-0 z-30 -mx-4 px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-border">
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

        <div className="flex gap-1 shrink-0" role="group" aria-label="Listing type">
          {TYPES.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => set({ type: t.id })}
              aria-pressed={filters.type === t.id}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                filters.type === t.id
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <span className="w-px h-4 bg-border shrink-0" aria-hidden="true" />

        <button
          type="button"
          onClick={() => set({ affordable: !filters.affordable })}
          aria-pressed={filters.affordable}
          className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
            filters.affordable
              ? 'bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-400/40'
              : 'bg-secondary text-muted-foreground hover:text-foreground border border-transparent'
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
          className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors border ${
            filters.saved
              ? 'bg-red-500/15 text-red-500 border-red-400/40'
              : 'bg-secondary text-muted-foreground hover:text-foreground border-transparent'
          }`}
        >
          <Heart className={`w-3 h-3 ${filters.saved ? 'fill-current' : ''}`} />
          Saved{savedCount > 0 ? ` (${savedCount})` : ''}
        </button>

        </div>

        <select
          value={filters.sort}
          onChange={(e) => set({ sort: e.target.value })}
          aria-label="Sort listings"
          className="shrink-0 bg-secondary border border-border rounded-full px-2 py-1 text-[11px] font-bold outline-none max-w-[104px]"
        >
          {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {/* Row 2 — rarity chips. Seven tiers don't fit 375px, so the rail
          scrolls; the mask fades the last chip out instead of slicing it
          mid-word, which reads as a broken layout rather than a hint. */}
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
              className="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors"
              style={{
                color: on ? tint.color : undefined,
                borderColor: on ? tint.color : 'hsl(var(--border))',
                background: on ? tint.surface : 'transparent',
              }}
            >
              {tint.label}
            </button>
          );
        })}
      </div>

      {/* Row 3 — result count + clear, only once something is filtering */}
      {activeCount > 0 && (
        <div className="flex items-center justify-between mt-1.5">
          <p className="text-[11px] text-muted-foreground">
            {resultCount} of {totalCount} listing{totalCount === 1 ? '' : 's'}
          </p>
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })}
            className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
          >
            <X className="w-3 h-3" /> Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
