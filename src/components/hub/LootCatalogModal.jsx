// src/components/hub/LootCatalogModal.jsx
//
// "What's inside?" catalog browser. Shows every droppable cosmetic
// (titles, frames, themes, stickers) grouped by rarity tier with
// visual previews — so a user can decide which capsule type to open
// before spending coins.
//
// Opened from the CapsuleOpener via a small "Preview catalog" link
// next to the rarity-odds disclosure.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { X, Sparkles, Crown, Square as SquareIcon, Palette } from 'lucide-react';
import { ITEMS, RARITY } from '@/lib/lootCatalog';
import { RarityDot } from '@/components/loot/RarityVisuals';
import { LOOT_TITLES } from '@/lib/lootTitles';
import { LOOT_FRAMES } from '@/lib/lootFrames';
import { LOOT_THEMES } from '@/lib/lootThemes';
import { useLanguage } from '@/lib/LanguageContext';

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'animated'];

const TAB_DEFS = [
  { id: 'stickers', labelKey: 'lootCatalog.tab.stickers', defaultLabel: 'Stickers', Icon: Sparkles, source: () => ITEMS.filter(i => i.type === 'sticker') },
  { id: 'titles',   labelKey: 'lootCatalog.tab.titles',   defaultLabel: 'Titles',   Icon: Crown,    source: () => LOOT_TITLES   || [] },
  { id: 'frames',   labelKey: 'lootCatalog.tab.frames',   defaultLabel: 'Frames',   Icon: SquareIcon, source: () => LOOT_FRAMES || [] },
  { id: 'themes',   labelKey: 'lootCatalog.tab.themes',   defaultLabel: 'Themes',   Icon: Palette,  source: () => LOOT_THEMES   || [] },
];

function Item({ item, kind }) {
  if (kind === 'stickers') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-xl shrink-0">{item.emoji}</span>
        <span className="truncate">{item.name}</span>
      </div>
    );
  }
  if (kind === 'titles') {
    return (
      <div className="text-xs truncate">
        {item.label || item.name || item.id}
      </div>
    );
  }
  if (kind === 'frames') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span
          className="w-5 h-5 rounded-full border-2 shrink-0"
          style={{ borderColor: item?.css?.borderColor || '#94a3b8' }}
          aria-hidden="true"
        />
        <span className="truncate">{item.label || item.name || item.id}</span>
      </div>
    );
  }
  if (kind === 'themes') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <div className="flex gap-0.5 shrink-0">
          {(item?.preview || []).slice(0, 3).map((c, i) => (
            <span
              key={i}
              className="w-3 h-3 rounded-sm"
              style={{ backgroundColor: c }}
              aria-hidden="true"
            />
          ))}
        </div>
        <span className="truncate">{item.name || item.id}</span>
      </div>
    );
  }
  return null;
}

export default function LootCatalogModal({ open, onClose }) {
  const { tFallback } = useLanguage();
  const [activeTab, setActiveTab] = useState('stickers');
  if (!open) return null;
  const TABS = TAB_DEFS.map(t => ({ ...t, label: tFallback(t.labelKey, t.defaultLabel) }));
  const tabConfig = TABS.find(t => t.id === activeTab);
  const items = tabConfig?.source?.() || [];
  const grouped = RARITY_ORDER.map(r => ({
    rarity: r,
    meta:   RARITY[r],
    items:  items.filter(i => i.rarity === r),
  })).filter(g => g.items.length > 0);

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[9999] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4"
      >
        <motion.div
          initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col"
          style={{ maxHeight: '88vh' }}
        >
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <h2 className="font-heading font-bold text-base">{tFallback('lootCatalog.title', "What's inside?")}</h2>
            <button onClick={onClose} aria-label={tFallback('common.close', 'Close')} className="w-7 h-7 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex gap-1 px-4 pb-2 border-b border-border">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-1 px-2 py-1 text-[11px] font-bold uppercase tracking-wide rounded-md transition-colors ${
                  activeTab === id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="w-3 h-3" /> {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {grouped.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-6">{tFallback('lootCatalog.empty', 'No items in this catalog yet.')}</p>
            ) : grouped.map(({ rarity, meta, items: rarityItems }) => (
              <div key={rarity}>
                <div className="flex items-center gap-1.5 mb-1">
                  <RarityDot rarity={rarity} />
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: meta?.color }}>
                    {rarity}
                  </span>
                  <span className="text-[10px] text-muted-foreground">× {rarityItems.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {rarityItems.map((item) => (
                    <div key={item.id} className="rounded-md bg-secondary/50 border border-border px-2 py-1.5">
                      <Item item={item} kind={activeTab} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
