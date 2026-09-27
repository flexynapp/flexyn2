// src/components/market/MarketFilterBar.jsx
//
// The filter row above the listings.
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

import { useMemo, useState } from 'react';
import { SlidersHorizontal, X, Heart } from 'lucide-react';
import { RARITY } from '@/lib/lootCatalog';
import { rarityTint } from '@/components/loot/RarityVisuals';
import { rarityName } from '@/components/capsules/words';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import { useLanguage } from '@/lib/LanguageContext';

export const DEFAULT_FILTERS = {
  type: 'all',        // 'all' | 'sale' | 'trade'
  rarities: [],       // [] = every rarity
  affordable: false,  // only listings the viewer can pay for
  saved: false,       // only listings the viewer hearted
  sort: 'recent',     // 'recent' | 'price-asc' | 'price-desc'
};

const TYPES = [{ id: 'all' }, { id: 'sale' }, { id: 'trade' }];

const SORTS = ['recent', 'price-asc', 'price-desc'];

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
// The round 2 layout: an All / Buy / Trade segmented control with counts and
// a Filter toggle on one row, the listing count and the sort under it, and
// the rest (can afford, saved, rarity) in a panel the Filter button opens.
export default function MarketFilterBar({
  filters, onChange, resultCount, totalCount, savedCount = 0, availableRarities,
  typeCounts,
}) {
  const { tFallback } = useLanguage();
  const [panelOpen, setPanelOpen] = useState(false);
  // Type is on the segmented control, so the badge counts what is hidden in
  // the panel.
  const panelCount = activeFilterCount(filters) - (filters.type !== 'all' ? 1 : 0);

  // Rarities that are actually ON THE MARKET, in catalog ladder order. A
  // tier the viewer has already SELECTED always survives the cut, or turning
  // it back off would mean clearing every filter. An empty set means "not
  // known yet": show the full ladder rather than an empty row.
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

  const typeLabel = (id) => (
    id === 'sale' ? tFallback('marketFilter.type.sale', 'Buy')
      : id === 'trade' ? tFallback('marketFilter.type.trade', 'Trade')
        : tFallback('marketFilter.type.all', 'All')
  );
  const sortLabel = (id) => (
    id === 'price-asc' ? tFallback('marketFilter.sortLowest', 'Lowest price')
      : id === 'price-desc' ? tFallback('marketFilter.sortHighest', 'Highest price')
        : tFallback('marketFilter.sortNewest', 'Newest first')
  );
  const count = activeFilterCount(filters) > 0 ? resultCount : totalCount;

  return (
    // Sticky below the phone header: `top` carries the header's 56px AND the
    // safe-area inset, or it pins underneath the header on a notched phone.
    <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] lg:top-0 z-30 -mx-4 px-4 pt-3 pb-2 bg-background flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div
          role="group"
          aria-label={tFallback('marketFilterBar.listingType', 'Listing type')}
          className="flex-1 h-11 p-[3px] rounded-full bg-card border flex"
        >
          {TYPES.map(t => {
            const on = filters.type === t.id;
            const n = typeCounts?.[t.id];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => set({ type: t.id })}
                aria-pressed={on}
                className={`flex-1 rounded-full text-label font-semibold inline-flex items-center justify-center gap-1 ${
                  on ? 'bg-foreground text-background' : 'text-foreground'
                }`}
              >
                {typeLabel(t.id)}
                {n != null && (
                  <span className={`font-medium tabular-nums ${on ? 'opacity-70' : 'text-muted-foreground'}`}>{n}</span>
                )}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setPanelOpen(o => !o)}
          aria-expanded={panelOpen}
          aria-controls="market-filter-panel"
          className={`h-11 px-3 rounded-full border inline-flex items-center gap-1 text-label font-semibold ${
            panelOpen ? 'bg-secondary' : ''
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
          {tFallback('marketFilter.filter', 'Filter')}
          {panelCount > 0 && (
            <span className="min-w-4 h-4 px-1 rounded-full bg-foreground text-background text-micro font-bold leading-4 text-center tabular-nums">
              {panelCount}
            </span>
          )}
        </button>
      </div>

      {panelOpen && (
        <div id="market-filter-panel" className="flex flex-col gap-2 pt-1">
          <div className="flex flex-wrap gap-1.5">
            <PanelChip on={filters.affordable} onClick={() => set({ affordable: !filters.affordable })}>
              <FlexCoinIcon size={14} />
              {tFallback('marketFilter.canAfford', 'Can afford')}
            </PanelChip>
            {/* Saved is a filter, not a separate view: it narrows the same
                grid, so it lives with the filters. */}
            <PanelChip on={filters.saved} onClick={() => set({ saved: !filters.saved })}>
              <Heart className={`w-3.5 h-3.5 ${filters.saved ? 'fill-current' : ''}`} aria-hidden="true" />
              {tFallback('marketFilter.saved', 'Saved')}
              {savedCount > 0 && <span className="font-medium tabular-nums opacity-70">{savedCount}</span>}
            </PanelChip>
          </div>
          {/* Hidden below two tiers: offering the only rarity on the market
              narrows nothing. */}
          {rarityKeys.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={tFallback('stickerSet.filter', 'Filter by rarity')}>
              {rarityKeys.map(r => (
                <PanelChip key={r} on={filters.rarities.includes(r)} onClick={() => toggleRarity(r)}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: rarityTint(r).color }} aria-hidden="true" />
                  {rarityName(tFallback, r)}
                </PanelChip>
              ))}
            </div>
          )}
          {panelCount > 0 && (
            <button
              type="button"
              onClick={() => onChange({ ...DEFAULT_FILTERS, type: filters.type, sort: filters.sort })}
              className="self-start h-11 inline-flex items-center gap-1 text-label font-semibold"
            >
              <X className="w-4 h-4" aria-hidden="true" /> {tFallback('trends.clearFilters', 'Clear filters')}
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-caption text-muted-foreground">
        <span className="tabular-nums">
          {count === 1
            ? tFallback('marketFilter.oneListing', '1 listing')
            : tFallback('marketFilter.listings', '{n} listings', { n: count })}
        </span>
        {/* The sort reads as text, as in the design, but stays a native
            select: it is the most reliable picker on a phone. */}
        <select
          value={filters.sort}
          onChange={(e) => set({ sort: e.target.value })}
          aria-label={tFallback('marketFilterBar.sortListings', 'Sort listings')}
          className="h-8 bg-transparent text-caption text-muted-foreground text-end outline-none appearance-none cursor-pointer"
        >
          {SORTS.map(id => <option key={id} value={id}>{sortLabel(id)}</option>)}
        </select>
      </div>
    </div>
  );
}

function PanelChip({ on, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`h-11 px-3 rounded-full border inline-flex items-center gap-1.5 text-label font-semibold ${
        on ? 'bg-foreground text-background border-foreground' : 'text-foreground'
      }`}
    >
      {children}
    </button>
  );
}
