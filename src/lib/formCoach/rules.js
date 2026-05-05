// src/lib/formCoach/rules.js
//
// Per-exercise rule-based form analysis. Each analyzer takes a normalized
// keypoint map (name → { x, y, score }) and returns a feedback object in the
// shape FeedbackPanel.jsx expects:
//
//   {
//     overall_score:  0-10,
//     form_rating:    'Excellent' | 'Good' | 'Needs Work' | 'Poor',
//     good_points:    string[],
//     corrections:    string[],
//     injury_risks:   string[],
//     tip:            string,
//   }
//
// Rules use joint angles + 2D positions in image space. They're deliberately
// generous: rule-based checks on a single static frame can't replace a coach,
// so we err on the side of "Good" unless something is clearly off.

import { angleAt, angleFromVertical, bestSide, distance, midpoint, ifConfident } from './geometry';

// ── Score helpers ─────────────────────────────────────────────────────────────

function ratingFromScore(score) {
  if (score >= 8.5) return 'Excellent';
  if (score >= 6.5) return 'Good';
  if (score >= 4.5) return 'Needs Work';
  return 'Poor';
}

function buildFeedback({ score, good = [], corrections = [], risks = [], tip = '' }) {
  const clamped = Math.max(0, Math.min(10, Math.round(score)));
  return {
    overall_score: clamped,
    form_rating:   ratingFromScore(clamped),
    good_points:   good,
    corrections,
    injury_risks:  risks,
    tip,
  };
}

// Each rule contributes ±points to a base score of 8 ("Good by default").
function applyRule({ ok, weight, goodMsg, badMsg, riskMsg }, ctx) {
  if (ok === null) return; // rule couldn't evaluate (low confidence) — skip
  if (ok) {
    if (goodMsg) ctx.good.push(goodMsg);
  } else {
    ctx.score -= weight;
    if (badMsg) ctx.corrections.push(badMsg);
    if (riskMsg) ctx.risks.push(riskMsg);
  }
}

// ── Squat ─────────────────────────────────────────────────────────────────────
//
// Best detected from the side. Side-on frame shows the knee angle clearly.
// Front-on frame still works for knee tracking but loses depth detail.

export function analyzeSquat(kp) {
  const ctx = { score: 8, good: [], corrections: [], risks: [] };

  // Knee angle (best of the two sides)
  const leftKnee  = angleAt(kp.left_hip,  kp.left_knee,  kp.left_ankle);
  const rightKnee = angleAt(kp.right_hip, kp.right_knee, kp.right_ankle);
  const kneeAngle = pickBest(leftKnee, rightKnee);

  // Hip/torso lean: angle of shoulder→hip vector vs vertical
  const torsoSide = bestSide(kp, 'left_shoulder', 'right_shoulder');
  const hipSide   = bestSide(kp, 'left_hip', 'right_hip');
  const torsoLean = (torsoSide && hipSide)
    ? angleFromVertical(torsoSide.kp, hipSide.kp)
    : null;

  // Knee tracking over toes (front-on view): ankle x ≈ knee x
  const kneeOverToe = checkKneeOverToe(kp);

  // Rule 1: Depth — knee angle ≤100° = at parallel or below
  applyRule({
    ok: kneeAngle === null ? null : kneeAngle <= 100,
    weight: 2,
    goodMsg: kneeAngle !== null && kneeAngle <= 100
      ? `Good depth — knee angle ${Math.round(kneeAngle)}°`
      : null,
    badMsg: kneeAngle !== null && kneeAngle > 100
      ? `Squat deeper — your knee angle is ${Math.round(kneeAngle)}°, aim for 90° or less`
      : null,
  }, ctx);

  // Rule 2: Torso angle — keep chest up, lean ≤45° from vertical
  applyRule({
    ok: torsoLean === null ? null : torsoLean <= 45,
    weight: 2,
    goodMsg: torsoLean !== null && torsoLean <= 30 ? 'Solid upright torso' : null,
    badMsg: torsoLean !== null && torsoLean > 45
      ? `Excessive forward lean (${Math.round(torsoLean)}°) — chest up`
      : null,
    riskMsg: torsoLean !== null && torsoLean > 60
      ? 'Lower back at risk from heavy forward lean'
      : null,
  }, ctx);

  // Rule 3: Knee tracking
  applyRule(kneeOverToe, ctx);

  if (ctx.good.length === 0 && ctx.corrections.length === 0) {
    ctx.corrections.push('Could not see your full body — try framing from the side at full height');
    ctx.score = 5;
  }

  return buildFeedback({
    ...ctx,
    tip: 'Film from the side at hip height — clearest view for squat depth and torso angle.',
  });
}

