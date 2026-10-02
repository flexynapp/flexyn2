// src/lib/capsuleClimb.js
//
// The script for the "crack it" capsule open. The server has already rolled
// the item; this decides only how the reveal of that roll is paced, one tap
// at a time, so the open is something the user does rather than watches.
//
// Every open starts at Common. Each tap is a strike, and a strike either
// climbs one rarity, or opens the canister on what it has reached. So a
// Common opens on the first tap, and a Legendary climbs four times before it
// opens. The climb never goes past the real rarity and never stops short of
// it: the ladder only ever tells the truth, just a step at a time.
//
// A "hold" keeps the hundredth open from feeling scripted: now and then a
// strike cracks the shell and decides nothing, so the rhythm of taps is not
// a readout of the rarity. At most one per open, and never on a
// Legendary-or-better climb, which is long enough.
//
// There is deliberately no near miss. An earlier draft flickered the next
// rung on before the lid went, which is a slot machine's trick: it shows a
// win that was never possible, it sits badly beside the exact odds the
// capsule publishes, and App Review reads it as loot-box pressure. The
// ladder only ever lights a rung the roll actually reached.
//
// Pure: no React, no timers. `rng` is injectable so tests can pin it.

export const CLIMB_LADDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'animated'];

/** Ladder index for a rarity. Mythic shares Legendary's rung. */
export function climbRank(rarity) {
  if (rarity === 'mythic') return CLIMB_LADDER.indexOf('legendary');
  const i = CLIMB_LADDER.indexOf(rarity);
  return i < 0 ? 0 : i;
}

const HOLD_CHANCE = 0.22;

/**
 * The strikes for one open, in order.
 *
 * @param {string} rarity           what the server rolled
 * @param {object} [opts]
 * @param {() => number} [opts.rng] Math.random by default
 * @returns {Array<{ kind: 'climb'|'hold'|'open', to?: string }>}
 *   `to` on a climb is the rarity it reaches; on the open it is the rarity
 *   it opens on (the real one, or 'mythic' for a mythic roll).
 */
export function climbPlan(rarity, { rng = Math.random } = {}) {
  const top = climbRank(rarity);
  const strikes = [];
  const holdAt = top < climbRank('legendary') && rng() < HOLD_CHANCE
    ? Math.floor(rng() * (top + 1))
    : -1;
  for (let i = 0; i < top; i++) {
    if (i === holdAt) strikes.push({ kind: 'hold' });
    strikes.push({ kind: 'climb', to: CLIMB_LADDER[i + 1] });
  }
  if (holdAt === top) strikes.push({ kind: 'hold' });
  strikes.push({ kind: 'open', to: rarity === 'mythic' ? 'mythic' : CLIMB_LADDER[top] });
  return strikes;
}
