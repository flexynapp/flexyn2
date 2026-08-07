// src/components/exercise/ExerciseFigure.jsx
//
// One posable human figure, drawn as SVG from joint angles.
//
// Why this instead of 117 drawings: start/mid/end for the 39 catalog
// exercises is 117 pictures. As images that is 1.2-1.8 MB on a mobile PWA
// that already watches its startup bundle; as 117 hand-drawn SVGs it is
// ~240 KB and 117 chances to drift out of style with each other. Here a pose
// is ~12 numbers, the whole set is ~15 KB, and every figure is visually
// identical by construction because they are the same figure.
//
// It also themes for free — everything is `currentColor` plus one accent, so
// light/dark comes from CSS rather than from re-exporting assets.
//
// The maths lives in lib/exerciseFigureGeometry so the offline contact sheet
// renders from the same implementation. See that file for the angle
// convention before authoring a pose.

import React from 'react';
import { SEG, solve, pts, PROPS } from '@/lib/exerciseFigureGeometry';

/**
 * A single posed figure.
 *
 * @param {object}  pose    joint angles (see lib/data/exercisePoses)
 * @param {boolean} accent  draw in the app accent rather than the text colour
 * @param {boolean} ground  floor reference line, so a push-up reads as
 *                          horizontal rather than as a person falling over
 */
export default function ExerciseFigure({ pose = {}, accent = false, className = '' }) {
  const s = solve(pose);
  // Apparatus decides the floor too: a dead hang drawn above a floor line
  // reads as someone standing with their arms up.
  const prop = pose.prop ? PROPS[pose.prop] : null;
  const showFloor = prop ? prop.floor : true;

  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      role="img"
      aria-hidden="true"
      fill="none"
      stroke={accent ? 'hsl(var(--primary))' : 'currentColor'}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {showFloor && (
        <line x1="12" y1="182" x2="188" y2="182" strokeWidth="2" strokeDasharray="4 6" opacity="0.28" />
      )}
      {prop && (
        <g opacity="0.55" dangerouslySetInnerHTML={{ __html: prop.draw }} />
      )}

      {/* Far-side limbs first and dimmer, so the figure reads as having depth
          without a second colour or any shading. */}
      <g opacity="0.42" strokeWidth="6">
        <polyline points={pts(s.neckBase, s.armFar.mid, s.armFar.end)} />
        <polyline points={pts(s.hip, s.legFar.mid, s.legFar.end, s.footFar)} />
      </g>

      {/* Torso heaviest — it is the mass the pose is organised around. */}
      <line
        x1={s.hip[0]} y1={s.hip[1]} x2={s.neckBase[0]} y2={s.neckBase[1]}
        strokeWidth="11" opacity="0.9"
      />

      <g strokeWidth="7">
        <polyline points={pts(s.neckBase, s.armNear.mid, s.armNear.end)} />
        <polyline points={pts(s.hip, s.legNear.mid, s.legNear.end, s.footNear)} />
      </g>

      <circle cx={s.headPos[0]} cy={s.headPos[1]} r={SEG.head} strokeWidth="5" />
    </svg>
  );
}

/**
 * The start / middle / end triptych for one exercise.
 *
 * Three panels, because a movement is a path and one frame cannot show a path
 * — and the middle panel is the position people actually get wrong. Labels
 * arrive already translated; this component holds no copy of its own.
 */
export function ExerciseDiagram({ frames = [], labels = [], className = '' }) {
  if (!frames.length) return null;
  return (
    <div className={`grid grid-cols-3 gap-2 ${className}`}>
      {frames.map((pose, i) => (
        <figure key={i} className="flex flex-col items-center gap-1 min-w-0">
          <div className="w-full rounded-lg bg-secondary/40 border border-border/50 text-foreground">
            <ExerciseFigure pose={pose} accent={i === 1} className="w-full h-auto" />
          </div>
          <figcaption className="text-micro text-muted-foreground text-center leading-tight">
            {labels[i] || ['Start', 'Middle', 'End'][i]}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
