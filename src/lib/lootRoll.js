// src/lib/lootRoll.js
//
// Turning a server-side roll into a concrete catalog item.
//
// claim_capsule_loot (migration 028) decides the RARITY and the CATEGORY
// server-side and persists both on the user_capsules row. Picking WHICH
// item of that tier is the residual client-side step — safe, because
// items within a tier are equivalent in value, unlike the tier itself.
//
// Lived inside CapsuleOpener.jsx until the recovery sweep needed it too;
// importing a 1,100-line modal to resolve one item was not reasonable.

import { getItemsByRarity } from '@/lib/lootCatalog';
import { LOOT_THEMES } from '@/lib/lootThemes';
import { LOOT_TITLES } from '@/lib/lootTitles';
import { LOOT_FRAMES } from '@/lib/lootFrames';

/**
 * @param {'sticker'|'theme'|'title'|'frame'} category
 * @param {string} rarity
 * @returns {object|null} a catalog item, or null when nothing matches
 */
export function pickItemForRoll(category, rarity) {
  let pool = [];
  if (category === 'sticker')    pool = getItemsByRarity(rarity);
  else if (category === 'theme') pool = LOOT_THEMES.filter(t => t.rarity === rarity);
  else if (category === 'title') pool = LOOT_TITLES.filter(t => t.rarity === rarity);
  else if (category === 'frame') pool = LOOT_FRAMES.filter(f => f.rarity === rarity);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Resolve a roll to an item, degrading rather than returning nothing.
 *
 * The recovery sweep can't just give up when a (category, rarity) pair has
 * no catalog entry — the user is owed SOMETHING, and the capsule is already
 * spent. Falls back to a sticker of the same rarity (the roll's tier is
 * what carries the value), and only returns null if even that is empty.
 */
export function resolveRolledItem(category, rarity) {
  return pickItemForRoll(category || 'sticker', rarity)
    ?? pickItemForRoll('sticker', rarity)
    ?? null;
}
