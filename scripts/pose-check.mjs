// scripts/pose-check.mjs
//
//   node scripts/pose-check.mjs
//
// Numeric checks on every pose, because the failures that matter here are
// invisible in the source and easy to miss on a contact sheet:
//
//   CONTACT  a fixed prop is anchored to frame one's hands, so frames two and
//            three must keep their hands near it — otherwise the lifter lets
//            go of the bar halfway through the rep.
//   FLOOR    a pose that should be standing on the ground floats above it.
//            Thigh 26 + shin 25 = 51, so a standing hip belongs at 131.
//   BOUNDS   a limb leaves the 200x200 viewBox and gets clipped.
//
// Exit code is non-zero when anything fails, so this can gate a commit.

import { solve, anchorFor, PROPS } from '../src/lib/exerciseFigureGeometry.js';
import { POSES } from '../src/lib/data/exercisePoses.js';

const CONTACT_TOL = 9;    // units; ~half a head
const FLOOR_Y     = 182;
const FLOOR_TOL   = 10;

// Poses with no ground contact by design.
const AIRBORNE = new Set(['Pull-up', 'Dips', 'Hanging Leg Raise', 'Tricep Dips',
                          'Leg Press', 'Leg Curl', 'Leg Extension', 'Dead Bug',
                          'Russian Twist', 'Bench Press', 'Dumbbell Fly',
                          'Skull Crusher', 'Incline Dumbbell Press', 'Cable Crunch',
                          'Seated Cable Row', 'Dumbbell Shoulder Press']);

// FOLD. A body whose legs and head leave the hip in the SAME direction is
// folded in half, not posed. This is what made Inverted Row read as the back
// going to the bar: torso and legs both ran right of the hip, so the figure
// was a Z. Geometry checks all passed — every joint was in bounds, the hands
// were on the bar — because "is this a plausible human" is a different
// question from "are the numbers legal".
//
// Exempt: poses where a tight fold is the exercise.
const FOLDED_OK = new Set(['Dead Bug', 'Cable Crunch', 'Hanging Leg Raise',
                           'Russian Twist', 'Leg Press', 'Leg Extension',
                           'Seated Cable Row', 'Dumbbell Shoulder Press',
                           'Lat Pulldown', 'Bodyweight Squat', 'Goblet Squat',
                           'Front Squat', 'Back Squat', 'Tricep Dips']);
const FOLD_MIN_DEG = 55;

let fails = 0, checks = 0;
const fail = (msg) => { console.log('  ✗ ' + msg); fails++; };

for (const [name, { frames }] of Object.entries(POSES)) {
  const issues = [];
  const prop = frames[0].prop ? PROPS[frames[0].prop] : null;
  // Only a GRIPPED prop anchored at the hand can drift out of the hand.
  const gripped = prop && !prop.held && prop.grip && !frames[0].propAt;
  const anchor = gripped ? anchorFor(frames[0]) : null;

  frames.forEach((pose, i) => {
    const s = solve(pose);
    checks++;

    if (anchor) {
      const d = Math.hypot(s.armNear.end[0] - anchor[0], s.armNear.end[1] - anchor[1]);
      if (d > CONTACT_TOL) {
        issues.push(`frame ${i + 1}: hand is ${d.toFixed(0)} from the ${frames[0].prop} (tol ${CONTACT_TOL})`);
      }
    }

    if (!AIRBORNE.has(name)) {
      const lowest = Math.max(s.footNear[1], s.footFar[1], s.armNear.end[1]);
      if (Math.abs(lowest - FLOOR_Y) > FLOOR_TOL) {
        issues.push(`frame ${i + 1}: lowest point ${lowest.toFixed(0)}, floor ${FLOOR_Y} (off by ${(lowest - FLOOR_Y).toFixed(0)})`);
      }
    }

    if (!FOLDED_OK.has(name)) {
      const ang = ([x, y]) => Math.atan2(x - s.hip[0], y - s.hip[1]) * 180 / Math.PI;
      let d = Math.abs(ang(s.neckBase) - ang(s.legNear.end));
      if (d > 180) d = 360 - d;
      if (d < FOLD_MIN_DEG) {
        issues.push(`frame ${i + 1}: torso and legs leave the hip ${d.toFixed(0)}deg apart — body is folded (min ${FOLD_MIN_DEG})`);
      }
    }

    const all = [s.headPos, s.neckBase, s.hip, s.armNear.end, s.armFar.end,
                 s.footNear, s.footFar, s.legNear.mid, s.legFar.mid];
    for (const [x, y] of all) {
      if (x < 6 || x > 194 || y < 6 || y > 194) {
        issues.push(`frame ${i + 1}: point (${x.toFixed(0)},${y.toFixed(0)}) outside the viewBox`);
        break;
      }
    }
  });

  if (issues.length) {
    console.log(name);
    issues.forEach(fail);
  }
}

const drawn = Object.keys(POSES).length;
console.log(`\n${drawn} exercises, ${checks} frames checked, ${fails} problem(s)`);
process.exit(fails ? 1 : 0);
