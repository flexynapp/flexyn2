// src/lib/lootTitles.js
//
// Profile Titles — text labels users equip and display under their @handle.
// Drops from capsules at controlled probabilities (similar to themes/stickers).
//
// Display: shown in HubPostCard (under @username), HubProfile, leaderboard
// rows, and the Stats Hub. Equip via UserBag → Titles tab.

export const LOOT_TITLES = [
  // ── Common (5 — flex-y but unflashy) ────────────────────────────────────────
  { id: 't_grinder',      name: 'The Grinder',      rarity: 'common', emoji: '⚙️',  description: 'Shows up no matter what.' },
  { id: 't_athlete',      name: 'Athlete',          rarity: 'common', emoji: '🏃',  description: 'A solid foundation.' },
  { id: 't_consistent',   name: 'Consistent',       rarity: 'common', emoji: '📅',  description: 'Day after day.' },
  { id: 't_committed',    name: 'Committed',        rarity: 'common', emoji: '🤝',  description: 'In it for the long haul.' },
  { id: 't_lifter',       name: 'Lifter',           rarity: 'common', emoji: '🏋️',  description: 'A simple truth.' },

  // ── Uncommon (5 — earned identity) ──────────────────────────────────────────
  { id: 't_iron_will',    name: 'Iron Will',        rarity: 'uncommon', emoji: '🛡️',  description: 'Unbreakable mindset.' },
  { id: 't_beast_mode',   name: 'Beast Mode',       rarity: 'uncommon', emoji: '🐺',  description: 'Something fierce.' },
  { id: 't_hustler',      name: 'The Hustler',      rarity: 'uncommon', emoji: '💼',  description: 'Always working.' },
  { id: 't_iron_wolf',    name: 'Iron Wolf',        rarity: 'uncommon', emoji: '🐾',  description: 'Lone but lethal.' },
  { id: 't_relentless',   name: 'Relentless',       rarity: 'uncommon', emoji: '🔁',  description: "Won't be stopped." },

  // ── Rare (4 — proper achievements) ──────────────────────────────────────────
  { id: 't_iron_king',    name: 'Iron King',        rarity: 'rare', emoji: '👑',  description: 'Crown of cold steel.' },
  { id: 't_apex',         name: 'Apex',             rarity: 'rare', emoji: '🦅',  description: 'Top of the food chain.' },
  { id: 't_warlord',      name: 'Warlord',          rarity: 'rare', emoji: '⚔️',  description: 'Conquers every session.' },
  { id: 't_storm_chaser', name: 'Storm Chaser',     rarity: 'rare', emoji: '⚡',   description: 'Lives in the eye of intensity.' },

  // ── Epic (3 — bragging rights) ──────────────────────────────────────────────
  { id: 't_phoenix',      name: 'Phoenix',          rarity: 'epic', emoji: '🔥',  description: 'Reborn through fire.' },
  { id: 't_titan',        name: 'Titan',            rarity: 'epic', emoji: '🗿',  description: 'Carved from stone.' },
  { id: 't_marathon_god', name: 'Marathon God',     rarity: 'epic', emoji: '🏛️',  description: 'Of the long road.' },

  // ── Legendary (2 — true rarity) ─────────────────────────────────────────────
  { id: 't_immortal',     name: 'Immortal',         rarity: 'legendary', emoji: '🌌', description: 'Carved into stone for eternity.' },
  { id: 't_chosen_one',   name: 'The Chosen One',   rarity: 'legendary', emoji: '✨', description: 'Once a generation.' },
];

// Capsule odds for titles (rolls AFTER theme roll, BEFORE sticker roll)
// These probabilities are the chance the capsule yields a title at all.
export const LOOT_TITLE_CAPSULE_ODDS = {
  standard: 0.05,  // 5 % of standard capsules drop a title
  premium:  0.12,  // 12 % of premium capsules
  elite:    0.20,  // 20 % of elite capsules — they're frequent in elite
};

// Within a title drop, distribute by rarity per capsule type
export const LOOT_TITLE_RARITY_ODDS = {
  standard: { common: 0.85, uncommon: 0.15, rare: 0,    epic: 0,    legendary: 0    },
  premium:  { common: 0.45, uncommon: 0.40, rare: 0.13, epic: 0.02, legendary: 0    },
  elite:    { common: 0.15, uncommon: 0.35, rare: 0.30, epic: 0.15, legendary: 0.05 },
};

/** Roll a title from a capsule. Returns null if no title is awarded this roll. */
export function rollLootTitle(capsuleType = 'standard') {
  const titleChance = LOOT_TITLE_CAPSULE_ODDS[capsuleType] ?? 0;
  if (Math.random() >= titleChance) return null;

  const rarityOdds = LOOT_TITLE_RARITY_ODDS[capsuleType] ?? {};
  const roll = Math.random();
  let cum = 0;
  let selectedRarity = 'common';
  for (const [rarity, prob] of Object.entries(rarityOdds)) {
    cum += prob;
    if (roll < cum) { selectedRarity = rarity; break; }
  }

  const pool = LOOT_TITLES.filter(t => t.rarity === selectedRarity);
  if (!pool.length) return null;
  const title = pool[Math.floor(Math.random() * pool.length)];

  // Shape into an inventory-compatible item
  return {
    id:      title.id,
    name:    title.name,
    emoji:   title.emoji,
    rarity:  title.rarity,
    type:    'title',
    variant: null,
    description: title.description,
    _titleData: title,
  };
}

/** Look up a title by its id. */
export function getLootTitleById(id) {
  return LOOT_TITLES.find(t => t.id === id) ?? null;
}
