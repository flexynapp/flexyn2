// src/lib/collection.js
//
// The collection model — what exists, what you own, what's still missing.
//
// Flexyn had three separate "browse the items" surfaces (the Marketplace's
// Item Index, the Capsule Opener's Loot Catalog, and the Bag) and not one
// of them could answer the question that actually drives a collection
// game: what DON'T I have yet? The Bag showed only what you own; the two
// catalogs showed everything but never marked ownership. So the empty slot
// — the single strongest motivator in every collection UI from the Pokédex
// to Habitica's pet grid — was invisible.
//
// This module owns the merge: catalog ∪ inventory → per-rarity groups with
// an `owned` flag, plus completion counts. It's deliberately pure so the
// arithmetic is testable without mounting a modal or mocking Supabase.

import { ITEMS, BRANDED_ITEMS, RARITY } from '@/lib/lootCatalog';
import { LOOT_TITLES } from '@/lib/lootTitles';
import { LOOT_FRAMES } from '@/lib/lootFrames';
import { LOOT_THEMES } from '@/lib/lootThemes';

// Common → rarest. Ascending reads better for a completion grid than the
// Item Index's old rarest-first order: you scan your easy wins, then see
// the gap widen toward the tail.
export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'animated'];

/**
 * Catalog sources per tab.
 *
 * Note the branded items are folded in alongside the core pool. The old
 * Item Index rendered ITEMS only, so all 40 BRANDED_ITEMS — the entire
 * Daily Drop catalog, the stuff users actually spend coins on — were
 * absent from the one screen that claimed to list "every item in the game".
 *
 * Capsules are excluded: they're consumables, not collectibles. Showing a
 * permanently-unowned "Standard Capsule" slot in a completion grid would
 * make 100% unreachable by construction.
 */
const SOURCES = {
  stickers: () => [
    ...ITEMS.filter(i => i.type === 'sticker'),
    ...BRANDED_ITEMS.filter(i => i.type === 'sticker'),
  ],
  titles: () => [
    ...LOOT_TITLES,
    ...BRANDED_ITEMS.filter(i => i.type === 'title'),
  ],
  frames: () => [
    ...LOOT_FRAMES,
    ...BRANDED_ITEMS.filter(i => i.type === 'frame'),
  ],
  themes: () => [...LOOT_THEMES],
};

export const COLLECTION_TABS = [
  { id: 'stickers', label: 'Stickers' },
  { id: 'titles',   label: 'Titles'   },
  { id: 'frames',   label: 'Frames'   },
  { id: 'themes',   label: 'Themes'   },
];

/** Every catalog entry for a tab, deduped by id, in catalog order. */
export function catalogFor(tabId) {
  const source = SOURCES[tabId];
  if (!source) return [];
  const seen = new Set();
  return source().filter(item => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/**
 * Reduce raw user_inventory rows into the two lookups the grid needs:
 * which item ids are owned, and which variants of each.
 *
 * Variants matter here because a foil copy is a genuinely different
 * collectible (and worth 2-10x on sale), but the Bag only ever surfaced
 * variants on cards you already owned — never as something to chase.
 */
export function ownershipFrom(inventoryRows) {
  const owned = new Set();
  const variants = new Map(); // item_id → Set<variant>
  for (const row of inventoryRows ?? []) {
    if (!row?.item_id) continue;
    owned.add(row.item_id);
    if (row.variant) {
      if (!variants.has(row.item_id)) variants.set(row.item_id, new Set());
      variants.get(row.item_id).add(row.variant);
    }
  }
  return { owned, variants };
}

/**
 * Build the rarity-grouped, ownership-annotated view for one tab.
 *
 * @returns {{groups: Array<{rarity, label, color, items, owned, total}>,
 *            owned: number, total: number, pct: number}}
 */
export function buildCollection(tabId, ownership, { ownedOnly = false } = {}) {
  const { owned: ownedIds, variants } = ownership ?? { owned: new Set(), variants: new Map() };
  const catalog = catalogFor(tabId);

  const byRarity = new Map();
  for (const item of catalog) {
    // An item whose rarity isn't on the ladder would otherwise vanish
    // silently from the grid AND from the denominator, quietly inflating
    // the completion percentage. Park it under common instead.
    const rarity = RARITY_ORDER.includes(item.rarity) ? item.rarity : 'common';
    if (!byRarity.has(rarity)) byRarity.set(rarity, []);
    byRarity.get(rarity).push({
      ...item,
      rarity,
      owned: ownedIds.has(item.id),
      ownedVariants: Array.from(variants.get(item.id) ?? []),
    });
  }

  const groups = RARITY_ORDER
    .filter(r => byRarity.has(r))
    .map(r => {
      const all = byRarity.get(r);
      const ownedCount = all.filter(i => i.owned).length;
      return {
        rarity: r,
        label: RARITY[r]?.label ?? r,
        color: RARITY[r]?.color ?? '#888',
        // Completion counts always describe the FULL tier, never the
        // filtered view — otherwise "Owned only" would report 6/6 and
        // read as complete.
        owned: ownedCount,
        total: all.length,
        items: ownedOnly ? all.filter(i => i.owned) : all,
      };
    })
    .filter(g => g.items.length > 0);

  const total = catalog.length;
  const owned = catalog.filter(i => ownedIds.has(i.id)).length;

  return {
    groups,
    owned,
    total,
    pct: total === 0 ? 0 : Math.round((owned / total) * 100),
  };
}

/** Completion across every tab — drives the header summary. */
export function overallCompletion(ownership) {
  let owned = 0;
  let total = 0;
  for (const tab of COLLECTION_TABS) {
    const c = buildCollection(tab.id, ownership);
    owned += c.owned;
    total += c.total;
  }
  return { owned, total, pct: total === 0 ? 0 : Math.round((owned / total) * 100) };
}

/**
 * Owned/total per rarity tier across EVERY tab.
 *
 * Drives the header's rarity spectrum. A single overall percentage says
 * "you're 29% done" and nothing else; the same 29% made of a full common
 * tier versus a scattering of legendaries are completely different
 * collections, and only the breakdown shows which one you have — and
 * therefore where the next thing worth chasing is.
 *
 * Tiers with no items in the game at all are omitted rather than rendered
 * as permanently-empty segments.
 */
export function rarityBreakdown(ownership) {
  const totals = new Map(); // rarity → { owned, total }

  for (const tab of COLLECTION_TABS) {
    for (const group of buildCollection(tab.id, ownership).groups) {
      const acc = totals.get(group.rarity) ?? { owned: 0, total: 0 };
      acc.owned += group.owned;
      acc.total += group.total;
      totals.set(group.rarity, acc);
    }
  }

  return RARITY_ORDER
    .filter(r => (totals.get(r)?.total ?? 0) > 0)
    .map(r => {
      const { owned, total } = totals.get(r);
      return {
        rarity: r,
        label: RARITY[r]?.label ?? r,
        color: RARITY[r]?.color ?? '#888',
        owned,
        total,
        pct: Math.round((owned / total) * 100),
      };
    });
}
