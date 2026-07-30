// src/lib/lootRoll.js
//
// Turning a server-side roll into a concrete catalog item.
//
// As of migration 267 the SERVER picks the item too, from the loot_catalog
// table, and returns its id. Nothing here decides what you win any more —
// this module's job is now purely to rehydrate the returned id into the full
// client-side catalog entry, because the database stores only id / name /
// emoji / type / rarity while the UI also needs the description, the theme
// preview colours and the frame CSS.
//
// `pickItemForRoll` and `buildCandidateMenu` are kept because the RPC
// signature still accepts the candidate pool (inert) and the pre-267 legacy
// path can still be reached on an un-migrated host. Prefer `hydrateItemById`
// for anything the server has already decided.
//
// Lived inside CapsuleOpener.jsx until the recovery sweep needed it too;
// importing a 1,100-line modal to resolve one item was not reasonable.

import { getItemsByRarity, getItemById } from '@/lib/lootCatalog';
import { LOOT_THEMES, getLootThemeById } from '@/lib/lootThemes';
import { LOOT_TITLES, getLootTitleById } from '@/lib/lootTitles';
import { LOOT_FRAMES, getLootFrameById } from '@/lib/lootFrames';

/**
 * Rehydrate a server-granted item id into its full catalog entry.
 *
 * The id is authoritative — it came from loot_catalog. This only adds the
 * presentation fields the database doesn't carry. Returns null when the id
 * isn't in any client catalog, which happens if the SQL seed is ahead of the
 * deployed bundle; callers fall back to the server's own name/emoji.
 *
 * @param {string} itemId
 * @param {'sticker'|'theme'|'title'|'frame'} [category] narrows the lookup
 */
export function hydrateItemById(itemId, category) {
  if (!itemId) return null;
  const lookups = category === 'theme'  ? [getLootThemeById]
                : category === 'title'  ? [getLootTitleById]
                : category === 'frame'  ? [getLootFrameById]
                : category === 'sticker' ? [getItemById]
                // Unknown category — try everything rather than guess.
                : [getItemById, getLootThemeById, getLootTitleById, getLootFrameById];
  for (const fn of lookups) {
    try {
      const hit = fn(itemId);
      if (hit) return hit;
    } catch { /* a getter that doesn't like this id shouldn't break the reveal */ }
  }
  return null;
}

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
