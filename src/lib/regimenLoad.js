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
// CORRECTION 2026-08-12: "set on every exercise of every public regimen"
// was true and is still true — of the four PUBLIC regimens. It does not
// generalise, and this module is now read by more than the store.
// `target_sets` is 212 of 212 across all 33 regimens, but `rest_seconds`
// is 44 of 212, concentrated in 6 regimens. Sizing the whole library from
// a four-row sample is what put a zero default in estimatedMinutes; see
// REST_SECONDS_DEFAULT below. Measure the population you actually serve,
// not the one the feature launched against.
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

// Rest to assume when an exercise carries none.
//
// This was 0, with a comment reasoning that "the work still happened, and
// dropping it would understate the session more than a zero rest does".
// That reasoning holds for ONE exercise missing rest among several. It is
// not the shape the data actually has.
//
// MEASURED against production 2026-08-12, all 33 regimens / 212 exercises:
//
//     rest on EVERY exercise    6 of 33 regimens
//     rest on NO exercise      27 of 33 regimens
//     partially covered         0 of 33 regimens
//
// It is bimodal, not sparse, and the reason is that there is exactly one
// writer and one entry path that skips it: `planBuilder.js` stamps
// `rest_seconds: ex.restSec ?? 90` on generated plans, while RegimenForm
// — the hand-built path — has no per-exercise rest field at all. (Its
// "Intra rest" / "Inter rest" inputs are group_meta on a superset, a
// different key, and group_id is 0 of 212 so they have never been used.)
//
// So a zero default did not shade the estimate, it broke it for 27 of 33
// regimens: they rendered an average of 14.4 min for sessions that take
// about 46.9. "Your Starter Plan: Build Strength" read ~24 min against a
// realistic ~78. A card confidently telling someone a 78-minute session
// takes 24 minutes is worse than one that says nothing, and this module's
// whole stated purpose is to stop the card rendering numbers that mean
// nothing.
//
// 90 s is not invented for this file. It is the app's own rest default in
// both places that already have one: FALLBACK_DURATION in
// RestTimerContext.jsx, and planBuilder's `?? 90`. Like
// WORK_SECONDS_PER_SET it is an assumption, and it is why every duration
// here is presented with a tilde.
export const REST_SECONDS_DEFAULT = 90;

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
    // A missing rest falls back to REST_SECONDS_DEFAULT, not to zero —
    // see the constant for the measured distribution that forced this.
    const rest = Number(ex?.rest_seconds);
    const restSec = Number.isFinite(rest) && rest > 0 ? rest : REST_SECONDS_DEFAULT;
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
    // Must mirror the fallback in estimatedMinutes. If this kept
    // returning 0 for a rest-less regimen, the deduction for the final
    // set would silently stop happening on exactly the 27 of 33 regimens
    // the default now covers.
    return Number.isFinite(rest) && rest > 0 ? rest : REST_SECONDS_DEFAULT;
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
