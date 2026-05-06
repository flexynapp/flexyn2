// src/lib/lootFrames.js
//
// Profile Frames — colored or animated borders that wrap the user's avatar
// in HubPostCard, profile views, and the Stats Hub.
//
// Each frame defines a CSS class string (or inline style fragment) to apply
// to the avatar wrapper. Animated frames use a CSS keyframe animation
// defined globally — see src/index.css for `frame-shimmer` etc.

export const LOOT_FRAMES = [
  // ── Common (3 — solid colored borders) ──────────────────────────────────────
  {
    id: 'f_steel',  name: 'Steel Edge',   rarity: 'common',
    emoji: '🔘', animated: false,
    description: 'Industrial steel border.',
    // CSS that wraps the avatar — applied as a `border` + `box-shadow`
    css: { border: '2px solid #94a3b8' },
  },
  {
    id: 'f_amber',  name: 'Amber Edge',   rarity: 'common',
    emoji: '🟠', animated: false,
    description: 'Warm amber.',
    css: { border: '2px solid #f59e0b' },
  },
  {
    id: 'f_emerald', name: 'Emerald Edge', rarity: 'common',
    emoji: '🟢', animated: false,
    description: 'Cool emerald.',
    css: { border: '2px solid #10b981' },
  },

  // ── Uncommon (3 — gradient borders) ─────────────────────────────────────────
  {
    id: 'f_sunset', name: 'Sunset Glow',   rarity: 'uncommon',
    emoji: '🌅', animated: false,
    description: 'Pink-to-orange gradient.',
    css: {
      border: '2px solid transparent',
      backgroundImage: 'linear-gradient(white, white), linear-gradient(135deg, #fb923c, #ec4899)',
      backgroundOrigin: 'border-box',
      backgroundClip: 'padding-box, border-box',
    },
  },
  {
    id: 'f_ocean',  name: 'Ocean Tide',    rarity: 'uncommon',
    emoji: '🌊', animated: false,
    description: 'Blue-to-cyan gradient.',
    css: {
      border: '2px solid transparent',
      backgroundImage: 'linear-gradient(white, white), linear-gradient(135deg, #3b82f6, #06b6d4)',
      backgroundOrigin: 'border-box',
      backgroundClip: 'padding-box, border-box',
    },
  },
  {
    id: 'f_forest', name: 'Forest Path',   rarity: 'uncommon',
    emoji: '🌲', animated: false,
    description: 'Lime-to-green gradient.',
    css: {
      border: '2px solid transparent',
      backgroundImage: 'linear-gradient(white, white), linear-gradient(135deg, #84cc16, #15803d)',
      backgroundOrigin: 'border-box',
      backgroundClip: 'padding-box, border-box',
    },
  },

  // ── Rare (2 — animated shimmer) ─────────────────────────────────────────────
  {
    id: 'f_gold_shimmer', name: 'Gold Shimmer', rarity: 'rare',
    emoji: '🌟', animated: true,
    description: 'Pulsing gold.',
    css: {
      border: '2px solid #facc15',
      boxShadow: '0 0 12px rgba(250, 204, 21, 0.6)',
      animation: 'frame-pulse 2s ease-in-out infinite',
    },
  },
  {
    id: 'f_crimson', name: 'Crimson Tide', rarity: 'rare',
    emoji: '🔴', animated: true,
    description: 'Pulsing red.',
    css: {
      border: '2px solid #dc2626',
      boxShadow: '0 0 12px rgba(220, 38, 38, 0.6)',
      animation: 'frame-pulse 2s ease-in-out infinite',
    },
  },

  // ── Epic (1 — rainbow shimmer) ──────────────────────────────────────────────
  {
    id: 'f_rainbow', name: 'Rainbow Aura', rarity: 'epic',
    emoji: '🌈', animated: true,
    description: 'Cycles through every color.',
    css: {
      border: '2px solid transparent',
      backgroundImage: 'linear-gradient(white, white), linear-gradient(45deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)',
      backgroundOrigin: 'border-box',
      backgroundClip: 'padding-box, border-box',
      backgroundSize: '100% 100%, 400% 400%',
      animation: 'frame-rainbow 6s linear infinite',
    },
  },

  // ── Legendary (1 — true rarity) ─────────────────────────────────────────────
  {
    id: 'f_legendary_aura', name: 'Legendary Aura', rarity: 'legendary',
    emoji: '👑', animated: true,
    description: 'Worn only by the chosen.',
    css: {
      border: '3px solid transparent',
      backgroundImage: 'linear-gradient(white, white), conic-gradient(from 0deg, #f59e0b, #ec4899, #8b5cf6, #06b6d4, #f59e0b)',
      backgroundOrigin: 'border-box',
      backgroundClip: 'padding-box, border-box',
      animation: 'frame-rotate 4s linear infinite',
      boxShadow: '0 0 16px rgba(245, 158, 11, 0.8)',
    },
  },
];

// Capsule odds for frames
export const LOOT_FRAME_CAPSULE_ODDS = {
  standard: 0.04,
  premium:  0.10,
  elite:    0.18,
};

// Within a frame drop, distribute by rarity
export const LOOT_FRAME_RARITY_ODDS = {
  standard: { common: 0.90, uncommon: 0.10, rare: 0,    epic: 0,    legendary: 0    },
  premium:  { common: 0.45, uncommon: 0.42, rare: 0.12, epic: 0.01, legendary: 0    },
  elite:    { common: 0.15, uncommon: 0.40, rare: 0.32, epic: 0.10, legendary: 0.03 },
};

/** Roll a frame from a capsule. Returns null if no frame is awarded this roll. */
export function rollLootFrame(capsuleType = 'standard') {
  const frameChance = LOOT_FRAME_CAPSULE_ODDS[capsuleType] ?? 0;
  if (Math.random() >= frameChance) return null;

  const rarityOdds = LOOT_FRAME_RARITY_ODDS[capsuleType] ?? {};
  const roll = Math.random();
  let cum = 0;
  let selectedRarity = 'common';
  for (const [rarity, prob] of Object.entries(rarityOdds)) {
    cum += prob;
    if (roll < cum) { selectedRarity = rarity; break; }
  }

  const pool = LOOT_FRAMES.filter(f => f.rarity === selectedRarity);
  if (!pool.length) return null;
  const frame = pool[Math.floor(Math.random() * pool.length)];

  return {
    id:      frame.id,
    name:    frame.name,
    emoji:   frame.emoji,
    rarity:  frame.rarity,
    type:    'frame',
    variant: null,
    description: frame.description,
    _frameData: frame,
  };
}

/** Look up a frame by its id. */
export function getLootFrameById(id) {
  return LOOT_FRAMES.find(f => f.id === id) ?? null;
}
