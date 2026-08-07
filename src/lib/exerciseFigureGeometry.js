// src/lib/exerciseFigureGeometry.js
//
// Forward kinematics for the posable exercise figure. Pure — no React, no DOM
// — so the component and the offline contact sheet (scripts/pose-sheet.mjs)
// render from ONE implementation. A second copy in the script would drift
// from the component, and the drift would show up as a sheet that looks right
// while the app looks wrong, which is worse than having no sheet.
//
// ANGLES are DEGREES, clockwise, 0 = down the screen (+y), 90 = right (+x),
// 180 = up. Absolute, not relative to the parent segment: relative angles are
// more correct kinematically and much harder to author by hand, and authoring
// 117 poses is the actual cost of this feature.

// Segment lengths in viewBox units — roughly a 7.5-head figure, the standard
// figure-drawing proportion. Eight heads reads as heroic and six reads as a
// child; both look wrong demonstrating a squat.
export const SEG = {
  head:     9,   // radius
  neck:     7,
  torso:    34,
  upperArm: 21,
  foreArm:  19,
  thigh:    26,
  shin:     25,
  foot:     9,
};

const RAD = Math.PI / 180;

export function step([x, y], angleDeg, length) {
  const a = angleDeg * RAD;
  return [x + Math.sin(a) * length, y + Math.cos(a) * length];
}


// Two-link inverse kinematics: given a shoulder (or hip) and a point the hand
// (or foot) must reach, return the two absolute angles that put it there.
//
// This exists because forward angles cannot hold contact. A pull-up is
// constrained at the HANDS — they stay on the bar while the body moves — but
// poses are authored outward from the hip, so every frame put the hand
// somewhere slightly different and the lifter appeared to let go of the bar
// halfway up. Hand-tuning that for one exercise is tedious; for the nine that
// grip something it is a losing game. Solving it makes contact exact.
//
// `bend` picks which of the two mirror solutions to use: +1 elbows/knees one
// way, -1 the other. There is no "correct" default — a pull-up and a dip bend
// opposite ways — so poses say which.
export function reach(origin, target, l1, l2, bend = 1) {
  const dx = target[0] - origin[0];
  const dy = target[1] - origin[1];
  const dist = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.01) || 0.01;

  // Direction to the target in our convention: 0 = down (+y), 90 = right (+x).
  const toTarget = Math.atan2(dx, dy) / RAD;
  // Interior angle at the shoulder between the limb and the straight line.
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const a = (Math.acos(cosA) / RAD) * bend;

  const upper = toTarget + a;
  const elbowPos = step(origin, upper, l1);
  const lower = Math.atan2(target[0] - elbowPos[0], target[1] - elbowPos[1]) / RAD;
  return [upper, lower];
}

/**
 * Resolve a pose into concrete joint coordinates.
 *
 * A pose specifies only angles (plus optionally where the hips sit); every
 * position is derived. That is what keeps the data authorable — you think
 * "knee bent to 90", not "knee at (142, 187)".
 */
export function solve(pose = {}) {
  const hip = pose.hip || [100, 105];
  const torsoAngle = pose.torso ?? 180;

  const neckBase = step(hip, torsoAngle, SEG.torso);
  const headPos  = step(neckBase, pose.head ?? torsoAngle, SEG.neck + SEG.head * 0.6);

  const limb = (origin, a1, l1, a2, l2) => {
    const mid = step(origin, a1, l1);
    return { mid, end: step(mid, a2, l2) };
  };

  // A pose may either state arm angles or state where the hand must BE. The
  // latter wins, because contact with a bar is the thing the picture is about.
  const bend = pose.armBend ?? 1;
  const [shN, elN] = pose.handAt
    ? reach(neckBase, pose.handAt, SEG.upperArm, SEG.foreArm, bend)
    : [pose.shoulderNear ?? pose.shoulderFar ?? 0, pose.elbowNear ?? pose.elbowFar ?? 0];
  const [shF, elF] = pose.handAtFar
    ? reach(neckBase, pose.handAtFar, SEG.upperArm, SEG.foreArm, bend)
    : pose.handAt
      ? reach(neckBase, [pose.handAt[0] - 6, pose.handAt[1]], SEG.upperArm, SEG.foreArm, bend)
      : [pose.shoulderFar ?? 0, pose.elbowFar ?? 0];

  const armFar  = limb(neckBase, shF, SEG.upperArm, elF, SEG.foreArm);
  const armNear = limb(neckBase, shN, SEG.upperArm, elN, SEG.foreArm);
  const legFar  = limb(hip, pose.hipFar  ?? 0, SEG.thigh, pose.kneeFar ?? 0, SEG.shin);
  const legNear = limb(hip, pose.hipNear ?? pose.hipFar ?? 0, SEG.thigh,
                            pose.kneeNear ?? pose.kneeFar ?? 0, SEG.shin);

  const footFar  = step(legFar.end,  pose.ankleFar  ?? 90, SEG.foot);
  const footNear = step(legNear.end, pose.ankleNear ?? pose.ankleFar ?? 90, SEG.foot);

  return { hip, neckBase, headPos, armFar, armNear, legFar, legNear, footFar, footNear };
}

