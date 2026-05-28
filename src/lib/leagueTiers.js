// src/lib/leagueTiers.js
//
// Configuration for the weekly league tiers. Each tier has:
//   • A display name + color
//   • A promotion count (top N members advance to the next tier)
//   • A demotion count (bottom N members fall to the previous tier)
//   • An end-of-week reward (coins + optional capsule)
//
// Tiers are ordered bronze → silver → gold → platinum → diamond → legend.

export const MAX_LEAGUE_SIZE = 30;

export const TIERS = [
  {
    id: 'bronze',
    label: 'Bronze',
    icon: '🥉',
    color: '#cd7f32',
    // Lighter, slightly polished bronze — shifts the previous very-dark
    // brown ramp (orange-700 → yellow-800) up two steps so it reads as
    // "shiny patina" instead of "rust." Pairs with a bronze ring border
    // on the card to outline it without making it look heavy.
    gradient: 'from-amber-500 via-orange-500 to-yellow-700',
    ringClass: 'ring-1 ring-amber-400/60',
    promote: 10,
    demote: 0, // never demoted out of bronze
    rewardCoins: 50,
    rewardCapsule: null,
  },
  {
    id: 'silver',
    label: 'Silver',
    icon: '🥈',
    color: '#c0c0c0',
    gradient: 'from-slate-300 via-slate-400 to-slate-500',
    promote: 10,
    demote: 5,
    rewardCoins: 100,
    rewardCapsule: null,
  },
  {
    id: 'gold',
    label: 'Gold',
    icon: '🥇',
    color: '#facc15',
    gradient: 'from-yellow-300 via-amber-400 to-yellow-600',
    promote: 7,
    demote: 5,
    rewardCoins: 200,
    rewardCapsule: 'standard',
  },
  {
    id: 'platinum',
    label: 'Platinum',
    icon: '💠',
    color: '#67e8f9',
    gradient: 'from-cyan-300 via-teal-400 to-cyan-600',
    promote: 5,
    demote: 5,
    rewardCoins: 350,
    rewardCapsule: 'premium',
  },
  {
    id: 'diamond',
    label: 'Diamond',
    icon: '💎',
    color: '#a5b4fc',
    gradient: 'from-indigo-300 via-violet-400 to-purple-500',
    promote: 3,
    demote: 5,
    rewardCoins: 600,
    rewardCapsule: 'premium',
  },
  {
    id: 'legend',
    label: 'Legend',
    icon: '👑',
    color: '#f0abfc',
    gradient: 'from-fuchsia-400 via-rose-400 to-pink-500',
    promote: 0, // already at the top — top finishers get the elite capsule
    demote: 5,
    rewardCoins: 1000,
    rewardCapsule: 'elite',
  },
];

const TIER_INDEX = Object.fromEntries(TIERS.map((t, i) => [t.id, i]));

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
 * Compute the result of a league member's final standing.
 *
 * @param {string} tierId — the league's tier
 * @param {number} rank — 1-indexed final rank (1 = first place)
 * @param {number} totalMembers — how many members were in the league
 * @returns {{ outcome: 'promote'|'demote'|'stay', newTier: string, coinsAwarded: number, capsuleAwarded: string|null }}
 */
export function resolveStanding(tierId, rank, totalMembers) {
  // Guard against missing inputs explicitly — getTier(null) falls back to
  // bronze, but here we want callers passing null/undefined to no-op.
  if (!tierId || !rank || !totalMembers) {
    return { outcome: 'stay', newTier: tierId, coinsAwarded: 0, capsuleAwarded: null };
  }
  const tier = getTier(tierId);
  if (!tier) {
    return { outcome: 'stay', newTier: tierId, coinsAwarded: 0, capsuleAwarded: null };
  }

  // Promote zone: top `tier.promote` finishers
  if (tier.promote > 0 && rank <= tier.promote) {
    const next = nextTier(tierId);
    return {
      outcome: 'promote',
      newTier: next ? next.id : tierId,
      coinsAwarded: tier.rewardCoins,
      capsuleAwarded: tier.rewardCapsule,
    };
  }

  // Demote zone: bottom `tier.demote` finishers (counted from the end)
  if (tier.demote > 0 && rank > totalMembers - tier.demote) {
    const prev = previousTier(tierId);
    return {
      outcome: 'demote',
      newTier: prev ? prev.id : tierId,
      coinsAwarded: 0,
      capsuleAwarded: null,
    };
  }

  // Top of legend: capped — but still award the legend reward to the very top
  if (tierId === 'legend' && rank <= 3) {
    return {
      outcome: 'stay',
      newTier: tierId,
      coinsAwarded: tier.rewardCoins,
      capsuleAwarded: tier.rewardCapsule,
    };
  }

  return { outcome: 'stay', newTier: tierId, coinsAwarded: 0, capsuleAwarded: null };
}

/** Returns the user-visible label for an outcome enum. */
export function outcomeLabel(outcome) {
  if (outcome === 'promote') return 'Promoted';
  if (outcome === 'demote')  return 'Demoted';
  return 'Held position';
}
