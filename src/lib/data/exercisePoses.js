// src/lib/data/exercisePoses.js
//
// Start / middle / end positions for the catalog exercises, as joint angles.
//
// See components/exercise/ExerciseFigure.jsx for the coordinate convention.
// The short version: DEGREES, clockwise, 0 points DOWN the screen, 90 points
// right, 180 points up. Angles are absolute, not relative to the parent limb,
// because absolute angles are what a person can actually author by hand.
//
// The figure faces RIGHT in every side-view pose. Keep it that way — a set of
// diagrams where some face left reads as a mistake even when each one is
// individually correct.
//
// WHAT THE MIDDLE FRAME IS FOR. It is not "halfway through the rep", it is the
// position people get wrong: the bottom of a squat, the bottom of a push-up,
// the moment a plank's hips sag. If a movement has no interesting middle, give
// it the loaded position rather than an interpolation nobody needs to see.
//
// ADDING ONE. Copy the nearest existing entry and adjust. Render the contact
// sheet (scripts/pose-sheet.mjs) and look at it — joint angles that read fine
// as numbers are wrong on screen more often than you would expect, and there
// is no substitute for looking.

/** @typedef {{hip?: number[], torso?: number, head?: number,
 *   shoulderNear?: number, shoulderFar?: number, elbowNear?: number, elbowFar?: number,
 *   hipNear?: number, hipFar?: number, kneeNear?: number, kneeFar?: number,
 *   ankleNear?: number, ankleFar?: number}} Pose */

// Feet land on the floor line (y=182) rather than floating above it: thigh 26
// + shin 25 = 51, so a standing hip sits at 182 - 51 = 131. Getting this wrong
// is invisible in the numbers and glaring on screen — the whole figure hovers.
//
// Arms are splayed a few degrees off the torso on purpose. Hanging them at 0
// puts them exactly behind it and the figure renders with no arms at all.
// Feet land on the floor line (y=182): thigh 26 + shin 25 = 51, so a standing
// hip sits at 131. Getting this wrong is invisible in the numbers and glaring
// on screen — the whole figure hovers.
//
// Arms splay a few degrees off the torso on purpose. At exactly 0 they render
// behind it and the figure has no arms.
//
// GRIPPING MOVEMENTS USE `handAt`, NOT ARM ANGLES. Where the hands hold
// something fixed — a pull-up bar, dip rails, a bench edge — the pose states
// the hand POSITION and inverse kinematics finds the angles. Forward angles
// cannot hold contact: the body moves between frames, so the hand drifted off
// the bar and the lifter appeared to let go halfway up the rep.
// `armBend` picks which way the elbow folds (+1 / -1).
const STANDING = {
  hip: [100, 131], torso: 180, head: 180,
  shoulderNear: 14, shoulderFar: 346, elbowNear: 10, elbowFar: 350,
  hipNear: 4, hipFar: 356, kneeNear: 2, kneeFar: 358,
  ankleNear: 90, ankleFar: 90,
};
const LEGS_STAND = { hipNear: 4, hipFar: 356, kneeNear: 2, kneeFar: 358, ankleNear: 90, ankleFar: 90 };
const PRONE_LEGS = { hipNear: 292, hipFar: 296, kneeNear: 292, kneeFar: 296, ankleNear: 30, ankleFar: 30 };
// Lying face-up on a bench: hips on the pad, knees bent, feet down to the floor.
const SUPINE_LEGS = { hipNear: 96, hipFar: 100, kneeNear: 20, kneeFar: 24, ankleNear: 90, ankleFar: 90 };
// Seated: thighs forward, shins down.
const SEATED_LEGS = { hipNear: 88, hipFar: 92, kneeNear: 4, kneeFar: 8, ankleNear: 90, ankleFar: 90 };

/** Standing, holding an implement — the pose only varies by where the hands are. */
const standHold = (prop, handY, extra = {}) => ({
  prop, hip: [100, 131], torso: 180, head: 180,
  handAt: [115, handY], armBend: -1, ...LEGS_STAND, ...extra,
});
/**
 * Lying on a bench, pressing — hands travel vertically.
 *
 * NO `propAt`. It said `propAt: 'hip'`, which drew the barbell across the lifter's
 * WAIST while both arms reached up holding nothing — the identical mistake seatHold
 * records two comments below, made twice because the note lived on the wrong helper.
 * Dumbbells hid it: propMarkup draws those from the solved hands and ignores the
 * anchor entirely, so only the two barbell movements showed the bug.
 *
 * The shoulder sits at (92, 151), so a hand may not be more than 40 units from there
 * — see the REACH check. Every handY here used to exceed it and was silently clamped.
 */
