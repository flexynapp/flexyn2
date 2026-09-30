// src/lib/leagueTiers.js
//
// Configuration for the league tiers (Kegan, 2026-09-30: strength decides
// your league, training decides your week).
//
// ── What a tier is ───────────────────────────────────────────────────────────
//
// Your tier is a strength band. The server computes a Strength Score (DOTS,
// bodyweight and sex adjusted) from your squat, bench, deadlift and overhead
// press over the last 90 days, each lift counted at its SECOND-best session
// so one typo or one forged set cannot place you. See
// `league_strength_compute` in migration 20260930203000.
//
//   • First placement lands as soon as you have a score, on any tier.
//   • After that you move one tier per Monday: up when your score clears the
//     next tier's `strengthFloor`, down only when it falls below
//     DEMOTE_MARGIN of your own tier's floor. A shield blocks one demotion.
//   • No score (no bodyweight, or no main lift in 90 days) holds your tier.
//
// ── What the weekly bracket is ───────────────────────────────────────────────
//
// A race on training days, then XP, against up to 29 others. It pays coins
// and capsules at each member's OWN tier and never moves anyone's tier. The
// top `prizePct` of qualified members take the full prize once at least
// MIN_QUALIFIED_FOR_PRIZE qualified; everyone else who trained takes a
// quarter. A member qualifies by training on `minWorkouts` separate days.
//
// ── This file mirrors the server ─────────────────────────────────────────────
//
// The floors mirror `league_tier_floor`, the prize and day rules mirror
// `resolve_league_bracket_internal`. The client copy exists so the UI can
// draw the prize line and the next floor without a round trip. They must move
// in lockstep.

export const MAX_LEAGUE_SIZE = 30;

/** Qualified members a bracket needs before anyone wins the top prize. */
export const MIN_QUALIFIED_FOR_PRIZE = 5;

/** You drop a tier when your score falls below this share of its floor. */
export const DEMOTE_MARGIN = 0.9;

/** Lifetime cap on purchased shields. Mirrors `c_lifetime_cap` in grant_league_shield. */
export const SHIELD_LIFETIME_CAP = 3;

// Each tier's colour lives in its emblem (LeagueTierIcon, which carries
// a lighter and darker step of it) and the trophy plate's accent. There
// are no tier gradients behind UI; a
// full-bleed tier gradient behind white text failed contrast on Gold and
// Platinum and put violet on Diamond.
export const TIERS = [
  {
    id: 'bronze',
    label: 'Bronze',
    color: '#cd7f32',
    strengthFloor: 0,
    prizePct: 0.50,
    minWorkouts: 1,
    rewardCoins: 50,
    rewardCapsule: null,
  },
  {
    id: 'silver',
    label: 'Silver',
    color: '#c0c0c0',
    strengthFloor: 150,
    prizePct: 0.40,
    minWorkouts: 1,
    rewardCoins: 100,
    rewardCapsule: null,
  },
  {
    id: 'gold',
    label: 'Gold',
    color: '#facc15',
    strengthFloor: 250,
    prizePct: 0.30,
    minWorkouts: 2,
    rewardCoins: 200,
    rewardCapsule: 'standard',
  },
  {
    id: 'platinum',
    label: 'Platinum',
    color: '#67e8f9',
    strengthFloor: 325,
    prizePct: 0.25,
    minWorkouts: 2,
    rewardCoins: 350,
    rewardCapsule: 'premium',
  },
  {
    id: 'diamond',
    label: 'Diamond',
    // Blue, not the violet it shipped as: purple is reserved for rarity
    // (loot and XP tiers), and a league is a standing, not a drop.
    color: '#60a5fa',
    strengthFloor: 400,
    prizePct: 0.20,
    minWorkouts: 3,
    rewardCoins: 600,
    rewardCapsule: 'premium',
  },
  {
    id: 'legend',
    label: 'Legend',
    // Rose, not fuchsia, for the same reason. The top tier needs a hue
    // no lower tier or state colour owns: warm enough to read as a prize,
    // clear of the destructive red the demotion zone uses.
    color: '#fb7185',
    strengthFloor: 475,
    prizePct: 0.20,
    minWorkouts: 3,
    rewardCoins: 1000,
    rewardCapsule: 'elite',
  },
];

const TIER_INDEX = Object.fromEntries(TIERS.map((t, i) => [t.id, i]));

/**
 * "Bronze League" in the reader's language. Every surface that names a
 * league goes through this, so the tier word is translated (es: Bronce) and
 * the translator owns the word order through `league.tierName` (es: "Liga
 * {tier}"). Surfaces used to pass the English `label` straight in ("Liga
 * Bronze") or append the word League themselves ("Bronce Liga").
 */
export function leagueTierName(tier, tFallback, level) {
  if (!tier?.id) return tFallback('league.leagueSuffix', 'League');
  const name = tFallback(`trophy.seasonTier.${tier.id}`, tier.label);
  // With a level it reads "Bronze League II". The numeral is the same in
  // every locale; the translator still owns where it sits.
  if (level) {
    return tFallback('league.tierLevelName', '{tier} League {level}', {
      tier: name,
      level: levelNumeral(level),
    });
  }
  return tFallback('league.tierName', '{tier} League', { tier: name });
}

/** Levels inside a league, I to IV. Display only: placement and payouts
 * never read it. */
