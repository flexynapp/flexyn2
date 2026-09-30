// src/lib/leagueTiers.js
//
// Configuration for the weekly league tiers. Each tier has:
//   • A display name + color
//   • A PROPORTIONAL promote/demote band, evaluated over the QUALIFIED field
//   • A qualification floor (minimum days trained; minimum weekly XP)
//   • An end-of-week reward (coins + optional capsule)
//
// Tiers are ordered bronze → silver → gold → platinum → diamond → legend.
//
// ── Why proportions replaced counts (migration 310) ──────────────────────────
//
// This file used to carry absolute counts: bronze `promote: 10`, and the
// server mirrored them. With a 30-member cap and live brackets holding 1–11
// people, "top 10 promote" meant a bronze bracket promoted EVERY member —
// including everyone on zero XP. Five weeks of that and an account that had
// never opened the app was in Legend. Proportions degrade gracefully at small
// N; absolute counts do not. Duolingo's ladder works the same way (bronze
// promotes roughly the top two-thirds, tightening to zero at the top tier).
//
// ── Why a qualification floor exists ─────────────────────────────────────────
//
// Ranking by XP alone let an idle account ride a promotion slot. A member is
// only ranked if they actually trained:
//
//     qualified ⟺ activeDays >= minWorkouts AND weeklyXp >= minXp
//
// Unqualified members sort below every qualified member regardless of XP, are
// never promoted, and never consume a promotion slot.
//
// ── Why minXp is 0 everywhere ────────────────────────────────────────────────
//
// It is a live knob, deliberately switched off. The production XP ledger holds
// ten user-weeks in total: median 23 XP, p75 50 XP, and 35 of its 36 grants
// are 3–65 XP micro-actions. Any floor in the hundreds would disqualify every
// user in the database including the active ones — turning "stops AFK
// promotion" into "stops all promotion". Raise it from data, never from a
// guess.
//
// ── This file mirrors the server ─────────────────────────────────────────────
//
// The authoritative copy is the VALUES table inside
// `resolve_league_bracket_internal` (migration 310). The client copy exists so
// the standings UI can draw the zone lines without a round trip. THEY MUST
// MOVE IN LOCKSTEP — a mismatch renders a promotion line in a place the
// resolver does not honour, which is worse than no line at all.

export const MAX_LEAGUE_SIZE = 30;

/**
 * Qualified members required before a bracket promotes or demotes anyone.
 * Below this, the bracket resolves to participation payouts only and every
 * member keeps their tier. Mirrors `c_min_bracket` in migration 310.
 *
 * This is what stops a solo bronze bracket escalating one person to Legend in
 * five weeks.
 */
export const MIN_QUALIFIED_TO_MOVE = 5;

/** Consecutive quiet weeks tolerated before decay starts. Mirrors `c_decay_grace`. */
export const DECAY_GRACE_WEEKS = 2;

/** Lifetime cap on purchased shields. Mirrors `c_lifetime_cap` in grant_league_shield. */
export const SHIELD_LIFETIME_CAP = 3;