export const pts = (...p) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

// Apparatus.
//
// A pull-up drawn without a bar is just a person standing with their arms up
// — equipment is not decoration, it is what makes the pose legible.
//
// Props are DERIVED FROM THE SOLVED HANDS, never hardcoded. The first pass at
// this placed bars at fixed coordinates and the hands missed them by 10-20
// units on half the exercises, because poses are authored forward from the hip
// and the hands land wherever the joint angles put them. Deriving the bar from
// the hand makes contact true by construction instead of by my eyesight.
//
// Two kinds, and the difference matters:
//
//   held: true   moves WITH the hands, recomputed per frame (barbell,
//                dumbbells) — the implement travels through the rep.
//   held: false  stays put across the whole triptych, anchored to the FIRST
//                frame (pull-up bar, bench, cable stack) — a bar that drifts
//                between panels reads as the gym moving, not the lifter.
export const PROPS = {
  // `grip` = the hand physically holds this, so hand-to-prop contact must hold
  // across all three frames. A cable stack stands behind the lifter and a leg
  // press plate is at the FEET — those connect through a drawn line or a
  // named joint, not through the hand, and checking them as grips is noise.
  'bar-high':      { held: false, floor: false, kind: 'bar',      span: 58, grip: true },
  'bar-low':       { held: false, floor: true,  kind: 'bar',      span: 54, grip: true },
  'parallel-bars': { held: false, floor: false, kind: 'parallel', span: 62, grip: true },
  'bench-seat':    { held: false, floor: true,  kind: 'bench',    span: 40, grip: true },
  'bench-flat':    { held: false, floor: true,  kind: 'bench',    span: 46 },
  'cable-stack':   { held: false, floor: true,  kind: 'stack',    span: 0  },
  'machine':       { held: false, floor: true,  kind: 'machine',  span: 44 },
  'barbell':       { held: true,  floor: true,  kind: 'barbell',  span: 40 },
  'dumbbells':     { held: true,  floor: true,  kind: 'dumbbell', span: 9  },
};

/** Where a prop hangs off: the near hand, unless the pose names another point. */
export function anchorFor(pose) {
  const s = solve(pose);
  if (pose.propAt === 'hip')  return s.hip;
  if (pose.propAt === 'foot') return s.footNear;
  return s.armNear.end;
}

/**
 * Prop markup positioned against a resolved anchor point [x, y].
 * `anchor` comes from the first frame for fixed props, and from this frame for
 * held ones — see the note above.
 */
