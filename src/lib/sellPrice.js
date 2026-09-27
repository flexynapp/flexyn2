// src/lib/sellPrice.js
//
// What the Bag pays for an item, for DISPLAY. The sale itself is priced by the
// server: sell_inventory_item (2026-09-27) reads the same table (half the
// rarity's base value, times the variant multiplier) and credits whatever it
// computes, so this can only ever mislabel a button, never mint a coin.
//
// It lived as a private constant inside UserBag. The capsule reveal now says
// what a fresh pull sells for too, and two copies of a price table are how the
// rarity colours drifted apart across six files.

import { RARITY, VARIANTS } from '@/lib/lootCatalog';

export const SELL_PRICE = Object.fromEntries(
  Object.entries(RARITY).map(([k, v]) => [k, Math.floor((v.baseCoins ?? 10) / 2)])
);

/** Coins the Bag's Sell button offers for one item of this rarity and variant. */
export function sellPriceFor(rarity, variant = null) {
  const mult = variant ? (VARIANTS[variant]?.sellMultiplier ?? 1) : 1;
  return Math.floor((SELL_PRICE[rarity] ?? 2) * mult);
}
