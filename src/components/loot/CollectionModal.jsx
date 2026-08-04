// src/components/loot/CollectionModal.jsx
//
// One collection surface, replacing three overlapping ones:
//
//   ItemIndexModal   (Marketplace → "Item Index")   — ITEMS only, no ownership
//   LootCatalogModal (Capsule Opener → "Preview")   — 4 tabs, no ownership
//   the Bag's tabs                                  — ownership only, no catalog
//
// Each answered half a question. This answers the whole one: here is
// everything in the game, here is what you have, here is what's missing.
//
// ── On the redesign ──────────────────────────────────────────────────────────
// The first pass was correct and joyless. Four fifths of a collection grid
// is, by definition, things you DON'T have, so the locked treatment sets
// the mood for the whole screen — and a grid of flat grey rectangles reads
// as broken tiles rather than as a display case with empty slots. Three
// changes carry most of the difference:
//
//   1. Locked slots are dashed rarity-tinted outlines, not filled grey
//      boxes. A dashed frame reads as "something goes here" in a way a
//      solid one never does, and keeping the rarity colour means an empty
//      legendary slot still looks worth chasing.
//   2. Rarity earns real visual weight. Owned epic+ cards get a gradient
//      wash, a coloured glow and an occasional sheen; commons stay quiet.
//      Previously a legendary and a common differed only by border hue.
//   3. Every slot is tappable and opens a detail sheet. A grid you can
//      only look at is a poster; one you can interrogate — what is this,
//      what's it worth, how do I get it — is a collection.
//
// Plus the two things that make it usable at 113 items: a Missing filter
// (the chase list, which is the whole point and was previously unreachable)
// and a search box.

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { X, LibraryBig, Lock, Percent, Search, Sparkles, ChevronLeft } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import * as inventory from '@/lib/data/inventory';
import { CAPSULE_ODDS, VARIANTS } from '@/lib/lootCatalog';
import {
  COLLECTION_TABS, buildCollection, ownershipFrom, overallCompletion, rarityBreakdown,
} from '@/lib/collection';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { RarityBadge, rarityTint, CoinAmount } from './RarityVisuals';

// Tiers that get the premium treatment — gradient, glow, sheen. Kept
// deliberately short: if everything shimmers, nothing does.
const PREMIUM = new Set(['epic', 'legendary', 'mythic', 'animated']);

const FILTERS = [
  { id: 'all',     label: 'All' },
  { id: 'owned',   label: 'Owned' },
  { id: 'missing', label: 'Missing' },
];

// ─── Completion ring ──────────────────────────────────────────────────────────
/**
 * The header's centrepiece. A ring rather than another horizontal bar: the
 * bar at the top of the old header was the same shape as the seven bars
 * below it, so the one number that describes the whole collection had no
 * more presence than a single tier's progress.
 */
function CompletionRing({ pct, size = 60, stroke = 5 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="hsl(var(--border))" strokeWidth={stroke}
        />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke="hsl(var(--primary))" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (pct / 100) * c }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="font-heading font-black text-sm tabular-nums leading-none">{pct}%</span>
      </div>
    </div>
  );
}

// ─── Rarity spectrum ──────────────────────────────────────────────────────────
/**
 * One segment per tier, each filled to that tier's completion.
 *
 * A single overall percentage says "29%" and nothing else — but 29% made
 * of a finished common tier is a completely different collection from 29%
 * scattered across legendaries. This is the shape of your collection in
 * one strip, and it points straight at the next gap worth closing.
 */