const benchHold = (prop, hand, extra = {}) => ({
  prop, hip: [126, 150], torso: 272, head: 272,
  handAt: hand, armBend: 1, ...SUPINE_LEGS, ...extra,
});
/** Seated on a bench/machine. */
// Seated. No propAt: the cable or bar must reach the HAND, and anchoring it
// at the hip ran the cable to the lifter's waist.
const seatHold = (prop, hand, extra = {}) => ({
  prop, hip: [92, 150], torso: 180, head: 180,
  handAt: hand, armBend: -1, ...SEATED_LEGS, ...extra,
});

const rep3 = (a, b) => [a, b, a];

export const POSES = {
  // ── Bodyweight ────────────────────────────────────────────────────────────
  'Bodyweight Squat': { labels: ['Stand tall', 'Hips below knees', 'Drive up'], frames: rep3(
    STANDING,
    { hip: [86, 152], torso: 146, head: 156,
      shoulderNear: 104, shoulderFar: 96, elbowNear: 100, elbowFar: 92,
      hipNear: 80, hipFar: 74, kneeNear: 340, kneeFar: 334, ankleNear: 90, ankleFar: 90 }) },

  'Push-up': { labels: ['Arms locked', 'Chest to floor', 'Press back up'], frames: rep3(
    { hip: [86, 150], torso: 100, head: 100, handAt: [124, 182], armBend: -1, ...PRONE_LEGS },
    { hip: [86, 160], torso: 96, head: 96, handAt: [124, 182], armBend: -1, ...PRONE_LEGS }) },

  'Plank': { labels: ['Set the line', 'Hold — hips level', 'Hips sagging (wrong)'], frames: [
    { hip: [86, 158], torso: 95, head: 95, handAt: [140, 182], armBend: -1,
      hipNear: 276, hipFar: 280, kneeNear: 276, kneeFar: 280, ankleNear: 30, ankleFar: 30 },
    { hip: [86, 158], torso: 95, head: 95, handAt: [140, 182], armBend: -1,
      hipNear: 276, hipFar: 280, kneeNear: 276, kneeFar: 280, ankleNear: 30, ankleFar: 30 },
    { hip: [86, 172], torso: 80, head: 90, handAt: [140, 182], armBend: -1,
      hipNear: 266, hipFar: 270, kneeNear: 266, kneeFar: 270, ankleNear: 26, ankleFar: 26 } ] },

  // The back leg drops STRAIGHT down and the shin runs BACKWARD to the toe. It used
  // to angle the thigh back and the shin forward, which is a knee bending the wrong
  // way — see the KNEE check in pose-check.mjs.
  'Lunge': { labels: ['Stand tall', 'Back knee low', 'Push back to stand'], frames: rep3(
    STANDING,
    { hip: [96, 146], torso: 178, head: 178,
      shoulderNear: 16, shoulderFar: 344, elbowNear: 12, elbowFar: 348,
      hipNear: 52, hipFar: 2, kneeNear: 352, kneeFar: 275, ankleNear: 90, ankleFar: 320 }) },

  'Pike Push-up': { labels: ['Hips high, V shape', 'Crown toward floor', 'Press back up'], frames: rep3(
    { hip: [112, 118], torso: 300, head: 300, handAt: [72, 173], armBend: -1,
      hipNear: 12, hipFar: 16, kneeNear: 12, kneeFar: 16, ankleNear: 90, ankleFar: 90 },
    { hip: [112, 118], torso: 306, head: 302, handAt: [73, 175], armBend: 1,
      hipNear: 12, hipFar: 16, kneeNear: 12, kneeFar: 16, ankleNear: 90, ankleFar: 90 }) },

  'Calf Raise': { labels: ['Flat feet', 'Up on the toes', 'Lower under control'], frames: rep3(
    STANDING, { ...STANDING, hip: [100, 120], ankleNear: 44, ankleFar: 44 }) },

  'Russian Twist': { labels: ['Seated, leaning back', 'Rotate across', 'Rotate back'], frames: [
    { hip: [78, 162], torso: 142, head: 146, shoulderNear: 96, shoulderFar: 88, elbowNear: 92, elbowFar: 84,
      hipNear: 95, hipFar: 89, kneeNear: 15, kneeFar: 9, ankleNear: 90, ankleFar: 90 },
    { hip: [78, 162], torso: 142, head: 158, shoulderNear: 118, shoulderFar: 108, elbowNear: 116, elbowFar: 106,
      hipNear: 95, hipFar: 89, kneeNear: 15, kneeFar: 9, ankleNear: 90, ankleFar: 90 },
    { hip: [78, 162], torso: 142, head: 132, shoulderNear: 62, shoulderFar: 52, elbowNear: 58, elbowFar: 48,
      hipNear: 95, hipFar: 89, kneeNear: 15, kneeFar: 9, ankleNear: 90, ankleFar: 90 } ] },

  'Dead Bug': { labels: ['On your back, limbs up', 'Opposite arm and leg out', 'Return to start'], frames: rep3(
    { hip: [118, 172], torso: 268, head: 268, shoulderNear: 184, shoulderFar: 176, elbowNear: 184, elbowFar: 176,
      hipNear: 186, hipFar: 178, kneeNear: 96, kneeFar: 88, ankleNear: 40, ankleFar: 40 },
    { hip: [118, 172], torso: 268, head: 268, shoulderNear: 230, shoulderFar: 176, elbowNear: 234, elbowFar: 176,
      hipNear: 186, hipFar: 130, kneeNear: 96, kneeFar: 120, ankleNear: 40, ankleFar: 40 }) },

  // ── Needs a bar / rails ───────────────────────────────────────────────────
  // Both knees flex BACKWARD. The far leg used to bend forward to splay the two legs
  // apart for depth, which read as a hyperextended knee; the splay now comes from the
  // thigh instead, which is where it belongs.
  'Pull-up': { labels: ['Dead hang', 'Chin over the bar', 'Lower to full hang'], frames: rep3(
    { prop: 'bar-high', hip: [100, 122], torso: 180, head: 202, handAt: [118, 53], armBend: 1, ...LEGS_STAND, kneeNear: 340, hipFar: 20, kneeFar: 356 },
    { prop: 'bar-high', hip: [100, 86],  torso: 180, head: 205, handAt: [118, 53], armBend: 1, ...LEGS_STAND, kneeNear: 336, hipFar: 23, kneeFar: 355 }) },

  'Dips': { labels: ['Support, arms locked', 'Elbows to 90', 'Press back up'], frames: rep3(
    { prop: 'parallel-bars', hip: [100, 126], torso: 184, head: 182, handAt: [111, 129], armBend: -1,
      hipNear: 350, hipFar: 346, kneeNear: 300, kneeFar: 296, ankleNear: 90, ankleFar: 90 },
    { prop: 'parallel-bars', hip: [100, 146], torso: 184, head: 182, handAt: [111, 129], armBend: -1,
      hipNear: 350, hipFar: 346, kneeNear: 300, kneeFar: 296, ankleNear: 90, ankleFar: 90 }) },

  // Face UP under the bar: head to the right, legs running the OTHER way from
  // the hip to heels planted on the floor. The first version had torso and
  // legs both leaving the hip rightward, which folded the figure into a Z and
  // read as the back going to the bar rather than the chest.
  'Inverted Row': { labels: ['Hang under the bar', 'Chest to the bar', 'Lower under control'], frames: rep3(
    { prop: 'bar-low', hip: [96, 150], torso: 90, head: 90, handAt: [128, 112], armBend: 1,
      hipNear: 320, hipFar: 324, kneeNear: 300, kneeFar: 304, ankleNear: 90, ankleFar: 90 },
    { prop: 'bar-low', hip: [96, 142], torso: 90, head: 90, handAt: [128, 112], armBend: 1,
      hipNear: 323, hipFar: 327, kneeNear: 323, kneeFar: 327, ankleNear: 90, ankleFar: 90 }) },

  // Thighs come up to the chest and the shins HANG DOWN from the knees. They used to
  // point up, which is a knee folding forwards — and it also drew as a closed
  // rectangle rather than as a pair of legs.
  'Hanging Leg Raise': { labels: ['Dead hang', 'Knees to chest', 'Lower with control'], frames: rep3(
    { prop: 'bar-high', hip: [100, 122], torso: 180, head: 202, handAt: [118, 53], armBend: 1, ...LEGS_STAND },
    { prop: 'bar-high', hip: [100, 122], torso: 180, head: 202, handAt: [118, 53], armBend: 1,
      hipNear: 110, hipFar: 114, kneeNear: 20, kneeFar: 24, ankleNear: 90, ankleFar: 90 }) },

  'Tricep Dips': { labels: ['Arms locked, hips off', 'Elbows to 90', 'Press back up'], frames: rep3(
    { prop: 'bench-seat', hip: [110, 142], torso: 190, head: 186, handAt: [86, 140], armBend: 1,
      hipNear: 51, hipFar: 47, kneeNear: 51, kneeFar: 47, ankleNear: 90, ankleFar: 90 },
    { prop: 'bench-seat', hip: [110, 158], torso: 190, head: 186, handAt: [86, 140], armBend: 1,
      hipNear: 51, hipFar: 47, kneeNear: 51, kneeFar: 47, ankleNear: 90, ankleFar: 90 }) },

  // ── Barbell, standing ─────────────────────────────────────────────────────
  'Back Squat': { labels: ['Bar on the back', 'Hips below knees', 'Drive up'], frames: rep3(
    { prop: 'barbell', hip: [100, 131], torso: 180, head: 180, handAt: [126, 104], armBend: -1, ...LEGS_STAND },
    { prop: 'barbell', hip: [88, 152], torso: 150, head: 158, handAt: [122, 122], armBend: -1,
      hipNear: 80, hipFar: 74, kneeNear: 340, kneeFar: 334, ankleNear: 90, ankleFar: 90 }) },

  'Front Squat': { labels: ['Bar on the front rack', 'Hips below knees', 'Drive up'], frames: rep3(
    { prop: 'barbell', hip: [100, 131], torso: 180, head: 180, handAt: [128, 106], armBend: 1, ...LEGS_STAND },
    { prop: 'barbell', hip: [90, 152], torso: 160, head: 166, handAt: [128, 126], armBend: 1,
      hipNear: 80, hipFar: 74, kneeNear: 340, kneeFar: 334, ankleNear: 90, ankleFar: 90 }) },

  'Romanian Deadlift': { labels: ['Stand, bar at the hips', 'Bar to mid-shin', 'Stand tall'], frames: rep3(
    standHold('barbell', 132),
    { prop: 'barbell', hip: [96, 134], torso: 144, head: 150, handAt: [121, 145], armBend: -1,
      hipNear: 10, hipFar: 4, kneeNear: 350, kneeFar: 344, ankleNear: 90, ankleFar: 90 }) },

  'Barbell Row': { labels: ['Hinged, bar hanging', 'Bar to the belly', 'Lower under control'], frames: rep3(
    { prop: 'barbell', hip: [96, 138], torso: 128, head: 136, handAt: [127, 156], armBend: -1,
      hipNear: 8, hipFar: 2, kneeNear: 352, kneeFar: 346, ankleNear: 90, ankleFar: 90 },
    { prop: 'barbell', hip: [96, 138], torso: 128, head: 136, handAt: [126, 140], armBend: -1,
      hipNear: 8, hipFar: 2, kneeNear: 352, kneeFar: 346, ankleNear: 90, ankleFar: 90 }) },

  'Overhead Press': { labels: ['Bar at the shoulders', 'Lock out overhead', 'Lower to shoulders'], frames: rep3(
    standHold('barbell', 100, { handAt: [132, 102] }), standHold('barbell', 62, { armBend: 1, handAt: [130, 72] })) },

  'Barbell Curl': { labels: ['Arms straight', 'Curl to the shoulders', 'Lower under control'], frames: rep3(
    standHold('barbell', 133), standHold('barbell', 106)) },

  // ── Dumbbells ─────────────────────────────────────────────────────────────
  'Dumbbell Curl': { labels: ['Arms straight', 'Curl up', 'Lower under control'], frames: rep3(
    standHold('dumbbells', 133), standHold('dumbbells', 106)) },

  'Hammer Curl': { labels: ['Neutral grip, arms straight', 'Curl up', 'Lower under control'], frames: rep3(
    standHold('dumbbells', 133), standHold('dumbbells', 108)) },

  'Lateral Raise': { labels: ['Arms at your sides', 'Up to shoulder height', 'Lower slowly'], frames: rep3(
    standHold('dumbbells', 133), standHold('dumbbells', 100, { handAt: [138, 100] })) },

  'Dumbbell Shoulder Press': { labels: ['At the shoulders', 'Press overhead', 'Lower to shoulders'], frames: rep3(
    seatHold('dumbbells', [112, 118]), seatHold('dumbbells', [123, 93], { armBend: 1 })) },

  'Dumbbell Row': { labels: ['Hinged, arm hanging', 'Elbow to the hip', 'Lower under control'], frames: rep3(
    { prop: 'dumbbells', hip: [96, 138], torso: 126, head: 134, handAt: [128, 157], armBend: -1,
      hipNear: 8, hipFar: 2, kneeNear: 352, kneeFar: 346, ankleNear: 90, ankleFar: 90 },
    { prop: 'dumbbells', hip: [96, 138], torso: 126, head: 134, handAt: [126, 142], armBend: -1,
      hipNear: 8, hipFar: 2, kneeNear: 352, kneeFar: 346, ankleNear: 90, ankleFar: 90 }) },

  'Dumbbell Romanian Deadlift': { labels: ['Stand, bells at the hips', 'Down to mid-shin', 'Stand tall'], frames: rep3(
    standHold('dumbbells', 132),
    { prop: 'dumbbells', hip: [96, 134], torso: 144, head: 150, handAt: [121, 145], armBend: -1,
      hipNear: 10, hipFar: 4, kneeNear: 350, kneeFar: 344, ankleNear: 90, ankleFar: 90 }) },

  'Goblet Squat': { labels: ['Bell at the chest', 'Hips below knees', 'Drive up'], frames: rep3(
    { prop: 'dumbbells', hip: [100, 131], torso: 180, head: 180, handAt: [126, 110], armBend: 1, ...LEGS_STAND },
    { prop: 'dumbbells', hip: [90, 152], torso: 160, head: 166, handAt: [126, 128], armBend: 1,
      hipNear: 80, hipFar: 74, kneeNear: 340, kneeFar: 334, ankleNear: 90, ankleFar: 90 }) },

  'Incline Dumbbell Press': { labels: ['Bells at the chest', 'Press up and in', 'Lower under control'], frames: rep3(
    benchHold('dumbbells', [102, 134]), benchHold('dumbbells', [96, 114])) },

  // The press BENDS the elbow; the fly keeps it long and sweeps the whole arm. Drawing
  // both as a bent-elbow press is what made these two the same picture (Section C).
  'Dumbbell Fly': { labels: ['Arms wide', 'Hug them together', 'Open back out'], frames: rep3(
    benchHold('dumbbells', [124, 130]), benchHold('dumbbells', [96, 113])) },

  // ── Bench ─────────────────────────────────────────────────────────────────
  'Bench Press': { labels: ['Bar over the chest', 'Bar to the chest', 'Press back up'], frames: rep3(
    benchHold('barbell', [94, 114]), benchHold('barbell', [99, 136])) },

  // The head is to the LEFT, so the bar travelling toward the forehead travels left as
  // well as down — which is what separates this from a bench press. The locked frame
  // sits the bar back over the face rather than over the chest for the same reason:
  // authored at the bench-press lockout it was the SAME PICTURE as a bench press.
  'Skull Crusher': { labels: ['Arms locked', 'Bar toward the forehead', 'Extend back up'], frames: rep3(
    benchHold('barbell', [88, 116]), benchHold('barbell', [80, 136], { armBend: -1 })) },

  // ── Machines and cables ───────────────────────────────────────────────────
  'Lat Pulldown': { labels: ['Arms extended overhead', 'Bar to the collarbone', 'Let it rise'], frames: rep3(
    seatHold('bar-pulldown', [116, 86]), seatHold('bar-pulldown', [110, 110], { torso: 176 })) },

  'Seated Cable Row': { labels: ['Arms extended', 'Handle to the belly', 'Extend back out'], frames: rep3(
    seatHold('cable-stack', [127, 133]), seatHold('cable-stack', [104, 138], { torso: 184 })) },

  'Cable Crossover': { labels: ['Arms wide', 'Bring them together', 'Open back out'], frames: rep3(
    { prop: 'cable-stack', hip: [92, 131], torso: 176, head: 176, handAt: [132, 108], armBend: -1, ...LEGS_STAND },
    { prop: 'cable-stack', hip: [92, 131], torso: 176, head: 176, handAt: [110, 122], armBend: -1, ...LEGS_STAND }) },

  'Face Pull': { labels: ['Arms extended forward', 'Rope to the face', 'Extend back out'], frames: rep3(
    { prop: 'cable-stack', hip: [92, 131], torso: 180, head: 180, handAt: [131, 100], armBend: -1, ...LEGS_STAND },
    { prop: 'cable-stack', hip: [92, 131], torso: 180, head: 180, handAt: [104, 92], armBend: -1, ...LEGS_STAND }) },

  'Tricep Pushdown': { labels: ['Elbows tucked, forearms up', 'Push all the way down', 'Return under control'], frames: rep3(
    { prop: 'cable-stack', hip: [92, 131], torso: 180, head: 180, handAt: [108, 112], armBend: -1, ...LEGS_STAND },
    { prop: 'cable-stack', hip: [92, 131], torso: 180, head: 180, handAt: [104, 134], armBend: -1, ...LEGS_STAND }) },

  // Kneeling means the shins run BACK from the knees along the floor. They used to run
  // forward, which is a knee bending the wrong way AND put both feet through the floor.
  'Cable Crunch': { labels: ['Kneeling, rope at the head', 'Crunch the ribs down', 'Rise under control'], frames: rep3(
    { prop: 'cable-stack', hip: [96, 156], torso: 180, head: 180, handAt: [134, 113], armBend: 1,
      hipNear: 342, hipFar: 346, kneeNear: 265, kneeFar: 269, ankleNear: 268, ankleFar: 272 },
    { prop: 'cable-stack', hip: [96, 156], torso: 150, head: 144, handAt: [134, 113], armBend: 1,
      hipNear: 342, hipFar: 346, kneeNear: 265, kneeFar: 269, ankleNear: 268, ankleFar: 272 }) },

  // The knee points TOWARD the chest, which for a reclined lifter is up the screen. It
  // used to dip below the hip-to-foot line — the knee folding backwards — which is the
  // single most obviously wrong thing in the set. Feet keep their old positions so the
  // plate still meets them; only the knee moved to the side a knee can reach.
  'Leg Press': { labels: ['Knees bent, feet on the plate', 'Press to near lockout', 'Return under control'], frames: rep3(
    { prop: 'machine', hip: [84, 150], torso: 256, head: 256, propAt: 'foot',
      shoulderNear: 320, shoulderFar: 314, elbowNear: 348, elbowFar: 342,
      hipNear: 130, hipFar: 134, kneeNear: 52, kneeFar: 56, ankleNear: 142, ankleFar: 146 },
    { prop: 'machine', hip: [84, 150], torso: 256, head: 256, propAt: 'foot',
      shoulderNear: 320, shoulderFar: 314, elbowNear: 348, elbowFar: 342,
      hipNear: 103, hipFar: 107, kneeNear: 80, kneeFar: 84, ankleNear: 142, ankleFar: 146 }) },

  'Leg Extension': { labels: ['Seated, knees bent', 'Straighten the knees', 'Lower under control'], frames: rep3(
    seatHold('machine', [103, 147], { hip: [86, 146], kneeNear: 4, kneeFar: 8 }),
    seatHold('machine', [103, 147], { hip: [86, 146], kneeNear: 84, kneeFar: 88 })) },

  'Leg Curl': { labels: ['Face down, legs straight', 'Heels to the glutes', 'Lower under control'], frames: rep3(
    { prop: 'machine', hip: [96, 150], torso: 100, head: 100, propAt: 'hip',
      shoulderNear: 150, shoulderFar: 156, elbowNear: 120, elbowFar: 126,
      hipNear: 274, hipFar: 278, kneeNear: 274, kneeFar: 278, ankleNear: 20, ankleFar: 20 },
    { prop: 'machine', hip: [96, 150], torso: 100, head: 100, propAt: 'hip',
      shoulderNear: 150, shoulderFar: 156, elbowNear: 120, elbowFar: 126,
      hipNear: 274, hipFar: 278, kneeNear: 190, kneeFar: 194, ankleNear: 130, ankleFar: 130 }) },
};

/** Poses for one exercise, or null when we have not drawn it yet. */
export function posesFor(exerciseName) {
  if (!exerciseName) return null;
  return POSES[exerciseName] || null;
}

/** Exercises that currently have a diagram — used by the contact sheet. */
export function drawnExercises() {
  return Object.keys(POSES);
}