// Helper: knees should track over toes — knee x ≈ ankle x (within ~30 px tolerance scaled to body size)
function checkKneeOverToe(kp) {
  const kneeAnk = (kneeName, ankName) => {
    const knee = ifConfident(kp[kneeName], 0.3);
    const ank  = ifConfident(kp[ankName],  0.3);
    if (!knee || !ank) return null;
    const hip = ifConfident(kp[kneeName.replace('knee', 'hip')], 0.3);
    if (!hip) return null;
    const bodyScale = distance(hip, ank);
    if (!bodyScale) return null;
    // Allow knee to drift up to ~25 % of leg length forward of ankle
    const drift = Math.abs(knee.x - ank.x) / bodyScale;
    return { drift, leftSide: kneeName.startsWith('left') };
  };
  const left  = kneeAnk('left_knee',  'left_ankle');
  const right = kneeAnk('right_knee', 'right_ankle');
  const both  = [left, right].filter(Boolean);
  if (both.length === 0) return { ok: null, weight: 0 };
  const worst = Math.max(...both.map(b => b.drift));
  return {
    ok: worst <= 0.25,
    weight: 1.5,
    goodMsg: worst <= 0.15 ? 'Knees tracking well over toes' : null,
    badMsg:  worst > 0.25 ? 'Knees drifting forward past toes — sit back into your heels' : null,
    riskMsg: worst > 0.45 ? 'Knee strain risk from extreme forward drift' : null,
  };
}

function pickBest(a, b) {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  // Prefer the more flexed (smaller) angle as the "active" side at bottom
  return Math.min(a, b);
}

// ── Deadlift ──────────────────────────────────────────────────────────────────

export function analyzeDeadlift(kp) {
  const ctx = { score: 8, good: [], corrections: [], risks: [] };

  // Back/torso angle from vertical (shoulder→hip)
  const torsoSide = bestSide(kp, 'left_shoulder', 'right_shoulder');
  const hipSide   = bestSide(kp, 'left_hip', 'right_hip');
  const torsoLean = (torsoSide && hipSide)
    ? angleFromVertical(torsoSide.kp, hipSide.kp)
    : null;

  // Hip angle (shoulder–hip–knee) — hinge depth
  const hipAngle = angleAt(
    bestSide(kp, 'left_shoulder', 'right_shoulder')?.kp,
    bestSide(kp, 'left_hip', 'right_hip')?.kp,
    bestSide(kp, 'left_knee', 'right_knee')?.kp,
  );

  // Bar path proxy: wrist x relative to ankle x — bar should be over mid-foot
  const wristSide = bestSide(kp, 'left_wrist', 'right_wrist');
  const ankleSide = bestSide(kp, 'left_ankle', 'right_ankle');
  const hipForBar = bestSide(kp, 'left_hip', 'right_hip');
  let barPath = null;
  if (wristSide && ankleSide && hipForBar) {
    const bodyScale = distance(hipForBar.kp, ankleSide.kp);
    if (bodyScale > 0) {
      const offset = Math.abs(wristSide.kp.x - ankleSide.kp.x) / bodyScale;
      barPath = offset; // ~0 = perfect, >0.3 = bar drifting away from body
    }
  }

  // Rule 1: Neutral spine — extreme rounding shows up as torso lean ≥80° at the bottom (almost horizontal)
  // We can't see spine curvature directly, but excessive lean + small hip angle = likely round-back
  applyRule({
    ok: torsoLean === null ? null : torsoLean <= 75,
    weight: 2,
    goodMsg: torsoLean !== null && torsoLean <= 60 ? 'Strong, neutral back angle' : null,
    badMsg: torsoLean !== null && torsoLean > 75
      ? `Back almost horizontal (${Math.round(torsoLean)}°) — keep chest up off the floor`
      : null,
    riskMsg: torsoLean !== null && torsoLean > 85
      ? 'Lumbar disc risk from over-flexion'
      : null,
  }, ctx);

  // Rule 2: Hip hinge — at the bottom hip angle should be 80–110°
  applyRule({
    ok: hipAngle === null ? null : (hipAngle >= 80 && hipAngle <= 130),
    weight: 1.5,
    goodMsg: hipAngle !== null && hipAngle >= 80 && hipAngle <= 110 ? 'Good hinge depth' : null,
    badMsg: hipAngle !== null && hipAngle < 80
      ? 'Sitting too low — this is a hinge, not a squat. Push hips back, not down.'
      : null,
  }, ctx);

  // Rule 3: Bar path (proxy via wrist over ankle)
  applyRule({
    ok: barPath === null ? null : barPath <= 0.20,
    weight: 1.5,
    goodMsg: barPath !== null && barPath <= 0.10 ? 'Bar tracking close to body' : null,
    badMsg: barPath !== null && barPath > 0.20
      ? 'Bar is drifting away from your body — pull it into your shins'
      : null,
    riskMsg: barPath !== null && barPath > 0.35
      ? 'Lower-back lever load is dangerous — keep the bar against your legs'
      : null,
  }, ctx);

  if (ctx.good.length === 0 && ctx.corrections.length === 0) {
    ctx.corrections.push('Could not detect your full body — film side-on at hip height');
    ctx.score = 5;
  }

  return buildFeedback({
    ...ctx,
    tip: 'For deadlifts: side-view, full body in frame, bar visible against your shins.',
  });
}