function RaritySpectrum({ breakdown }) {
  return (
    <div className="flex items-end gap-[3px] h-7" role="img" aria-label="Completion by rarity">
      {breakdown.map(b => (
        <div
          key={b.rarity}
          className="flex-1 min-w-0 flex flex-col items-stretch gap-1"
          title={`${b.label} — ${b.owned}/${b.total}`}
        >
          <div className="h-4 rounded-[3px] overflow-hidden" style={{ background: `${b.color}22` }}>
            <motion.div
              className="w-full rounded-[3px] origin-bottom"
              style={{ backgroundColor: b.color, height: '100%' }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: b.pct / 100 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
            />
          </div>
          <span
            className="text-[8px] font-bold text-center tabular-nums leading-none opacity-70"
            style={{ color: b.color }}
          >
            {b.owned}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── One collection slot ──────────────────────────────────────────────────────
function Slot({ item, onSelect, index }) {
  const tint = rarityTint(item.rarity);
  const locked = !item.owned;
  const premium = PREMIUM.has(item.rarity) && !locked;

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(item)}
      // Cap the stagger: at 55 items an uncapped 0.015s/item delay makes
      // the last row land almost a second late, which reads as jank.
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index, 18) * 0.012 }}
      whileTap={{ scale: 0.94 }}
      aria-label={`${item.name} — ${locked ? 'not collected' : 'collected'}, ${tint.label}`}
      className={`group relative overflow-hidden rounded-xl p-2 flex flex-col items-center justify-center text-center gap-1.5 min-h-[92px] transition-shadow ${
        premium ? 'coll-sheen' : ''
      }`}
      style={{
        // Locked slots are DASHED. A dashed frame reads as "something goes
        // here"; the old solid grey fill read as a broken tile, and with
        // four fifths of the grid locked that set the mood for the screen.
        // The rarity colour stays either way — an empty legendary slot has
        // to look worth chasing.
        border: locked ? `1.5px dashed ${tint.color}66` : `1.5px solid ${tint.color}`,
        // Every owned slot gets a gradient, not just the premium ones. A
        // flat 8%-alpha slate wash is invisible on the light theme, so an
        // owned common was rendering as a plain white box — indistinguishable
        // from the card behind it, which threw away the one distinction the
        // grid exists to make.
        background: locked
          ? `${tint.color}08`
          : premium
            ? `linear-gradient(155deg, ${tint.color}3d, ${tint.color}0f 62%)`
            : `linear-gradient(155deg, ${tint.color}26, ${tint.color}0d 70%)`,
        boxShadow: premium ? `0 0 16px -4px ${tint.color}88` : undefined,
      }}
    >
      {item.preview ? (
        // Themes show their palette rather than an emoji.
        <div className="flex gap-0.5" style={locked ? { filter: 'grayscale(1)', opacity: 0.3 } : undefined}>
          {item.preview.slice(0, 3).map((hex, i) => (
            <span key={i} className="w-3.5 h-3.5 rounded-[3px]" style={{ backgroundColor: hex }} />
          ))}
        </div>
      ) : (
        <span
          className="text-[26px] leading-none transition-transform duration-200 group-hover:scale-110"
          style={locked ? { filter: 'grayscale(1)', opacity: 0.25 } : undefined}
          aria-hidden="true"
        >
          {item.emoji || '❓'}
        </span>
      )}

      <span
        className={`text-[10px] font-semibold leading-tight line-clamp-2 ${
          locked ? 'text-muted-foreground/70' : 'text-foreground'
        }`}
      >
        {item.name}
      </span>

      {locked && (
        <Lock className="absolute top-1.5 end-1.5 w-2.5 h-2.5 text-muted-foreground/50" aria-hidden="true" />
      )}

      {/* Variant pips — a foil copy is a genuinely different collectible
          (and worth 2-10x on sale), but the Bag only ever revealed variants
          on cards you already had. Here they're visible as something to
          chase. */}
      {item.ownedVariants?.length > 0 && (
        <div className="absolute top-1.5 start-1.5 flex gap-0.5">
          {item.ownedVariants.map(v => (
            <span
              key={v}
              className="w-1.5 h-1.5 rounded-full ring-1 ring-black/20"
              style={{ backgroundColor: VARIANTS[v]?.color ?? '#fff' }}
              title={VARIANTS[v]?.label ?? v}
            />
          ))}
        </div>
      )}
    </motion.button>
  );
}

// ─── Detail sheet ─────────────────────────────────────────────────────────────
/**
 * Tap-through for one slot.
 *
 * The grid alone can only say "you don't have this". It can't say what the
 * thing is, what it's worth, or how you'd get it — so the answer to "why
 * would I chase that?" was nowhere on the screen. This carries the odds
 * for the item's own tier, which is the number that actually decides
 * whether chasing it is realistic.
 */
function DetailSheet({ item, onBack }) {
  const tint = rarityTint(item.rarity);
  const locked = !item.owned;

  // Odds of THIS tier, per capsule type — only the capsules that can
  // actually produce it.
  const odds = Object.entries(CAPSULE_ODDS)
    .map(([type, table]) => ({ type, p: table?.[item.rarity] ?? 0 }))
    .filter(o => o.p > 0);

  return (
    <motion.div
      key="detail"
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex-1 overflow-y-auto"
    >
      <div
        className="px-4 pt-5 pb-6 flex flex-col items-center text-center gap-2"
        style={{ background: `linear-gradient(180deg, ${tint.color}22, transparent)` }}
      >
        <div
          className="w-20 h-20 rounded-2xl flex items-center justify-center"
          style={{
            border: locked ? `2px dashed ${tint.color}66` : `2px solid ${tint.color}`,
            background: locked ? `${tint.color}0a` : `${tint.color}1f`,
            boxShadow: locked ? undefined : `0 0 28px -6px ${tint.color}aa`,
          }}
        >
          {item.preview ? (
            <div className="flex gap-1" style={locked ? { filter: 'grayscale(1)', opacity: 0.3 } : undefined}>
              {item.preview.slice(0, 3).map((hex, i) => (
                <span key={i} className="w-4 h-8 rounded" style={{ backgroundColor: hex }} />
              ))}
            </div>
          ) : (
            <span
              className="text-5xl leading-none"
              style={locked ? { filter: 'grayscale(1)', opacity: 0.28 } : undefined}
              aria-hidden="true"
            >
              {item.emoji || '❓'}
            </span>
          )}
        </div>

        <h3 className="font-heading font-bold text-lg leading-tight mt-1">{item.name}</h3>
        <RarityBadge rarity={item.rarity} />
        {item.description && (
          <p className="text-xs text-muted-foreground max-w-[34ch] leading-relaxed mt-0.5">
            {item.description}
          </p>
        )}
      </div>

      <div className="px-4 pb-4 space-y-3">
        {/* Ownership */}
        <div
          className="rounded-xl px-3 py-2.5 flex items-center gap-2.5"
          style={{
            border: `1px solid ${locked ? 'hsl(var(--border))' : `${tint.color}66`}`,
            background: locked ? 'hsl(var(--secondary) / 0.4)' : `${tint.color}12`,
          }}
        >
          {locked
            ? <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
            : <Sparkles className="w-4 h-4 shrink-0" style={{ color: tint.color }} />}
          <div className="min-w-0 flex-1 text-start">
            <p className="text-xs font-bold leading-tight">
              {locked ? 'Not collected yet' : 'In your collection'}
            </p>
            {!locked && item.ownedVariants?.length > 0 && (
              <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                {item.ownedVariants.map(v => VARIANTS[v]?.label ?? v).join(' · ')} variant
                {item.ownedVariants.length > 1 ? 's' : ''} owned
              </p>
            )}
          </div>
          {item.baseCoins > 0 && (
            <CoinAmount value={item.baseCoins} className="text-xs font-bold shrink-0" />
          )}
        </div>

        {/* How to get it — the missing "why would I chase this?" answer. */}
        {odds.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-1.5 text-start">
              Drop chance
            </p>
            <div className="space-y-1.5">
              {odds.map(o => (
                <div key={o.type} className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold capitalize w-20 shrink-0 text-start">
                    {o.type}
                  </span>
                  <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: tint.color }}
                      initial={{ width: 0 }}
                      // Square-root scale: a 0.5% and a 2% bar are both
                      // invisible on a linear scale against a 60% common,
                      // so the rare tiers would all render as empty tracks.
                      animate={{ width: `${Math.max(Math.sqrt(o.p) * 100, 2)}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                  <span className="text-[11px] tabular-nums text-muted-foreground w-12 text-end shrink-0">
                    {(o.p * 100).toFixed(o.p < 0.01 ? 2 : 1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onBack}
          className="w-full rounded-xl border border-border py-2 text-xs font-bold hover:bg-secondary transition-colors"
        >
          Back to collection
        </button>
      </div>
    </motion.div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export default function CollectionModal({ open, onClose, initialTab = 'stickers' }) {
  const { user } = useAuth();
  const [tab, setTab] = useState(initialTab);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [showOdds, setShowOdds] = useState(false);
  const [selected, setSelected] = useState(null);
  useBodyScrollLock(open);

  // Reset the detail view whenever the modal reopens, so it never opens
  // onto whatever slot was last inspected in a previous session.
  useEffect(() => {
    if (open) { setSelected(null); setQuery(''); }
  }, [open]);

  const { data: inventoryRows = [], isLoading } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn:  () => inventory.listItems(user.email),
    enabled:  !!user?.email && open,
    staleTime: 30_000,
  });

  const ownership = useMemo(() => ownershipFrom(inventoryRows), [inventoryRows]);
  const overall   = useMemo(() => overallCompletion(ownership), [ownership]);
  const breakdown = useMemo(() => rarityBreakdown(ownership), [ownership]);

  // Tab counts are computed once for the whole toolbar rather than inside
  // the map — the old code rebuilt the entire catalog for all four tabs on
  // every render of the tab strip.
  const tabCounts = useMemo(
    () => Object.fromEntries(COLLECTION_TABS.map(t => [t.id, buildCollection(t.id, ownership)])),
    [ownership]
  );

  const collection = useMemo(() => {
    const base = buildCollection(tab, ownership, { ownedOnly: filter === 'owned' });
    const q = query.trim().toLowerCase();
    if (filter !== 'missing' && !q) return base;
    return {
      ...base,
      groups: base.groups
        .map(g => ({
          ...g,
          items: g.items.filter(i =>
            (filter !== 'missing' || !i.owned) &&
            (!q || i.name.toLowerCase().includes(q))),
        }))
        .filter(g => g.items.length > 0),
    };
  }, [tab, ownership, filter, query]);

  const visibleCount = collection.groups.reduce((n, g) => n + g.items.length, 0);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Collection"
          className="relative w-full md:max-w-2xl bg-card border border-border rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="relative px-4 py-3 border-b border-border overflow-hidden shrink-0">
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: 'radial-gradient(ellipse 70% 100% at 0% 0%, hsl(var(--primary) / 0.10), transparent)' }}
              aria-hidden="true"
            />
            <div className="relative flex items-center gap-3">
              {selected ? (
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Back to collection"
                  className="w-9 h-9 rounded-lg border border-border flex items-center justify-center hover:bg-secondary transition-colors shrink-0 rtl:scale-x-[-1]"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              ) : (
                <CompletionRing pct={overall.pct} />
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <LibraryBig className="w-3.5 h-3.5 text-primary shrink-0" />
                  <h2 className="font-heading font-bold text-base leading-tight">Collection</h2>
                </div>
                <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                  <span className="font-bold text-foreground tabular-nums">{overall.owned}</span>
                  {' '}of {overall.total} collected
                  {overall.total > overall.owned && (
                    <> · <span className="tabular-nums">{overall.total - overall.owned}</span> to go</>
                  )}
                </p>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-2 rounded-md hover:bg-secondary transition-colors shrink-0 self-start"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!selected && breakdown.length > 0 && (
              <div className="relative mt-2.5">
                <RaritySpectrum breakdown={breakdown} />
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {selected ? (
              <DetailSheet key="detail" item={selected} onBack={() => setSelected(null)} />
            ) : (
              <motion.div
                key="grid"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex-1 flex flex-col min-h-0"
              >
                {/* Tabs */}
                <div
                  className="flex items-center gap-1.5 px-4 pt-2.5 pb-2 overflow-x-auto scrollbar-hide shrink-0"
                  style={{
                    scrollbarWidth: 'none',
                    maskImage: 'linear-gradient(to right, #000 92%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to right, #000 92%, transparent 100%)',
                  }}
                >
                  {COLLECTION_TABS.map(t => {
                    const c = tabCounts[t.id];
                    const active = tab === t.id;
                    const done = c.owned === c.total;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        aria-pressed={active}
                        className={`shrink-0 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all ${
                          active
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'bg-secondary/60 text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t.label}
                        <span className={`ms-1.5 tabular-nums ${active ? 'opacity-80' : 'opacity-60'}`}>
                          {c.owned}/{c.total}
                        </span>
                        {done && <span className="ms-1" aria-label="complete">✓</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Filter + search */}
                <div className="flex items-center gap-2 px-4 pb-2.5 shrink-0">
                  <div className="flex rounded-lg bg-secondary/60 p-0.5 shrink-0">
                    {FILTERS.map(f => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFilter(f.id)}
                        aria-pressed={filter === f.id}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${
                          filter === f.id
                            ? 'bg-card text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute start-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search…"
                      aria-label="Search the collection"
                      className="w-full h-8 rounded-lg bg-secondary/60 ps-7 pe-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground/70"
                    />
                  </div>
                </div>

                {/* Grid */}
                <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-5">
                  {isLoading ? (
                    <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                      {Array.from({ length: 15 }).map((_, i) => (
                        <div key={i} className="h-[92px] rounded-xl bg-secondary/40 animate-pulse" />
                      ))}
                    </div>
                  ) : visibleCount === 0 ? (
                    // A search that filters everything out is NOT the same
                    // fact as a complete tier. Showing "this category is
                    // complete" to someone on 27/55 who happened to search a
                    // word with no hits is a flatly false claim about their
                    // collection, so the query case is answered first.
                    <div className="text-center py-12">
                      <p className="text-3xl mb-2" aria-hidden="true">
                        {query.trim() ? '🔍' : filter === 'missing' ? '🏆' : '📭'}
                      </p>
                      <p className="font-heading font-bold text-sm">
                        {query.trim()
                          ? 'No matches'
                          : filter === 'missing'
                            ? 'Nothing missing here'
                            : 'Nothing collected here yet'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {query.trim()
                          ? <>Nothing in {filter === 'all' ? 'this category' : `your ${filter} items`} matches “{query.trim()}”.</>
                          : filter === 'missing'
                            ? 'This category is complete — every slot filled.'
                            : 'Open a capsule to start filling this one in.'}
                      </p>
                      {query.trim() && (
                        <button
                          type="button"
                          onClick={() => setQuery('')}
                          className="mt-3 text-xs font-bold text-primary hover:underline"
                        >
                          Clear search
                        </button>
                      )}
                    </div>
                  ) : (
                    collection.groups.map(group => (
                      <section key={group.rarity}>
                        {/* Rarity header — the coloured rule carries the tier
                            across the full width instead of leaving the label
                            floating next to a stub of a progress bar. */}
                        <div className="flex items-center gap-2 mb-2">
                          <span
                            className="text-[10px] font-black uppercase tracking-[0.18em] shrink-0"
                            style={{ color: group.color }}
                          >
                            {group.label}
                          </span>
                          <div
                            className="flex-1 h-px"
                            style={{ background: `linear-gradient(90deg, ${group.color}66, transparent)` }}
                          />
                          <span
                            className="text-[10px] font-bold tabular-nums shrink-0 px-1.5 py-0.5 rounded-full"
                            style={{ color: group.color, background: `${group.color}18` }}
                          >
                            {group.owned}/{group.total}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                          {group.items.map((item, i) => (
                            <Slot key={item.id} item={item} index={i} onSelect={setSelected} />
                          ))}
                        </div>
                      </section>
                    ))
                  )}

                  {/* Capsule odds — carried over from the old Item Index so that
                      surface can be retired without losing the disclosure. */}
                  <section className="pt-3 border-t border-border">
                    <button
                      type="button"
                      onClick={() => setShowOdds(o => !o)}
                      aria-expanded={showOdds}
                      className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <Percent className="w-3 h-3" /> Capsule odds
                    </button>
                    {showOdds && (
                      <div className="space-y-2 text-[11px] mt-2">
                        {Object.entries(CAPSULE_ODDS).map(([type, odds]) => (
                          <div key={type} className="bg-secondary/40 rounded-lg px-3 py-2">
                            <p className="font-bold capitalize">{type} capsule</p>
                            <p className="text-muted-foreground tabular-nums">
                              {Object.entries(odds)
                                .filter(([, prob]) => prob > 0)
                                .map(([rarity, prob]) =>
                                  `${rarity} ${(prob * 100).toFixed(prob < 0.01 ? 2 : 1)}%`)
                                .join(' · ')}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                {/* Legend */}
                <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-[10px] text-muted-foreground shrink-0">
                  <span className="flex items-center gap-1">
                    <span
                      className="w-3 h-3 rounded-[3px] shrink-0"
                      style={{ border: '1.5px dashed hsl(var(--muted-foreground) / 0.5)' }}
                      aria-hidden="true"
                    />
                    not collected
                  </span>
                  <span className="flex items-center gap-1">
                    <RarityBadge rarity="legendary" size="sm" /> rarity tier
                  </span>
                  <span className="ms-auto tabular-nums">Tap any slot for details</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
