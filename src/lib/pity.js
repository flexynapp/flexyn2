// src/lib/pity.js
//
// "How long since something good?" — derived from your own open history.
//
// IMPORTANT, and the UI says this too: this is a MIRROR, not a MECHANIC.
// Flexyn has no pity system. claim_capsule_loot (migration 028) rolls
// independently every time, so 60 opens without an Epic does not make the
// next one likelier. What this fixes is that the odds disclosure tells you
// a Standard capsule is 0.2% legendary and then nothing ever tells you
// where you actually stand — the single most-read number on trackers like
// paimon.moe is exactly this one.
//
// Presenting a streak counter next to drop rates is a real risk of
// implying a guarantee, so the copy at the call site is explicit that
// every roll is independent. Don't soften that wording without also
// building the server-side pity it would then be describing.

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