// ── Bench Press ───────────────────────────────────────────────────────────────
//
// Limited on a single static frame — we can really only check elbow flare
// from a top/3-4 view, and rep-position from a side view.

export function analyzeBench(kp) {
  const ctx = { score: 8, good: [], corrections: [], risks: [] };

  // Elbow angle at bottom of press
  const leftElbow  = angleAt(kp.left_shoulder,  kp.left_elbow,  kp.left_wrist);
  const rightElbow = angleAt(kp.right_shoulder, kp.right_elbow, kp.right_wrist);
  const elbowMin = pickBest(leftElbow, rightElbow);

  // Elbow flare: angle between torso (shoulder-shoulder line) and upper arm
  // Check via shoulder-elbow vs shoulder-shoulder horizontal relationship
  const flare = checkElbowFlare(kp);

  applyRule({
    ok: elbowMin === null ? null : (elbowMin >= 60 && elbowMin <= 110),
    weight: 1.5,
    goodMsg: elbowMin !== null && elbowMin >= 70 && elbowMin <= 100 ? 'Good elbow position at bottom' : null,
    badMsg: elbowMin !== null && elbowMin < 60
      ? 'Bar dropping too low — stop at chest level'
      : elbowMin !== null && elbowMin > 110
      ? 'Half-rep — lower the bar to your chest for full range'
      : null,
  }, ctx);

  applyRule(flare, ctx);

  if (ctx.good.length === 0 && ctx.corrections.length === 0) {
    ctx.corrections.push('Couldn\'t analyze your bench — try a top-down or 45° angle so the arms are visible');
    ctx.score = 5;
  }

  return buildFeedback({
    ...ctx,
    tip: 'Bench press is best filmed from above or at a 45° angle. Side-on hides elbow flare.',
  });
}

function checkElbowFlare(kp) {
  // A rough proxy: elbow x distance from shoulder relative to elbow-wrist length.
  // Flared elbow → elbow far from torso → arm closer to 90° flare angle.
  const left = (() => {
    const sh = ifConfident(kp.left_shoulder, 0.3);
    const el = ifConfident(kp.left_elbow,    0.3);
    const wr = ifConfident(kp.left_wrist,    0.3);
    if (!sh || !el || !wr) return null;
    const armLen = distance(el, wr);
    if (!armLen) return null;
    return Math.abs(el.x - sh.x) / armLen;
  })();
  const right = (() => {
    const sh = ifConfident(kp.right_shoulder, 0.3);
    const el = ifConfident(kp.right_elbow,    0.3);
    const wr = ifConfident(kp.right_wrist,    0.3);
    if (!sh || !el || !wr) return null;
    const armLen = distance(el, wr);
    if (!armLen) return null;
    return Math.abs(el.x - sh.x) / armLen;
  })();
  const both = [left, right].filter(v => v !== null);
  if (both.length === 0) return { ok: null, weight: 0 };
  const worst = Math.max(...both);
  return {
    ok: worst <= 0.85,
    weight: 1.5,
    goodMsg: worst <= 0.60 ? 'Elbows tucked at a healthy angle' : null,
    badMsg: worst > 0.85 ? 'Elbows flaring out 90° — tuck them ~45° to spare your shoulders' : null,
    riskMsg: worst > 1.10 ? 'Shoulder impingement risk from heavy flared press' : null,
  };
}

