// src/lib/pity.js
//
// Personal-best and open-history stats derived from user_capsules.
//
// HISTORY: this file used to compute the "opens since your last Epic+"
// streak client-side, and carried a prominent warning that the number was
// a MIRROR and not a MECHANIC — Flexyn had no pity, rolls were
// independent, and a streak counter sitting under a drop-rate table could
// very easily be misread as "I'm due".
//
// Migration 256 made it a mechanic. The server now owns the counters AND
// the guarantees (30 opens for epic+, 90 for legendary+, soft pity from
// 61), and CapsuleStreak reads them from get_capsule_pity() rather than
// deriving them here — the server has to be the authority, because the UI
// is promising something it must actually honour.
//
// What's left here is the part the server does NOT track: personal bests
// and lifetime open count.

// Anything at or above Epic is what a user is actually chasing — the
// Standard capsule's combined epic+ odds are 2%, so this is the streak
// worth surfacing.
export const GOOD_RARITIES = new Set(['epic', 'legendary', 'mythic', 'animated']);

/**
 * Reduce opened-capsule rows into streak stats.
 *
 * Rows are expected newest-first (that's how listOpenHistory returns
 * them); this re-sorts defensively rather than trusting call-site order,
 * because reading the streak off a mis-ordered array produces a number
 * that looks plausible and is simply wrong.
 *
 * @param {Array<{rolled_rarity?:string, opened_at?:string, earned_at?:string}>} rows
 * @returns {{opens:number, sinceGood:number|null, bestRarity:string|null,
 *            lastGoodAt:string|null, hasHistory:boolean}}
 *   sinceGood is null when the user has never pulled Epic+ — "47 opens,
 *   none yet" is a different statement from "47 since the last one" and
 *   the UI renders them differently.
 */
export function computePity(rows) {
  const usable = (rows ?? []).filter(r => r && r.rolled_rarity);
  if (usable.length === 0) {
    return { opens: 0, sinceGood: null, bestRarity: null, lastGoodAt: null, hasHistory: false };
  }

  const when = (r) => new Date(r.opened_at || r.earned_at || 0).getTime();
  const sorted = [...usable].sort((a, b) => when(b) - when(a)); // newest first

  let sinceGood = null;
  let lastGoodAt = null;
  let streak = 0;
  for (const row of sorted) {
    if (GOOD_RARITIES.has(row.rolled_rarity)) {
      sinceGood = streak;
      lastGoodAt = row.opened_at || row.earned_at || null;
      break;
    }
    streak += 1;
  }

  // Rarest thing ever pulled, for the "personal best" line.
  const LADDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'animated'];
  let bestRarity = null;
  let bestIdx = -1;
  for (const row of sorted) {
    const idx = LADDER.indexOf(row.rolled_rarity);
    if (idx > bestIdx) { bestIdx = idx; bestRarity = row.rolled_rarity; }
  }

  return {
    opens: sorted.length,
    sinceGood,
    bestRarity,
    lastGoodAt,
    hasHistory: true,
  };
}
