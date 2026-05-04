// src/lib/lootCatalog.js
// Client-side item catalog and rarity configuration for the loot system.

export const RARITY = {
  common: {
    label: 'Common',
    color: '#94a3b8',
    gradient: 'from-slate-400 to-slate-600',
    bgClass: 'bg-slate-800',
    borderClass: 'border-slate-400',
    textClass: 'text-slate-300',
    glowClass: 'shadow-slate-400/40',
    baseCoins: 5,
  },
  uncommon: {
    label: 'Uncommon',
    color: '#4ade80',
    gradient: 'from-green-400 to-green-600',
    bgClass: 'bg-green-950',
    borderClass: 'border-green-400',
    textClass: 'text-green-300',
    glowClass: 'shadow-green-400/40',
    baseCoins: 15,
  },
  rare: {
    label: 'Rare',
    color: '#60a5fa',
    gradient: 'from-blue-400 to-blue-600',
    bgClass: 'bg-blue-950',
    borderClass: 'border-blue-400',
    textClass: 'text-blue-300',
    glowClass: 'shadow-blue-400/40',
    baseCoins: 40,
  },
  epic: {
    label: 'Epic',
    color: '#c084fc',
    gradient: 'from-purple-400 to-purple-600',
    bgClass: 'bg-purple-950',
    borderClass: 'border-purple-400',
    textClass: 'text-purple-300',
    glowClass: 'shadow-purple-400/50',
    baseCoins: 100,
  },
  legendary: {
    label: 'Legendary',
    color: '#fbbf24',
    gradient: 'from-amber-400 to-amber-600',
    bgClass: 'bg-amber-950',
    borderClass: 'border-amber-400',
    textClass: 'text-amber-300',
    glowClass: 'shadow-amber-400/60',
    baseCoins: 250,
  },
  animated: {
    label: 'Animated',
    color: '#f472b6',
    gradient: 'from-pink-400 to-fuchsia-500',
    bgClass: 'bg-pink-950',
    borderClass: 'border-pink-400',
    textClass: 'text-pink-300',
    glowClass: 'shadow-pink-400/60',
    baseCoins: 500,
  },
};

export const ITEMS = [
  // ── Common stickers (5) ──
  { id: 'stk_muscle',   type: 'sticker', rarity: 'common',    name: 'Flex',          description: 'Show off those gains.', emoji: '💪', baseCoins: 5  },
  { id: 'stk_fire',     type: 'sticker', rarity: 'common',    name: 'On Fire',        description: 'You\'re absolutely blazing.', emoji: '🔥', baseCoins: 5  },
  { id: 'stk_star',     type: 'sticker', rarity: 'common',    name: 'Star',           description: 'A classic star for a reason.', emoji: '⭐', baseCoins: 5  },
  { id: 'stk_thumbs',   type: 'sticker', rarity: 'common',    name: 'Solid',          description: 'Thumbs up, keep going.', emoji: '👍', baseCoins: 5  },
  { id: 'stk_target',   type: 'sticker', rarity: 'common',    name: 'Bullseye',       description: 'Locked on your goals.', emoji: '🎯', baseCoins: 5  },

  // ── Uncommon stickers (5) ──
  { id: 'stk_crown',    type: 'sticker', rarity: 'uncommon',  name: 'Crown',          description: 'Royalty of the gym.', emoji: '👑', baseCoins: 15 },
  { id: 'stk_rocket',   type: 'sticker', rarity: 'uncommon',  name: 'Launch',         description: 'To the moon and back.', emoji: '🚀', baseCoins: 15 },
  { id: 'stk_diamond',  type: 'sticker', rarity: 'uncommon',  name: 'Diamond',        description: 'Hard as a diamond.', emoji: '💎', baseCoins: 15 },
  { id: 'stk_zap',      type: 'sticker', rarity: 'uncommon',  name: 'Zap',            description: 'Pure electric energy.', emoji: '⚡', baseCoins: 15 },
  { id: 'stk_trophy',   type: 'sticker', rarity: 'uncommon',  name: 'Trophy',         description: 'Winner\'s mentality.', emoji: '🏆', baseCoins: 15 },

  // ── Rare stickers (3) ──
  { id: 'stk_dragon',   type: 'sticker', rarity: 'rare',      name: 'Dragon',         description: 'Unleash your inner beast.', emoji: '🐉', baseCoins: 40 },
  { id: 'stk_eagle',    type: 'sticker', rarity: 'rare',      name: 'Eagle',          description: 'Soar above the rest.', emoji: '🦅', baseCoins: 40 },
  { id: 'stk_wave',     type: 'sticker', rarity: 'rare',      name: 'Wave',           description: 'Ride the momentum.', emoji: '🌊', baseCoins: 40 },

  // ── Epic stickers (3) ──
  { id: 'stk_galaxy',   type: 'sticker', rarity: 'epic',      name: 'Galaxy',         description: 'Your potential is infinite.', emoji: '🌌', baseCoins: 100 },
  { id: 'stk_orb',      type: 'sticker', rarity: 'epic',      name: 'Crystal Orb',    description: 'See your future gains.', emoji: '🔮', baseCoins: 100 },
  { id: 'stk_lion',     type: 'sticker', rarity: 'epic',      name: 'Lion',           description: 'Pride of the pride.', emoji: '🦁', baseCoins: 100 },

  // ── Legendary stickers (2) ──
  { id: 'stk_glow',     type: 'sticker', rarity: 'legendary', name: 'Radiance',       description: 'You light up the gym.', emoji: '🌟', baseCoins: 250 },
  { id: 'stk_comet',    type: 'sticker', rarity: 'legendary', name: 'Comet',          description: 'A once-in-a-lifetime drop.', emoji: '💫', baseCoins: 250 },

  // ── Animated sticker (1) ──
  { id: 'stk_sparkle',  type: 'sticker', rarity: 'animated',  name: 'Sparkle',        description: 'Rarest of the rare — it moves!', emoji: '✨', baseCoins: 500 },

  // ── Capsule items (3) ──
  { id: 'cap_standard', type: 'capsule', rarity: 'common',    name: 'Standard Capsule', description: 'A mystery awaits inside.', emoji: '📦', baseCoins: 0 },
  { id: 'cap_premium',  type: 'capsule', rarity: 'uncommon',  name: 'Premium Capsule',  description: 'Better odds, better loot.', emoji: '🎁', baseCoins: 0 },
  { id: 'cap_elite',    type: 'capsule', rarity: 'epic',      name: 'Elite Capsule',    description: 'Only the finest drops.', emoji: '💠', baseCoins: 0 },
];

