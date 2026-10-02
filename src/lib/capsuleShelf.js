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
import { glyphFor } from '@/components/capsules/stickerGlyphs';

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
 * Shelf order, left to right, with `tier` in the middle and the other two
 * either side in catalogue order. Used once, for the first arrangement.
 */
export function shelfSlots(tier) {
  const centre = CAPSULE_TIERS.includes(tier) ? tier : 'standard';
  const others = CAPSULE_TIERS.filter(t => t !== centre);
  return [others[0], centre, others[1]];
}

/**
 * The shelf after the user picks `tier`: it trades places with whatever is in
 * the middle and the third canister stays where it stands. A swap, rather than
 * re-sorting into catalogue order, is what lets the change animate as two
 * canisters passing each other instead of all three reshuffling.
 */
export function swapIntoCentre(slots, tier) {
  const at = slots.indexOf(tier);
  if (at < 0 || at === 1) return slots;
  const next = [...slots];
  next[at] = slots[1];
  next[1] = tier;
  return next;
}

// Canister heights, mirroring the CSS clamps the shelf drew before it
// animated: clamp(160px,26vh,226px) for the chosen one, clamp(84px,13vh,111px)
// for the two beside it. Computed here because the swap animates transforms,
// and a transform needs numbers.
const clampPx = (min, v, max) => Math.min(max, Math.max(min, v));
const CANISTER_RATIO = 120 / 166;
const SHELF_GAP = 10;
const LABEL_W = 104;
const LABEL_GAP = 8;

/**
 * Geometry for one viewport height. Every canister is drawn at the large size
 * and the side ones are scaled down from their base, so a swap is pure
 * transform (x and scale) and never resizes a box.
 *
 * @param {number} vh  window.innerHeight in px
 * @returns {{ big:number, width:number, side:number, offset:number, labelOffset:number }}
 *   big    the chosen canister's height
 *   width  its width
 *   side   scale of a side canister
 *   offset px from the centre to a side canister's centre
 *   labelOffset same for the labels under them, never closer than a label's width
 */
export function shelfGeometry(vh) {
  const big = clampPx(160, 0.26 * vh, 226);
  const small = clampPx(84, 0.13 * vh, 111);
  const width = big * CANISTER_RATIO;
  const side = small / big;
  const offset = width / 2 + SHELF_GAP + (width * side) / 2;
  return { big, width, side, offset, labelOffset: Math.max(offset, LABEL_W + LABEL_GAP) };
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

/**
 * The set as one line per rarity, in sheet order: `{ rarity, owned, total }`.
 * `owned` is a Set of item ids (ownershipFrom().owned); anything in it that
 * is not a sticker in the set is ignored. This is what the set bar draws and
 * what the set page lists, so both count the same thing.
 */
export function setTiers(owned) {
  const have = owned ?? new Set();
  const set = stickerSet();
  return LADDER
    .map(rarity => {
      const inTier = set.filter(s => s.rarity === rarity);
      return { rarity, owned: inTier.filter(s => have.has(s.id)).length, total: inTier.length };
    })
    .filter(t => t.total > 0);
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

/**
 * The stickers the set preview fans out: the user's newest owned stickers,
 * oldest on the left so the newest lands on top, then a few they do not have
 * yet, rarest first, as a glimpse of what the set still holds.
 * `inventoryRows` is newest first, as inventory.listItems returns it.
 * `lead` is a sticker that just dropped: it goes on top even if it is
 * already in the rows. Returns `{ id, rarity, emoji, owned }` items.
 */
export function setFan(inventoryRows, { max = 5, teasers = 2, lead = null } = {}) {
  const set = stickerSet();
  const byId = new Map(set.map(s => [s.id, s]));
  const seen = new Set();
  const mine = [];
  for (const row of inventoryRows ?? []) {
    const id = row?.item_id;
    if (!byId.has(id) || seen.has(id)) continue;
    seen.add(id);
    if (id !== lead) mine.push(byId.get(id));
  }
  const room = Math.max(0, max - (lead && byId.has(lead) ? 1 : 0));
  const out = mine.slice(0, room).reverse().map(s => ({ id: s.id, rarity: s.rarity, emoji: s.emoji, owned: true }));
  if (lead && byId.has(lead)) {
    const s = byId.get(lead);
    out.push({ id: s.id, rarity: s.rarity, emoji: s.emoji, owned: true });
    seen.add(lead);
  }
  if (teasers > 0) {
    const missing = [...set].reverse().filter(s => !seen.has(s.id) && glyphFor(s.id));
    for (const s of missing.slice(0, teasers)) out.push({ id: s.id, rarity: s.rarity, emoji: s.emoji, owned: false });
  }
  return out;
}

/**
 * The face a rarity wears on the odds ladder: a sticker of that rarity the
 * user owns, else one from the set they could get. Drawn stickers before
 * emoji discs. Null when the set has no sticker of that rarity.
 */
export function rarityFace(rarity, owned) {
  const have = owned ?? new Set();
  const inTier = stickerSet().filter(s => s.rarity === rarity);
  const rank = (s) => (have.has(s.id) ? 0 : 2) + (glyphFor(s.id) ? 0 : 1);
  const pick = [...inTier].sort((a, b) => rank(a) - rank(b))[0];
  return pick ? { id: pick.id, emoji: pick.emoji, owned: have.has(pick.id) } : null;
}