export function propMarkup(name, anchor, solved) {
  const p = PROPS[name];
  if (!p || !anchor) return '';
  const [ax, ay] = anchor;
  const n = (v) => v.toFixed(1);
  const g = (inner) => `<g opacity="0.55">${inner}</g>`;

  switch (p.kind) {
    case 'bar':
      return g(`<line x1="${n(ax - p.span)}" y1="${n(ay)}" x2="${n(ax + p.span)}" y2="${n(ay)}" stroke-width="7"/>`
        + (name === 'bar-high'
          ? `<line x1="${n(ax - p.span + 6)}" y1="${n(ay)}" x2="${n(ax - p.span + 6)}" y2="6" stroke-width="4" opacity="0.5"/>`
            + `<line x1="${n(ax + p.span - 6)}" y1="${n(ay)}" x2="${n(ax + p.span - 6)}" y2="6" stroke-width="4" opacity="0.5"/>`
          : `<line x1="${n(ax - p.span)}" y1="${n(ay)}" x2="${n(ax - p.span)}" y2="182" stroke-width="4" opacity="0.4"/>`));
    case 'parallel':
      // Two rails either side of the torso, at hand height.
      return g(`<line x1="${n(ax - p.span)}" y1="${n(ay)}" x2="${n(ax - 12)}" y2="${n(ay)}" stroke-width="7"/>`
             + `<line x1="${n(ax + 12)}" y1="${n(ay)}" x2="${n(ax + p.span)}" y2="${n(ay)}" stroke-width="7"/>`);
    case 'bench':
      return g(`<rect x="${n(ax - p.span)}" y="${n(ay)}" width="${n(p.span * 2)}" height="9" rx="3" stroke-width="5"/>`
             + `<line x1="${n(ax - p.span + 10)}" y1="${n(ay + 9)}" x2="${n(ax - p.span + 10)}" y2="182" stroke-width="4" opacity="0.4"/>`
             + `<line x1="${n(ax + p.span - 10)}" y1="${n(ay + 9)}" x2="${n(ax + p.span - 10)}" y2="182" stroke-width="4" opacity="0.4"/>`);
    case 'stack':
      // Cable column behind the lifter, with the line running to the hands.
      return g(`<rect x="164" y="58" width="24" height="124" rx="4" stroke-width="5"/>`
             + `<line x1="176" y1="70" x2="${n(ax)}" y2="${n(ay)}" stroke-width="3" opacity="0.8"/>`);
    case 'machine':
      return g(`<rect x="${n(ax - p.span)}" y="${n(ay)}" width="${n(p.span * 2)}" height="14" rx="4" stroke-width="5"/>`);
    case 'barbell':
      // Through the hands, plates on both ends.
      return g(`<line x1="${n(ax - p.span)}" y1="${n(ay)}" x2="${n(ax + p.span)}" y2="${n(ay)}" stroke-width="6"/>`
             + `<line x1="${n(ax - p.span)}" y1="${n(ay - 11)}" x2="${n(ax - p.span)}" y2="${n(ay + 11)}" stroke-width="7"/>`
             + `<line x1="${n(ax + p.span)}" y1="${n(ay - 11)}" x2="${n(ax + p.span)}" y2="${n(ay + 11)}" stroke-width="7"/>`);
    case 'dumbbell': {
      // One at each hand, so both arms visibly hold something.
      const bell = ([hx, hy]) =>
        `<line x1="${n(hx - p.span)}" y1="${n(hy)}" x2="${n(hx + p.span)}" y2="${n(hy)}" stroke-width="5"/>`
        + `<line x1="${n(hx - p.span)}" y1="${n(hy - 7)}" x2="${n(hx - p.span)}" y2="${n(hy + 7)}" stroke-width="6"/>`
        + `<line x1="${n(hx + p.span)}" y1="${n(hy - 7)}" x2="${n(hx + p.span)}" y2="${n(hy + 7)}" stroke-width="6"/>`;
      return g(bell(solved.armNear.end) + bell(solved.armFar.end));
    }
    default:
      return '';
  }
}

/**
 * The figure as raw SVG markup. Used by the offline contact sheet; the React
 * component renders the same shapes as elements so it can theme and animate.
 */
export function figureMarkup(pose, { accent = false, anchor = null } = {}) {
  const s = solve(pose);
  const stroke = accent ? 'var(--accent)' : 'currentColor';
  const prop = pose.prop ? PROPS[pose.prop] : null;
  const showFloor = prop ? prop.floor : true;
  // Held props follow this frame's hands; fixed props use the anchor the
  // caller carried over from frame one.
  const at = prop ? (prop.held ? anchorFor(pose) : (anchor || anchorFor(pose))) : null;
  return `
    ${showFloor ? '<line x1="12" y1="182" x2="188" y2="182" stroke-width="2" stroke-dasharray="4 6" opacity="0.28"/>' : ''}
    ${prop ? propMarkup(pose.prop, at, s) : ''}
    <g opacity="0.42" stroke-width="6">
      <polyline points="${pts(s.neckBase, s.armFar.mid, s.armFar.end)}"/>
      <polyline points="${pts(s.hip, s.legFar.mid, s.legFar.end, s.footFar)}"/>
    </g>
    <line x1="${s.hip[0].toFixed(1)}" y1="${s.hip[1].toFixed(1)}" x2="${s.neckBase[0].toFixed(1)}" y2="${s.neckBase[1].toFixed(1)}" stroke-width="11" opacity="0.9"/>
    <g stroke-width="7">
      <polyline points="${pts(s.neckBase, s.armNear.mid, s.armNear.end)}"/>
      <polyline points="${pts(s.hip, s.legNear.mid, s.legNear.end, s.footNear)}"/>
    </g>
    <circle cx="${s.headPos[0].toFixed(1)}" cy="${s.headPos[1].toFixed(1)}" r="${SEG.head}" stroke-width="5"/>
  `.replace(/stroke="currentColor"/g, `stroke="${stroke}"`);
}