export const MAX_LEAGUE_LEVEL = 4;

/**
 * Your level inside your current league, from 1 to MAX_LEAGUE_LEVEL.
 *
 * Every week you QUALIFY in the league adds a level, and moving to a
 * different league (promotion or demotion) starts you at I again. Derived from resolved `league_members` rows rather than
 * stored, so nothing has to keep a counter in step with the resolver.
 *
 * @param {string} currentTierId  the tier you are in this week
 * @param {{ tier: string, qualified: boolean|null }[]} history
 *        resolved weeks, NEWEST FIRST
 */
export function leagueLevel(currentTierId, history) {
  let earned = 0;
  for (const week of history || []) {
    // The stint in this league ends at the first week spent in another one.
    if (week?.tier !== currentTierId) break;
    // qualified is NULL on a voided week (migration 310), which never ran
    // through the resolver and earns nothing.
    if (week.qualified === true) earned += 1;
  }
  return Math.min(MAX_LEAGUE_LEVEL, 1 + earned);
}

/** Roman numeral for a league level. Reads the same in every locale. */
export function levelNumeral(level) {
  return ['I', 'II', 'III', 'IV'][Math.min(MAX_LEAGUE_LEVEL, Math.max(1, level || 1)) - 1];
}

export function getTier(id) {
  return TIERS.find(t => t.id === id) || TIERS[0];
}

export function nextTier(id) {
  const i = TIER_INDEX[id];
  if (i === undefined || i === TIERS.length - 1) return null;
  return TIERS[i + 1];
}

export function previousTier(id) {
  const i = TIER_INDEX[id];
  if (i === undefined || i === 0) return null;
  return TIERS[i - 1];
}

/** The tier a Strength Score belongs to. Mirrors `league_tier_for_score`. */
export function tierForScore(score) {
  if (score == null || !Number.isFinite(Number(score))) return TIERS[0];
  let found = TIERS[0];
  for (const t of TIERS) if (Number(score) >= t.strengthFloor) found = t;
  return found;
}

/**
 * How many of `qualifiedCount` win the top prize in a bracket of this tier.
 * Mirrors `resolve_league_bracket_internal`, including the GREATEST(1, …)
 * floor. 0 below MIN_QUALIFIED_FOR_PRIZE.
 */
export function prizeCount(tierId, qualifiedCount) {
  const tier = getTier(tierId);
  if (!qualifiedCount || qualifiedCount < MIN_QUALIFIED_FOR_PRIZE) return 0;
  return Math.max(1, Math.ceil(qualifiedCount * tier.prizePct));
}

/**
 * Is this member competing this week? Uses the member's OWN tier, which a
 * mixed bracket can differ from the bracket's.
 *
 * @param {string} tierId  fallback tier, the bracket's
 * @param {{ tier?: string, active_days?: number, qualified?: boolean }} member
 */
export function isQualified(tierId, member) {
  if (!member) return false;
  // The server stamps `qualified` at resolution time; trust it once present.
  if (typeof member.qualified === 'boolean') return member.qualified;
  const tier = getTier(member.tier || tierId);
  return (Number(member.active_days) || 0) >= tier.minWorkouts;
}

/**
 * What a qualified member's position would pay if the week ended now.
 * Display-side mirror of `resolve_league_bracket_internal`; the server is
 * authoritative. Never moves a tier: that is the Strength Score's job.
 *
 * @param {string} tierId  the MEMBER's tier (it sets the purse)
 * @param {number} rank    1-indexed rank among qualified members
 * @param {number} qualifiedCount
 * @param {object} [opts]
 * @param {boolean} [opts.qualified=true]
 * @param {string}  [opts.bracketTierId]  sets the prize share; defaults to tierId
 * @returns {{ outcome: 'top'|'hold'|'unranked', coinsAwarded: number, capsuleAwarded: string|null }}
 */
export function resolveStanding(tierId, rank, qualifiedCount, opts = {}) {
  const { qualified = true, bracketTierId = tierId } = opts;
  const nothing = { outcome: 'hold', coinsAwarded: 0, capsuleAwarded: null };
  if (!tierId || TIER_INDEX[tierId] === undefined) return nothing;
  const tier = getTier(tierId);

  if (!qualified) return { ...nothing, outcome: 'unranked' };
  if (!rank || !qualifiedCount) return nothing;

  const prizeN = prizeCount(bracketTierId, qualifiedCount);
  if (prizeN > 0 && rank <= prizeN) {
    return {
      outcome: 'top',
      // First place takes a 1.5x purse; the rest of the prize zone takes tier rate.
      coinsAwarded: rank === 1 ? Math.floor((tier.rewardCoins * 3) / 2) : tier.rewardCoins,
      capsuleAwarded: tier.rewardCapsule,
    };
  }
  return {
    outcome: 'hold',
    coinsAwarded: Math.max(1, Math.floor(tier.rewardCoins / 4)),
    capsuleAwarded: null,
  };
}

/** Returns the user-visible label for an outcome enum. */
export function outcomeLabel(outcome) {
  if (outcome === 'top') return 'Prize zone';
  if (outcome === 'promote') return 'Promoted';
  if (outcome === 'demote') return 'Demoted';
  if (outcome === 'unranked') return 'Not qualified';
  if (outcome === 'decayed') return 'Dropped for inactivity';
  return 'Trained';
}
