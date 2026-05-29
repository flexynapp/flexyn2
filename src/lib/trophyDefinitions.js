// src/lib/trophyDefinitions.js
//
// Earned-trophy catalog. These are AUTO-AWARDED milestones — distinct
// from the decorative emoji picker on the profile (that one lets a
// user choose any 5 emojis for display; this one tracks achievements
// they've actually unlocked).
//
// Criteria are checked SERVER-SIDE in grant_eligible_trophies()
// (migration 167) so a client can't fake having earned one. The
// catalog here mirrors the server's list — when you change one,
// change the other.

export const TROPHY_TIERS = {
  bronze:    { label: 'Bronze',    color: '#cd7f32', order: 1 },
  silver:    { label: 'Silver',    color: '#c0c0c0', order: 2 },
  gold:      { label: 'Gold',      color: '#ffd700', order: 3 },
  platinum:  { label: 'Platinum',  color: '#7be0e0', order: 4 },
  legendary: { label: 'Legendary', color: '#a855f7', order: 5 },
};

// Each entry:
//   id          unique trophy id (matches server-side switch)
//   name        display name
//   description criteria copy ("Log your 100th workout")
//   emoji       trophy art
//   tier        bronze | silver | gold | platinum | legendary
//   category    workout | streak | level | duel | crew | cardio
export const TROPHIES = [
  // ── Workout count ──────────────────────────────────────────────
  { id: 'first_rep',       category: 'workout', tier: 'bronze',    emoji: '🥉', name: 'First Rep',         description: 'Logged your first workout.' },
  { id: 'consistent',      category: 'workout', tier: 'silver',    emoji: '🥈', name: 'Consistent',        description: '10 workouts logged.' },
  { id: 'committed',       category: 'workout', tier: 'gold',      emoji: '🥇', name: 'Committed',         description: '50 workouts logged.' },
  { id: 'centurion',       category: 'workout', tier: 'platinum',  emoji: '🏆', name: 'Centurion',         description: '100 workouts logged.' },

  // ── Streak ──────────────────────────────────────────────────────
  { id: 'streak_spark',    category: 'streak',  tier: 'bronze',    emoji: '🔥', name: 'Spark',             description: '7-day workout streak.' },
  { id: 'streak_blaze',    category: 'streak',  tier: 'silver',    emoji: '🔥', name: 'Blaze',             description: '30-day workout streak.' },
  { id: 'streak_inferno',  category: 'streak',  tier: 'gold',      emoji: '🔥', name: 'Inferno',           description: '100-day workout streak.' },
  { id: 'streak_eternal',  category: 'streak',  tier: 'legendary', emoji: '🔥', name: 'Eternal Flame',     description: '365-day workout streak.' },

  // ── Level ───────────────────────────────────────────────────────
  { id: 'level_tier1',     category: 'level',   tier: 'bronze',    emoji: '⚡', name: 'Tier 1',             description: 'Reached Level 10.' },
  { id: 'level_tier2',     category: 'level',   tier: 'silver',    emoji: '⚡', name: 'Tier 2',             description: 'Reached Level 25.' },
  { id: 'level_tier3',     category: 'level',   tier: 'gold',      emoji: '⚡', name: 'Tier 3',             description: 'Reached Level 50.' },
  { id: 'level_apex',      category: 'level',   tier: 'legendary', emoji: '⚡', name: 'Apex',               description: 'Reached Level 100.' },

  // ── Duels ───────────────────────────────────────────────────────
  { id: 'duel_challenger', category: 'duel',    tier: 'bronze',    emoji: '⚔️', name: 'Challenger',        description: 'Won your first duel.' },
  { id: 'duel_champion',   category: 'duel',    tier: 'silver',    emoji: '⚔️', name: 'Champion',          description: 'Won 10 duels.' },

  // ── Crew ────────────────────────────────────────────────────────
  { id: 'crew_squad',      category: 'crew',    tier: 'bronze',    emoji: '🛡️', name: 'Squad Member',      description: 'Joined your first crew.' },

  // ── Cardio ──────────────────────────────────────────────────────
  { id: 'cardio_5k',       category: 'cardio',  tier: 'bronze',    emoji: '🏃', name: '5K Club',           description: 'Logged a 5K+ cardio session.' },
  { id: 'cardio_10k',      category: 'cardio',  tier: 'silver',    emoji: '🏃', name: '10K Club',          description: 'Logged a 10K+ cardio session.' },
  { id: 'cardio_half',     category: 'cardio',  tier: 'gold',      emoji: '🏆', name: 'Half Marathoner',   description: 'Logged a 21.1K+ cardio session.' },
];

export const TROPHY_BY_ID = Object.fromEntries(TROPHIES.map(t => [t.id, t]));

export function getTrophy(id) {
  return TROPHY_BY_ID[id] || null;
}
