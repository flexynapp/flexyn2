// src/lib/lootCatalog.js
// Client-side item catalog and rarity configuration for the loot system.

// ── Daily Drop sticker pool ──────────────────────────────────────────
// 40+ stickers that rotate through the Marketplace's "Today's Drop"
// section. Three appear per day, deterministic by day-of-year so every
// user sees the same lineup on the same calendar day. Pool is meant as
// filler — themed around gym/fitness/effort with the rarity ladder
// giving the cheap ones a "starter merch" feel and the legendary ones
// a "you flex hard" feel.
// Server-side prices live in migration 165.
export const BRANDED_ITEMS = [
  // ── Common (25 coins) — gym essentials ──
  { id: 'flx_dumbbell', type: 'sticker', rarity: 'common',    name: 'Iron Dumbbell',   description: 'The Flexyn classic.',           emoji: '🏋️',  baseCoins: 25,  branded: true },
  { id: 'flx_band',     type: 'sticker', rarity: 'common',    name: 'Wristband',       description: 'Tighten up.',                   emoji: '⚪',  baseCoins: 25,  branded: true },
  { id: 'flx_chalk',    type: 'sticker', rarity: 'common',    name: 'Chalk Bag',       description: 'Grip game on lock.',            emoji: '⬜',  baseCoins: 25,  branded: true },
  { id: 'flx_shoes',    type: 'sticker', rarity: 'common',    name: 'Lifters',         description: 'Heel-elevated. Knees out.',     emoji: '👟',  baseCoins: 25,  branded: true },
  { id: 'flx_water',    type: 'sticker', rarity: 'common',    name: 'Hydrate',         description: 'Drink up.',                     emoji: '💧',  baseCoins: 25,  branded: true },
  { id: 'flx_apple',    type: 'sticker', rarity: 'common',    name: 'Clean Eats',      description: 'Macros first.',                 emoji: '🍎',  baseCoins: 25,  branded: true },
  { id: 'flx_egg',      type: 'sticker', rarity: 'common',    name: 'Protein',         description: 'The eternal staple.',           emoji: '🥚',  baseCoins: 25,  branded: true },
  { id: 'flx_alarm',    type: 'sticker', rarity: 'common',    name: 'Early Bird',      description: '5 AM strikes back.',            emoji: '⏰',  baseCoins: 25,  branded: true },
  { id: 'flx_pencil',   type: 'sticker', rarity: 'common',    name: 'Log It',          description: 'If it ain\'t logged...',        emoji: '📝',  baseCoins: 25,  branded: true },
  { id: 'flx_sweat',    type: 'sticker', rarity: 'common',    name: 'Sweat Drip',      description: 'Earned every drop.',            emoji: '💦',  baseCoins: 25,  branded: true },

  // ── Uncommon (50 coins) — earned vibe ──
  { id: 'flx_logo',     type: 'sticker', rarity: 'uncommon',  name: 'Flexyn Logo',     description: 'The OG dumbbell.',              emoji: '🟧',  baseCoins: 50,  branded: true },
  { id: 'flx_day_one',  type: 'sticker', rarity: 'uncommon',  name: 'Day One',         description: 'You were here from the start.', emoji: '①',   baseCoins: 50,  branded: true },
  { id: 'flx_keychain', type: 'sticker', rarity: 'uncommon',  name: 'Flexyn Keychain', description: 'Tag for your gym bag.',         emoji: '🔑',  baseCoins: 50,  branded: true },
  { id: 'flx_bottle',   type: 'sticker', rarity: 'uncommon',  name: 'Hydro Bottle',    description: 'Drink up. Branded.',            emoji: '🧊',  baseCoins: 50,  branded: true },
  { id: 'flx_muscle',   type: 'sticker', rarity: 'uncommon',  name: 'Flex',            description: 'Show off those gains.',         emoji: '💪',  baseCoins: 50,  branded: true },
  { id: 'flx_lightbolt',type: 'sticker', rarity: 'uncommon',  name: 'Volt',            description: 'Pure intensity.',               emoji: '⚡',  baseCoins: 50,  branded: true },
  { id: 'flx_target',   type: 'sticker', rarity: 'uncommon',  name: 'On Target',       description: 'Goals locked.',                 emoji: '🎯',  baseCoins: 50,  branded: true },
  { id: 'flx_med1',     type: 'sticker', rarity: 'uncommon',  name: 'First Place',     description: 'Top of the leaderboard.',       emoji: '🥇',  baseCoins: 50,  branded: true },
  { id: 'flx_med2',     type: 'sticker', rarity: 'uncommon',  name: 'Second Place',    description: 'Climbing.',                     emoji: '🥈',  baseCoins: 50,  branded: true },
  { id: 'flx_med3',     type: 'sticker', rarity: 'uncommon',  name: 'Third Place',     description: 'Podium.',                       emoji: '🥉',  baseCoins: 50,  branded: true },

  // ── Rare (100 coins) — gear / lifestyle ──
  { id: 'flx_og',       type: 'title',   rarity: 'rare',      name: 'OG',              description: 'Day-one Flexyn member title.',  emoji: '🏷️',  baseCoins: 120, branded: true },
  { id: 'flx_anvil',    type: 'sticker', rarity: 'rare',      name: 'Flex Anvil',      description: 'Forge yourself.',               emoji: '⚒️',  baseCoins: 80,  branded: true },
  { id: 'flx_belt',     type: 'sticker', rarity: 'rare',      name: 'Lifting Belt',    description: 'Stay tight, stay safe.',        emoji: '🥋',  baseCoins: 100, branded: true },
  { id: 'flx_swords',   type: 'sticker', rarity: 'rare',      name: 'Battle Mode',     description: 'Duel\'s on.',                   emoji: '⚔️',  baseCoins: 100, branded: true },
  { id: 'flx_shield',   type: 'sticker', rarity: 'rare',      name: 'Crew Shield',     description: 'Squad represent.',              emoji: '🛡️',  baseCoins: 100, branded: true },
  { id: 'flx_rocket',   type: 'sticker', rarity: 'rare',      name: 'Take Off',        description: 'On the come-up.',               emoji: '🚀',  baseCoins: 100, branded: true },
  { id: 'flx_diamond',  type: 'sticker', rarity: 'rare',      name: 'Diamond Grip',    description: 'Forged under pressure.',        emoji: '💎',  baseCoins: 100, branded: true },
  { id: 'flx_runner',   type: 'sticker', rarity: 'rare',      name: 'Sprinter',        description: 'Cardio merch.',                 emoji: '🏃',  baseCoins: 100, branded: true },

  // ── Epic (200 coins) — flex on em ──
  { id: 'flx_streak',   type: 'sticker', rarity: 'epic',      name: 'Streak Flame',    description: '100-day glow.',                 emoji: '🔥',  baseCoins: 200, branded: true },
  { id: 'flx_dragon',   type: 'sticker', rarity: 'epic',      name: 'Beast Mode',      description: 'Unleash it.',                   emoji: '🐉',  baseCoins: 200, branded: true },
  { id: 'flx_eagle',    type: 'sticker', rarity: 'epic',      name: 'Apex Predator',   description: 'Above the rest.',               emoji: '🦅',  baseCoins: 200, branded: true },
  { id: 'flx_galaxy',   type: 'sticker', rarity: 'epic',      name: 'Cosmic Pump',     description: 'No ceiling.',                   emoji: '🌌',  baseCoins: 200, branded: true },
  { id: 'flx_lion',     type: 'sticker', rarity: 'epic',      name: 'Pride',           description: 'King of the pride.',            emoji: '🦁',  baseCoins: 200, branded: true },

  // ── Legendary (400 coins) — trophy-tier ──
  { id: 'flx_crown',    type: 'frame',   rarity: 'legendary', name: 'Champion Frame',  description: 'Gold border for your profile.', emoji: '👑',  baseCoins: 400, branded: true },
  { id: 'flx_trophy',   type: 'sticker', rarity: 'legendary', name: 'Hall of Fame',    description: 'Your name lives forever.',      emoji: '🏆',  baseCoins: 400, branded: true },
  { id: 'flx_radiance', type: 'sticker', rarity: 'legendary', name: 'Radiance',        description: 'You light up the room.',        emoji: '🌟',  baseCoins: 400, branded: true },
  { id: 'flx_comet',    type: 'sticker', rarity: 'legendary', name: 'Streak Comet',    description: 'Once-in-a-lifetime drop.',      emoji: '☄️',  baseCoins: 400, branded: true },

  // ── Animated (1000 coins) — top of the wall ──
  { id: 'flx_sparkles', type: 'sticker', rarity: 'animated',  name: 'Sparkles',        description: 'The drop everyone wants.',      emoji: '✨',  baseCoins: 1000, branded: true },
];

