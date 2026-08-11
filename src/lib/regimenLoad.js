// src/lib/regimenLoad.js
//
// What a regimen COSTS you: how many sets, and roughly how long.
//
// This exists because the store had nothing true to sort or describe
// regimens by. `difficulty` is NULL on every public row and `copy_count`
// is 0 on every public row, so the two signals the card leaned on could
// only ever render a blank or a zero. `target_sets` and `rest_seconds`,
// meanwhile, are set on every exercise of every public regimen — enough
// to answer the question a browser actually has, which is "can I fit
// this today?". See docs/penpot-explore-regimens-board.js for the
// measurements and the board this came from.
//
// Nothing here is persisted. It is derived at render time from the
// `exercises` JSONB the card already holds, so it needs no column, no
// backfill and no input from the regimen's author.

// Seconds of actual work in one set, used only to turn rest into a
// duration. It is an ASSUMPTION, not data — the one invented number in
// this calculation — which is why every duration this module produces is
// presented with a tilde. It lives here, named, rather than inline at a
// call site so that changing it is one edit and so that nobody mistakes
// it for something measured.
//
// 40 s covers a working set of 6-12 reps at a controlled tempo plus the
// walk to and from the rack. Sets outside that range are wrong in both
// directions and the tilde is doing that work.
export const WORK_SECONDS_PER_SET = 40;

// Below this many sets a duration is more noise than signal — a
// one-exercise regimen is not a "session" whose length means anything.
const MIN_SETS_FOR_DURATION = 3;

/**
 * Total prescribed sets across a regimen's exercises.
 * Returns 0 when nothing carries a set count, which callers must treat
 * as "don't render", never as "zero sets".
 */
export function totalSets(regimen) {
  const list = regimen?.exercises;
  if (!Array.isArray(list)) return 0;
  return list.reduce((sum, ex) => {
    const sets = Number(ex?.target_sets);
    return sum + (Number.isFinite(sets) && sets > 0 ? sets : 0);
  }, 0);
}

/**
 * Rough session length in minutes, or null when it cannot be derived.
 *
 * Returns null rather than 0 in every degenerate case. A "0 min" badge on
 * a real regimen reads as a broken app, and the whole point of this
 * module is to stop the card rendering numbers that mean nothing — it
 * would be an odd way to fail.
 */
export function estimatedMinutes(regimen) {
  const list = regimen?.exercises;
  if (!Array.isArray(list) || list.length === 0) return null;

  let seconds = 0;
  let counted = 0;
  for (const ex of list) {
    const sets = Number(ex?.target_sets);
    if (!Number.isFinite(sets) || sets <= 0) continue;
    // A missing rest is treated as no rest rather than skipping the
    // exercise: the work still happened, and dropping it would
    // understate the session more than a zero rest does.
    const rest = Number(ex?.rest_seconds);
    const restSec = Number.isFinite(rest) && rest > 0 ? rest : 0;
    seconds += sets * (restSec + WORK_SECONDS_PER_SET);
    counted += sets;
  }
  if (counted < MIN_SETS_FOR_DURATION) return null;

  // The last set of the session has no rest after it. Left in, a
  // 28-set session is overstated by ~1.5 min, which is inside the
  // tilde — but it is free to remove and the number is closer without it.
  const lastRest = lastRestSeconds(list);
  const total = Math.max(0, seconds - lastRest);
  return Math.max(1, Math.round(total / 60));
}

function lastRestSeconds(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    const sets = Number(list[i]?.target_sets);
    if (!Number.isFinite(sets) || sets <= 0) continue;
    const rest = Number(list[i]?.rest_seconds);
    return Number.isFinite(rest) && rest > 0 ? rest : 0;
  }
  return 0;
}

/**
 * Everything the store card needs about a regimen's cost, in one call.
 *
 *   { exercises, sets, minutes }
 *
 * `sets` is 0 and `minutes` is null when they cannot be derived; the card
 * drops those fragments from its cost line rather than rendering a zero.
 */
export function regimenLoad(regimen) {
  const exercises = Array.isArray(regimen?.exercises) ? regimen.exercises.length : 0;
  return {
    exercises,
    sets: totalSets(regimen),
    minutes: estimatedMinutes(regimen),
  };
}
