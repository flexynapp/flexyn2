// src/components/market/ItemIndexModal.jsx
//
// "Browse every item in the game" — a full index of the loot catalog,
// surfaced from the Marketplace via a book-icon button. Renders every
// entry from lootCatalog.ITEMS grouped by rarity tier so a user can
// see what they're chasing.
//
// Read-only; doesn't grant anything. Useful as both a flex (look at
// all this stuff!) and a discovery surface (oh, there's a Comet
// sticker?).

import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Book } from 'lucide-react';
import { ITEMS, CAPSULE_ODDS } from '@/lib/lootCatalog';
import { rarityTint, COIN } from '@/components/loot/RarityVisuals';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

const RARITY_ORDER = ['animated', 'legendary', 'epic', 'rare', 'uncommon', 'common'];

// Tints come from `rarityTint`, which derives everything from the ONE
// colour in lootCatalog.RARITY. This file used to carry its own
// rarity→Tailwind map (zinc/emerald/sky/…) that had already drifted from
// the catalog's own palette (slate/green/blue/…), so "Rare" was sky-blue
// here and blue-400 one screen over.

export default function ItemIndexModal({ open, onClose }) {
  useBodyScrollLock(open);
  const [filter, setFilter] = useState('all');

  const grouped = useMemo(() => {
    const filtered = filter === 'all' ? ITEMS : ITEMS.filter(it => it.type === filter);
    const byRarity = {};
    for (const item of filtered) {
      if (!byRarity[item.rarity]) byRarity[item.rarity] = [];
      byRarity[item.rarity].push(item);
    }
    return RARITY_ORDER
      .filter(r => byRarity[r]?.length)
      .map(r => ({ rarity: r, items: byRarity[r] }));
  }, [filter]);

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
          className="relative w-full md:max-w-2xl bg-card border border-border rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary/12 flex items-center justify-center">
                <Book className="w-4 h-4 text-primary" />
              </div>
              <div>
                <h2 className="font-heading font-bold text-base">Item Index</h2>
                <p className="text-[11px] text-muted-foreground">{ITEMS.length} items in the game</p>
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

          {/* Type filter */}
          <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border bg-secondary/30">
            {['all', 'sticker', 'capsule'].map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setFilter(t)}
                className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide transition-colors ${
                  filter === t
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-muted-foreground hover:text-foreground border border-border'
                }`}
              >
                {t === 'all' ? 'All' : t === 'sticker' ? 'Stickers' : 'Capsules'}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {grouped.map(group => {
              const tint = rarityTint(group.rarity);
              return (
                <section key={group.rarity}>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="text-[10px] font-bold uppercase tracking-[0.18em]"
                      style={{ color: tint.color }}
                    >
                      {tint.label}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      · {group.items.length} item{group.items.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {group.items.map(item => (
                      <div
                        key={item.id}
                        className="rounded-lg ring-1 p-3 flex items-start gap-2.5"
                        style={{ background: tint.wash, '--tw-ring-color': tint.ring }}
                      >
                        <div className="text-2xl shrink-0 leading-none mt-0.5" aria-hidden="true">
                          {item.emoji}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="font-heading font-bold text-xs leading-tight truncate">
                            {item.name}
                          </p>
                          <p className="text-[10px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">
                            {item.description}
                          </p>
                          {item.baseCoins > 0 && (
                            <p className="text-[10px] font-bold mt-1" style={{ color: tint.color }}>
                              {COIN} {item.baseCoins}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}

            {/* Capsule odds footnote */}
            {filter !== 'sticker' && (
              <section className="mt-2 pt-3 border-t border-border">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                  Capsule odds
                </p>
                <div className="space-y-2 text-[11px]">
                  {Object.entries(CAPSULE_ODDS).map(([type, odds]) => (
                    <div key={type} className="bg-secondary/40 rounded-lg px-3 py-2">
                      <p className="font-bold capitalize">{type} capsule</p>
                      {/* CAPSULE_ODDS stores PROBABILITIES (0.600), not
                          percentages. This used to interpolate the raw
                          fraction straight into a "%" string, so a 60%
                          common rate was displayed to users as "0.6%" —
                          and legendary read "0.002%" instead of 0.2%.
                          CapsuleRarityOdds.jsx has always scaled correctly;
                          this surface didn't. */}
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
              </section>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}