export const CAPSULE_ODDS = {
  standard: {
    common:    0.600,
    uncommon:  0.280,
    rare:      0.100,
    epic:      0.018,
    legendary: 0.002,
    animated:  0.000,
  },
  premium: {
    common:    0.350,
    uncommon:  0.380,
    rare:      0.190,
    epic:      0.065,
    legendary: 0.013,
    animated:  0.002,
  },
  elite: {
    common:    0.100,
    uncommon:  0.250,
    rare:      0.350,
    epic:      0.220,
    legendary: 0.070,
    animated:  0.010,
  },
};

/** Return all items of a given rarity (stickers only for drops). */
export function getItemsByRarity(rarity) {
  return ITEMS.filter(i => i.rarity === rarity && i.type === 'sticker');
}

/** Look up an item by its id. */
export function getItemById(id) {
  return ITEMS.find(i => i.id === id) ?? null;
}

/**
 * Roll the capsule RNG and return the won item.
 * Uses the configured odds for the given capsule type.
 */
export function rollCapsule(capsuleType = 'standard') {
  const odds = CAPSULE_ODDS[capsuleType] ?? CAPSULE_ODDS.standard;
  const roll = Math.random();
  let cumulative = 0;
  let wonRarity = 'common';

  for (const [rarity, probability] of Object.entries(odds)) {
    cumulative += probability;
    if (roll < cumulative) {
      wonRarity = rarity;
      break;
    }
  }

  const pool = getItemsByRarity(wonRarity);
  if (pool.length === 0) {
    // Fallback — should never happen with a complete catalog
    return ITEMS.find(i => i.rarity === 'common' && i.type === 'sticker');
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Sticker Variants ─────────────────────────────────────────────────────────
export const VARIANTS = {
  foil: {
    label: 'Foil',
    badge: '✦ Foil',
    sellMultiplier: 2,
    color: '#e2e8f0',
    borderColor: 'rgba(200,220,255,0.6)',
  },
  gold: {
    label: 'Gold',
    badge: '★ Gold',
    sellMultiplier: 5,
    color: '#f59e0b',
    borderColor: '#f59e0b',
  },
  diamond: {
    label: 'Diamond',
    badge: '◆ Diamond',
    sellMultiplier: 10,
    color: '#67e8f9',
    borderColor: '#67e8f9',
  },
};

// Variant drop odds per capsule type (these are independent of item odds)
export const VARIANT_ODDS = {
  standard: { foil: 0.03, gold: 0.00,  diamond: 0.000 },
  premium:  { foil: 0.08, gold: 0.02,  diamond: 0.000 },
  elite:    { foil: 0.14, gold: 0.05,  diamond: 0.010 },
};

/** Roll for a variant after an item has been chosen. Returns null for no variant. */
export function rollVariant(capsuleType = 'standard') {
  const odds = VARIANT_ODDS[capsuleType] ?? VARIANT_ODDS.standard;
  const roll = Math.random();
  let cum = 0;
  for (const [variant, prob] of Object.entries(odds)) {
    cum += prob;
    if (roll < cum) return variant;
  }
  return null;
}
