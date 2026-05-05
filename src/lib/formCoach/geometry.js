// src/lib/formCoach/geometry.js
//
// Pure 2D geometry helpers for pose-based form analysis. All keypoints are
// `{ x, y, score }` where x/y are pixel coordinates in the captured image and
// score is detection confidence in [0, 1].

/** Distance between two keypoints. */
export function distance(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Midpoint of two keypoints (no confidence — caller checks both). */
export function midpoint(a, b) {
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Interior angle (degrees) at vertex `b` formed by ray b→a and ray b→c.
 * Returns null if any input is missing.
 *
 * Example: knee angle = angleAt(hip, knee, ankle)
 *   Standing leg straight  → ~180°
 *   Squat parallel         → ~90°
 *   ATG (ass-to-grass)     → ~50°
 */
export function angleAt(a, b, c) {
  if (!a || !b || !c) return null;
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const magA = Math.hypot(ab.x, ab.y);
  const magC = Math.hypot(cb.x, cb.y);
  if (magA === 0 || magC === 0) return null;
  const cos = Math.max(-1, Math.min(1, dot / (magA * magC)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Angle of the line from a→b relative to vertical (y-axis), in degrees.
 *   Vertical (b directly below a) → 0
 *   Horizontal                    → 90
 *   45° forward lean              → 45
 */
export function angleFromVertical(a, b) {
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // atan2 of horizontal over vertical — positive y is "down" in image space
  return Math.abs((Math.atan2(dx, dy) * 180) / Math.PI);
}

/**
 * Confidence-aware lookup. Returns the keypoint only if its score is at or
 * above `min`. Most rule-based checks need ≥0.3; full body analysis needs
 * ≥0.4 across all major joints.
 */
export function ifConfident(kp, min = 0.3) {
  if (!kp) return null;
  return kp.score >= min ? kp : null;
}

/**
 * How well-detected the user's full body is, 0–1. Used to gate analysis —
 * if the score is too low we ask the user to reposition or improve lighting.
 *
 * Weighted toward the main 12 joints used by the analyzers.
 */
export function bodyDetectionScore(kp) {
  const KEY_JOINTS = [
    'left_shoulder', 'right_shoulder',
    'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist',
    'left_hip', 'right_hip',
    'left_knee', 'right_knee',
    'left_ankle', 'right_ankle',
  ];
  let total = 0;
  let n = 0;
  for (const name of KEY_JOINTS) {
    const k = kp[name];
    if (k && typeof k.score === 'number') {
      total += k.score;
      n += 1;
    }
  }
  return n > 0 ? total / n : 0;
}

/** Convert MoveNet's keypoint array into a name → keypoint map. */
export function keypointsToMap(keypointsArr) {
  const out = {};
  for (const k of keypointsArr || []) {
    if (k.name) out[k.name] = { x: k.x, y: k.y, score: k.score };
  }
  return out;
}

/** Pick whichever side has higher visibility for a paired joint. */
export function bestSide(kp, leftName, rightName) {
  const l = kp[leftName];
  const r = kp[rightName];
  if (!l && !r) return null;
  if (!l) return { side: 'right', kp: r };
  if (!r) return { side: 'left', kp: l };
  return l.score >= r.score ? { side: 'left', kp: l } : { side: 'right', kp: r };
}
