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

import { solve, anchorFor, PROPS, SEG } from '../src/lib/exerciseFigureGeometry.js';
import { POSES } from '../src/lib/data/exercisePoses.js';

// REACH. `reach()` clamps a target further away than the arm is long, so an
// unreachable `handAt` does not fail — it quietly puts the hand somewhere else, and
// every HELD prop hangs off that somewhere else. Bench Press asked for a bar 60 units
// from a 40-unit arm and got one 20 units from where the pose said, which is exactly
// the class of defect this file exists to catch: the source reads correct.
const ARM = SEG.upperArm + SEG.foreArm;

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

// OCCLUSION. A limb lying along the torso renders behind it and the figure
// appears to have no arms. I hand-fixed this once for standing poses and did
// not encode it, so Pull-up, Dips and Hanging Leg Raise reproduced it exactly
// — every hanging pose puts both arms in the torso's line. A lesson that only
// lives in my head gets relearned; a lesson in this file does not.
const LIMB_CLEARANCE = 7;

// A head drawn on top of the bar reads as the bar passing through the skull.
const HEAD_CLEARANCE = 4;

// An arm running straight up past the head is hidden by it — which is why the
// pull-up and hanging leg raise looked armless even though the torso-clearance
// check passed. Overhead grips have to be splayed wider than the skull, which
// is also how people actually grip a bar.
const HEAD_R = 9;

// Movements where the hands genuinely belong beside the head — a front-squat
// rack position IS hands at the neck, and a cable crunch holds the rope by the
// ears. Distorting those to satisfy the check would make the picture wrong in
// order to make the checker quiet, which is the wrong trade. Exempt with the
// reason recorded, and keep the check strict for everything else.
const HANDS_AT_HEAD_OK = new Set(['Front Squat', 'Cable Crunch', 'Goblet Squat']);

// KNEE. A knee is a hinge with one direction of travel, and unlike the elbow it has no
// shoulder rotation to hide behind — so a knee bending the wrong way is wrong in every
// projection, not just this one. It is also the failure a person spots instantly and
// cannot un-see, which is how it was found: on a rendered card, not in the numbers.
//
// The figure always faces +x, so flexion always rotates the shin toward -x, which in
// this convention is a DECREASING angle. Signed angles survive rotation, so the rule
// holds for a lifter who is upright, prone, supine or hanging upside down — only
// mirroring the figure would flip it, and exercisePoses.js forbids that.
//
// Nine frames failed this on first run: Leg Press (knee dipping below the hip-to-foot
// line), Cable Crunch (kneeling with the shins running forward, and both feet through
// the floor), Hanging Leg Raise (shins pointing up), the Lunge's back leg and the
// Pull-up's far leg. All nine had passed every other check in this file.
const KNEE_TOL = 6;   // a few degrees of hyperextension is normal and reads fine

const angOf = ([x, y]) => Math.atan2(x, y) * 180 / Math.PI;
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
const wrap = (d) => { while (d > 180) d -= 360; while (d <= -180) d += 360; return d; };
/** Signed knee flexion in degrees. Negative is a knee doing what a knee does. */
function flexion(s, side) {
  return wrap(angOf(sub2(s[side].end, s[side].mid)) - angOf(sub2(s[side].mid, s.hip)));
}

// SUPPORT. A body whose weight is not on the floor and not hanging from
// something is resting on apparatus, and that apparatus has to be drawn — a
// figure supported by nothing reads as falling, not as pressing. Nine
// exercises shipped that way: bench press, incline press, fly, skull crusher,
// shoulder press, cable row, pulldown, leg extension and leg press.
//
// Two shapes count as "off the floor":
//
//   LYING    the torso is nearer horizontal than vertical. |cos| < 0.45 is
//            about 27 degrees of slack, which is deliberately generous: a
//            bent-over row sits at 0.59 and must not be flagged, because a
//            hinge is a standing position and a check that fires on it would
//            teach people to ignore this one.
//   SEATED   the thigh is near horizontal, the hip is well clear of the floor,
//            AND the torso is upright. The floor threshold separates a lat
//            pulldown (hip 32 units up, on a seat) from a Russian twist (20
//            units, on the ground).
//
//            The torso clause is load-bearing and was added after this check
//            fired on all four squats. It is not a fudge: the bottom of a
//            squat IS geometrically a person sitting on an invisible chair —
//            thigh horizontal, hip well off the floor — and the only thing
//            that separates it from a seat is that a squatter leans forward
//            over their feet (146-160 degrees) while someone on a bench sits
//            up (172-184). A check that flags four correct squats is a check
//            everyone learns to ignore.
const TORSO_HORIZ = 0.45;
const THIGH_HORIZ = 0.42;
const SEAT_CLEARANCE = 24;
const UPRIGHT_SLACK = 18;   // degrees either side of a vertical torso