/**
 * Deterministic daily rotation. Same day-of-year always returns the
 * same N items so every user sees the same drop on May 29th. Refresh
 * happens at local midnight (the day-of-year flips client-side).
 *
 * @param {Date} [today] override for testing
 * @param {number} [count=3] how many items to surface
 */
export function getDailyDrop(today = new Date(), count = 3) {
  const start = new Date(today.getFullYear(), 0, 0);
  const diff = today - start;
  const dayOfYear = Math.floor(diff / 86_400_000);
  const out = [];
  for (let i = 0; i < count && i < BRANDED_ITEMS.length; i++) {
    out.push(BRANDED_ITEMS[(dayOfYear + i * 7) % BRANDED_ITEMS.length]);
  }
  return out;
}

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
  mythic: {
    label: 'Mythic',
    color: '#fb7185',
    gradient: 'from-rose-400 to-rose-600',
    bgClass: 'bg-rose-950',
    borderClass: 'border-rose-400',
    textClass: 'text-rose-300',
    glowClass: 'shadow-rose-400/60',
    baseCoins: 500,
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

// ── Capsule glyph ─────────────────────────────────────────────────────
// Text-only fallback for the capsule. Anywhere a capsule is RENDERED,
// use <CapsuleIcon type=… /> (src/components/loot/CapsuleIcon.jsx) — it
// draws the actual gachapon sphere. This map exists for the surfaces
// that can only hold a string: toast titles, push-notification icons,
// catalog rows.
//
// It used to be 📦 / 🎁 / 💠 — a box, a present and a gem. None of them
// is a capsule, and the box in particular is what a user opening the Bag
// saw first. Declared above ITEMS because ITEMS reads it at module load.
//
// All three tiers share the glyph on purpose: the tier is carried by
// COLOUR on the real icon, and every string site that uses this map also
// names the tier next to it ("Premium Capsule earned"). Three different
// emoji objects is the drift this replaces, not a feature to preserve.
export const CAPSULE_GLYPH = {
  standard: '🔮',
  premium:  '🔮',
  elite:    '🔮',
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
  { id: 'cap_standard', type: 'capsule', rarity: 'common',    name: 'Standard Capsule', description: 'A mystery awaits inside.', emoji: CAPSULE_GLYPH.standard, baseCoins: 0 },
  { id: 'cap_premium',  type: 'capsule', rarity: 'uncommon',  name: 'Premium Capsule',  description: 'Better odds, better loot.', emoji: CAPSULE_GLYPH.premium, baseCoins: 0 },
  { id: 'cap_elite',    type: 'capsule', rarity: 'epic',      name: 'Elite Capsule',    description: 'Only the finest drops.', emoji: CAPSULE_GLYPH.elite, baseCoins: 0 },
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
 * Look up an item across BOTH catalogs — the core drop pool and the
 * branded Daily Drop pool.
 *
 * `getItemById` only searches ITEMS, so a branded item (flx_*) always came
 * back null. That's fine for the drop-roll code that owns it, but any
 * surface that renders a MARKETPLACE listing needs this version: branded
 * items are purchasable, therefore listable, therefore they show up in
 * listings whose descriptions would otherwise be blank.
 */
export function findCatalogItem(id) {
  if (!id) return null;
  return ITEMS.find(i => i.id === id)
    ?? BRANDED_ITEMS.find(i => i.id === id)
    ?? null;
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
