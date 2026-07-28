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
// Unowned entries render as locked silhouettes that keep their rarity
// ring — the empty slot is the point, not a rendering accident.

import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { X, LibraryBig, Lock, Percent } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import * as inventory from '@/lib/data/inventory';
import { CAPSULE_ODDS } from '@/lib/lootCatalog';
import { VARIANTS } from '@/lib/lootCatalog';
import {
  COLLECTION_TABS, buildCollection, ownershipFrom, overallCompletion,
} from '@/lib/collection';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { RarityBadge, RarityDot, rarityTint } from './RarityVisuals';

// ─── Completion meter ─────────────────────────────────────────────────────────
function CompletionBar({ owned, total, pct, color }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color ?? 'hsl(var(--primary))' }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <span className="text-[10px] font-bold tabular-nums text-muted-foreground shrink-0">
        {owned}/{total}
      </span>
    </div>
  );
}

// ─── One collection slot ──────────────────────────────────────────────────────
function Slot({ item }) {
  const tint = rarityTint(item.rarity);
  const locked = !item.owned;

  return (
    <div
      className="relative rounded-lg border-2 p-2 flex flex-col items-center text-center gap-1 min-h-[86px] justify-center"
      style={{
        // A locked slot keeps its rarity ring — that's what makes an empty
        // legendary slot read as "worth chasing" rather than as a broken
        // tile. The first pass used a 25%-alpha border on a transparent
        // background, and on the light theme that vanished completely:
        // every locked tile looked identical regardless of tier, so rarity
        // was communicated only by the section header. Verified on device.
        // The GREYSCALE EMOJI plus the lock badge carry "locked"; the frame
        // is free to carry rarity at full strength.
        borderColor: locked ? `${tint.color}99` : tint.color,
        background: locked ? `${tint.color}0f` : tint.wash,
      }}
      title={locked ? `${item.name} — not collected yet` : item.name}
    >
      {item.preview ? (
        // Themes show their palette rather than an emoji.
        <div className="flex gap-0.5" style={locked ? { filter: 'grayscale(1)', opacity: 0.3 } : undefined}>
          {item.preview.slice(0, 3).map((hex, i) => (
            <span key={i} className="w-3 h-3 rounded-sm" style={{ backgroundColor: hex }} />
          ))}
        </div>
      ) : (
        <span
          className="text-2xl leading-none"
          style={locked ? { filter: 'grayscale(1)', opacity: 0.28 } : undefined}
          aria-hidden="true"
        >
          {item.emoji || '❓'}
        </span>
      )}

      <span className={`text-[10px] font-semibold leading-tight line-clamp-2 ${locked ? 'text-muted-foreground' : ''}`}>
        {item.name}
      </span>

      {locked && (
        <Lock className="absolute top-1 end-1 w-2.5 h-2.5 text-muted-foreground/60" aria-hidden="true" />
      )}

      {/* Variant pips — a foil copy is a genuinely different collectible
          (and worth 2-10x on sale), but the Bag only ever revealed variants
          on cards you already had. Here they're visible as something to
          chase. */}
      {item.ownedVariants?.length > 0 && (
        <div className="flex gap-0.5">
          {item.ownedVariants.map(v => (
            <span
              key={v}
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: VARIANTS[v]?.color ?? '#fff' }}
              title={VARIANTS[v]?.label ?? v}
            />
          ))}
        </div>
      )}

      <span className="sr-only">
        {locked ? 'Not collected' : 'Collected'}
      </span>
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export default function CollectionModal({ open, onClose, initialTab = 'stickers' }) {
  const { user } = useAuth();
  const [tab, setTab] = useState(initialTab);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const [showOdds, setShowOdds] = useState(false);
  useBodyScrollLock(open);

  const { data: inventoryRows = [], isLoading } = useQuery({
    queryKey: ['userInventory', user?.email],
    queryFn:  () => inventory.listItems(user.email),
    enabled:  !!user?.email && open,
    staleTime: 30_000,
  });

  const ownership = useMemo(() => ownershipFrom(inventoryRows), [inventoryRows]);
  const collection = useMemo(
    () => buildCollection(tab, ownership, { ownedOnly }),
    [tab, ownership, ownedOnly]
  );
  const overall = useMemo(() => overallCompletion(ownership), [ownership]);

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
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-primary/12 flex items-center justify-center shrink-0">
                  <LibraryBig className="w-4 h-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-heading font-bold text-base leading-tight">Collection</h2>
                  <p className="text-[11px] text-muted-foreground leading-tight">
                    {overall.owned} of {overall.total} collected · {overall.pct}%
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-2 rounded-md hover:bg-secondary transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <CompletionBar owned={overall.owned} total={overall.total} pct={overall.pct} />
          </div>

          {/* Tabs + owned-only toggle */}
          <div
            className="flex items-center gap-1.5 px-4 py-2 border-b border-border bg-secondary/30 overflow-x-auto scrollbar-hide"
            style={{
              scrollbarWidth: 'none',
              // Four tabs plus the owned-only toggle don't fit 375px; fade
              // the overflow instead of slicing the last label mid-word.
              maskImage: 'linear-gradient(to right, #000 90%, transparent 100%)',
              WebkitMaskImage: 'linear-gradient(to right, #000 90%, transparent 100%)',
            }}
          >
            {COLLECTION_TABS.map(t => {
              const c = buildCollection(t.id, ownership);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-pressed={tab === t.id}
                  className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                    tab === t.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-card border border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                  <span className="ms-1 opacity-70 tabular-nums">{c.owned}/{c.total}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setOwnedOnly(o => !o)}
              aria-pressed={ownedOnly}
              className={`shrink-0 ms-auto px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${
                ownedOnly
                  ? 'bg-primary/15 text-primary border border-primary/40'
                  : 'bg-card border border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              Owned only
            </button>
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {isLoading ? (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {Array.from({ length: 15 }).map((_, i) => (
                  <div key={i} className="h-[86px] rounded-lg bg-secondary/40 animate-pulse" />
                ))}
              </div>
            ) : collection.groups.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-10">
                Nothing collected in this category yet.
              </p>
            ) : (
              collection.groups.map(group => (
                <section key={group.rarity}>
                  <div className="flex items-center gap-2 mb-2">
                    <RarityDot rarity={group.rarity} />
                    <span
                      className="text-[10px] font-bold uppercase tracking-[0.18em]"
                      style={{ color: group.color }}
                    >
                      {group.label}
                    </span>
                    <div className="flex-1 max-w-[140px]">
                      <CompletionBar
                        owned={group.owned}
                        total={group.total}
                        pct={group.total ? Math.round((group.owned / group.total) * 100) : 0}
                        color={group.color}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {group.items.map(item => <Slot key={item.id} item={item} />)}
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
          <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Lock className="w-2.5 h-2.5" /> not collected
            </span>
            <span className="flex items-center gap-1">
              <RarityBadge rarity="legendary" size="sm" /> rarity tier
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
