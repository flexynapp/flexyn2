// src/lib/running/paces.js
//
// Competitive-running pace engine. Turns a runner's current 5K time into the
// training paces + race splits a real coach would prescribe, so a "train for a
// faster 5K" plan carries specific targets instead of vague "hard effort" cues.
//
// Method (Jack Daniels' VDOT zones, expressed as offsets from 5K race pace —
// the model his Running Formula and every VDOT calculator use):
//   Easy/recovery  +75 s/mi   (conversational, 70–80% of weekly volume)
//   Long           +85 s/mi   (easy, time on feet)
//   Marathon       +45 s/mi   (steady, "comfortable")
//   Threshold/tempo +25 s/mi  (~1-hour race pace, "comfortably hard")
//   Interval (VO2) ≈ 5K pace  (3–5 min reps at ~95–100% VO2max)
//   Repetition     −18 s/mi   (economy/speed, mile-race pace, full recovery)
// Race equivalence + prediction use Riegel: T2 = T1 · (D2/D1)^1.06.
//
// Pure module — deterministic, no I/O. Fully unit-tested.

export const MILE_M = 1609.344;
export const FIVEK_M = 5000;
const FIVEK_MI = FIVEK_M / MILE_M; // 3.10686…
const RIEGEL = 1.06;

// Seconds-per-mile offset from 5K pace for each Daniels zone.
const OFFSET_PER_MILE = {
  easy: 75,
  long: 85,
  marathon: 45,
  threshold: 25,
  interval: 0,
  rep: -18,
};

/** Riegel race-time prediction/equivalence. */
export function predictSeconds(fromMeters, fromSeconds, toMeters) {
  if (!(fromMeters > 0) || !(fromSeconds > 0) || !(toMeters > 0)) return 0;
  return fromSeconds * Math.pow(toMeters / fromMeters, RIEGEL);
}

/** Convert any race (distance + time) to an equivalent 5K time in seconds. */
export function to5kSeconds(distanceMeters, seconds) {
  return Math.round(predictSeconds(distanceMeters, seconds, FIVEK_M));
}

/** m:ss from seconds (paces or short times). */
export function formatPace(secPer) {
  const s = Math.max(0, Math.round(Number(secPer) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
export const formatClock = formatPace;

/**
 * Training paces from a current 5K time (seconds). Each zone returns
 * { perMile, perKm } in seconds.
 */
export function paceZones(fiveKSeconds) {
  const perMile5k = (Number(fiveKSeconds) || 0) / FIVEK_MI;
  const zones = {};
  for (const [zone, off] of Object.entries(OFFSET_PER_MILE)) {
    const perMile = perMile5k + off;
    zones[zone] = { perMile, perKm: perMile / (MILE_M / 1000) };
  }
  return zones;
}

/**
 * A realistic faster-5K goal. Default ~2.5% quicker, but clamp the per-mile
 * gain to a sane 5–45 s/mi so we never promise the impossible or the trivial.
 */
export function goalFiveK(currentSeconds, { improvementPct = 2.5 } = {}) {
  const cur = Number(currentSeconds) || 0;
  if (cur <= 0) return 0;
  let gainPerMile = (cur / FIVEK_MI) * (improvementPct / 100);
  gainPerMile = Math.max(5, Math.min(45, gainPerMile));
  return Math.round(cur - gainPerMile * FIVEK_MI);
}

/** Race splits for a target 5K time. */
export function fiveKSplits(goalSeconds) {
  const total = Number(goalSeconds) || 0;
  const perMile = total / FIVEK_MI;
  const perKm = total / 5;
  return { total, perMile, perKm, per400: perKm * 0.4, halfway: total / 2 };
}

/** Target time for a single rep of `meters` at a given per-km pace. */
export function repTime(perKmSeconds, meters) {
  return (Number(perKmSeconds) || 0) * (meters / 1000);
}

/**
 * One-call summary for plan builders: given a current 5K time, return the
 * zones, a faster goal, and that goal's splits — everything the cardio session
 * details and the plan header need.
 */
export function runningTargets(currentFiveKSeconds, opts = {}) {
  const current = Math.max(0, Math.round(Number(currentFiveKSeconds) || 0));
  const goal = goalFiveK(current, opts);
  return {
    currentFiveKSeconds: current,
    goalFiveKSeconds: goal,
    zones: paceZones(current),
    goalSplits: fiveKSplits(goal),
  };
}
