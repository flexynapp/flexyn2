// src/lib/exerciseLoop.js
//
// Turns an exercise's three drawn positions (start, middle, end) into one
// continuous rep, for the looping figure in the exercise guide. Pure: no
// React, no timers. The component owns the clock.
//
// The rep is slow on purpose and shaped like coaching, not like a
// metronome: two seconds down to the hard position, a short pause there,
// one second back up, a breath at the top. The pause is when the figure
// goes orange, the same orange the still guide gives its middle panel,
// because the middle is the position people get wrong.
//
// Poses store ABSOLUTE joint angles, so 350 to 10 must turn 20 degrees,
// not 340 the long way round. `hip` and `handAt` are points and blend
// straight. Anything that is not a number (the implement, the support)
// cannot blend, so it must be the same in all three frames or the
// exercise is not looped (see canLoop).

/** Seconds per leg: down, hold at the bottom, up, rest at the top. */
export const REP_LEGS = [
  { from: 0, to: 1, seconds: 2.0, label: 1, hold: false },
  { from: 1, to: 1, seconds: 0.25, label: 1, hold: true },
  { from: 1, to: 2, seconds: 1.0, label: 2, hold: false },
  { from: 2, to: 2, seconds: 0.6, label: 0, hold: false },
];

export const REP_SECONDS = REP_LEGS.reduce((s, l) => s + l.seconds, 0);

// Not angles even though they are numbers.
const DISCRETE = new Set(['armBend', 'prop', 'support', 'propAt']);

const turn = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

/** Blend two poses. `t` from 0 (a) to 1 (b). */
export function blendPose(a, b, t) {
  const out = { ...a };
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const va = a[k];
    const vb = b[k];
    if (Array.isArray(va) && Array.isArray(vb)) out[k] = va.map((x, i) => x + (vb[i] - x) * t);
    else if (typeof va === 'number' && typeof vb === 'number' && !DISCRETE.has(k)) out[k] = turn(va, vb, t);
    else out[k] = va ?? vb;
  }
  return out;
}

/**
 * Whether three frames can play as one rep. False when a frame changes
 * something that cannot blend: which way the elbow folds (four presses
 * flip it), the implement, or what the figure is supported by. Those keep
 * the still guide rather than snapping mid-rep.
 */
export function canLoop(frames) {
  if (!Array.isArray(frames) || frames.length !== 3) return false;
  const keys = (f) => Object.keys(f).sort().join(',');
  if (new Set(frames.map(keys)).size !== 1) return false;
  for (const k of DISCRETE) {
    if (new Set(frames.map((f) => f[k])).size > 1) return false;
  }
  return true;
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2);

/**
 * The figure at `seconds` into the loop (wraps).
 * @returns {{ pose: object, label: number, hold: boolean }}
 */
export function poseAt(frames, seconds) {
  let s = ((Number(seconds) || 0) % REP_SECONDS + REP_SECONDS) % REP_SECONDS;
  for (const leg of REP_LEGS) {
    if (s <= leg.seconds) {
      const t = ease(leg.seconds ? s / leg.seconds : 1);
      return { pose: blendPose(frames[leg.from], frames[leg.to], t), label: leg.label, hold: leg.hold };
    }
    s -= leg.seconds;
  }
  return { pose: frames[0], label: 0, hold: false };
}
