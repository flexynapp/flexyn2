// src/lib/lootThemes.js
//
// Loot-only themes obtained from capsule drops. Wave 65 — every theme
// now ships with a unique scene (see src/components/ThemeAnimationLayer.jsx
// + the scene CSS block in src/index.css). Rarity dictates motion budget:
//
//   common    — static scene (illustrative backdrop, drifting mist max)
//   uncommon  — scene + one light animated element
//   rare      — scene + multiple animated layers
//   epic      — full atmospheric animation (parallax, rotation, etc.)
//   legendary — animation that transforms the chrome itself
//
// IMPORTANT — the `animation` field MUST match a key in
// ThemeAnimationLayer.jsx's ANIMATION_MAP. Pre-Wave-65 had bugs where
// `loot_galaxy` was wired to 'shimmer', `loot_volcano` to 'glow',
// `loot_arctic` to 'shimmer', `loot_sunset` to 'pulse' — none of those
// keys existed, so those four themes silently rendered no scene at all.
// All fixed in Wave 65.

export const LOOT_THEMES = [
  // ── Common: static scenes (one illustrative backdrop, no motion past
  // gentle drift). The lack of motion is what makes uncommon+ feel rare.
  {
    id: 'loot_coral',
    name: 'Coral Rush',
    description: 'Underwater coral garden',
    rarity: 'common',
    emoji: '🪸',
    animated: true,
    animation: 'coralRush',
    preview: ['#f87171', '#7f1d1d'],
    vars: {
      '--primary': '0 84% 60%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '0 60% 25%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '0 84% 60%',
      '--sidebar-primary': '0 84% 60%',
      '--sidebar-ring': '0 84% 60%',
      // Underwater needs a teal-tinted backdrop so the scene reads.
      '--background': '195 50% 88%',
      '--foreground': '200 60% 12%',
      '--card': '0 0% 100%',
      '--card-foreground': '200 60% 12%',
      '--muted': '195 30% 82%',
      '--muted-foreground': '200 30% 36%',
      '--border': '195 30% 78%',
    },
  },
  {
    id: 'loot_mint',
    name: 'Mint Frost',
    description: 'Misty pine forest',
    rarity: 'common',
    emoji: '🌿',
    animated: true,
    animation: 'mintFrost',
    preview: ['#34d399', '#022c22'],
    vars: {
      '--primary': '152 76% 42%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '152 55% 16%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '152 76% 42%',
      '--sidebar-primary': '152 76% 42%',
      '--sidebar-ring': '152 76% 42%',
      '--background': '160 30% 92%',
      '--foreground': '152 50% 12%',
      '--card': '0 0% 100%',
      '--card-foreground': '152 50% 12%',
      '--muted': '152 15% 86%',
      '--muted-foreground': '152 25% 38%',
      '--border': '152 20% 82%',
    },
  },
  {
    id: 'loot_rose',
    name: 'Rose Quartz',
    description: 'Cherry blossoms drifting',
    rarity: 'common',
    emoji: '🌸',
    animated: true,
    animation: 'roseQuartz',
    preview: ['#fb7185', '#4c0519'],
    vars: {
      '--primary': '345 83% 60%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '345 55% 20%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '345 83% 60%',
      '--sidebar-primary': '345 83% 60%',
      '--sidebar-ring': '345 83% 60%',
      '--background': '345 50% 94%',
      '--foreground': '345 40% 18%',
      '--card': '0 0% 100%',
      '--card-foreground': '345 40% 18%',
      '--muted': '345 25% 90%',
      '--muted-foreground': '345 25% 42%',
      '--border': '345 25% 86%',
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

  // ── Rare: full particle effects + dark chrome ────────────────────────────────
  {
    id: 'loot_nebula',
    name: 'Nebula',
    description: 'Deep space + purple nebula clouds',
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
      '--background': '265 45% 6%',
      '--foreground': '270 25% 96%',
      '--card': '265 40% 10%',
      '--card-foreground': '270 25% 96%',
      '--muted': '265 30% 14%',
      '--muted-foreground': '270 20% 88%',
      '--border': '265 30% 20%',
    },
  },
  {
    id: 'loot_ember',
    name: 'Ember Core',
    description: 'Bonfire crackling in the night',
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
      '--background': '15 40% 5%',
      '--foreground': '20 30% 96%',
      '--card': '15 35% 9%',
      '--card-foreground': '20 30% 96%',
      '--muted': '15 28% 14%',
      '--muted-foreground': '20 20% 88%',
      '--border': '15 28% 20%',
    },
  },

  // ── Epic: full atmospheric animation + dark chrome ───────────────────────────
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
      '--background': '215 50% 6%',
      '--foreground': '180 25% 96%',
      '--card': '215 40% 10%',
      '--card-foreground': '180 25% 96%',
      '--muted': '215 30% 14%',
      '--muted-foreground': '180 20% 88%',
      '--border': '215 30% 20%',
    },
  },
  {
    id: 'loot_cyberpunk',
    name: 'Cyberpunk',
    description: 'Neon city skyline + flying vehicles',
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
      '--background': '240 40% 5%',
      '--foreground': '189 30% 96%',
      '--card': '240 35% 9%',
      '--card-foreground': '189 30% 96%',
      '--muted': '240 25% 14%',
      '--muted-foreground': '189 20% 88%',
      '--border': '240 25% 20%',
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
      '--background': '260 30% 5%',
      '--foreground': '0 0% 98%',
      '--card': '260 25% 9%',
      '--card-foreground': '0 0% 98%',
      '--muted': '260 20% 14%',
      '--muted-foreground': '0 0% 88%',
      '--border': '260 20% 20%',
    },
  },

  // ── New common colorways ─────────────────────────────────────────────────────
  {
    id: 'loot_solar',
    name: 'Solar Flare',
    description: 'Blazing sun + dancing corona',
    rarity: 'common',
    emoji: '☀️',
    animated: true,
    animation: 'solarFlare',  // Wave 70 — newly wired
    preview: ['#fbbf24', '#451a03'],
    vars: {
      '--primary': '38 92% 55%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '24 70% 22%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '38 92% 55%',
      '--sidebar-primary': '38 92% 55%',
      '--sidebar-ring': '38 92% 55%',
      // Solar wants a warm dark backdrop so the sun pops + the cards
      // stand out against the orange/amber gradient.
      '--background': '20 75% 8%',
      '--foreground': '38 40% 96%',
      '--card': '20 55% 13%',
      '--card-foreground': '38 40% 96%',
      '--muted': '20 35% 18%',
      '--muted-foreground': '38 25% 88%',
      '--border': '20 35% 24%',
    },
  },
  {
    id: 'loot_jade',
    name: 'Jade Stone',
    description: 'Bamboo grove + fireflies',
    rarity: 'common',
    emoji: '🟢',
    animated: true,
    animation: 'jadeStone',  // Wave 70 — newly wired
    preview: ['#10b981', '#022c22'],
    vars: {
      '--primary': '160 84% 39%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '160 60% 16%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '160 84% 39%',
      '--sidebar-primary': '160 84% 39%',
      '--sidebar-ring': '160 84% 39%',
      // Jade scene is a dark grove at dusk — chrome matches.
      '--background': '160 50% 7%',
      '--foreground': '152 30% 96%',
      '--card': '158 40% 12%',
      '--card-foreground': '152 30% 96%',
      '--muted': '158 30% 17%',
      '--muted-foreground': '152 20% 88%',
      '--border': '158 30% 23%',
    },
  },

  // ── New uncommon (animated) ──────────────────────────────────────────────────
  {
    id: 'loot_sunset',
    name: 'Sunset Pulse',
    description: 'Pulsing orange-pink horizon',
    rarity: 'uncommon',
    emoji: '🌅',
    animated: true,
    animation: 'sunset',  // Wave 65: was 'pulse' (no such handler — dead scene)
    preview: ['#fb923c', '#7c2d12'],
    vars: {
      '--primary': '24 95% 60%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '14 80% 25%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '24 95% 60%',
      '--sidebar-primary': '24 95% 60%',
      '--sidebar-ring': '24 95% 60%',
    },
  },
  {
    id: 'loot_arctic',
    name: 'Arctic Glow',
    description: 'Ice cave with drifting snow',
    rarity: 'uncommon',
    emoji: '❄️',
    animated: true,
    animation: 'arctic',  // Wave 65: was 'shimmer' (no such handler — dead scene)
    preview: ['#7dd3fc', '#0c4a6e'],
    vars: {
      '--primary': '199 89% 64%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '201 92% 24%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '199 89% 64%',
      '--sidebar-primary': '199 89% 64%',
      '--sidebar-ring': '199 89% 64%',
      // Ice cave needs the dark chrome — even at uncommon — or the
      // stalactites and walls have nothing to read against.
      // muted-foreground bumped to 88% so text-muted-foreground/50-80
      // alpha variants (used heavily across the UI) stay readable
      // against the scene showing through translucent cards.
      '--background': '215 75% 7%',
      '--foreground': '199 30% 96%',
      '--card': '215 60% 12%',
      '--card-foreground': '199 30% 96%',
      '--muted': '215 40% 16%',
      '--muted-foreground': '199 25% 88%',
      '--border': '215 40% 22%',
    },
  },

  // ── New rare ─────────────────────────────────────────────────────────────────
  {
    id: 'loot_volcano',
    name: 'Volcanic',
    description: 'Volcano silhouette + rising magma',
    rarity: 'rare',
    emoji: '🌋',
    animated: true,
    animation: 'volcano',  // Wave 65: was 'glow' (no such handler — dead scene)
    preview: ['#ef4444', '#450a0a'],
    vars: {
      '--primary': '0 84% 60%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '20 80% 18%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '0 84% 60%',
      '--sidebar-primary': '0 84% 60%',
      '--sidebar-ring': '0 84% 60%',
      '--background': '5 50% 6%',
      '--foreground': '20 30% 96%',
      '--card': '5 40% 10%',
      '--card-foreground': '20 30% 96%',
      '--muted': '5 30% 14%',
      '--muted-foreground': '20 20% 88%',
      '--border': '5 30% 20%',
    },
  },

  // ── New epic ─────────────────────────────────────────────────────────────────
  {
    id: 'loot_galaxy',
    name: 'Galactic',
    description: 'Deep space + parallax stars + planet',
    rarity: 'epic',
    emoji: '🌌',
    animated: true,
    animation: 'galaxy',  // Wave 65: was 'shimmer' (no such handler — dead scene)
    preview: ['#a78bfa', '#1e1b4b'],
    vars: {
      '--primary': '258 90% 66%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '243 75% 28%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '258 90% 66%',
      '--sidebar-primary': '258 90% 66%',
      '--sidebar-ring': '258 90% 66%',
      '--background': '243 50% 5%',
      '--foreground': '258 30% 96%',
      '--card': '243 40% 9%',
      '--card-foreground': '258 30% 96%',
      '--muted': '243 30% 14%',
      '--muted-foreground': '258 20% 88%',
      '--border': '243 30% 20%',
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // WAVE 2 — collectible scene drop (Claude Design handoff). One showpiece per
  // rarity tier, including Flexyn's first MYTHIC. Scenes live in
  // ThemeAnimationLayer.jsx (ANIMATION_MAP) + the Wave-2 block in index.css.
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: 'loot_zen',
    name: 'Zen Garden',
    description: 'Raked sand, stones, drifting maple leaves',
    rarity: 'common',
    emoji: '🪨',
    animated: true,
    animation: 'zenGarden',
    preview: ['#e0584a', '#5d5a52'],
    vars: {
      '--primary': '6 70% 52%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '25 25% 25%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '6 70% 52%',
      '--sidebar-primary': '6 70% 52%',
      '--sidebar-ring': '6 70% 52%',
      // Raked-sand daylight — warm paper chrome.
      '--background': '42 32% 92%',
      '--foreground': '25 25% 14%',
      '--card': '40 40% 98%',
      '--card-foreground': '25 25% 14%',
      '--muted': '42 24% 86%',
      '--muted-foreground': '25 14% 40%',
      '--border': '42 24% 80%',
    },
  },
  {
    id: 'loot_abyss',
    name: 'Deep Ocean Abyss',
    description: 'Marine snow, drifting jellies, a glowing anglerfish lure',
    rarity: 'rare',
    emoji: '🦑',
    animated: true,
    animation: 'abyss',
    preview: ['#22d3ee', '#082f49'],
    vars: {
      '--primary': '190 90% 52%',
      '--primary-foreground': '215 60% 8%',
      '--accent': '215 50% 18%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '190 90% 52%',
      '--sidebar-primary': '190 90% 52%',
      '--sidebar-ring': '190 90% 52%',
      // Hadal dark — bioluminescent cyan is the only light down here.
      '--background': '216 60% 4%',
      '--foreground': '195 30% 95%',
      '--card': '216 50% 7%',
      '--card-foreground': '195 30% 95%',
      '--muted': '216 40% 11%',
      '--muted-foreground': '195 18% 64%',
      '--border': '216 40% 17%',
    },
  },
  {
    id: 'loot_storm',
    name: 'Storm Chaser',
    description: 'Supercell sky, sweeping rain, periodic lightning strikes',
    rarity: 'epic',
    emoji: '⛈️',
    animated: true,
    animation: 'stormChaser',
    preview: ['#facc15', '#1e293b'],
    vars: {
      '--primary': '48 95% 54%',
      '--primary-foreground': '222 40% 10%',
      '--accent': '220 26% 24%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '48 95% 54%',
      '--sidebar-primary': '48 95% 54%',
      '--sidebar-ring': '48 95% 54%',
      '--background': '221 26% 6%',
      '--foreground': '212 16% 95%',
      '--card': '221 21% 10%',
      '--card-foreground': '212 16% 95%',
      '--muted': '221 16% 14%',
      '--muted-foreground': '212 11% 66%',
      '--border': '221 16% 20%',
    },
  },
  {
    id: 'loot_kingdom',
    name: 'Underwater Kingdom',
    description: 'Sunken golden-windowed palace, fish schools, god rays',
    rarity: 'legendary',
    emoji: '🔱',
    animated: true,
    animation: 'underwaterKingdom',
    preview: ['#22d3ee', '#fcd34d'],
    vars: {
      '--primary': '186 85% 45%',
      '--primary-foreground': '0 0% 100%',
      '--accent': '45 80% 40%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '186 85% 45%',
      '--sidebar-primary': '186 85% 45%',
      '--sidebar-ring': '45 80% 40%',
      // Sunken-palace teal with treasure-gold accents.
      '--background': '198 65% 5%',
      '--foreground': '186 32% 95%',
      '--card': '198 55% 9%',
      '--card-foreground': '186 32% 95%',
      '--muted': '198 40% 13%',
      '--muted-foreground': '186 18% 66%',
      '--border': '198 40% 19%',
    },
  },
  {
    id: 'loot_dragon',
    name: "Dragon's Lair",
    description: 'Gold hoard, blinking dragon eyes, fire-breath washes — the accent breathes gold↔ember',
    rarity: 'mythic',
    emoji: '🐉',
    animated: true,
    animation: 'dragonsLair',
    preview: ['#f59e0b', '#7f1d1d'],
    vars: {
      // --primary/--ring pulse live (gold↔ember) from the scene layer.
      '--primary': '32 95% 55%',
      '--primary-foreground': '15 60% 8%',
      '--accent': '0 60% 24%',
      '--accent-foreground': '0 0% 100%',
      '--ring': '32 95% 55%',
      '--sidebar-primary': '32 95% 55%',
      '--sidebar-ring': '32 95% 55%',
      '--background': '12 45% 4%',
      '--foreground': '30 30% 95%',
      '--card': '12 38% 8%',
      '--card-foreground': '30 30% 95%',
      '--muted': '12 30% 12%',
      '--muted-foreground': '30 18% 68%',
      '--border': '12 30% 18%',
    },
  },
];

// Odds that a capsule drop is a theme (vs. a sticker)
export const LOOT_THEME_CAPSULE_ODDS = {
  standard: 0.00,
  premium:  0.03,
  elite:    0.08,
};

// Within a theme drop, these are the rarity weights.
// Mythic (Wave 2 — Dragon's Lair) sits above legendary at the rarest
// weight; the elite tier is the only crate that can roll it.
export const LOOT_THEME_RARITY_ODDS = {
  standard: {},
  premium:  { common: 1.0 },
  elite:    { common: 0.50, uncommon: 0.27, rare: 0.16, epic: 0.05, legendary: 0.015, mythic: 0.005 },
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
