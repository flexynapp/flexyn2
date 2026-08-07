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
const STANDING = {
  hip: [100, 131], torso: 180, head: 180,
  shoulderNear: 14, shoulderFar: 346, elbowNear: 10, elbowFar: 350,
  hipNear: 4, hipFar: 356, kneeNear: 2, kneeFar: 358,
  ankleNear: 90, ankleFar: 90,
};

// Prone positions share a leg line: hips back and slightly down to the toes.
const PRONE_LEGS = { hipNear: 292, hipFar: 296, kneeNear: 292, kneeFar: 296, ankleNear: 30, ankleFar: 30 };

export const POSES = {
  'Bodyweight Squat': {
    labels: ['Stand tall', 'Hips below knees', 'Drive up'],
    frames: [
      STANDING,
      { // thigh near horizontal, shin near vertical, torso folded forward
        hip: [86, 152], torso: 146, head: 156,
        shoulderNear: 104, shoulderFar: 96, elbowNear: 100, elbowFar: 92,
        hipNear: 80, hipFar: 74, kneeNear: 340, kneeFar: 334,
        ankleNear: 90, ankleFar: 90 },
      STANDING,
    ],
  },

  'Push-up': {
    labels: ['Arms locked', 'Chest to floor', 'Press back up'],
    frames: [
      { hip: [86, 148], torso: 100, head: 100,
        shoulderNear: 4, shoulderFar: 356, elbowNear: 2, elbowFar: 358, ...PRONE_LEGS },
      { // shoulders drop ~28 units; elbows bend back past 90
        hip: [86, 168], torso: 96, head: 96,
        shoulderNear: 46, shoulderFar: 40, elbowNear: 316, elbowFar: 310, ...PRONE_LEGS },
      { hip: [86, 148], torso: 100, head: 100,
        shoulderNear: 4, shoulderFar: 356, elbowNear: 2, elbowFar: 358, ...PRONE_LEGS },
    ],
  },

  'Plank': {
    // On the FOREARMS, not straight arms: upper arm straight down, forearm
    // flat along the floor. That is the difference between a plank and the top
    // of a push-up, and it is the whole point of the picture.
    labels: ['Set the line', 'Hold — hips level', 'Hips sagging (wrong)'],
    frames: [
      { hip: [86, 164], torso: 95, head: 95,
        shoulderNear: 4, shoulderFar: 356, elbowNear: 86, elbowFar: 94,
        hipNear: 276, hipFar: 280, kneeNear: 276, kneeFar: 280, ankleNear: 30, ankleFar: 30 },
      { hip: [86, 164], torso: 95, head: 95,
        shoulderNear: 4, shoulderFar: 356, elbowNear: 86, elbowFar: 94,
        hipNear: 276, hipFar: 280, kneeNear: 276, kneeFar: 280, ankleNear: 30, ankleFar: 30 },
      { // hips dropped toward the floor, lumbar collapsed - the failure mode
        hip: [86, 178], torso: 78, head: 88,
        shoulderNear: 4, shoulderFar: 356, elbowNear: 86, elbowFar: 94,
        hipNear: 262, hipFar: 266, kneeNear: 268, kneeFar: 272, ankleNear: 30, ankleFar: 30 },
    ],
  },

  'Lunge': {
    labels: ['Stand tall', 'Back knee low', 'Push back to stand'],
    frames: [
      STANDING,
      { hip: [96, 146], torso: 178, head: 178,
        shoulderNear: 16, shoulderFar: 344, elbowNear: 12, elbowFar: 348,
        hipNear: 52, hipFar: 310, kneeNear: 352, kneeFar: 26,
        ankleNear: 90, ankleFar: 60 },
      STANDING,
    ],
  },

  'Pike Push-up': {
    // An inverted V: hands and feet on the floor, hips the highest point.
    labels: ['Hips high, V shape', 'Crown toward floor', 'Press back up'],
    frames: [
      { hip: [112, 125], torso: 300, head: 300,
        shoulderNear: 4, shoulderFar: 356, elbowNear: 2, elbowFar: 358,
        hipNear: 10, hipFar: 14, kneeNear: 10, kneeFar: 14, ankleNear: 90, ankleFar: 90 },
      { hip: [112, 125], torso: 300, head: 296,
        shoulderNear: 54, shoulderFar: 48, elbowNear: 320, elbowFar: 314,
        hipNear: 10, hipFar: 14, kneeNear: 10, kneeFar: 14, ankleNear: 90, ankleFar: 90 },
      { hip: [112, 125], torso: 300, head: 300,
        shoulderNear: 4, shoulderFar: 356, elbowNear: 2, elbowFar: 358,
        hipNear: 10, hipFar: 14, kneeNear: 10, kneeFar: 14, ankleNear: 90, ankleFar: 90 },
    ],
  },

  'Calf Raise': {
    labels: ['Flat feet', 'Up on the toes', 'Lower under control'],
    frames: [
      STANDING,
      { ...STANDING, hip: [100, 118], ankleNear: 46, ankleFar: 46 },
      STANDING,
    ],
  },

  'Russian Twist': {
    // Seated: hips ON the floor, torso leaning back, feet lifted.
    labels: ['Seated, leaning back', 'Rotate across', 'Rotate back'],
    frames: [
      { hip: [78, 176], torso: 142, head: 146,
        shoulderNear: 96, shoulderFar: 88, elbowNear: 92, elbowFar: 84,
        hipNear: 66, hipFar: 60, kneeNear: 22, kneeFar: 16, ankleNear: 90, ankleFar: 90 },
      { hip: [78, 176], torso: 142, head: 156,
        shoulderNear: 128, shoulderFar: 118, elbowNear: 126, elbowFar: 116,
        hipNear: 66, hipFar: 60, kneeNear: 22, kneeFar: 16, ankleNear: 90, ankleFar: 90 },
      { hip: [78, 176], torso: 142, head: 134,
        shoulderNear: 64, shoulderFar: 54, elbowNear: 60, elbowFar: 50,
        hipNear: 66, hipFar: 60, kneeNear: 22, kneeFar: 16, ankleNear: 90, ankleFar: 90 },
    ],
  },

  'Dead Bug': {
    // On the back, head to the LEFT: torso points left (270), limbs point up.
    labels: ['On your back, limbs up', 'Opposite arm and leg out', 'Return to start'],
    frames: [
      { hip: [118, 176], torso: 268, head: 268,
        shoulderNear: 184, shoulderFar: 176, elbowNear: 184, elbowFar: 176,
        hipNear: 186, hipFar: 178, kneeNear: 96, kneeFar: 88, ankleNear: 40, ankleFar: 40 },
      { hip: [118, 176], torso: 268, head: 268,
        shoulderNear: 232, shoulderFar: 176, elbowNear: 236, elbowFar: 176,
        hipNear: 186, hipFar: 128, kneeNear: 96, kneeFar: 118, ankleNear: 40, ankleFar: 40 },
      { hip: [118, 176], torso: 268, head: 268,
        shoulderNear: 184, shoulderFar: 176, elbowNear: 184, elbowFar: 176,
        hipNear: 186, hipFar: 178, kneeNear: 96, kneeFar: 88, ankleNear: 40, ankleFar: 40 },
    ],
  },

  'Inverted Row': {
    // Face-up under a bar, heels on the floor, arms reaching up to the bar.
    labels: ['Hang under the bar', 'Chest to the bar', 'Lower under control'],
    frames: [
      { prop: 'bar-low', hip: [96, 150], torso: 86, head: 86,
        shoulderNear: 178, shoulderFar: 182, elbowNear: 178, elbowFar: 182,
        hipNear: 74, hipFar: 78, kneeNear: 40, kneeFar: 44, ankleNear: 90, ankleFar: 90 },
      { prop: 'bar-low', hip: [96, 132], torso: 86, head: 86,
        shoulderNear: 160, shoulderFar: 164, elbowNear: 212, elbowFar: 216,
        hipNear: 74, hipFar: 78, kneeNear: 40, kneeFar: 44, ankleNear: 90, ankleFar: 90 },
      { prop: 'bar-low', hip: [96, 150], torso: 86, head: 86,
        shoulderNear: 178, shoulderFar: 182, elbowNear: 178, elbowFar: 182,
        hipNear: 74, hipFar: 78, kneeNear: 40, kneeFar: 44, ankleNear: 90, ankleFar: 90 },
    ],
  },

  'Tricep Dips': {
    labels: ['Arms locked, hips off', 'Elbows to 90', 'Press back up'],
    frames: [
      { prop: 'bench', hip: [104, 138], torso: 196, head: 190,
        shoulderNear: 344, shoulderFar: 340, elbowNear: 350, elbowFar: 346,
        hipNear: 70, hipFar: 64, kneeNear: 84, kneeFar: 80, ankleNear: 90, ankleFar: 90 },
      { prop: 'bench', hip: [104, 158], torso: 196, head: 190,
        shoulderNear: 330, shoulderFar: 326, elbowNear: 28, elbowFar: 24,
        hipNear: 70, hipFar: 64, kneeNear: 84, kneeFar: 80, ankleNear: 90, ankleFar: 90 },
      { prop: 'bench', hip: [104, 138], torso: 196, head: 190,
        shoulderNear: 344, shoulderFar: 340, elbowNear: 350, elbowFar: 346,
        hipNear: 70, hipFar: 64, kneeNear: 84, kneeFar: 80, ankleNear: 90, ankleFar: 90 },
    ],
  },

  'Pull-up': {
    // Hanging: no floor contact, so the feet stay well clear of the line.
    labels: ['Dead hang', 'Chin over the bar', 'Lower to full hang'],
    frames: [
      { prop: 'bar-high', hip: [100, 116], torso: 180, head: 180,
        shoulderNear: 172, shoulderFar: 188, elbowNear: 174, elbowFar: 186,
        hipNear: 6, hipFar: 354, kneeNear: 4, kneeFar: 356, ankleNear: 90, ankleFar: 90 },
      { prop: 'bar-high', hip: [100, 146], torso: 180, head: 180,
        shoulderNear: 152, shoulderFar: 208, elbowNear: 216, elbowFar: 144,
        hipNear: 14, hipFar: 346, kneeNear: 332, kneeFar: 28, ankleNear: 90, ankleFar: 90 },
      { prop: 'bar-high', hip: [100, 116], torso: 180, head: 180,
        shoulderNear: 172, shoulderFar: 188, elbowNear: 174, elbowFar: 186,
        hipNear: 6, hipFar: 354, kneeNear: 4, kneeFar: 356, ankleNear: 90, ankleFar: 90 },
    ],
  },

  'Dips': {
    labels: ['Support, arms locked', 'Elbows to 90', 'Press back up'],
    frames: [
      { prop: 'parallel-bars', hip: [100, 128], torso: 186, head: 182,
        shoulderNear: 8, shoulderFar: 352, elbowNear: 4, elbowFar: 356,
        hipNear: 12, hipFar: 348, kneeNear: 330, kneeFar: 30, ankleNear: 90, ankleFar: 90 },
      { prop: 'parallel-bars', hip: [100, 152], torso: 190, head: 184,
        shoulderNear: 332, shoulderFar: 324, elbowNear: 30, elbowFar: 22,
        hipNear: 12, hipFar: 348, kneeNear: 330, kneeFar: 30, ankleNear: 90, ankleFar: 90 },
      { prop: 'parallel-bars', hip: [100, 128], torso: 186, head: 182,
        shoulderNear: 8, shoulderFar: 352, elbowNear: 4, elbowFar: 356,
        hipNear: 12, hipFar: 348, kneeNear: 330, kneeFar: 30, ankleNear: 90, ankleFar: 90 },
    ],
  },
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
