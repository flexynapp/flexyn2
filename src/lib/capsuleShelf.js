// src/lib/capsuleShelf.js
//
// The arithmetic behind the Capsules home, the reveal and the market rows, kept
// pure so it can be tested without a Supabase mock or a render.
//
// Nothing here decides what anybody gets. Capsules are rolled and granted by
// open_capsule_atomic, bought through purchase_shop_item and sold through
// sell_inventory_item; this module only describes what the server already
// decided, or what it publishes (odds, prices).

import { CAPSULE_ODDS, RARITY, findCatalogItem } from '@/lib/lootCatalog';
import { SHOP_CATALOG } from '@/lib/data/coinShop';
import { catalogFor } from '@/lib/collection';

export const CAPSULE_TIERS = ['standard', 'premium', 'elite'];

/** The shop SKU that sells a tier, and its published price. */
export function tierShopItem(tier) {
  return SHOP_CATALOG[`capsule_${tier}`] ?? null;
}

/** The most capsules one open runs, matching CapsuleOpener's MAX_BATCH. */
export const MAX_OPEN_AT_ONCE = 10;

/**
 * Unopened capsule rows grouped by tier. Unknown tiers are parked under
 * standard, the same default the opener uses, so a row never vanishes.
 */
export function shelfByTier(rows) {
  const out = { standard: [], premium: [], elite: [] };
  for (const row of rows ?? []) {
    if (!row || row.is_opened) continue;
    const tier = CAPSULE_TIERS.includes(row.capsule_type) ? row.capsule_type : 'standard';
    out[tier].push(row);
  }
  return out;
}

/**
 * The tier to show first: the rarest one the user can open right now, or
 * standard when the shelf is empty (it is the cheapest to buy).
 */
export function defaultTier(shelf) {
  for (const tier of ['elite', 'premium', 'standard']) {
    if ((shelf?.[tier]?.length ?? 0) > 0) return tier;
  }
  return 'standard';
}

/**
 * After opening `tier`, the next capsule worth offering on the reveal: more
 * of the same tier if any are left after this open, otherwise the rarest
 * other tier on the shelf. Null when the shelf will be empty.
 *
 * @param {{standard:any[],premium:any[],elite:any[]}} shelf  before the open
 * @param {string} tier   the tier being opened
 * @param {number} taken  how many of that tier this open uses
 */
export function nextOnShelf(shelf, tier, taken) {
  const left = (shelf?.[tier]?.length ?? 0) - taken;
  if (left > 0) {
    return { tier, rows: shelf[tier].slice(taken, taken + MAX_OPEN_AT_ONCE) };
  }
  for (const other of ['elite', 'premium', 'standard']) {
    if (other === tier) continue;
    const rows = shelf?.[other] ?? [];
    if (rows.length > 0) return { tier: other, rows: rows.slice(0, MAX_OPEN_AT_ONCE) };
  }
  return null;
}

/**
 * Published drop rates for a tier as bar segments, rarest last. Tiers the
 * capsule cannot drop (a 0 rate) are left out rather than drawn as slivers.
 * `pct` is the percentage as a number; formatting is the caller's.
 */
export function oddsSegments(tier) {
  const table = CAPSULE_ODDS[tier] ?? CAPSULE_ODDS.standard;
  return Object.entries(table)
    .filter(([, p]) => p > 0)
    .map(([rarity, p]) => ({
      rarity,
      color: RARITY[rarity]?.color ?? '#888',
      label: RARITY[rarity]?.label ?? rarity,
      // Rounded to a tenth so 0.018 prints as 1.8 rather than 1.7999999.
      pct: Math.round(p * 1000) / 10,
    }));
}

/**
 * The punch strip: one slot per sticker in the set, filled for each owned.
 * `fresh` marks one slot as just earned, drawn in that item's rarity.
 *
 * @returns {Array<'owned'|'fresh'|'empty'>}
 */
export function punchSlots(owned, total, fresh = false) {
  const n = Math.max(0, total | 0);
  const have = Math.min(n, Math.max(0, owned | 0));
  return Array.from({ length: n }, (_, i) => {
    if (fresh && i === have - 1) return 'fresh';
    return i < have ? 'owned' : 'empty';
  });
}

/** The sticker set, in sheet order: catalog stickers, common to rarest. */
const LADDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'animated'];
export function stickerSet() {
  const all = catalogFor('stickers');
  return LADDER.flatMap(r => all.filter(i => i.rarity === r));
}

/**
 * Where an item sits on the sheet: `{ no, total }`, or null for anything
 * that is not a sticker in the set (titles, frames, themes).
 */
export function setNumber(itemId) {
  const set = stickerSet();
  const i = set.findIndex(s => s.id === itemId);
  return i < 0 ? null : { no: i + 1, total: set.length };
}

/** Two-digit sheet number, as stamped on the set. */
export function formatSetNo(no) {
  return String(no).padStart(2, '0');
}

/** How many copies of an item an inventory holds. */
export function copiesOf(inventoryRows, itemId) {
  if (!itemId) return 0;
  return (inventoryRows ?? []).filter(r => r?.item_id === itemId).length;
}

/**
 * What the item is worth in the catalog (the shop's base value). Null when
 * the catalog does not know the item, so the row can drop the line rather
 * than print a zero.
 */
export function catalogValue(itemId) {
  const v = findCatalogItem(itemId)?.baseCoins;
  return typeof v === 'number' && v > 0 ? v : null;
}

/**
 * How many times the catalog value a listing asks, rounded, or null when it
 * is not worth saying (no catalog value, or under double). "Sellers set
 * their own prices" is only news when the price is far from the catalog.
 */
export function askMultiple(askingPrice, catalog) {
  if (!catalog || !askingPrice) return null;
  const m = askingPrice / catalog;
  if (m < 2) return null;
  return m >= 10 ? Math.round(m) : Math.round(m * 10) / 10;
}