// ── Push-up ───────────────────────────────────────────────────────────────────

export function analyzePushup(kp) {
  const ctx = { score: 8, good: [], corrections: [], risks: [] };

  // Body line: shoulder–hip–ankle should be roughly straight (165–180°)
  const bodyAngle = angleAt(
    bestSide(kp, 'left_shoulder', 'right_shoulder')?.kp,
    bestSide(kp, 'left_hip',      'right_hip')?.kp,
    bestSide(kp, 'left_ankle',    'right_ankle')?.kp,
  );

  // Elbow angle at the bottom — should reach ≤100° for full ROM
  const leftElbow  = angleAt(kp.left_shoulder,  kp.left_elbow,  kp.left_wrist);
  const rightElbow = angleAt(kp.right_shoulder, kp.right_elbow, kp.right_wrist);
  const elbowMin = pickBest(leftElbow, rightElbow);

  applyRule({
    ok: bodyAngle === null ? null : bodyAngle >= 160,
    weight: 2,
    goodMsg: bodyAngle !== null && bodyAngle >= 170 ? 'Tight plank line — well held' : null,
    badMsg: bodyAngle !== null && bodyAngle < 160
      ? bodyAngle < 150
        ? 'Hips sagging — engage your core to keep the body in a straight line'
        : 'Slight hip pike or sag — tighten your midsection'
      : null,
    riskMsg: bodyAngle !== null && bodyAngle < 140 ? 'Lower-back stress from sagging hips' : null,
  }, ctx);

  applyRule({
    ok: elbowMin === null ? null : elbowMin <= 100,
    weight: 1.5,
    goodMsg: elbowMin !== null && elbowMin <= 90 ? 'Good depth — chest near the floor' : null,
    badMsg: elbowMin !== null && elbowMin > 100
      ? `Half-reps — go deeper (your elbow only reached ${Math.round(elbowMin)}°)`
      : null,
  }, ctx);

  if (ctx.good.length === 0 && ctx.corrections.length === 0) {
    ctx.corrections.push('Couldn\'t see your full body — film side-on at floor height');
    ctx.score = 5;
  }

  return buildFeedback({
    ...ctx,
    tip: 'Side view, low camera angle, full body in frame from head to feet.',
  });
}

// ── Pull-up ───────────────────────────────────────────────────────────────────

export function analyzePullup(kp) {
  const ctx = { score: 8, good: [], corrections: [], risks: [] };

  // Chin clearance: at the top, nose y should be at or above wrist y
  const nose = ifConfident(kp.nose, 0.3);
  const leftWrist  = ifConfident(kp.left_wrist,  0.3);
  const rightWrist = ifConfident(kp.right_wrist, 0.3);
  const wristY = (leftWrist && rightWrist)
    ? Math.min(leftWrist.y, rightWrist.y)
    : (leftWrist?.y ?? rightWrist?.y);
  const chinAtBar = (nose && wristY != null) ? (nose.y <= wristY + 20) : null;

  // Elbow angle at top
  const leftElbow  = angleAt(kp.left_shoulder,  kp.left_elbow,  kp.left_wrist);
  const rightElbow = angleAt(kp.right_shoulder, kp.right_elbow, kp.right_wrist);
  const elbowMin = pickBest(leftElbow, rightElbow);

  applyRule({
    ok: chinAtBar,
    weight: 2,
    goodMsg: chinAtBar ? 'Chin clearing the bar cleanly' : null,
    badMsg: chinAtBar === false ? 'Pull higher — chin should clear the bar at the top' : null,
  }, ctx);

  applyRule({
    ok: elbowMin === null ? null : elbowMin <= 60,
    weight: 1.5,
    goodMsg: elbowMin !== null && elbowMin <= 50 ? 'Strong full pull' : null,
    badMsg: elbowMin !== null && elbowMin > 80 ? 'Half pull — drive your chest toward the bar' : null,
  }, ctx);

  if (ctx.good.length === 0 && ctx.corrections.length === 0) {
    ctx.corrections.push('Couldn\'t analyze the pull-up — try filming from the front, full body in frame');
    ctx.score = 5;
  }

  return buildFeedback({
    ...ctx,
    tip: 'Front view, full body, frame at the very top of the rep for the cleanest analysis.',
  });
}

