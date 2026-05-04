// src/lib/lootThemes.js
// Loot-only themes obtained from capsule drops.
// Common = colorways only. Uncommon/Rare/Epic/Legendary = animated.

export const LOOT_THEMES = [
  // ── Common: new colorways ────────────────────────────────────────────────────
  {
    id: 'loot_coral',
    name: 'Coral Rush',
    description: 'Warm coral vibes',
    rarity: 'common',
    emoji: '🪸',
    animated: false,
    animation: null,
    preview: ['#f87171', '#7f1d1d'],
    vars: {
      '--primary': '0 91% 71%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '0 60% 25%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '0 91% 71%',
      '--sidebar-primary': '0 91% 71%',
      '--sidebar-ring': '0 91% 71%',
    },
  },
  {
    id: 'loot_mint',
    name: 'Mint Frost',
    description: 'Cool & crisp',
    rarity: 'common',
    emoji: '🌿',
    animated: false,
    animation: null,
    preview: ['#34d399', '#022c22'],
    vars: {
      '--primary': '152 76% 52%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '152 55% 16%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '152 76% 52%',
      '--sidebar-primary': '152 76% 52%',
      '--sidebar-ring': '152 76% 52%',
    },
  },
  {
    id: 'loot_rose',
    name: 'Rose Quartz',
    description: 'Soft rose',
    rarity: 'common',
    emoji: '🌸',
    animated: false,
    animation: null,
    preview: ['#fb7185', '#4c0519'],
    vars: {
      '--primary': '345 83% 60%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '345 55% 20%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '345 83% 60%',
      '--sidebar-primary': '345 83% 60%',
      '--sidebar-ring': '345 83% 60%',
    },
  },

  // ── Uncommon: subtle animated accents ───────────────────────────────────────
  {
    id: 'loot_dusk',
    name: 'Dusk Protocol',
    description: 'Amber sunset slowly shifting',
    rarity: 'uncommon',
    emoji: '🌅',
    animated: true,
    animation: 'dusk',
    preview: ['#f97316', '#e11d48'],
    vars: {
      '--primary': '24 95% 53%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '0 70% 26%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '24 95% 53%',
      '--sidebar-primary': '24 95% 53%',
      '--sidebar-ring': '24 95% 53%',
    },
  },
  {
    id: 'loot_tidal',
    name: 'Tidal Force',
    description: 'Ocean wave shimmer',
    rarity: 'uncommon',
    emoji: '🌊',
    animated: true,
    animation: 'tidal',
    preview: ['#0ea5e9', '#0c4a6e'],
    vars: {
      '--primary': '199 89% 48%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '200 65% 20%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '199 89% 48%',
      '--sidebar-primary': '199 89% 48%',
      '--sidebar-ring': '199 89% 48%',
    },
  },

  // ── Rare: full particle effects ──────────────────────────────────────────────
  {
    id: 'loot_nebula',
    name: 'Nebula',
    description: 'Drifting star particles',
    rarity: 'rare',
    emoji: '🌌',
    animated: true,
    animation: 'nebula',
    preview: ['#a855f7', '#1e0a3c'],
    vars: {
      '--primary': '270 80% 60%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '265 55% 22%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '270 80% 60%',
      '--sidebar-primary': '270 80% 60%',
      '--sidebar-ring': '270 80% 60%',
    },
  },
  {
    id: 'loot_ember',
    name: 'Ember Core',
    description: 'Rising sparks from the edges',
    rarity: 'rare',
    emoji: '🔥',
    animated: true,
    animation: 'ember',
    preview: ['#ef4444', '#431407'],
    vars: {
      '--primary': '0 84% 60%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '0 55% 20%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '0 84% 60%',
      '--sidebar-primary': '0 84% 60%',
      '--sidebar-ring': '0 84% 60%',
    },
  },

  // ── Epic: transformative animated UI ────────────────────────────────────────
  {
    id: 'loot_aurora',
    name: 'Aurora',
    description: 'Northern lights sweep your screen',
    rarity: 'epic',
    emoji: '🌠',
    animated: true,
    animation: 'aurora',
    preview: ['#2dd4bf', '#7c3aed'],
    vars: {
      '--primary': '172 66% 50%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '260 60% 28%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '172 66% 50%',
      '--sidebar-primary': '172 66% 50%',
      '--sidebar-ring': '172 66% 50%',
    },
  },
  {
    id: 'loot_cyberpunk',
    name: 'Cyberpunk',
    description: 'Neon scanlines + edge glows',
    rarity: 'epic',
    emoji: '🤖',
    animated: true,
    animation: 'cyberpunk',
    preview: ['#06b6d4', '#e879f9'],
    vars: {
      '--primary': '189 95% 43%',
      '--primary-foreground': '0 0% 0%',
      '--accent': '295 75% 45%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '189 95% 43%',
      '--sidebar-primary': '189 95% 43%',
      '--sidebar-ring': '295 75% 45%',
    },
  },

  // ── Legendary: the entire UI becomes alive ───────────────────────────────────
  {
    id: 'loot_prism',
    name: 'Prismatic',
    description: 'Every color — constantly cycling',
    rarity: 'legendary',
    emoji: '💎',
    animated: true,
    animation: 'prism',
    preview: ['#f43f5e', '#3b82f6'],
    vars: {
      '--primary': '330 85% 60%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '260 60% 28%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '330 85% 60%',
      '--sidebar-primary': '330 85% 60%',
      '--sidebar-ring': '330 85% 60%',
    },
  },
];

// Odds that a capsule drop is a theme (vs. a sticker)
export const LOOT_THEME_CAPSULE_ODDS = {
  standard: 0.00,
  premium:  0.03,
  elite:    0.08,
};

// Within a theme drop, these are the rarity weights
export const LOOT_THEME_RARITY_ODDS = {
  standard: {},
  premium:  { common: 1.0 },
  elite:    { common: 0.50, uncommon: 0.28, rare: 0.16, epic: 0.05, legendary: 0.01 },
};

/**
 * Roll a random loot theme item for a given capsule type.
 * Returns a theme item object (compatible with inventory.addItem) or null.
 */
export function rollLootTheme(capsuleType = 'standard') {
  const themeChance = LOOT_THEME_CAPSULE_ODDS[capsuleType] ?? 0;
  if (Math.random() >= themeChance) return null;

  const rarityOdds = LOOT_THEME_RARITY_ODDS[capsuleType] ?? {};
  const roll = Math.random();
  let cum = 0;
  let selectedRarity = 'common';
  for (const [rarity, prob] of Object.entries(rarityOdds)) {
    cum += prob;
    if (roll < cum) { selectedRarity = rarity; break; }
  }

  const pool = LOOT_THEMES.filter(t => t.rarity === selectedRarity);
  if (!pool.length) return null;
  const theme = pool[Math.floor(Math.random() * pool.length)];

  // Shape into an inventory-compatible item
  return {
    id:      theme.id,
    name:    theme.name,
    emoji:   theme.emoji,
    rarity:  theme.rarity,
    type:    'theme',
    variant: null,
    description: theme.description,
    // Carry the full theme object for display in CapsuleOpener
    _themeData: theme,
  };
}

/** Look up a loot theme by its id. */
export function getLootThemeById(id) {
  return LOOT_THEMES.find(t => t.id === id) ?? null;
}