// Each tier's colour is used in exactly one form: a solid chip (the medal
// on the card, the square on the ladder, the badge in the standings
// header) or the trophy plate's accent. There are no tier gradients; a
// full-bleed tier gradient behind white text failed contrast on Gold and
// Platinum and put violet on Diamond.
export const TIERS = [
  {
    id: 'bronze',
    label: 'Bronze',
    color: '#cd7f32',
    promotePct: 0.50,
    demotePct: 0,      // never demoted out of bronze — it is the floor
    minWorkouts: 1,
    minXp: 0,
    rewardCoins: 50,
    rewardCapsule: null,
  },
  {
    id: 'silver',
    label: 'Silver',
    color: '#c0c0c0',
    promotePct: 0.40,
    demotePct: 0.10,
    minWorkouts: 1,
    minXp: 0,
    rewardCoins: 100,
    rewardCapsule: null,
  },
  {
    id: 'gold',
    label: 'Gold',
    color: '#facc15',
    promotePct: 0.30,
    demotePct: 0.15,
    minWorkouts: 2,
    minXp: 0,
    rewardCoins: 200,
    rewardCapsule: 'standard',
  },
  {
    id: 'platinum',
    label: 'Platinum',
    color: '#67e8f9',
    promotePct: 0.25,
    demotePct: 0.20,
    minWorkouts: 2,
    minXp: 0,
    rewardCoins: 350,
    rewardCapsule: 'premium',
  },
  {
    id: 'diamond',
    label: 'Diamond',
    // Blue, not the violet it shipped as: purple is reserved for rarity
    // (loot and XP tiers), and a league is a standing, not a drop.
    color: '#60a5fa',
    promotePct: 0.20,
    demotePct: 0.20,
    minWorkouts: 3,
    minXp: 0,
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
    promotePct: 0,     // terminal tier — the season board is the endgame
    demotePct: 0.20,
    minWorkouts: 3,
    minXp: 0,
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
export function leagueTierName(tier, tFallback) {
  if (!tier?.id) return tFallback('league.leagueSuffix', 'League');
  const name = tFallback(`trophy.seasonTier.${tier.id}`, tier.label);
  return tFallback('league.tierName', '{tier} League', { tier: name });
}

/**
 * Glyph colour for text or an icon drawn ON a tier chip. Tier colours run
 * from dark bronze to pale platinum, so a fixed white or black fails at one
 * end; pick from relative luminance. 0.42 rather than 0.5 so dark wins
 * ties, because a white glyph disappears fastest on the pale tiers.
 */
export function onTierColor(hex) {
  const h = (hex || '').replace('#', '');
  if (h.length !== 6) return '#fff';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.42 ? '#1a1d23' : '#ffffff';
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

/**
 * How many of `qualifiedCount` promote out of this tier.
 *
 * Mirrors migration 310 exactly, including the `GREATEST(1, …)` floor — a
 * qualified bracket always advances somebody, or the ladder stalls at the
 * bottom where the field is smallest.
 *
 * Returns 0 below MIN_QUALIFIED_TO_MOVE, and 0 for a terminal tier.
 */
export function promoteCount(tierId, qualifiedCount) {
  const tier = getTier(tierId);
  if (!qualifiedCount || qualifiedCount < MIN_QUALIFIED_TO_MOVE) return 0;
  if (!tier.promotePct) return 0;
  return Math.max(1, Math.ceil(qualifiedCount * tier.promotePct));
}

/**
 * How many of `qualifiedCount` demote out of this tier.
 *
 * Floors rather than ceils — demotion is the punitive direction, so the
 * rounding goes in the user's favour. Mirrors migration 310.
 */
export function demoteCount(tierId, qualifiedCount) {
  const tier = getTier(tierId);
  if (!qualifiedCount || qualifiedCount < MIN_QUALIFIED_TO_MOVE) return 0;
  if (!tier.demotePct) return 0;
  return Math.floor(qualifiedCount * tier.demotePct);
}

/**
 * Is this member competing this week?
 *
 * @param {string} tierId
 * @param {{ active_days?: number, weekly_xp?: number, qualified?: boolean }} member
 */
export function isQualified(tierId, member) {
  if (!member) return false;
  // The server stamps `qualified` at resolution time; trust it once present.
  if (typeof member.qualified === 'boolean') return member.qualified;
  const tier = getTier(tierId);
  const days = Number(member.active_days) || 0;
  const xp = Number(member.weekly_xp) || 0;
  return days >= tier.minWorkouts && xp >= tier.minXp;
}

/**
 * Compute the result of a league member's final standing.
 *
 * Display-side mirror of `resolve_league_bracket_internal` (migration 310).
 * The server is authoritative — this exists so the UI can show someone what
 * their current position would pay if the week ended now.
 *
 * @param {string} tierId — the league's tier
 * @param {number} rank — 1-indexed rank AMONG QUALIFIED MEMBERS (1 = first)
 * @param {number} qualifiedCount — how many members qualified
 * @param {object} [opts]
 * @param {boolean} [opts.qualified=true] — false for an unranked member
 * @param {boolean} [opts.hasShield=false] — holds one demotion
 * @returns {{ outcome: 'promote'|'demote'|'hold'|'unranked', newTier: string,
 *             coinsAwarded: number, capsuleAwarded: string|null, shielded: boolean }}
 */
export function resolveStanding(tierId, rank, qualifiedCount, opts = {}) {
  const { qualified = true, hasShield = false } = opts;
  const nothing = {
    outcome: 'hold', newTier: tierId, coinsAwarded: 0,
    capsuleAwarded: null, shielded: false,
  };

  if (!tierId || !getTier(tierId)) return nothing;
  const tier = getTier(tierId);

  // Didn't train — not competing. No rank, no reward, no promotion, ever.
  if (!qualified) {
    return { ...nothing, outcome: 'unranked' };
  }
  if (!rank || !qualifiedCount) return nothing;

  const promoteN = promoteCount(tierId, qualifiedCount);
  const demoteN = demoteCount(tierId, qualifiedCount);

  if (promoteN > 0 && rank <= promoteN) {
    const next = nextTier(tierId);
    return {
      outcome: 'promote',
      newTier: next ? next.id : tierId,
      // First place takes a 1.5× purse; the rest of the zone takes tier rate.
      coinsAwarded: rank === 1
        ? Math.floor((tier.rewardCoins * 3) / 2)
        : tier.rewardCoins,
      capsuleAwarded: tier.rewardCapsule,
      shielded: false,
    };
  }

  if (demoteN > 0 && rank > qualifiedCount - demoteN) {
    if (hasShield) {
      return { ...nothing, shielded: true };
    }
    const prev = previousTier(tierId);
    return {
      outcome: 'demote',
      newTier: prev ? prev.id : tierId,
      coinsAwarded: 0,
      capsuleAwarded: null,
      shielded: false,
    };
  }

  // Qualified and mid-table. This paid nothing before 310, which is ~90% of a
  // full bracket getting no signal that the week happened at all.
  return {
    outcome: 'hold',
    newTier: tierId,
    coinsAwarded: Math.max(1, Math.floor(tier.rewardCoins / 4)),
    capsuleAwarded: null,
    shielded: false,
  };
}

/** Returns the user-visible label for an outcome enum. */
export function outcomeLabel(outcome) {
  if (outcome === 'promote') return 'Promoted';
  if (outcome === 'demote') return 'Demoted';
  if (outcome === 'unranked') return 'Not qualified';
  if (outcome === 'decayed') return 'Dropped for inactivity';
  return 'Held position';
}
