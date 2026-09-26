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

/**
 * MediaPipe Pose Landmarker returns 33 landmarks by index. The analyzers were
 * written against MoveNet's 17 named keypoints, and MediaPipe's 33 are a
 * superset of those, so we name exactly the ones MoveNet had and ignore the
 * rest (mouth, fingers, heels, foot tips). If a rule ever
 * needs a heel or foot index, add it here under a new name.
 */
export const POSE_LANDMARK_INDEX = {
  nose: 0,
  left_eye: 2,
  right_eye: 5,
  left_ear: 7,
  right_ear: 8,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28,
};

/**
 * Convert one pose's MediaPipe landmarks into a name → keypoint map.
 *
 * MediaPipe coordinates are normalised to [0, 1]; the rules measure some
 * things in PIXELS (the pull-up chin check allows 20px), so we scale back to
 * the image size to keep those thresholds meaning what they meant. Its
 * `visibility` is the per-joint confidence that MoveNet called `score`.
 *
 * A landmark placed outside the image gets score 0 whatever its visibility:
 * MediaPipe extrapolates joints past the edge of a close-up (a knee at
 * x = -35 with visibility 0.5 was measured) and the rules must not read
 * a guessed joint as a seen one.
 */
const EDGE_MARGIN = 0.02;

function inFrame(l) {
  return l.x >= -EDGE_MARGIN && l.x <= 1 + EDGE_MARGIN
    && l.y >= -EDGE_MARGIN && l.y <= 1 + EDGE_MARGIN;
}

export function landmarksToMap(landmarks, width = 1, height = 1) {
  const out = {};
  if (!Array.isArray(landmarks)) return out;
  for (const [name, i] of Object.entries(POSE_LANDMARK_INDEX)) {
    const l = landmarks[i];
    if (!l) continue;
    out[name] = {
      x: l.x * width,
      y: l.y * height,
      score: typeof l.visibility === 'number' && inFrame(l) ? l.visibility : 0,
    };
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