// Weight is carried by something already drawn, or by nothing at all.
const SUPPORT_NOT_NEEDED = new Set([
  'Push-up', 'Plank', 'Pike Push-up', 'Dead Bug',  // on the floor
  'Russian Twist',                                  // sitting on the floor
  'Inverted Row',                                   // hanging under the bar
  'Leg Curl',                                       // its machine prop IS the pad
]);

// Distance from point to the segment a-b.
function distToSeg(pt, a, b) {
  const [px, py] = pt, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

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

    // Hanging from apparatus carries the body too — those props have floor:false.
    if (!SUPPORT_NOT_NEEDED.has(name) && !pose.support && !(prop && prop.floor === false)) {
      const torsoDeg = pose.torso ?? 180;
      const lying = Math.abs(Math.cos(torsoDeg * Math.PI / 180)) < TORSO_HORIZ;
      const thighDeg = pose.hipNear ?? pose.hipFar ?? 0;
      const seated = Math.abs(Math.cos(thighDeg * Math.PI / 180)) < THIGH_HORIZ
                     && (FLOOR_Y - s.hip[1]) > SEAT_CLEARANCE
                     && Math.abs(torsoDeg - 180) < UPRIGHT_SLACK;
      if (lying || seated) {
        issues.push(`frame ${i + 1}: ${lying ? 'lying' : 'seated'} off the floor with no \`support\` — the lifter rests on nothing`);
      }
    }

    if (pose.handAt) {
      const d = Math.hypot(pose.handAt[0] - s.neckBase[0], pose.handAt[1] - s.neckBase[1]);
      if (d > ARM - 0.5) {
        issues.push(`frame ${i + 1}: handAt (${pose.handAt}) is ${d.toFixed(0)} from the shoulder, arm reaches ${ARM} — it will be silently clamped to (${s.armNear.end[0].toFixed(0)},${s.armNear.end[1].toFixed(0)})`);
      }
    }

    for (const [label, side] of [['near', 'legNear'], ['far', 'legFar']]) {
      const f = flexion(s, side);
      if (f > KNEE_TOL) {
        issues.push(`frame ${i + 1}: ${label} knee bends BACKWARDS (${f.toFixed(0)}deg, max +${KNEE_TOL}) — flex the shin toward the back of the leg`);
      }
    }

    // Near arm and near leg must be visible against the torso.
    for (const [label, limb] of [['arm', s.armNear], ['leg', s.legNear]]) {
      const dMid = distToSeg(limb.mid, s.hip, s.neckBase);
      const dEnd = distToSeg(limb.end, s.hip, s.neckBase);
      if (dMid < LIMB_CLEARANCE && dEnd < LIMB_CLEARANCE) {
        issues.push(`frame ${i + 1}: near ${label} lies along the torso (${dMid.toFixed(0)}/${dEnd.toFixed(0)} clearance, min ${LIMB_CLEARANCE}) — it will render invisible`);
      }
    }

    for (const [a, b, what] of (HANDS_AT_HEAD_OK.has(name) ? [] :
                               [[s.neckBase, s.armNear.mid, 'upper arm'],
                                [s.armNear.mid, s.armNear.end, 'forearm']])) {
      const d = distToSeg(s.headPos, a, b);
      if (d < HEAD_R - 2) {
        issues.push(`frame ${i + 1}: near ${what} passes through the head (${d.toFixed(0)}, min ${HEAD_R - 2}) — widen the grip`);
      }
    }

    // Head must not sit on the apparatus it is meant to hang beneath — except
    // at the top of a pull-up, where "chin over the bar" is the whole point.
    if (prop && !prop.held && anchor && name !== 'Pull-up') {
      const dHead = Math.abs(s.headPos[1] - anchor[1]);
      if (dHead < 9 + HEAD_CLEARANCE && Math.abs(s.headPos[0] - anchor[0]) < 60) {
        issues.push(`frame ${i + 1}: head is ${dHead.toFixed(0)} from the ${frames[0].prop} — the bar draws through it`);
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
