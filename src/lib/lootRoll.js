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

// Every category/rarity combination a roll can land on.
const CATEGORIES = ['sticker', 'theme', 'title', 'frame'];
const RARITIES   = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'animated'];

/**
 * The candidate menu sent to open_capsule_atomic (migration 255).
 *
 * One item per "category:rarity" bucket, chosen BEFORE the roll and
 * therefore without knowing its outcome. The server rolls, looks up the
 * bucket it landed on, and inserts the inventory row in the same
 * transaction that spends the capsule — which is what closes the window
 * where a capsule was gone but its item didn't exist yet.
 *
 * Only id/name/emoji/type travel. The RARITY stored on the inventory row
 * comes from the server's roll, never from this payload, so a tampered
 * menu can misname an item but cannot upgrade its tier.
 */
export function buildCandidateMenu() {
  const menu = {};
  for (const category of CATEGORIES) {
    for (const rarity of RARITIES) {
      const item = pickItemForRoll(category, rarity);
      if (!item) continue;
      menu[`${category}:${rarity}`] = {
        id: item.id,
        name: item.name,
        emoji: item.emoji ?? '',
        type: item.type ?? category,
      };
    }
  }
  return menu;
}