// ── Overhead Press ────────────────────────────────────────────────────────────

export function analyzeOhp(kp) {
  const ctx = { score: 8, good: [], corrections: [], risks: [] };

  // Elbow lockout angle at top — should be ≥160°
  const leftElbow  = angleAt(kp.left_shoulder,  kp.left_elbow,  kp.left_wrist);
  const rightElbow = angleAt(kp.right_shoulder, kp.right_elbow, kp.right_wrist);
  const elbow = pickBest(leftElbow, rightElbow);

  // Wrist over shoulder over hip (vertical bar path)
  const wristSide    = bestSide(kp, 'left_wrist',    'right_wrist');
  const shoulderSide = bestSide(kp, 'left_shoulder', 'right_shoulder');
  const hipSide      = bestSide(kp, 'left_hip',      'right_hip');
  let stackOff = null;
  if (wristSide && shoulderSide && hipSide) {
    const bodyScale = distance(shoulderSide.kp, hipSide.kp);
    if (bodyScale > 0) {
      stackOff = Math.abs(wristSide.kp.x - shoulderSide.kp.x) / bodyScale;
    }
  }

  applyRule({
    ok: elbow === null ? null : elbow >= 160,
    weight: 1.5,
    goodMsg: elbow !== null && elbow >= 170 ? 'Full lockout overhead' : null,
    badMsg: elbow !== null && elbow < 160 ? `Press to full lockout (elbow at ${Math.round(elbow)}°)` : null,
  }, ctx);

  applyRule({
    ok: stackOff === null ? null : stackOff <= 0.30,
    weight: 1.5,
    goodMsg: stackOff !== null && stackOff <= 0.15 ? 'Bar stacked over shoulders' : null,
    badMsg: stackOff !== null && stackOff > 0.30 ? 'Bar pressed forward of shoulders — press straight up' : null,
    riskMsg: stackOff !== null && stackOff > 0.50 ? 'Shoulder strain from pressing in front' : null,
  }, ctx);

  if (ctx.good.length === 0 && ctx.corrections.length === 0) {
    ctx.corrections.push('Couldn\'t see your arms clearly — film side-on with the bar in frame');
    ctx.score = 5;
  }

  return buildFeedback({
    ...ctx,
    tip: 'Side view, capture at the top of the press for lockout analysis.',
  });
}

// ── Generic fallback ──────────────────────────────────────────────────────────
//
// For exercises we don't have a specific analyzer for. Returns posture-only
// feedback (body straightness) plus an honest "we don't have specific rules
// for this lift yet" note.

export function analyzeGeneric(kp, exerciseName) {
  const ctx = { score: 7, good: [], corrections: [], risks: [] };

  const bodyAngle = angleAt(
    bestSide(kp, 'left_shoulder', 'right_shoulder')?.kp,
    bestSide(kp, 'left_hip',      'right_hip')?.kp,
    bestSide(kp, 'left_ankle',    'right_ankle')?.kp,
  );

  if (bodyAngle !== null) {
    if (bodyAngle >= 165) {
      ctx.good.push('Body alignment looks straight');
    } else if (bodyAngle < 140) {
      ctx.corrections.push('Body line is bent — check your posture');
      ctx.score -= 1;
    }
  }

  return buildFeedback({
    ...ctx,
    corrections: [
      ...ctx.corrections,
      `${exerciseName}: detailed form rules aren't built in yet — pick Squat, Deadlift, Bench Press, Push-up, Pull-up, or Overhead Press for a deep analysis.`,
    ],
    tip: 'Pick one of the supported exercises for the most accurate feedback.',
  });
}

// ── Router ────────────────────────────────────────────────────────────────────
// Maps an exercise name (case-insensitive substring match) to an analyzer.

const ROUTES = [
  { match: /squat/i,                   fn: analyzeSquat },
  { match: /deadlift/i,                fn: analyzeDeadlift },
  { match: /bench(?:\s*press)?/i,      fn: analyzeBench },
  { match: /push[-\s]?up/i,            fn: analyzePushup },
  { match: /pull[-\s]?up|chin[-\s]?up/i, fn: analyzePullup },
  { match: /overhead\s*press|^ohp$|shoulder\s*press/i, fn: analyzeOhp },
];

export function routeAnalyzer(exerciseName) {
  for (const r of ROUTES) {
    if (r.match.test(exerciseName)) return r.fn;
  }
  return (kp) => analyzeGeneric(kp, exerciseName);
}
