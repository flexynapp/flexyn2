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

  const armFar  = limb(neckBase, pose.shoulderFar  ?? 0, SEG.upperArm, pose.elbowFar ?? 0, SEG.foreArm);
  const armNear = limb(neckBase, pose.shoulderNear ?? pose.shoulderFar ?? 0, SEG.upperArm,
                                 pose.elbowNear    ?? pose.elbowFar    ?? 0, SEG.foreArm);
  const legFar  = limb(hip, pose.hipFar  ?? 0, SEG.thigh, pose.kneeFar ?? 0, SEG.shin);
  const legNear = limb(hip, pose.hipNear ?? pose.hipFar ?? 0, SEG.thigh,
                            pose.kneeNear ?? pose.kneeFar ?? 0, SEG.shin);

  const footFar  = step(legFar.end,  pose.ankleFar  ?? 90, SEG.foot);
  const footNear = step(legNear.end, pose.ankleNear ?? pose.ankleFar ?? 90, SEG.foot);

  return { hip, neckBase, headPos, armFar, armNear, legFar, legNear, footFar, footNear };
}

export const pts = (...p) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

// Apparatus. A pull-up drawn without a bar is just a person standing with
// their arms up — the equipment is not decoration, it is what makes the pose
// legible. Each prop also decides whether the floor line helps: a dead hang
// with a floor under the feet reads as standing, so hanging props suppress it.
export const PROPS = {
  'bar-high':      { floor: false, draw: '<line x1="46" y1="34"  x2="154" y2="34"  stroke-width="7"/><line x1="52" y1="34" x2="52" y2="8" stroke-width="4" opacity="0.5"/><line x1="148" y1="34" x2="148" y2="8" stroke-width="4" opacity="0.5"/>' },
  'bar-low':       { floor: true,  draw: '<line x1="52" y1="96"  x2="158" y2="96"  stroke-width="7"/>' },
  'parallel-bars': { floor: false, draw: '<line x1="30" y1="150" x2="96"  y2="150" stroke-width="7"/><line x1="118" y1="150" x2="184" y2="150" stroke-width="7"/>' },
  'bench':         { floor: true,  draw: '<rect x="24" y="150" width="74" height="9" rx="3" stroke-width="5"/>' },
};

/**
 * The figure as raw SVG markup. Used by the offline contact sheet; the React
 * component renders the same shapes as elements so it can theme and animate.
 */
export function figureMarkup(pose, { accent = false } = {}) {
  const s = solve(pose);
  const stroke = accent ? 'var(--accent)' : 'currentColor';
  const prop = pose.prop ? PROPS[pose.prop] : null;
  const showFloor = prop ? prop.floor : true;
  return `
    ${showFloor ? '<line x1="12" y1="182" x2="188" y2="182" stroke-width="2" stroke-dasharray="4 6" opacity="0.28"/>' : ''}
    ${prop ? `<g opacity="0.55">${prop.draw}</g>` : ''}
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
