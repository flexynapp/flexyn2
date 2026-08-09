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

// ── League season trophies ────────────────────────────────────────────────
//
// These cannot live in TROPHIES, because a new one is minted every 28 days
// and a static catalog would need editing on every roll. They are resolved
// from the id instead: `league_s{n}_{tier}` and `league_s{n}_champion`, both
// written by award_league_season_internal (migration 312).
//
// `TROPHIES.length` is the denominator for the "12 / 40 earned" counter on
// the profile, so season trophies are deliberately NOT added to it — an
// unreachable denominator that grows forever would make the collection look
// permanently unfinished.

const SEASON_TROPHY_RE = /^league_s(\d+)_(bronze|silver|gold|platinum|diamond|legend|champion)$/;

// TROPHY_TIERS has no `diamond` step, so diamond borrows platinum's ramp and
// both legend and champion take `legendary`.
const SEASON_TIER_MAP = {
  bronze: 'bronze', silver: 'silver', gold: 'gold',
  platinum: 'platinum', diamond: 'platinum',
  legend: 'legendary', champion: 'legendary',
};

const SEASON_EMOJI = {
  bronze: '🥉', silver: '🥈', gold: '🥇',
  platinum: '💠', diamond: '💎', legend: '👑', champion: '👑',
};

/** Parsed season trophy, or null if `id` isn't one. */
export function parseSeasonTrophy(id) {
  const m = SEASON_TROPHY_RE.exec(id || '');
  if (!m) return null;
  const season = Number(m[1]);
  const kind = m[2];
  const isChampion = kind === 'champion';
  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  return {
    id,
    season,
    kind,
    isChampion,
    category: 'league',
    tier: SEASON_TIER_MAP[kind] || 'bronze',
    emoji: SEASON_EMOJI[kind] || '🎖️',
    name: isChampion ? `Champion, S${season}` : `Season ${season} ${label}`,
    description: isChampion
      ? `Won season ${season} outright. Minted once — nobody else can earn this one.`
      : `Reached ${label} in season ${season}.`,
  };
}

export function getTrophy(id) {
  return TROPHY_BY_ID[id] || parseSeasonTrophy(id) || null;
}
